import { Module } from '@nestjs/common';
import { InventarisService } from './inventaris.service.js';
import { InventarisController } from './inventaris.controller.js';

@Module({
  controllers: [InventarisController],
  providers: [InventarisService],
})
export class InventarisModule {}
