import { describe, it, expect, vi } from 'vitest';
import { KeuanganRepository } from './keuangan.repository.js';
export function seam(handler: (sql: string, p: any[]) => any[] = () => []) {
  const query = vi.fn(async (sql: string, p: any[] = []) => ({
    rows: handler(sql, p),
  }));
  const db = {
    query: vi.fn(async (sql: string, p: any[] = []) => handler(sql, p)),
    withTransaction: vi.fn(async (fn: any, _actor?: number) => fn({ query })),
  };
  return { db, query, repo: new KeuanganRepository(db as any) };
}
const tx = {
  kas: 'gereja',
  jenis: 'masuk',
  nominal: '25',
  tanggal: '2026-11-15',
  uraian: 'Syukur',
  koreksi_dari: null,
} as const;
describe('ledger mutations', () => {
  it('locks report rows before inserting transactions, with actor and audit', async () => {
    const { repo, query, db } = seam((sql) =>
      sql.includes('FROM laporan_mingguan')
        ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
        : sql.includes('INSERT INTO transaksi')
          ? [{ id: '9', nominal: '25' }]
          : [],
    );
    await expect(repo.addTransaction(1, tx, 7)).resolves.toMatchObject({
      id: '9',
    });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[0][0]).toContain('is_deleted = false');
    expect(db.withTransaction.mock.calls[0][1]).toBe(7);
    expect(
      query.mock.calls.find(([s]) => s.includes('INSERT INTO transaksi'))?.[1],
    ).toContain(7);
    expect(query.mock.calls.some(([s]) => s.includes('audit_log'))).toBe(true);
  });
  it('rejects missing and locked reports before every mutation', async () => {
    for (const row of [
      [],
      [{ id: 1, tanggal: '2026-11-15', terkunci: true }],
    ]) {
      const { repo, query } = seam((sql) =>
        sql.includes('FROM laporan_mingguan') ? row : [],
      );
      await expect(repo.addTransaction(1, tx, 7)).rejects.toThrow();
      await expect(
        repo.addOffering(
          1,
          {
            nama: 'A',
            bulan: '2026-11-01',
            tanggal: tx.tanggal,
            nominal: '25',
          },
          7,
        ),
      ).rejects.toThrow();
      await expect(
        repo.reconcile(1, { kas: 'gereja', saldo_fisik: '0' }, 7),
      ).rejects.toThrow();
      expect(
        query.mock.calls.some(([s]) => s.includes('INSERT INTO transaksi')),
      ).toBe(false);
    }
  });
  it('rejects future transaction dates and corrections not referencing a locked earlier report', async () => {
    const { repo } = seam((sql) =>
      sql.includes('FROM laporan_mingguan')
        ? [{ id: 2, tanggal: '2026-11-22', terkunci: false }]
        : [],
    );
    await expect(
      repo.addTransaction(2, { ...tx, tanggal: '2026-11-23' }, 7),
    ).rejects.toThrow('tanggal');
    await expect(
      repo.addTransaction(2, { ...tx, koreksi_dari: '99' }, 7),
    ).rejects.toThrow('Koreksi');
  });
  it('creates monthly offering and incoming church transaction atomically and warns for duplicate name/month', async () => {
    const { repo, query, db } = seam((sql) =>
      sql.includes('FROM laporan_mingguan')
        ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
        : sql.includes('INSERT INTO transaksi')
          ? [{ id: '9', nominal: '25' }]
          : sql.includes('SELECT id FROM persembahan')
            ? [{ id: '8' }]
            : sql.includes('INSERT INTO persembahan')
              ? [{ id: '10', nominal: '25' }]
              : [],
    );
    const result = await repo.addOffering(
      1,
      { nama: 'A', bulan: '2026-11-01', tanggal: tx.tanggal, nominal: '25' },
      7,
    );
    expect(result.peringatan).toHaveLength(1);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(
      query.mock.calls.find(([s]) => s.includes('INSERT INTO transaksi'))?.[1],
    ).toEqual(expect.arrayContaining(['gereja', 'masuk']));
    expect(
      query.mock.calls.find(([s]) =>
        s.includes('INSERT INTO persembahan'),
      )?.[1],
    ).toContain('9');
  });
});
describe('derived balances', () => {
  it('derives all four balances in SQL with BIGINT arithmetic and returns decimal strings plus exact total', async () => {
    const { repo, query } = seam((sql) =>
      sql.includes('FROM saldo_awal') && !sql.includes('SUM')
        ? ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
            kas,
            per_tanggal: '2026-11-08',
          }))
        : sql.includes('SUM')
          ? [
              { kas: 'gereja', saldo: '9007199254740993' },
              { kas: 'pusat', saldo: '2' },
              { kas: 'diakonia', saldo: '0' },
              { kas: 'pembangunan', saldo: '0' },
            ]
          : [],
    );
    expect(await repo.saldo('2026-11-15')).toEqual({
      tanggal: '2026-11-15',
      kas: {
        gereja: '9007199254740993',
        pusat: '2',
        diakonia: '0',
        pembangunan: '0',
      },
      total: '9007199254740995',
    });
    const sql = query.mock.calls.find(([s]) => s.includes('SUM'))?.[0] ?? '';
    expect(query.mock.calls[0][0]).toContain('REPEATABLE READ');
    expect(sql).toContain('l.tanggal <=');
    expect(sql).not.toContain('t.tanggal <=');
    expect(sql).toContain('::text');
    expect(sql).toContain('t.is_deleted = false');
    expect(sql).toContain('l.is_deleted = false');
    expect(sql).toContain('a.is_deleted = false');
    await expect(repo.saldo('2026-11-07')).rejects.toThrow('2026-11-08');
  });
});
describe('reconciliation monetary storage limits', () => {
  function reconciliationSeam(system: string) {
    return seam((sql, p) => {
      if (sql.includes('SUM'))
        return ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
          kas, saldo: kas === 'gereja' ? system : '0',
        }));
      if (sql.includes('FROM saldo_awal'))
        return ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
          kas, per_tanggal: '2026-11-08',
        }));
      if (sql.includes('FROM laporan_mingguan'))
        return [{ id: 1, tanggal: '2026-11-15', terkunci: false }];
      if (sql.includes('INSERT INTO rekonsiliasi'))
        return [{ id: '1', saldo_sistem: p[2], saldo_fisik: p[3] }];
      return [];
    });
  }

  it('rejects an aggregate system balance above BIGINT before any insert or audit', async () => {
    const { repo, query } = reconciliationSeam('9223372036854775808');
    await expect(
      repo.reconcile(1, { kas: 'gereja', saldo_fisik: '0' }, 7),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/penyesuaian/i) });
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/i.test(sql))).toBe(false);
  });
});

describe('reconciliation and permanent lock', () => {
  const openings = ['gereja', 'pusat', 'diakonia', 'pembangunan'].map(
    (kas) => ({ kas, per_tanggal: '2026-11-08' }),
  );
  const balances = openings.map((r) => ({ kas: r.kas, saldo: '25' }));
  function lockSeam(recons: any[], author = 8) {
    return seam((sql) =>
      sql.includes('FROM saldo_awal') && !sql.includes('SUM')
        ? openings
        : sql.includes('SUM')
          ? balances
          : sql.includes('FROM laporan_mingguan')
            ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
            : sql.includes('FROM rekonsiliasi')
              ? recons
              : sql.includes('SELECT dibuat_oleh')
                ? [{ dibuat_oleh: author }]
                : sql.includes('UPDATE laporan_mingguan')
                  ? [
                      {
                        id: 1,
                        tanggal: '2026-11-15',
                        terkunci: true,
                        disetujui_oleh: 7,
                      },
                    ]
                  : sql.includes('INSERT INTO rekonsiliasi')
                    ? [
                        {
                          id: '1',
                          saldo_sistem: '25',
                          saldo_fisik: '25',
                          selisih: '0',
                        },
                      ]
                    : [],
    );
  }
  const valid = openings.map((r) => ({
    kas: r.kas,
    saldo_sistem: '25',
    saldo_fisik: '25',
    selisih: '0',
  }));
  it('captures a fresh system balance and upserts only the requested physical count', async () => {
    const { repo, query } = lockSeam(valid);
    await expect(
      repo.reconcile(1, { kas: 'gereja', saldo_fisik: '25' }, 7),
    ).resolves.toMatchObject({ saldo_sistem: '25', selisih: '0' });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(
      query.mock.calls.find(([s]) =>
        s.includes('INSERT INTO rekonsiliasi'),
      )?.[1],
    ).toEqual([1, 'gereja', '25', '25', 7]);
  });
  it.each([
    ['incomplete', valid.slice(1)],
    [
      'nonzero',
      valid.map((r, i) => (i ? r : { ...r, selisih: '1', saldo_fisik: '26' })),
    ],
    [
      'stale',
      valid.map((r, i) =>
        i ? r : { ...r, saldo_sistem: '24', saldo_fisik: '24' },
      ),
    ],
  ])('rejects %s reconciliation before locking', async (_name, recons) => {
    const { repo, query } = lockSeam(recons as any[]);
    await expect(repo.lock(1, 7, false)).rejects.toThrow();
    expect(
      query.mock.calls.some(([s]) => s.includes('UPDATE laporan_mingguan')),
    ).toBe(false);
  });
  it('locks four freshly matching zero deltas permanently and records approval in the same transaction', async () => {
    const { repo, query } = lockSeam(valid);
    await expect(repo.lock(1, 7, true)).resolves.toMatchObject({
      terkunci: true,
      disetujui_oleh: 7,
    });
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock(20261108)');
    expect(query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(
      query.mock.calls.find(([s]) =>
        s.includes('UPDATE laporan_mingguan'),
      )?.[0],
    ).toContain('disetujui_pada');
    expect(query.mock.calls.some(([s]) => s.includes('audit_log'))).toBe(true);
  });
  it('forbids approval by the last transaction author', async () => {
    const { repo } = lockSeam(valid, 7);
    await expect(repo.lock(1, 7, true)).rejects.toThrow('terakhir');
  });
});
describe('full report reads', () => {
  it('returns per-fund previous balance, incoming/outgoing, offerings and exact final totals in a consistent snapshot', async () => {
    const openings = ['gereja', 'pusat', 'diakonia', 'pembangunan'].map(
      (kas) => ({ kas, per_tanggal: '2026-11-08' }),
    );
    const { repo, query } = seam((sql, p) =>
      sql.includes('FROM saldo_awal') && !sql.includes('SUM')
        ? openings
        : sql.includes('SUM')
          ? openings.map((r) => ({
              kas: r.kas,
              saldo:
                r.kas === 'gereja'
                  ? p[0] === '2026-11-08'
                    ? '100'
                    : '120'
                  : '0',
            }))
          : sql.includes('FROM laporan_mingguan')
            ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
            : sql.includes('FROM transaksi')
              ? [
                  { id: '1', kas: 'gereja', jenis: 'masuk', nominal: '25' },
                  { id: '2', kas: 'gereja', jenis: 'keluar', nominal: '5' },
                ]
              : sql.includes('FROM persembahan_bulanan')
                ? [{ id: '1', nominal: '25' }]
                : [],
    );
    const report = await repo.detail(1);
    expect(report.kas.gereja).toMatchObject({
      saldo_lalu: '100',
      total_penerimaan: '25',
      total_pengeluaran: '5',
      saldo_akhir: '120',
    });
    expect(report.total_persembahan).toBe('25');
    expect(report.total_saldo_akhir).toBe('120');
    expect(query.mock.calls[0][0]).toContain('REPEATABLE READ');
  });
  it('lists reports with business dates normalized to text and reports missing IDs', async () => {
    const { repo, db } = seam();
    await expect(repo.list()).resolves.toEqual([]);
    expect(db.query.mock.calls[0][0]).toContain('tanggal::text');
    expect(db.query.mock.calls[0][0]).toContain('is_deleted = false');
    await expect(repo.detail(999)).rejects.toThrow('tidak ditemukan');
  });
});
describe('report creation', () => {
  it('requires restoring a deleted preceding report rather than silently skipping its week', async () => {
    const { repo } = seam((sql) => sql.includes('FROM saldo_awal')
      ? ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({ kas, per_tanggal: '2026-11-08' }))
      : sql.includes('FROM laporan_mingguan') ? [{ id: 1, tanggal: '2026-11-15', terkunci: false, is_deleted: true }] : []);
    await expect(repo.create('2026-11-22', 7)).rejects.toThrow('dipulihkan');
  });

  it('requires all four opening balances and serializes with initialization', async () => {
    const { repo, query } = seam();
    await expect(repo.create('2026-11-15', 7)).rejects.toThrow('Saldo awal');
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock(20261108)');
  });
  it('creates only contiguous Sunday reports after the previous report is locked, with audit', async () => {
    const { repo, query } = seam((sql) =>
      sql.includes('FROM saldo_awal')
        ? ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
            kas,
            per_tanggal: '2026-11-08',
          }))
        : sql.includes('INSERT INTO laporan')
          ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
          : [],
    );
    await expect(repo.create('2026-11-15', 7)).resolves.toMatchObject({
      id: 1,
    });
    expect(query.mock.calls.some(([s]) => s.includes('audit_log'))).toBe(true);
    await expect(repo.create('2026-11-22', 7)).rejects.toThrow('2026-11-15');
    await expect(repo.create('2026-11-16', 7)).rejects.toThrow('Minggu');
  });
  it('rejects an unlocked preceding report', async () => {
    const { repo } = seam((sql) =>
      sql.includes('FROM saldo_awal')
        ? ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
            kas,
            per_tanggal: '2026-11-08',
          }))
        : sql.includes('FROM laporan_mingguan')
          ? [{ id: 1, tanggal: '2026-11-15', terkunci: false }]
          : [],
    );
    await expect(repo.create('2026-11-22', 7)).rejects.toThrow('terkunci');
  });
});
