import { BadRequestException } from '@nestjs/common';

export type Kondisi = 'baik' | 'rusak' | 'hilang';
export interface MetadataInput {
  kode: string; nama: string; lokasi: string; penanggung_jawab: string;
  keterangan: string | null; transaksi_id: string | null;
}
export interface CreateInput extends MetadataInput { kondisi: Kondisi }
export interface ConditionInput { kondisi: Kondisi; catatan: string }
export interface LoanInput { peminjam: string; tanggal_pinjam: string; rencana_kembali: string | null; catatan: string | null }
export interface ReturnInput { tanggal_kembali: string; catatan?: string | null }
const invalid = (field: string): never => { throw new BadRequestException(`${field} tidak valid`); };
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Data');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) return invalid('Kolom');
  return input;
}
export function inventoryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) return invalid('ID');
  return value;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.includes('\0')) return invalid(field);
  const result = value.trim();
  if (!result || result.length > max) return invalid(field);
  return result;
}
function optionalText(value: unknown, field: string): string | null {
  return value == null ? null : text(value, field, 2000);
}
function condition(value: unknown): Kondisi {
  if (value !== 'baik' && value !== 'rusak' && value !== 'hilang') return invalid('Kondisi');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return invalid('Tanggal');
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Tanggal');
  return value;
}
const fields = ['kode', 'nama', 'lokasi', 'penanggung_jawab', 'keterangan', 'transaksi_id'];
function metadata(input: Record<string, unknown>, partial: boolean): Partial<MetadataInput> {
  const result: Partial<MetadataInput> = {};
  for (const field of ['kode', 'nama', 'lokasi', 'penanggung_jawab'] as const) {
    if (!partial || Object.hasOwn(input, field)) result[field] = text(input[field], field, field === 'kode' ? 100 : 200);
  }
  if (!partial || Object.hasOwn(input, 'keterangan')) result.keterangan = optionalText(input.keterangan, 'Keterangan');
  if (!partial || Object.hasOwn(input, 'transaksi_id')) result.transaksi_id = input.transaksi_id == null ? null : inventoryId(input.transaksi_id);
  return result;
}
export function createInput(value: unknown): CreateInput {
  const input = object(value, [...fields, 'kondisi']);
  return { ...metadata(input, false) as MetadataInput, kondisi: input.kondisi === undefined ? 'baik' : condition(input.kondisi) };
}
export function patchInput(value: unknown): Partial<MetadataInput> {
  const input = object(value, fields);
  if (!Object.keys(input).length) return invalid('Perubahan');
  return metadata(input, true);
}
export function conditionInput(value: unknown): ConditionInput {
  const input = object(value, ['kondisi', 'catatan']);
  return { kondisi: condition(input.kondisi), catatan: text(input.catatan, 'Catatan', 2000) };
}
export function loanInput(value: unknown): LoanInput {
  const input = object(value, ['peminjam', 'tanggal_pinjam', 'rencana_kembali', 'catatan']);
  const tanggal_pinjam = date(input.tanggal_pinjam);
  const rencana_kembali = input.rencana_kembali == null ? null : date(input.rencana_kembali);
  if (rencana_kembali && rencana_kembali < tanggal_pinjam) return invalid('Rencana kembali');
  return { peminjam: text(input.peminjam, 'Peminjam', 200), tanggal_pinjam, rencana_kembali, catatan: optionalText(input.catatan, 'Catatan') };
}
export function returnInput(value: unknown): ReturnInput {
  const input = object(value, ['tanggal_kembali', 'catatan']);
  return { tanggal_kembali: date(input.tanggal_kembali), ...(Object.hasOwn(input, 'catatan') ? { catatan: optionalText(input.catatan, 'Catatan') } : {}) };
}
export function emptyInput(value: unknown): Record<string, never> {
  object(value === undefined ? {} : value, []);
  return {};
}
