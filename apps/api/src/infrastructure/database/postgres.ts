import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

@Injectable()
export class Postgres implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({ connectionString, max: 10, statement_timeout: 10_000 });
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
