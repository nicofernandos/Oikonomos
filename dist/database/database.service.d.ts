import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient, QueryResultRow } from 'pg';
export declare class DatabaseService implements OnModuleDestroy {
    private readonly pool;
    constructor(config: ConfigService);
    query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    onModuleDestroy(): Promise<void>;
}
