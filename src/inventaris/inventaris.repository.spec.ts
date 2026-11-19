import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { InventarisRepository } from './inventaris.repository.js';
import { createInput } from './dto/inventaris.dto.js';
const input = createInput({ kode: 'A', nama: 'Kursi', lokasi: 'Aula', penanggung_jawab: 'B' });
const barang = { id: '9007199254740993', ...input, is_deleted: false };
let activeLoan: any;
let row: any;
let link: any[];
let fault: string | undefined;
const query = vi.fn(async (sql: string, _params?: unknown[]): Promise<{ rows: any[] }> => {
  if (fault && sql.startsWith('INSERT INTO barang')) throw { code: fault };
  if (sql.includes('FROM transaksi')) return { rows: link };
  if (sql.startsWith('SELECT') && sql.includes('FROM barang')) return { rows: row ? [row] : [] };
  if (sql.startsWith('SELECT') && sql.includes('FROM peminjaman_barang')) return { rows: activeLoan ? [activeLoan] : [] };
  if (sql.startsWith('INSERT INTO barang') || sql.startsWith('UPDATE barang')) return { rows: [barang] };
  if (sql.startsWith('INSERT INTO riwayat')) return { rows: [{ id: '1' }] };
  if (sql.startsWith('INSERT INTO peminjaman') || sql.startsWith('UPDATE peminjaman')) return { rows: [{ id: '2', tanggal_pinjam: '2026-11-18' }] };
  return { rows: [] };
});
const db = { query: vi.fn(async (sql: string, params?: unknown[]) => (await query(sql, params)).rows), withTransaction: vi.fn(async (fn: any, _actor?: number) => fn({ query })) };
let repo: InventarisRepository;
beforeEach(() => { vi.clearAllMocks(); activeLoan = undefined; row = barang; link = [{ id: '5' }]; fault = undefined; repo = new InventarisRepository(db as unknown as DatabaseService); });
describe('inventaris repository', () => {
  it('BR-I01 creates gift plus initial history and audit atomically with actor', async () => {
    expect(await repo.create(input, 7)).toEqual(barang);
    expect(db.withTransaction).toHaveBeenCalledWith(expect.any(Function), 7);
    const sql = query.mock.calls.map(([s]) => s);
    expect(sql.filter((s) => s.startsWith('INSERT INTO barang'))).toHaveLength(1);
    expect(sql.filter((s) => s.startsWith('INSERT INTO riwayat_kondisi_barang'))).toHaveLength(1);
    expect(sql.filter((s) => s.startsWith('INSERT INTO audit_log'))).toHaveLength(1);
    expect(sql.some((s) => /(?:INSERT INTO|UPDATE|DELETE FROM) transaksi\b/.test(s))).toBe(false);
    expect(query.mock.calls.find(([s]) => s.startsWith('INSERT INTO riwayat'))?.[1]).toEqual([barang.id, null, 'baik', 'Kondisi awal', 7]);
  });
  it('BR-I01 rejects inactive/non-expense links before insertion and locks active financial parents read-only', async () => {
    link = [];
    await expect(repo.create({ ...input, transaksi_id: '5' }, 7)).rejects.toMatchObject({ status: 400 });
    expect(query.mock.calls.some(([s]) => s.startsWith('INSERT INTO barang'))).toBe(false);
    const sql = query.mock.calls.map(([s]) => s).join(' ');
    expect(sql).toContain("jenis='keluar'");
    expect(sql).toContain('t.is_deleted = false');
    expect(sql).toContain('l.is_deleted = false');
    expect(sql).toContain('FOR SHARE OF t,l');
  });
  it('BR-I02 locks item before appending condition history and updating current condition', async () => {
    const result = await repo.changeCondition(barang.id, { kondisi: 'rusak', catatan: 'Patah' }, 7);
    expect(result.barang.id).toBe(barang.id);
    const sql = query.mock.calls.map(([s]) => s);
    expect(sql[0]).toContain('FOR UPDATE');
    expect(query.mock.calls.find(([s]) => s.startsWith('INSERT INTO riwayat'))?.[1]).toEqual([barang.id, 'baik', 'rusak', 'Patah', 7]);
    expect(sql.some((s) => s.startsWith('UPDATE riwayat'))).toBe(false);
    expect(sql.some((s) => s.startsWith('UPDATE barang SET kondisi='))).toBe(true);
  });
  it('BR-I02 refuses same condition and missing/deleted item without writing history', async () => {
    await expect(repo.changeCondition(barang.id, { kondisi: 'baik', catatan: 'X' }, 7)).rejects.toMatchObject({ status: 409 });
    row = undefined;
    await expect(repo.changeCondition('1', { kondisi: 'rusak', catatan: 'X' }, 7)).rejects.toMatchObject({ status: 404 });
    row = { ...barang, is_deleted: true };
    await expect(repo.changeCondition('1', { kondisi: 'rusak', catatan: 'X' }, 7)).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.some(([s]) => s.startsWith('INSERT'))).toBe(false);
  });
  it('patches only validated metadata under item lock and checks changed expense link', async () => {
    expect(await repo.update(barang.id, { nama: 'Bangku', transaksi_id: null }, 7)).toEqual(barang);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    const update = query.mock.calls.find(([s]) => s.startsWith('UPDATE barang'))!;
    expect(update[0]).toContain('nama=$2');
    expect(update[1]).toEqual([barang.id, 'Bangku', null]);
    link = [];
    await expect(repo.update(barang.id, { transaksi_id: '8' }, 7)).rejects.toMatchObject({ status: 400 });
  });
  it('soft deletes only without active loan, restores explicitly with no business field changes', async () => {
    activeLoan = { id: '2' };
    await expect(repo.remove(barang.id, 7)).rejects.toMatchObject({ status: 409 });
    activeLoan = undefined;
    await repo.remove(barang.id, 7);
    expect(query.mock.calls.some(([s]) => s.startsWith('UPDATE barang SET is_deleted=true WHERE id=$1'))).toBe(true);
    await expect(repo.restore(barang.id, 7)).rejects.toMatchObject({ status: 409 });
    row = { ...barang, is_deleted: true };
    await repo.restore(barang.id, 7);
    expect(query.mock.calls.some(([s]) => s.startsWith('UPDATE barang SET is_deleted=false WHERE id=$1'))).toBe(true);
    expect(query.mock.calls.some(([s]) => s.startsWith('DELETE'))).toBe(false);
    row = undefined;
    await expect(repo.remove('1', 7)).rejects.toMatchObject({ status: 404 });
    await expect(repo.restore('1', 7)).rejects.toMatchObject({ status: 404 });
  });
  it('returns string IDs and metadata on active reads and rejects missing parents for child reads', async () => {
    expect(await repo.list()).toEqual([barang]);
    expect((await repo.detail(barang.id)).id).toBe(barang.id);
    expect(await repo.history(barang.id)).toEqual([]);
    expect(await repo.loans(barang.id)).toEqual([]);
    expect(query.mock.calls.some(([s]) => s.includes('id::text') && s.includes('updated_at,updated_by,modified_at,modified_by,deleted_at,deleted_by,is_deleted'))).toBe(true);
    row = undefined;
    await expect(repo.detail('1')).rejects.toMatchObject({ status: 404 });
    await expect(repo.history('1')).rejects.toMatchObject({ status: 404 });
    await expect(repo.loans('1')).rejects.toMatchObject({ status: 404 });
  });
  it('BR-I03 serializes loans on parent and refuses double loans', async () => {
    const loan = { peminjam: 'A', tanggal_pinjam: '2026-11-18', rencana_kembali: null, catatan: null };
    expect((await repo.borrow(barang.id, loan, 7)).id).toBe('2');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(query.mock.calls.find(([s]) => s.startsWith('INSERT INTO peminjaman'))?.[1]).toEqual([barang.id, 'A', '2026-11-18', null, null, 7]);
    query.mockClear(); activeLoan = { id: '2' };
    await expect(repo.borrow(barang.id, loan, 7)).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([s]) => s.startsWith('INSERT'))).toBe(false);
  });
  it('BR-I03 returns loan only for matching item and valid return date; refuses repeat return', async () => {
    activeLoan = { id: '2', tanggal_pinjam: '2026-11-18', tanggal_kembali: null };
    expect((await repo.returnLoan(barang.id, '2', { tanggal_kembali: '2026-11-19' }, 7)).id).toBe('2');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    const select = query.mock.calls.find(([s]) => s.includes('FROM peminjaman_barang'))!;
    expect(select[0]).toContain('barang_id=$1 AND id=$2');
    expect(select[1]).toEqual([barang.id, '2']);
    expect(query.mock.calls.find(([s]) => s.startsWith('UPDATE peminjaman'))?.[0]).not.toContain('catatan=');
    await expect(repo.returnLoan(barang.id, '2', { tanggal_kembali: '2026-11-17' }, 7)).rejects.toMatchObject({ status: 400 });
    activeLoan.tanggal_kembali = '2026-11-19';
    await expect(repo.returnLoan(barang.id, '2', { tanggal_kembali: '2026-11-20' }, 7)).rejects.toMatchObject({ status: 409 });
    activeLoan = undefined;
    await expect(repo.returnLoan(barang.id, '2', { tanggal_kembali: '2026-11-20' }, 7)).rejects.toMatchObject({ status: 404 });
  });
  it('maps duplicate code race to 409 and invalid relation race to 400', async () => {
    fault = '23505'; await expect(repo.create(input, 7)).rejects.toMatchObject({ status: 409 });
    fault = '23503'; await expect(repo.create(input, 7)).rejects.toMatchObject({ status: 400 });
  });
});
