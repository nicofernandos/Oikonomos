import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type { CreateInput, Kondisi, MetadataInput, ConditionInput, LoanInput, ReturnInput } from './dto/inventaris.dto.js';
import type { Barang, RiwayatKondisi, Peminjaman } from './inventaris.types.js';
const META = 'updated_at,updated_by,modified_at,modified_by,deleted_at,deleted_by,is_deleted';
const BARANG = `id::text,kode,nama,keterangan,kondisi,lokasi,penanggung_jawab,transaksi_id::text,dibuat_oleh,dibuat_pada,${META}`;
const RIWAYAT = `id::text,barang_id::text,kondisi_lama,kondisi_baru,catatan,diubah_oleh,waktu,${META}`;
const LOAN = `id::text,barang_id::text,peminjam,tanggal_pinjam::text,rencana_kembali::text,tanggal_kembali::text,catatan,dibuat_oleh,dibuat_pada,${META}`;
@Injectable()
export class InventarisRepository {
  constructor(private readonly db: DatabaseService) {}
  private async write<T>(actor: number, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    try { return await this.db.withTransaction(fn, actor); }
    catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '23505') throw new ConflictException('Kode barang atau peminjaman aktif sudah tercatat');
      if (code === '23503') throw new BadRequestException('Relasi data tidak valid');
      throw error;
    }
  }
  private async validLink(c: PoolClient, id: string | null): Promise<void> {
    if (id === null) return;
    const result = await c.query("SELECT t.id::text FROM transaksi t JOIN laporan_mingguan l ON l.id=t.laporan_id WHERE t.id=$1 AND t.jenis='keluar' AND t.is_deleted = false AND l.is_deleted = false FOR SHARE OF t,l", [id]);
    if (!result.rows.length) throw new BadRequestException('Transaksi harus berupa pengeluaran aktif pada laporan aktif');
  }
  private async audit(c: PoolClient, actor: number, aksi: string, objek: string, id: string, input: unknown): Promise<void> {
    await c.query('INSERT INTO audit_log(siapa,aksi,objek,objek_id,ringkasan) VALUES ($1,$2,$3,$4,$5::jsonb)', [actor, aksi, objek, id, JSON.stringify(input)]);
  }
  private async addHistory(c: PoolClient, id: string, old: Kondisi | null, kondisi: Kondisi, catatan: string, actor: number): Promise<RiwayatKondisi> {
    return (await c.query<RiwayatKondisi>(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_lama,kondisi_baru,catatan,diubah_oleh) VALUES ($1,$2,$3,$4,$5) RETURNING ${RIWAYAT}`, [id, old, kondisi, catatan, actor])).rows[0];
  }
  private async item(c: PoolClient, id: string, deleted = false, lock = true): Promise<Barang> {
    const row = (await c.query<Barang>(`SELECT ${BARANG} FROM barang WHERE id=$1${deleted ? '' : ' AND is_deleted = false'}${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    if (!row || (!deleted && row.is_deleted)) throw new NotFoundException('Barang tidak ditemukan');
    return row;
  }
  private async activeLoan(c: PoolClient, id: string): Promise<Peminjaman | undefined> {
    return (await c.query<Peminjaman>(`SELECT ${LOAN} FROM peminjaman_barang WHERE barang_id=$1 AND tanggal_kembali IS NULL AND is_deleted = false`, [id])).rows[0];
  }
  list(): Promise<Barang[]> {
    return this.db.query<Barang>(`SELECT ${BARANG} FROM barang WHERE is_deleted = false ORDER BY id DESC`);
  }
  async detail(id: string): Promise<Barang & { peminjaman_aktif: Peminjaman | null }> {
    return this.db.withTransaction(async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = await this.item(c, id, false, false);
      return { ...row, peminjaman_aktif: await this.activeLoan(c, id) ?? null };
    });
  }
  async history(id: string): Promise<RiwayatKondisi[]> {
    return this.db.withTransaction(async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.item(c, id, false, false);
      return (await c.query<RiwayatKondisi>(`SELECT ${RIWAYAT} FROM riwayat_kondisi_barang WHERE barang_id=$1 AND is_deleted = false ORDER BY waktu,id`, [id])).rows;
    });
  }
  async loans(id: string): Promise<Peminjaman[]> {
    return this.db.withTransaction(async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.item(c, id, false, false);
      return (await c.query<Peminjaman>(`SELECT ${LOAN} FROM peminjaman_barang WHERE barang_id=$1 AND is_deleted = false ORDER BY tanggal_pinjam DESC,id DESC`, [id])).rows;
    });
  }
  async changeCondition(id: string, input: ConditionInput, actor: number) {
    return this.write(actor, async (c) => {
      const old = await this.item(c, id);
      if (old.kondisi === input.kondisi) throw new ConflictException('Kondisi barang tidak berubah');
      const riwayat = await this.addHistory(c, id, old.kondisi, input.kondisi, input.catatan, actor);
      const barang = (await c.query<Barang>(`UPDATE barang SET kondisi=$2 WHERE id=$1 RETURNING ${BARANG}`, [id, input.kondisi])).rows[0];
      await this.audit(c, actor, 'ubah_kondisi_barang', 'barang', id, input);
      return { barang, riwayat };
    });
  }
  async update(id: string, input: Partial<MetadataInput>, actor: number): Promise<Barang> {
    return this.write(actor, async (c) => {
      await this.item(c, id);
      if (input.transaksi_id !== undefined) await this.validLink(c, input.transaksi_id);
      // Column identifiers are taken only from this fixed allowlist.
      const columns = (['kode','nama','lokasi','penanggung_jawab','keterangan','transaksi_id'] as const).filter((key) => Object.hasOwn(input, key));
      if (!columns.length) throw new BadRequestException('Perubahan tidak valid');
      const assignments = columns.map((key, index) => `${key}=$${index + 2}`).join(',');
      const barang = (await c.query<Barang>(`UPDATE barang SET ${assignments} WHERE id=$1 RETURNING ${BARANG}`, [id, ...columns.map((key) => input[key])])).rows[0];
      await this.audit(c, actor, 'ubah_barang', 'barang', id, input);
      return barang;
    });
  }
  async remove(id: string, actor: number): Promise<Barang> {
    return this.write(actor, async (c) => {
      await this.item(c, id);
      if (await this.activeLoan(c, id)) throw new ConflictException('Barang masih dipinjam');
      // Metadata and retention audit are populated by the shared triggers.
      return (await c.query<Barang>(`UPDATE barang SET is_deleted=true WHERE id=$1 RETURNING ${BARANG}`, [id])).rows[0];
    });
  }
  async restore(id: string, actor: number): Promise<Barang> {
    return this.write(actor, async (c) => {
      const barang = await this.item(c, id, true);
      if (!barang.is_deleted) throw new ConflictException('Barang masih aktif');
      return (await c.query<Barang>(`UPDATE barang SET is_deleted=false WHERE id=$1 RETURNING ${BARANG}`, [id])).rows[0];
    });
  }
  async borrow(id: string, input: LoanInput, actor: number): Promise<Peminjaman> {
    return this.write(actor, async (c) => {
      await this.item(c, id);
      if (await this.activeLoan(c, id)) throw new ConflictException('Barang masih dipinjam');
      const loan = (await c.query<Peminjaman>(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,rencana_kembali,catatan,dibuat_oleh) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${LOAN}`, [id,input.peminjam,input.tanggal_pinjam,input.rencana_kembali,input.catatan,actor])).rows[0];
      await this.audit(c, actor, 'pinjam_barang', 'peminjaman_barang', loan.id, { barang_id: id, ...input });
      return loan;
    });
  }
  async returnLoan(id: string, loanId: string, input: ReturnInput, actor: number): Promise<Peminjaman> {
    return this.write(actor, async (c) => {
      await this.item(c, id);
      const loan = (await c.query<Peminjaman>(`SELECT ${LOAN} FROM peminjaman_barang WHERE barang_id=$1 AND id=$2 AND is_deleted = false FOR UPDATE`, [id,loanId])).rows[0];
      if (!loan) throw new NotFoundException('Peminjaman tidak ditemukan');
      if (loan.tanggal_kembali !== null) throw new ConflictException('Barang sudah dikembalikan');
      if (input.tanggal_kembali < loan.tanggal_pinjam) throw new BadRequestException('Tanggal kembali tidak boleh sebelum tanggal pinjam');
      const hasNote = Object.hasOwn(input, 'catatan');
      const result = (await c.query<Peminjaman>(`UPDATE peminjaman_barang SET tanggal_kembali=$3${hasNote ? ',catatan=$4' : ''} WHERE barang_id=$1 AND id=$2 RETURNING ${LOAN}`, [id,loanId,input.tanggal_kembali,...(hasNote ? [input.catatan] : [])])).rows[0];
      await this.audit(c, actor, 'kembali_barang', 'peminjaman_barang', loanId, { barang_id: id, ...input });
      return result;
    });
  }
  async create(input: CreateInput, actor: number): Promise<Barang> {
    return this.write(actor, async (c) => {
      await this.validLink(c, input.transaksi_id);
      const row = (await c.query<Barang>(`INSERT INTO barang(kode,nama,keterangan,kondisi,lokasi,penanggung_jawab,transaksi_id,dibuat_oleh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${BARANG}`, [input.kode,input.nama,input.keterangan,input.kondisi,input.lokasi,input.penanggung_jawab,input.transaksi_id,actor])).rows[0];
      await this.addHistory(c, row.id, null, input.kondisi, 'Kondisi awal', actor);
      await this.audit(c, actor, 'buat_barang', 'barang', row.id, input);
      return row;
    });
  }
}
