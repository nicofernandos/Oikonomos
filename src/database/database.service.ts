import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

const { Pool, types } = pg;

// BIGINT uang tetap string desimal agar tidak dibulatkan oleh JavaScript.
types.setTypeParser(20, (v: string) => v);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
    });
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query<T>(text, params);
    return res.rows;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>, actorId?: number): Promise<T> {
    if (actorId !== undefined && (!Number.isSafeInteger(actorId) || actorId < 1 || actorId > 2147483647)) {
      throw new RangeError('ID pelaku tidak valid');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (actorId !== undefined) {
        await client.query("SELECT set_config('oikonomos.actor_id', $1, true)", [String(actorId)]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}