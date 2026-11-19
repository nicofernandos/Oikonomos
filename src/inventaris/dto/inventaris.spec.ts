import { describe, it, expect } from 'vitest';
import { inventoryId, createInput, patchInput, conditionInput, loanInput, returnInput, emptyInput } from './inventaris.dto.js';
const barang = { kode: ' A ', nama: ' Kursi ', lokasi: ' Aula ', penanggung_jawab: ' B ' };
describe('validasi inventaris', () => {
  it('BR-I01/04 trims text, allows gifts and preserves canonical int8 IDs', () => {
    expect(createInput(barang)).toEqual({ kode: 'A', nama: 'Kursi', lokasi: 'Aula', penanggung_jawab: 'B', keterangan: null, transaksi_id: null, kondisi: 'baik' });
    expect(createInput({ ...barang, transaksi_id: '9007199254740993' }).transaksi_id).toBe('9007199254740993');
    expect(inventoryId('9223372036854775807')).toBe('9223372036854775807');
  });
  it.each(['0', '-1', '01', '1.0', '1e2', '9223372036854775808', 1])('rejects malformed ID %s', (id) => expect(() => inventoryId(id)).toThrow());
  it.each([{ ...barang, nama: ' ' }, { ...barang, lokasi: null }, { ...barang, kode: 'a\0b' }, { ...barang, nama: 'x'.repeat(201) }, { ...barang, kondisi: 'lain' }, { ...barang, ekstra: true }, { ...barang, transaksi_id: 2 }])('rejects unsafe create payload', (body) => expect(() => createInput(body)).toThrow());
  it('strict metadata patch cannot overwrite condition, audit or tombstone fields', () => {
    expect(patchInput({ keterangan: null })).toEqual({ keterangan: null });
    for (const body of [{}, { kondisi: 'rusak' }, { updated_by: 7 }, { is_deleted: true }, { lokasi: '' }]) expect(() => patchInput(body)).toThrow();
    expect(() => emptyInput({ nama: 'x' })).toThrow();
    expect(emptyInput(undefined)).toEqual({});
  });
  it('validates condition and mandatory reason', () => {
    expect(conditionInput({ kondisi: 'rusak', catatan: ' patah ' })).toEqual({ kondisi: 'rusak', catatan: 'patah' });
    for (const body of [{ kondisi: 'lain', catatan: 'x' }, { kondisi: 'baik', catatan: '' }, { kondisi: 'baik' }]) expect(() => conditionInput(body)).toThrow();
  });
  it('validates real calendar dates and planned return ordering', () => {
    expect(loanInput({ peminjam: ' A ', tanggal_pinjam: '2028-02-29' }).peminjam).toBe('A');
    expect(returnInput({ tanggal_kembali: '2026-11-18', catatan: null })).toEqual({ tanggal_kembali: '2026-11-18', catatan: null });
    for (const tanggal_pinjam of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01']) expect(() => loanInput({ peminjam: 'A', tanggal_pinjam })).toThrow();
    expect(() => loanInput({ peminjam: 'A', tanggal_pinjam: '2026-11-18', rencana_kembali: '2026-11-17' })).toThrow();
    expect(() => returnInput({ tanggal_kembali: '2026-02-30' })).toThrow();
  });
});
