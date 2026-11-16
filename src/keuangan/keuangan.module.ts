import { Module } from '@nestjs/common';
import { KeuanganService } from './keuangan.service.js';
import { KeuanganController } from './keuangan.controller.js';

@Module({
  controllers: [KeuanganController],
  providers: [KeuanganService],
})
export class KeuanganModule {}
