import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  async checkHealth() {
    try {
      const [row] = await this.databaseService.query<{ now: Date }>(
        'SELECT NOW() AS now',
      );
      return { status: 'ok', databaseTime: row.now };
    } catch {
      throw new ServiceUnavailableException('Database is not available');
    }
  }
}
