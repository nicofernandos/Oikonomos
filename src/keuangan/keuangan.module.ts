import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { KeuanganService } from './keuangan.service.js';
import { KeuanganController, SaldoController } from './keuangan.controller.js';
import { KeuanganRepository } from './keuangan.repository.js';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [KeuanganController, SaldoController],
  providers: [KeuanganService, KeuanganRepository],
  exports: [KeuanganService, KeuanganRepository],
})
export class KeuanganModule {}
