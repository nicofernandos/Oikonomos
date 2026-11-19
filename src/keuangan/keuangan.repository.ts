import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import {
  KAS,
  type Kas,
  type TransactionInput,
  type OfferingInput,
  type ReconciliationInput,
} from './dto/finance.dto.js';
const TX =
  'id::text, laporan_id, kas, jenis, uraian, nominal::text, tanggal::text, koreksi_dari::text, dibuat_oleh, dibuat_pada';
const RECON =
  'id::text, laporan_id, kas, saldo_sistem::text, saldo_fisik::text, selisih::text, dicek_oleh, waktu';
const BALANCE_SQL = `SELECT a.kas, (a.nominal + COALESCE(SUM(CASE WHEN t.jenis='masuk' THEN t.nominal ELSE -t.nominal END),0))::text AS saldo
FROM saldo_awal a LEFT JOIN (transaksi t JOIN laporan_mingguan l ON l.id=t.laporan_id AND l.tanggal <= $1::date AND l.is_deleted = false AND t.is_deleted = false) ON t.kas=a.kas
WHERE a.is_deleted = false
GROUP BY a.kas, a.nominal ORDER BY a.kas`;
function balanceResult(tanggal: string, rows: { kas: Kas; saldo: string }[]) {
  const kas = Object.fromEntries(rows.map((r) => [r.kas, r.saldo])) as Record<
    Kas,
    string
  >;
  return {
    tanggal,
    kas,
    total: rows.reduce((n, r) => n + BigInt(r.saldo), 0n).toString(),
  };
}
const REPORT =
  'id, tanggal::text, terkunci, dibuat_oleh, dibuat_pada, dikunci_oleh, dikunci_pada, disetujui_oleh, disetujui_pada';
export interface Report {
  id: number;
  tanggal: string;
  terkunci: boolean;
  [key: string]: unknown;
}
export interface TransactionRow {
  id: string;
  laporan_id: number;
  kas: Kas;
  jenis: 'masuk' | 'keluar';
  uraian: string;
  nominal: string;
  tanggal: string;
  koreksi_dari: string | null;
  dibuat_oleh: number | null;
  dibuat_pada: Date;
}
export interface OfferingRow {
  id: string;
  laporan_id: number;
  transaksi_id: string;
  nama: string;
  bulan: string;
  nominal: string;
}
function sum(rows: { nominal: string }[]): string {
  return rows.reduce((n, r) => n + BigInt(r.nominal), 0n).toString();
}
@Injectable()
export class KeuanganRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private async audit(
    c: PoolClient,
    actor: number,
    action: string,
    entity: string,
    id: unknown,
    summary: unknown,
  ) {
    await c.query(
      'INSERT INTO audit_log (siapa,aksi,objek,objek_id,ringkasan) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [actor, action, entity, String(id), JSON.stringify(summary)],
    );
  }
  private async opening(c: PoolClient) {
    const { rows } = await c.query(
      'SELECT kas, per_tanggal::text FROM saldo_awal WHERE is_deleted = false',
    );
    if (
      rows.length !== 4 ||
      KAS.some(
        (k) => !rows.some((r) => r.kas === k && r.per_tanggal === '2026-11-08'),
      )
    )
      throw new ConflictException(
        'Saldo awal keempat kas per 2026-11-08 wajib diverifikasi',
      );
  }
  private async openReport(c: PoolClient, id: number): Promise<Report> {
    const r = (
      await c.query<Report>(
        `SELECT ${REPORT} FROM laporan_mingguan WHERE id=$1 AND is_deleted = false FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Laporan tidak ditemukan');
    if (r.terkunci)
      throw new ConflictException('Laporan sudah terkunci permanen');
    return r;
  }
  private async insertTransaction(
    c: PoolClient,
    report: Report,
    input: TransactionInput,
    actor: number,
  ) {
    if (input.tanggal > report.tanggal)
      throw new BadRequestException(
        'Tanggal transaksi melewati tanggal laporan',
      );
    if (input.koreksi_dari) {
      const origin = (
        await c.query<{ terkunci: boolean; tanggal: string }>(
          `SELECT l.terkunci, l.tanggal::text FROM transaksi t JOIN laporan_mingguan l ON l.id=t.laporan_id WHERE t.id=$1 AND t.is_deleted = false AND l.is_deleted = false`,
          [input.koreksi_dari],
        )
      ).rows[0];
      if (!origin || !origin.terkunci || origin.tanggal >= report.tanggal)
        throw new BadRequestException(
          'Koreksi wajib menunjuk transaksi laporan terkunci sebelumnya',
        );
      const next = (
        await c.query<{ id: number }>(
          'SELECT id FROM laporan_mingguan WHERE tanggal > $1::date AND NOT terkunci AND is_deleted = false ORDER BY tanggal LIMIT 1',
          [origin.tanggal],
        )
      ).rows[0];
      if (!next || next.id !== report.id)
        throw new ConflictException(
          'Koreksi harus dicatat pada laporan terbuka berikutnya',
        );
    }
    const row = (
      await c.query(
        `INSERT INTO transaksi (laporan_id,kas,jenis,uraian,nominal,tanggal,koreksi_dari,dibuat_oleh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TX}`,
        [
          report.id,
          input.kas,
          input.jenis,
          input.uraian,
          input.nominal,
          input.tanggal,
          input.koreksi_dari,
          actor,
        ],
      )
    ).rows[0];
    await this.audit(c, actor, 'tambah_transaksi', 'transaksi', row.id, input);
    return row;
  }
  async addTransaction(id: number, input: TransactionInput, actor: number) {
    return this.db.withTransaction(async (c) =>
      this.insertTransaction(c, await this.openReport(c, id), input, actor),
      actor,
    );
  }
  async addOffering(id: number, input: OfferingInput, actor: number) {
    return this.db.withTransaction(async (c) => {
      const report = await this.openReport(c, id);
      const duplicate =
        (
          await c.query(
            'SELECT id FROM persembahan_bulanan WHERE lower(btrim(nama))=lower(btrim($1)) AND bulan=$2::date AND is_deleted = false LIMIT 1',
            [input.nama, input.bulan],
          )
        ).rows.length > 0;
      const transaksi = await this.insertTransaction(
        c,
        report,
        {
          kas: 'gereja',
          jenis: 'masuk',
          uraian: `Persembahan bulanan ${input.nama} (${input.bulan})`,
          tanggal: input.tanggal,
          nominal: input.nominal,
          koreksi_dari: null,
        },
        actor,
      );
      const persembahan = (
        await c.query(
          'INSERT INTO persembahan_bulanan (laporan_id,transaksi_id,nama,bulan,nominal) VALUES ($1,$2,$3,$4,$5) RETURNING id::text, laporan_id, transaksi_id::text, nama, bulan::text, nominal::text',
          [id, transaksi.id, input.nama, input.bulan, input.nominal],
        )
      ).rows[0];
      await this.audit(
        c,
        actor,
        'tambah_persembahan',
        'persembahan_bulanan',
        persembahan.id,
        input,
      );
      return {
        persembahan,
        transaksi,
        peringatan: duplicate
          ? ['Nama dan bulan persembahan sudah tercatat']
          : [],
      };
    }, actor);
  }
  async saldo(tanggal: string) {
    if (tanggal < '2026-11-08')
      throw new BadRequestException('Saldo tersedia mulai 2026-11-08');
    return this.db.withTransaction(async (c) => {
      await c.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      await this.opening(c);
      return balanceResult(
        tanggal,
        (await c.query<{ kas: Kas; saldo: string }>(BALANCE_SQL, [tanggal]))
          .rows,
      );
    });
  }
  async reconcile(id: number, input: ReconciliationInput, actor: number) {
    return this.db.withTransaction(async (c) => {
      const report = await this.openReport(c, id);
      await this.opening(c);
      const balances = balanceResult(
        report.tanggal,
        (
          await c.query<{ kas: Kas; saldo: string }>(BALANCE_SQL, [
            report.tanggal,
          ])
        ).rows,
      );
      const system = BigInt(balances.kas[input.kas]);
      const difference = BigInt(input.saldo_fisik) - system;
      const min = -9223372036854775808n;
      const max = 9223372036854775807n;
      if (system < min || system > max || difference < min || difference > max) {
        throw new ConflictException(
          'Saldo atau selisih melebihi batas penyimpanan; catat transaksi penyesuaian',
        );
      }
      const row = (
        await c.query(
          `INSERT INTO rekonsiliasi (laporan_id,kas,saldo_sistem,saldo_fisik,dicek_oleh) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (laporan_id,kas) DO UPDATE SET saldo_sistem=EXCLUDED.saldo_sistem,saldo_fisik=EXCLUDED.saldo_fisik,dicek_oleh=EXCLUDED.dicek_oleh,waktu=now() WHERE rekonsiliasi.is_deleted = false RETURNING ${RECON}`,
          [id, input.kas, balances.kas[input.kas], input.saldo_fisik, actor],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Rekonsiliasi telah dihapus secara logis dan harus dipulihkan sebelum diperbarui');
      await this.audit(c, actor, 'rekonsiliasi', 'laporan_mingguan', id, {
        ...input,
        saldo_sistem: balances.kas[input.kas],
      });
      return row;
    }, actor);
  }
  async lock(id: number, actor: number, approval: boolean): Promise<Report> {
    return this.db.withTransaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(20261108)');
      const report = await this.openReport(c, id);
      await this.opening(c);
      const balances = balanceResult(
        report.tanggal,
        (
          await c.query<{ kas: Kas; saldo: string }>(BALANCE_SQL, [
            report.tanggal,
          ])
        ).rows,
      );
      const reconciliation = (
        await c.query<{
          kas: Kas;
          saldo_sistem: string;
          saldo_fisik: string;
          selisih: string;
        }>(`SELECT ${RECON} FROM rekonsiliasi WHERE laporan_id=$1 AND is_deleted = false`, [id])
      ).rows;
      if (
        reconciliation.length !== 4 ||
        KAS.some((k) => !reconciliation.some((r) => r.kas === k))
      )
        throw new ConflictException('Rekonsiliasi keempat kas wajib lengkap');
      if (
        reconciliation.some(
          (r) => BigInt(r.saldo_sistem) !== BigInt(balances.kas[r.kas]),
        )
      )
        throw new ConflictException(
          'Rekonsiliasi kedaluwarsa; hitung ulang saldo fisik',
        );
      if (
        reconciliation.some(
          (r) =>
            BigInt(r.selisih) !== 0n ||
            BigInt(r.saldo_fisik) !== BigInt(r.saldo_sistem),
        )
      )
        throw new ConflictException(
          'Selisih rekonsiliasi harus nol; catat transaksi penyesuaian',
        );
      if (approval) {
        const last = (
          await c.query<{ dibuat_oleh: number | null }>(
            'SELECT dibuat_oleh FROM transaksi WHERE laporan_id=$1 AND is_deleted = false ORDER BY id DESC LIMIT 1',
            [id],
          )
        ).rows[0];
        if (last?.dibuat_oleh === actor)
          throw new ConflictException(
            'Penyetuju tidak boleh sama dengan penginput transaksi terakhir',
          );
      }
      const locked = (
        await c.query<Report>(
          `UPDATE laporan_mingguan SET terkunci=true,dikunci_oleh=$2::int,dikunci_pada=now(),disetujui_oleh=CASE WHEN $3::boolean THEN $2::int ELSE NULL END,disetujui_pada=CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE id=$1 RETURNING ${REPORT}`,
          [id, actor, approval],
        )
      ).rows[0];
      await this.audit(c, actor, 'kunci_laporan', 'laporan_mingguan', id, {
        persetujuan_majelis: approval,
      });
      return locked;
    }, actor);
  }
  list(): Promise<Report[]> {
    return this.db.query<Report>(
      `SELECT ${REPORT} FROM laporan_mingguan WHERE is_deleted = false ORDER BY tanggal DESC`,
    );
  }
  async detail(id: number) {
    return this.db.withTransaction(async (c) => {
      await c.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      const laporan = (
        await c.query<Report>(
          `SELECT ${REPORT} FROM laporan_mingguan WHERE id=$1 AND is_deleted = false`,
          [id],
        )
      ).rows[0];
      if (!laporan) throw new NotFoundException('Laporan tidak ditemukan');
      await this.opening(c);
      const previousDate = new Date(
        new Date(laporan.tanggal + 'T00:00:00Z').getTime() - 7 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      const previous = balanceResult(
        previousDate,
        (
          await c.query<{ kas: Kas; saldo: string }>(BALANCE_SQL, [
            previousDate,
          ])
        ).rows,
      );
      const current = balanceResult(
        laporan.tanggal,
        (
          await c.query<{ kas: Kas; saldo: string }>(BALANCE_SQL, [
            laporan.tanggal,
          ])
        ).rows,
      );
      const transactions = (
        await c.query<TransactionRow>(
          `SELECT ${TX} FROM transaksi WHERE laporan_id=$1 AND is_deleted = false ORDER BY tanggal,id`,
          [id],
        )
      ).rows;
      const persembahan_bulanan = (
        await c.query<OfferingRow>(
          'SELECT id::text, laporan_id, transaksi_id::text, nama, bulan::text, nominal::text FROM persembahan_bulanan WHERE laporan_id=$1 AND is_deleted = false ORDER BY id',
          [id],
        )
      ).rows;
      const rekonsiliasi = (
        await c.query(
          `SELECT ${RECON} FROM rekonsiliasi WHERE laporan_id=$1 AND is_deleted = false ORDER BY kas`,
          [id],
        )
      ).rows;
      const kas = Object.fromEntries(
        KAS.map((k) => {
          const penerimaan = transactions.filter(
            (t) => t.kas === k && t.jenis === 'masuk',
          );
          const pengeluaran = transactions.filter(
            (t) => t.kas === k && t.jenis === 'keluar',
          );
          return [
            k,
            {
              saldo_lalu: previous.kas[k],
              penerimaan,
              total_penerimaan: sum(penerimaan),
              pengeluaran,
              total_pengeluaran: sum(pengeluaran),
              saldo_akhir: current.kas[k],
            },
          ];
        }),
      ) as Record<
        Kas,
        {
          saldo_lalu: string;
          penerimaan: TransactionRow[];
          total_penerimaan: string;
          pengeluaran: TransactionRow[];
          total_pengeluaran: string;
          saldo_akhir: string;
        }
      >;
      return {
        laporan,
        kas,
        persembahan_bulanan,
        total_persembahan: sum(persembahan_bulanan),
        total_saldo_lalu: previous.total,
        total_saldo_akhir: current.total,
        rekonsiliasi,
      };
    });
  }
  async create(tanggal: string, actor: number): Promise<Report> {
    if (new Date(tanggal + 'T00:00:00Z').getUTCDay() !== 0)
      throw new BadRequestException('Tanggal laporan harus hari Minggu');
    return this.db.withTransaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(20261108)');
      await this.opening(c);
      const previous = (
        await c.query<Report>(
          `SELECT ${REPORT}, is_deleted FROM laporan_mingguan ORDER BY tanggal DESC LIMIT 1 FOR UPDATE`,
        )
      ).rows[0];
      if (previous?.is_deleted) throw new ConflictException('Laporan sebelumnya telah dihapus secara logis dan harus dipulihkan');
      if (previous && !previous.terkunci)
        throw new ConflictException('Laporan sebelumnya harus terkunci');
      const expected = previous
        ? new Date(
            new Date(previous.tanggal + 'T00:00:00Z').getTime() + 7 * 86400000,
          )
            .toISOString()
            .slice(0, 10)
        : '2026-11-15';
      if (tanggal !== expected)
        throw new ConflictException(
          `Tanggal laporan berikutnya harus ${expected}`,
        );
      const report = (
        await c.query<Report>(
          `INSERT INTO laporan_mingguan (tanggal,dibuat_oleh) VALUES ($1,$2) RETURNING ${REPORT}`,
          [tanggal, actor],
        )
      ).rows[0];
      await this.audit(
        c,
        actor,
        'buat_laporan',
        'laporan_mingguan',
        report.id,
        { tanggal },
      );
      return report;
    }, actor);
  }
}
