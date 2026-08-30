import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";

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
  }

  async paymentTransaction<T>(actorId: string, correlationId: string, operation: (client: PoolClient) => Promise<T>, commandKey?: string): Promise<T> {
    if (!this.paymentPool) throw new Error("PAYMENT_DATABASE_URL is required for trusted Payment commands");
    return this.retrySerialization(async () => {
      const client = await this.paymentPool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true),set_config('aims.command_key',$3,true)", [actorId, correlationId, commandKey ?? ""]);
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
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
      const client = await this.financePool!.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true),set_config('aims.command_key',$3,true)",
          [actorId, correlationId, commandKey ?? ""],
        );
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
}
