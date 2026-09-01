import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import {failureCategory,metrics,operationalLog,safeErrorCode} from "../observability/telemetry.js";

@Injectable()
export class Postgres implements OnModuleDestroy {
  readonly pool: Pool;
  readonly financePool: Pool | null;
  readonly paymentPool: Pool | null;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    this.pool = new Pool({
      connectionString,
      max: 10,
      statement_timeout: 10_000,
      connectionTimeoutMillis: 5_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000,
    });
    this.financePool = process.env.FINANCE_DATABASE_URL
      ? new Pool({
          connectionString: process.env.FINANCE_DATABASE_URL,
          max: 5,
          statement_timeout: 10_000,
          connectionTimeoutMillis: 5_000,
          lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 15_000,
        })
      : null;
    this.paymentPool = process.env.PAYMENT_DATABASE_URL
      ? new Pool({ connectionString: process.env.PAYMENT_DATABASE_URL, max: 5, statement_timeout: 10_000, connectionTimeoutMillis: 5_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 15_000 })
      : null;
    this.observePool(this.pool,"APPLICATION");
    if(this.financePool)this.observePool(this.financePool,"FINANCE");
    if(this.paymentPool)this.observePool(this.paymentPool,"PAYMENT");
  }

  async paymentTransaction<T>(actorId: string, correlationId: string, operation: (client: PoolClient) => Promise<T>, commandKey?: string): Promise<T> {
    if (!this.paymentPool) throw new Error("PAYMENT_DATABASE_URL is required for trusted Payment commands");
    return this.retrySerialization(async () => {
      const started=performance.now();let client:PoolClient;try{client=await this.paymentPool!.connect()}catch(error){this.dbFailure("PAYMENT","EXECUTOR_CALL",error);throw error}
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true),set_config('aims.command_key',$3,true)", [actorId, correlationId, commandKey ?? ""]);
        const result = await operation(client);
        await client.query("COMMIT");
        metrics.counter("aims_db_operations_total",{pool:"PAYMENT",operation:"EXECUTOR_CALL",outcome:"SUCCESS",failure_category:"NONE"});
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        this.dbFailure("PAYMENT","EXECUTOR_CALL",error);
        throw error;
      } finally { client.release();metrics.histogram("aims_db_operation_duration_seconds",{pool:"PAYMENT",operation:"EXECUTOR_CALL"},(performance.now()-started)/1000);this.poolGauges(this.paymentPool!,"PAYMENT") }
    });
  }

  async financeTransaction<T>(
    actorId: string,
    correlationId: string,
    operation: (client: PoolClient) => Promise<T>,
    commandKey?: string,
  ): Promise<T> {
    if (!this.financePool)
      throw new Error(
        "FINANCE_DATABASE_URL is required for trusted Finance Control commands",
      );
    return this.retrySerialization(async () => {
      const started=performance.now();let client:PoolClient;try{client=await this.financePool!.connect()}catch(error){this.dbFailure("FINANCE","EXECUTOR_CALL",error);throw error}
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true),set_config('aims.command_key',$3,true)",
          [actorId, correlationId, commandKey ?? ""],
        );
        const result = await operation(client);
        await client.query("COMMIT");
        metrics.counter("aims_db_operations_total",{pool:"FINANCE",operation:"EXECUTOR_CALL",outcome:"SUCCESS",failure_category:"NONE"});
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        this.dbFailure("FINANCE","EXECUTOR_CALL",error);
        throw error;
      } finally {
        client.release();
        metrics.histogram("aims_db_operation_duration_seconds",{pool:"FINANCE",operation:"EXECUTOR_CALL"},(performance.now()-started)/1000);this.poolGauges(this.financePool!,"FINANCE");
      }
    });
  }

  async retrySerialization<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          (error as { code?: string }).code !== "40001" ||
          attempt >= maxRetries
        )
          throw error;
        metrics.counter("aims_db_operations_total",{pool:"APPLICATION",operation:"SERIALIZATION_RETRY",outcome:"RETRY",failure_category:"CONCURRENCY"});
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            10 * 2 ** attempt + Math.floor(Math.random() * 10),
          ),
        );
      }
    }
  }

  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const started=performance.now();
    let client:PoolClient;
    try{client=await this.pool.connect()}catch(error){this.dbFailure("APPLICATION","TRANSACTION",error);throw error}
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      metrics.counter("aims_db_operations_total",{pool:"APPLICATION",operation:"TRANSACTION",outcome:"SUCCESS",failure_category:"NONE"});
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      this.dbFailure("APPLICATION","TRANSACTION",error);
      throw error;
    } finally {
      client.release();
      metrics.histogram("aims_db_operation_duration_seconds",{pool:"APPLICATION",operation:"TRANSACTION"},(performance.now()-started)/1000);
      this.poolGauges(this.pool,"APPLICATION");
    }
  }

  async retryableTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.retrySerialization(() => this.transaction(operation));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    await this.financePool?.end();
    await this.paymentPool?.end();
  }
  private observePool(pool:Pool,name:string){pool.on("error",error=>this.dbFailure(name,"POOL",error));this.poolGauges(pool,name)}
  private poolGauges(pool:Pool,name:string){metrics.gauge("aims_db_pool_connections",{pool:name,state:"TOTAL"},pool.totalCount);metrics.gauge("aims_db_pool_connections",{pool:name,state:"IDLE"},pool.idleCount);metrics.gauge("aims_db_pool_connections",{pool:name,state:"WAITING"},pool.waitingCount)}
  private dbFailure(pool:string,operation:string,error:unknown){const category=failureCategory(error);metrics.counter("aims_db_operations_total",{pool,operation,outcome:"FAILURE",failure_category:category});operationalLog("error","database_operation_failed",{operation,component:pool,failure_category:category,safe_error_code:safeErrorCode(error)})}
}
