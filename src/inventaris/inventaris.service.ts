import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/user.js';
import { InventarisRepository } from './inventaris.repository.js';
import { inventoryId, createInput, patchInput, conditionInput, loanInput, returnInput, emptyInput } from './dto/inventaris.dto.js';
@Injectable()
export class InventarisService {
  constructor(private readonly repo: InventarisRepository) {}
  private authenticated(user: AuthUser): void {
    if (!user?.aktif) throw new UnauthorizedException('Autentikasi diperlukan');
  }
  private admin(user: AuthUser): void {
    this.authenticated(user);
    if (user.peran !== 'admin') throw new ForbiddenException('Hanya admin yang boleh mengubah inventaris');
  }
  async findAll(user: AuthUser) { this.authenticated(user); return this.repo.list(); }
  async findOne(user: AuthUser, id: unknown) { this.authenticated(user); return this.repo.detail(inventoryId(id)); }
  async history(user: AuthUser, id: unknown) { this.authenticated(user); return this.repo.history(inventoryId(id)); }
  async loans(user: AuthUser, id: unknown) { this.authenticated(user); return this.repo.loans(inventoryId(id)); }
  async create(user: AuthUser, body: unknown) {
    this.admin(user); return this.repo.create(createInput(body), user.id);
  }
  async update(user: AuthUser, id: unknown, body: unknown) {
    this.admin(user); return this.repo.update(inventoryId(id), patchInput(body), user.id);
  }
  async remove(user: AuthUser, id: unknown, body: unknown) {
    this.admin(user); emptyInput(body); return this.repo.remove(inventoryId(id), user.id);
  }
  async restore(user: AuthUser, id: unknown, body: unknown) {
    this.admin(user); emptyInput(body); return this.repo.restore(inventoryId(id), user.id);
  }
  async changeCondition(user: AuthUser, id: unknown, body: unknown) {
    this.admin(user); return this.repo.changeCondition(inventoryId(id), conditionInput(body), user.id);
  }
  async borrow(user: AuthUser, id: unknown, body: unknown) {
    this.admin(user); return this.repo.borrow(inventoryId(id), loanInput(body), user.id);
  }
  async returnLoan(user: AuthUser, id: unknown, loanId: unknown, body: unknown) {
    this.admin(user); return this.repo.returnLoan(inventoryId(id), inventoryId(loanId), returnInput(body), user.id);
  }
}
