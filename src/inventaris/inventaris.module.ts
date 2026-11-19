import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InventarisService } from './inventaris.service.js';
import { InventarisController } from './inventaris.controller.js';
import { InventarisRepository } from './inventaris.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InventarisController],
  providers: [InventarisService, InventarisRepository],
  exports: [InventarisService, InventarisRepository],
})
export class InventarisModule {}
