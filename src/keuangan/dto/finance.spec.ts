import { describe, expect, it } from 'vitest';
import * as dto from './finance.dto.js';
describe('finance inputs', () => {
  describe.each(['1\n', '1\r', '1\r\n', '1\u2028', '1\u2029'])('terminal line break %j', (value) => {
    it('rejects money aliases', () => {
      expect(() => dto.money(value)).toThrow('Data keuangan tidak valid');
    });
    it('rejects report ID aliases', () => {
      expect(() => dto.reportId(value)).toThrow('Data keuangan tidak valid');
    });
  });
  it('preserves canonical report ID boundaries', () => {
    expect(dto.reportId('1')).toBe(1);
    expect(dto.reportId('2147483647')).toBe(2147483647);
    expect(() => dto.reportId('2147483648')).toThrow('Data keuangan tidak valid');
  });
  describe.each(['\uD800', '\uDC00', 'A\uD800Z', '\uDC00\uD800', '😀\uD800'])('unpaired surrogate %j', (text) => {
    it('rejects transaction text', () => {
      expect(() => dto.transaction({ kas: 'gereja', jenis: 'masuk', uraian: text, nominal: '1', tanggal: '2026-11-15' })).toThrow('Data keuangan tidak valid');
    });
    it('rejects offering text', () => {
      expect(() => dto.offering({ nama: text, nominal: '1', bulan: '2026-11-01', tanggal: '2026-11-15' })).toThrow('Data keuangan tidak valid');
    });
  });
  it('preserves valid emoji and trims surrounding whitespace', () => {
    const text = 'Nama 😀 🙏 𐀀';
    expect(dto.transaction({ kas: 'gereja', jenis: 'masuk', uraian: ` ${text} `, nominal: '1', tanggal: '2026-11-15' }).uraian).toBe(text);
    expect(dto.offering({ nama: ` ${text} `, nominal: '1', bulan: '2026-11-01', tanggal: '2026-11-15' }).nama).toBe(text);
  });
  it('preserves full BIGINT precision and rejects unsafe numbers, overflow, fractions and unknown fields', () => {
    expect(dto.money('9223372036854775807')).toBe('9223372036854775807');
    expect(dto.money(123)).toBe('123');
    for (const x of [
      0,
      -1,
      1.2,
      Number.MAX_SAFE_INTEGER + 1,
      '9223372036854775808',
      '1e3',
      '01',
      null,
    ])
      expect(() => dto.money(x)).toThrow();
    expect(() =>
      dto.transaction({
        kas: 'gereja',
        jenis: 'masuk',
        tanggal: '2026-11-15',
        nominal: '1',
        uraian: 'X',
        saldo: 5,
      }),
    ).toThrow();
  });
  it('validates real dates, enum, month and non-empty text', () => {
    expect(() => dto.date('2026-02-30')).toThrow();
    expect(() =>
      dto.offering({
        nama: ' ',
        bulan: '2026-11-01',
        tanggal: '2026-11-15',
        nominal: 1,
      }),
    ).toThrow();
    expect(() =>
      dto.offering({
        nama: 'A',
        bulan: '2026-11-02',
        tanggal: '2026-11-15',
        nominal: 1,
      }),
    ).toThrow();
    expect(() =>
      dto.reconciliation({ kas: 'other', saldo_fisik: 0 }),
    ).toThrow();
    expect(dto.reconciliation({ kas: 'gereja', saldo_fisik: 0 })).toEqual({
      kas: 'gereja',
      saldo_fisik: '0',
    });
  });
});
