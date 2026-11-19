import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthRequest } from '../auth/jwt-auth.guard.js';
import { InventarisService } from './inventaris.service.js';

@Controller('inventaris')
export class InventarisController {
  constructor(
    @Inject(InventarisService) private readonly inventarisService: InventarisService,
  ) {}

  @Post()
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.inventarisService.create(req.user, body);
  }

  @Get()
  findAll(@Req() req: AuthRequest) {
    return this.inventarisService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inventarisService.findOne(req.user, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.update(req.user, id, body);
  }

  @Delete(':id')
  remove(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.remove(req.user, id, body);
  }

  @Post(':id/pulihkan')
  restore(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.restore(req.user, id, body);
  }

  @Get(':id/riwayat-kondisi')
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inventarisService.history(req.user, id);
  }

  @Post(':id/kondisi')
  changeCondition(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.changeCondition(req.user, id, body);
  }

  @Get(':id/peminjaman')
  loans(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.inventarisService.loans(req.user, id);
  }

  @Post(':id/peminjaman')
  borrow(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.borrow(req.user, id, body);
  }

  @Post(':id/peminjaman/:loanId/kembali')
  returnLoan(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('loanId') loanId: string,
    @Body() body: unknown,
  ) {
    return this.inventarisService.returnLoan(req.user, id, loanId, body);
  }
}
