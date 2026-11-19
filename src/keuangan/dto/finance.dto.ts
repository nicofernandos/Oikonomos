import { BadRequestException } from '@nestjs/common';
export const KAS = ['gereja', 'pusat', 'diakonia', 'pembangunan'] as const;
export type Kas = (typeof KAS)[number];
function invalid(): never {
  throw new BadRequestException('Data keuangan tidak valid');
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid();
  return value as Record<string, unknown>;
}
export function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '0001-01-01'
  )
    invalid();
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    invalid();
  return value;
}
export function money(value: unknown, zero = false): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) invalid();
    value = String(value);
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) invalid();
  const n = BigInt(value);
  if (n < (zero ? 0n : 1n) || n > 9223372036854775807n) invalid();
  return value;
}
export function reportId(value: string): number {
  const id = money(value);
  if (BigInt(id) > 2147483647n) invalid();
  return Number(id);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || value.includes('\u0000') || /[\uD800-\uDFFF]/u.test(value))
    invalid();
  return value.trim();
}
function kas(value: unknown): Kas {
  if (!KAS.includes(value as Kas)) invalid();
  return value as Kas;
}
export function report(value: unknown) {
  const o = object(value, ['tanggal']);
  return { tanggal: date(o.tanggal) };
}
export function transaction(value: unknown) {
  const o = object(value, [
    'kas',
    'jenis',
    'uraian',
    'nominal',
    'tanggal',
    'koreksi_dari',
  ]);
  if (o.jenis !== 'masuk' && o.jenis !== 'keluar') invalid();
  return {
    kas: kas(o.kas),
    jenis: o.jenis,
    uraian: text(o.uraian),
    nominal: money(o.nominal),
    tanggal: date(o.tanggal),
    koreksi_dari: o.koreksi_dari == null ? null : money(o.koreksi_dari),
  };
}
export function offering(value: unknown) {
  const o = object(value, ['nama', 'bulan', 'tanggal', 'nominal']);
  const bulan = date(o.bulan);
  if (!bulan.endsWith('-01')) invalid();
  return {
    nama: text(o.nama),
    bulan,
    tanggal: date(o.tanggal),
    nominal: money(o.nominal),
  };
}
export function reconciliation(value: unknown) {
  const o = object(value, ['kas', 'saldo_fisik']);
  return { kas: kas(o.kas), saldo_fisik: money(o.saldo_fisik, true) };
}
export type TransactionInput = ReturnType<typeof transaction>;
export type OfferingInput = ReturnType<typeof offering>;
export type ReconciliationInput = ReturnType<typeof reconciliation>;
