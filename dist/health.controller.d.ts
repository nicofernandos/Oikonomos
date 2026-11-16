import { DatabaseService } from './database/database.service.js';
export declare class HealthController {
    private readonly databaseService;
    constructor(databaseService: DatabaseService);
    checkHealth(): Promise<{
        status: string;
        databaseTime: Date;
    }>;
}
