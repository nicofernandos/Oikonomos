import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/user.js';
import { KeuanganRepository } from './keuangan.repository.js';
import * as dto from './dto/finance.dto.js';

@Injectable()
export class KeuanganService {
  private readonly requireApproval: boolean;
  constructor(
    @Inject(KeuanganRepository) private readonly repository: KeuanganRepository,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const value = config.get<unknown>('REQUIRE_MAJELIS_APPROVAL');
    if (value !== undefined && value !== 'false' && value !== 'true')
      throw new Error('REQUIRE_MAJELIS_APPROVAL harus true atau false');
    this.requireApproval = value === 'true';
  }
  private writer(user: AuthUser) {
    if (user.peran !== 'bendahara')
      throw new ForbiddenException('Hanya bendahara dapat menulis keuangan');
  }
  create(user: AuthUser, body: unknown) {
    this.writer(user);
    return this.repository.create(dto.report(body).tanggal, user.id);
  }
  list() {
    return this.repository.list();
  }
  detail(id: string) {
    return this.repository.detail(dto.reportId(id));
  }
  saldo(tanggal: unknown) {
    return this.repository.saldo(dto.date(tanggal));
  }
  addTransaction(user: AuthUser, id: string, body: unknown) {
    this.writer(user);
    return this.repository.addTransaction(
      dto.reportId(id),
      dto.transaction(body),
      user.id,
    );
  }
  addOffering(user: AuthUser, id: string, body: unknown) {
    this.writer(user);
    return this.repository.addOffering(
      dto.reportId(id),
      dto.offering(body),
      user.id,
    );
  }
  reconcile(user: AuthUser, id: string, body: unknown) {
    this.writer(user);
    return this.repository.reconcile(
      dto.reportId(id),
      dto.reconciliation(body),
      user.id,
    );
  }
  lock(user: AuthUser, id: string, body: unknown) {
    if (
      this.requireApproval
        ? user.peran !== 'majelis'
        : user.peran !== 'bendahara'
    )
      throw new ForbiddenException(
        this.requireApproval
          ? 'Penguncian memerlukan persetujuan majelis'
          : 'Hanya bendahara dapat mengunci laporan',
      );
    dto.object(body ?? {}, []);
    return this.repository.lock(
      dto.reportId(id),
      user.id,
      this.requireApproval,
    );
  }
}
