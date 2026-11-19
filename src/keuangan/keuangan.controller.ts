import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthRequest } from '../auth/jwt-auth.guard.js';
import { KeuanganService } from './keuangan.service.js';

@Controller('laporan')
export class KeuanganController {
  constructor(
    @Inject(KeuanganService) private readonly service: KeuanganService,
  ) {}
  @Get()
  list() {
    return this.service.list();
  }
  @Post()
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.user, body);
  }
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
  @Post(':id/transaksi')
  transaction(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addTransaction(req.user, id, body);
  }
  @Post(':id/persembahan')
  offering(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addOffering(req.user, id, body);
  }
  @Post(':id/rekonsiliasi')
  reconcile(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.reconcile(req.user, id, body);
  }
  @Post(':id/kunci')
  lock(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.lock(req.user, id, body);
  }
}

@Controller('saldo')
export class SaldoController {
  constructor(
    @Inject(KeuanganService) private readonly service: KeuanganService,
  ) {}
  @Get()
  saldo(@Query('tanggal') tanggal: unknown) {
    return this.service.saldo(tanggal);
  }
}
