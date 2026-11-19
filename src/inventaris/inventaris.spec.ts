import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventarisService } from './inventaris.service.js';
import type { InventarisRepository } from './inventaris.repository.js';
import type { AuthUser } from '../auth/user.js';
const user: AuthUser = { id: 7, username: 'a', nama: 'A', peran: 'admin', aktif: true };
const input = { kode: ' A ', nama: 'Kursi', lokasi: 'Aula', penanggung_jawab: 'B' };
const methods = ['list','detail','history','loans','create','update','remove','restore','changeCondition','borrow','returnLoan'] as const;
const repo = Object.fromEntries(methods.map((key) => [key, vi.fn(async () => ({ id: '9007199254740993' }))])) as unknown as Record<typeof methods[number], ReturnType<typeof vi.fn>>;
const service = new InventarisService(repo as unknown as InventarisRepository);
const writes = (actor: AuthUser) => [
  () => service.create(actor, input), () => service.update(actor, '1', { nama: 'Bangku' }),
  () => service.remove(actor, '1', {}), () => service.restore(actor, '1', {}),
  () => service.changeCondition(actor, '1', { kondisi: 'rusak', catatan: 'Patah' }),
  () => service.borrow(actor, '1', { peminjam: 'A', tanggal_pinjam: '2026-11-18' }),
  () => service.returnLoan(actor, '1', '2', { tanggal_kembali: '2026-11-18' }),
];
beforeEach(() => vi.clearAllMocks());
describe('inventaris service access and validation before SQL', () => {
  it('permits only ADMIN for every write, never calling repository for other roles', async () => {
    for (const peran of ['bendahara','majelis'] as const) {
      for (const action of writes({ ...user, peran })) await expect(action()).rejects.toMatchObject({ status: 403 });
    }
    for (const mock of Object.values(repo)) expect(mock).not.toHaveBeenCalled();
  });
  it('requires active authentication for read and write', async () => {
    for (const actor of [undefined, { ...user, aktif: false }]) {
      await expect(service.findAll(actor as AuthUser)).rejects.toMatchObject({ status: 401 });
      await expect(service.create(actor as AuthUser, input)).rejects.toMatchObject({ status: 401 });
    }
    for (const mock of Object.values(repo)) expect(mock).not.toHaveBeenCalled();
  });
  it('allows every authenticated role to read all inventory resources', async () => {
    for (const peran of ['admin','bendahara','majelis'] as const) {
      const actor = { ...user, peran };
      await service.findAll(actor); await service.findOne(actor, '9007199254740993');
      await service.history(actor, '1'); await service.loans(actor, '1');
    }
    expect(repo.detail).toHaveBeenCalledWith('9007199254740993');
  });
  it('passes actor and normalized validated payload for all writes', async () => {
    for (const action of writes(user)) await action();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ kode: 'A', transaksi_id: null }), 7);
    expect(repo.update).toHaveBeenCalledWith('1', { nama: 'Bangku' }, 7);
    expect(repo.remove).toHaveBeenCalledWith('1', 7);
    expect(repo.restore).toHaveBeenCalledWith('1', 7);
    expect(repo.changeCondition).toHaveBeenCalledWith('1', { kondisi: 'rusak', catatan: 'Patah' }, 7);
    expect(repo.borrow).toHaveBeenCalledWith('1', expect.objectContaining({ peminjam: 'A' }), 7);
    expect(repo.returnLoan).toHaveBeenCalledWith('1', '2', { tanggal_kembali: '2026-11-18' }, 7);
  });
  it('rejects unknown bodies, malformed IDs and invalid dates without repository', async () => {
    const bad = [() => service.create(user, { ...input, dibuat_oleh: 2 }), () => service.update(user, '1', { kondisi: 'rusak' }), () => service.remove(user, '1', { is_deleted: true }), () => service.restore(user, '1', { nama: 'x' }), () => service.changeCondition(user, '1', { kondisi: 'buruk', catatan: 'x' }), () => service.borrow(user, '1', { peminjam: 'A', tanggal_pinjam: '2026-02-30' }), () => service.returnLoan(user, '1', '01', { tanggal_kembali: '2026-11-18' }), () => service.findOne(user, '9223372036854775808')];
    for (const action of bad) await expect(action()).rejects.toMatchObject({ status: 400 });
    for (const mock of Object.values(repo)) expect(mock).not.toHaveBeenCalled();
  });
});
