import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const databaseUrl = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const migration = '1794930000010_inventaris.sql';
const tables = ['barang', 'riwayat_kondisi_barang', 'peminjaman_barang'] as const;

suite('BR-I01..04: skema inventaris PostgreSQL nyata', () => {
  const schema = `inventory_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let user: number;
  let item: string;
  let serial = 0;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Gunakan database khusus berakhiran _test');
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query((await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0]);
    }
    user = (await pool.query("INSERT INTO users(username,password_hash,nama,peran) VALUES ('inventory-admin','test-only','Admin','admin') RETURNING id")).rows[0].id;
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('oikonomos.actor_id',$1,true)", [String(user)]);
  });
  afterEach(async () => { await client?.query('ROLLBACK'); client?.release(); });

  async function barang(connection: pg.PoolClient | pg.Pool = client) {
    return (await connection.query(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh)
      VALUES ($1,'Kursi','Gereja','Petugas',$2) RETURNING *`, [`INV-${++serial}`, user])).rows[0];
  }
  async function denied(sql: string, values: unknown[] = [], pattern: RegExp = /./) {
    await client.query('SAVEPOINT denied');
    await expect(client.query(sql, values)).rejects.toThrow(pattern);
    await client.query('ROLLBACK TO SAVEPOINT denied');
  }
  async function history(id = item) {
    return (await client.query(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_lama,kondisi_baru,catatan,diubah_oleh)
      VALUES ($1,NULL,'baik','Pencatatan awal',$2) RETURNING *`, [id,user])).rows[0];
  }
  async function loan(id = item) {
    return (await client.query(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh)
      VALUES ($1,'Peminjam','2026-11-18',$2) RETURNING *`, [id,user])).rows[0];
  }

  it('BR-I01/04: teks wajib tidak kosong, kode unik, FK dan tanggal pinjam valid', async () => {
    item = (await barang()).id;
    for (const column of ['kode','nama','lokasi','penanggung_jawab']) {
      await denied(`UPDATE barang SET ${column}='   ' WHERE id=$1`, [item], /check constraint/i);
      await denied(`UPDATE barang SET ${column}=$2 WHERE id=$1`, [item,'a\0b'], /invalid byte sequence/i);
    }
    await denied('UPDATE barang SET keterangan=$2 WHERE id=$1', [item,'  '], /check constraint/i);
    await denied(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh) SELECT kode,nama,lokasi,penanggung_jawab,dibuat_oleh FROM barang WHERE id=$1`, [item], /unique constraint/i);
    await denied('UPDATE barang SET dibuat_oleh=2147483647 WHERE id=$1', [item], /foreign key/i);
    await denied(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_baru,catatan,diubah_oleh) VALUES ($1,'baik','  ',$2)`, [item,user], /check constraint/i);
    for (const [start,plan,end] of [ ['2026-11-18','2026-11-17',null],['2026-11-18',null,'2026-11-17'] ]) {
      await denied(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,rencana_kembali,tanggal_kembali,dibuat_oleh) VALUES ($1,'Nama',$2,$3,$4,$5)`, [item,start,plan,end,user], /check constraint/i);
    }
    await denied(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,' ','2026-11-18',$2)`, [item,user], /check constraint/i);
    // No unconfirmed rule forbids lending damaged/lost items, or late returns.
    await client.query("UPDATE barang SET kondisi='hilang' WHERE id=$1", [item]);
    await client.query(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,rencana_kembali,tanggal_kembali,catatan,dibuat_oleh) VALUES ($1,'Nama','2026-11-18','2026-11-18','2026-11-20',NULL,$2)`, [item,user]);
  });

  it('BR-I03: riwayat append-only dan perubahan kondisi atomik melalui transaksi aplikasi', async () => {
    item = (await barang()).id;
    const initial = await history();
    for (const change of ["catatan='Ubah'", "kondisi_baru='rusak'", 'updated_by=NULL', 'is_deleted=true', 'is_deleted=false']) {
      await denied(`UPDATE riwayat_kondisi_barang SET ${change} WHERE id=$1`, [initial.id], /riwayat.*tidak dapat diubah/i);
    }
    await client.query('SAVEPOINT perubahan');
    await client.query("UPDATE barang SET kondisi='rusak' WHERE id=$1", [item]);
    await denied(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_lama,kondisi_baru,catatan,diubah_oleh) VALUES ($1,'baik','rusak',' ', $2)`, [item,user], /check constraint/i);
    await client.query('ROLLBACK TO SAVEPOINT perubahan');
    expect((await client.query('SELECT kondisi FROM barang WHERE id=$1', [item])).rows[0].kondisi).toBe('baik');
    await client.query("UPDATE barang SET kondisi='rusak' WHERE id=$1", [item]);
    await client.query(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_lama,kondisi_baru,catatan,diubah_oleh) VALUES ($1,'baik','rusak','Rusak saat diperiksa',$2)`, [item,user]);
    expect((await client.query('SELECT kondisi_baru FROM riwayat_kondisi_barang WHERE barang_id=$1 ORDER BY id', [item])).rows.map((r) => r.kondisi_baru)).toEqual(['baik','rusak']);
  });

  it('BR-I04: satu pinjaman aktif, tidak dapat disembunyikan, pengembalian sekali dan barang terhapus tertutup', async () => {
    item = (await barang()).id;
    const active = await loan();
    await denied(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,'Lain','2026-11-18',$2)`, [item,user], /unique constraint/i);
    await denied('UPDATE barang SET is_deleted=true WHERE id=$1', [item], /pinjaman.*aktif/i);
    await denied('UPDATE peminjaman_barang SET is_deleted=true WHERE id=$1', [active.id], /pinjaman.*aktif/i);
    await client.query("UPDATE peminjaman_barang SET tanggal_kembali='2026-11-20' WHERE id=$1", [active.id]);
    for (const change of ["peminjam='Lain'", "tanggal_pinjam='2026-11-19'", 'tanggal_kembali=NULL', "tanggal_kembali='2026-11-21'", "catatan='Ubah'"]) {
      await denied(`UPDATE peminjaman_barang SET ${change} WHERE id=$1`, [active.id], /dikembalikan.*tidak dapat diubah/i);
    }
    // A returned loan may be retained/restored, without rewriting business data.
    await client.query('UPDATE peminjaman_barang SET is_deleted=true WHERE id=$1', [active.id]);
    await client.query('UPDATE peminjaman_barang SET is_deleted=false WHERE id=$1', [active.id]);
    await client.query('UPDATE barang SET is_deleted=true WHERE id=$1', [item]);
    await denied(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_baru,catatan,diubah_oleh) VALUES ($1,'baik','Baru',$2)`, [item,user], /barang.*dihapus/i);
    await denied(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,'Nama','2026-11-18',$2)`, [item,user], /barang.*dihapus/i);
    await denied('UPDATE peminjaman_barang SET updated_by=NULL WHERE id=$1', [active.id], /barang.*dihapus/i);
    await denied("UPDATE barang SET nama='Ubah' WHERE id=$1", [item], /dihapus.*dipulihkan/i);
    await denied("UPDATE barang SET is_deleted=false,nama='Ubah' WHERE id=$1", [item], /pemulihan.*data/i);
    await client.query('UPDATE barang SET is_deleted=false WHERE id=$1', [item]);
    await loan();
  });

  it('BR-I02: tautan hanya pengeluaran aktif pada laporan aktif tanpa mengubah keuangan', async () => {
    item = (await barang()).id;
    const report = (await client.query("INSERT INTO laporan_mingguan(tanggal) VALUES ('2026-11-22') RETURNING id")).rows[0].id;
    const expense = (await client.query(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES ($1,'gereja','keluar','Pembelian',1,'2026-11-18') RETURNING *`, [report])).rows[0];
    const income = (await client.query(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES ($1,'gereja','masuk','Penerimaan',1,'2026-11-18') RETURNING id`, [report])).rows[0].id;
    await denied('UPDATE barang SET transaksi_id=9223372036854775807 WHERE id=$1', [item], /foreign key/i);
    await denied('UPDATE barang SET transaksi_id=$2 WHERE id=$1', [item,income], /pengeluaran.*aktif/i);
    await client.query('UPDATE barang SET transaksi_id=$2 WHERE id=$1', [item,expense.id]);
    expect((await client.query('SELECT * FROM transaksi WHERE id=$1', [expense.id])).rows[0]).toEqual(expense);
    await denied('UPDATE transaksi SET is_deleted=true WHERE id=$1', [expense.id], /barang.*aktif/i);
    await denied("UPDATE transaksi SET jenis='masuk' WHERE id=$1", [expense.id], /barang.*aktif/i);
    await client.query('UPDATE barang SET is_deleted=true WHERE id=$1', [item]);
    await client.query('UPDATE transaksi SET is_deleted=true WHERE id=$1', [expense.id]);
    await denied('UPDATE barang SET is_deleted=false WHERE id=$1', [item], /pengeluaran.*aktif/i);
    await denied(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh,transaksi_id) VALUES ('DEAD-LINK','Barang','Gereja','Petugas',$1,$2)`, [user,expense.id], /pengeluaran.*aktif/i);
    // Defensive validation even if an administrator bypassed old report guards.
    await client.query('UPDATE transaksi SET is_deleted=true WHERE id=$1', [income]);
    await client.query('UPDATE laporan_mingguan SET is_deleted=true WHERE id=$1', [report]);
    await client.query('ALTER TABLE transaksi DISABLE TRIGGER USER');
    await client.query('UPDATE transaksi SET is_deleted=false,deleted_at=NULL,deleted_by=NULL WHERE id=$1', [expense.id]);
    await client.query('ALTER TABLE transaksi ENABLE TRIGGER USER');
    await denied(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh,transaksi_id) VALUES ('DEAD-REPORT','Barang','Gereja','Petugas',$1,$2)`, [user,expense.id], /pengeluaran.*aktif/i);
  });

  it('BR-I02: tautan laporan terkunci boleh dibaca, guard penulisan keuangan tetap berlaku', async () => {
    item = (await barang()).id;
    const report = (await client.query("INSERT INTO laporan_mingguan(tanggal) VALUES ('2026-11-22') RETURNING id")).rows[0].id;
    const expense = (await client.query(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES ($1,'gereja','keluar','Pembelian',1,'2026-11-18') RETURNING id`, [report])).rows[0].id;
    await client.query('UPDATE laporan_mingguan SET terkunci=true WHERE id=$1', [report]);
    await client.query('UPDATE barang SET transaksi_id=$2 WHERE id=$1', [item,expense]);
    await denied("UPDATE transaksi SET nominal=2 WHERE id=$1", [expense], /laporan terkunci/i);
    await denied('UPDATE transaksi SET is_deleted=true WHERE id=$1', [expense]);
    expect((await client.query('SELECT nominal::text, is_deleted FROM transaksi WHERE id=$1', [expense])).rows[0]).toEqual({ nominal: '1', is_deleted: false });
  });

  it('BR-I01: down menolak kehilangan barang, termasuk tombstone, dan tidak melepas guard', async () => {
    const down = (await readFile(`migrations/${migration}`, 'utf8')).split('-- Down Migration')[1];
    item = (await barang()).id;
    await denied(down, [], /rollback.*ditolak.*data|data.*rollback.*ditolak/i);
    await client.query('UPDATE barang SET is_deleted=true WHERE id=$1', [item]);
    await denied(down, [], /rollback.*ditolak.*data|data.*rollback.*ditolak/i);
    expect((await client.query('SELECT is_deleted FROM barang WHERE id=$1', [item])).rows[0].is_deleted).toBe(true);
    await denied('DELETE FROM barang WHERE false', [], /penghapusan fisik/i);
  });

  it('BR-I01: down/up kosong aman dan mempertahankan helper serta guard lama', async () => {
    const [up,down] = (await readFile(`migrations/${migration}`, 'utf8')).split('-- Down Migration');
    const before = (await client.query('SELECT * FROM users ORDER BY id')).rows;
    await client.query(down);
    expect((await client.query("SELECT to_regclass('barang') AS relation,to_regtype('kondisi_barang') AS enum")).rows[0]).toEqual({ relation: null,enum: null });
    for (const fn of ['isi_metadata_retensi()','tolak_penghapusan_fisik()','audit_retensi()']) expect((await client.query('SELECT to_regprocedure($1) AS helper', [fn])).rows[0].helper).not.toBeNull();
    await denied('DELETE FROM users WHERE false', [], /penghapusan fisik/i);
    expect((await client.query('SELECT * FROM users ORDER BY id')).rows).toEqual(before);
    await client.query(up);
    item = (await barang()).id;
    await history();
    await loan();
    for (const table of tables) await denied(`DELETE FROM ${table} WHERE false`, [], /penghapusan fisik/i);
  });

  async function isolated(run: (db: pg.Pool) => Promise<void>) {
    const isolatedSchema = `inventory_race_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${isolatedSchema}`);
    await admin.query(`CREATE SCHEMA ${isolatedSchema}`);
    const db = new pg.Pool({ connectionString: url.toString() });
    try {
      for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
        await db.query((await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0]);
      }
      await db.query("INSERT INTO users(id,username,password_hash,nama,peran) VALUES ($1,'admin','test-only','Admin','admin')", [user]);
      await run(db);
    } finally {
      await db.end();
      await admin.query(`DROP SCHEMA ${isolatedSchema} CASCADE`);
    }
  }
  async function blocked(db: pg.Pool, pid: number) {
    // Observe an actual server-side lock wait, not an arbitrary scheduling sleep.
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await db.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0].blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected competing PostgreSQL session to block');
  }

  it('BR-I04: dua pinjaman konkuren diserialisasi oleh lock barang dan indeks unik', async () => {
    await isolated(async (db) => {
      const id = (await barang(db)).id;
      const first = await db.connect();
      const second = await db.connect();
      try {
        await first.query('BEGIN');
        await second.query('BEGIN');
        const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const sql = `INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,'Nama','2026-11-18',$2)`;
        await first.query(sql, [id,user]);
        const competing = second.query(sql, [id,user]).then(() => null, (error: { code: string }) => error);
        await blocked(db,pid);
        await first.query('COMMIT');
        expect(await competing).toMatchObject({ code: '23505' });
        await second.query('ROLLBACK');
        expect((await db.query('SELECT count(*)::int AS total FROM peminjaman_barang WHERE barang_id=$1 AND tanggal_kembali IS NULL AND NOT is_deleted', [id])).rows[0].total).toBe(1);
      } finally {
        await first.query('ROLLBACK'); await second.query('ROLLBACK');
        first.release(); second.release();
      }
    });
  });

  it('BR-I04: soft-delete barang konkuren dengan pinjaman tidak menghasilkan anak aktif pada tombstone', async () => {
    await isolated(async (db) => {
      const id = (await barang(db)).id;
      const first = await db.connect();
      const second = await db.connect();
      try {
        await first.query('BEGIN'); await second.query('BEGIN');
        const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await first.query('UPDATE barang SET is_deleted=true WHERE id=$1', [id]);
        const competing = second.query(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,'Nama','2026-11-18',$2)`, [id,user]).then(() => null, (error: Error) => error);
        await blocked(db,pid);
        await first.query('COMMIT');
        expect(await competing).toMatchObject({ message: expect.stringMatching(/barang.*dihapus/i) });
        await second.query('ROLLBACK');
        expect((await db.query('SELECT count(*)::int AS total FROM peminjaman_barang WHERE barang_id=$1', [id])).rows[0].total).toBe(0);
        // Reverse ordering: a loan owns the same item lock before deletion.
        await db.query('UPDATE barang SET is_deleted=false WHERE id=$1', [id]);
        await first.query('BEGIN'); await second.query('BEGIN');
        await first.query(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES ($1,'Nama','2026-11-18',$2)`, [id,user]);
        const deletion = second.query('UPDATE barang SET is_deleted=true WHERE id=$1', [id]).then(() => null, (error: Error) => error);
        await blocked(db,pid);
        await first.query('COMMIT');
        expect(await deletion).toMatchObject({ message: expect.stringMatching(/pinjaman.*aktif/i) });
        await second.query('ROLLBACK');
        expect((await db.query('SELECT is_deleted FROM barang WHERE id=$1', [id])).rows[0].is_deleted).toBe(false);
      } finally {
        await first.query('ROLLBACK'); await second.query('ROLLBACK');
        first.release(); second.release();
      }
    });
  });

  it('BR-I02: pembuatan tautan bersaing dengan soft-delete transaksi secara aman', async () => {
    await isolated(async (db) => {
      const report = (await db.query("INSERT INTO laporan_mingguan(tanggal) VALUES ('2026-11-22') RETURNING id")).rows[0].id;
      const expense = (await db.query(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES ($1,'gereja','keluar','Beli',1,'2026-11-18') RETURNING id`, [report])).rows[0].id;
      const first = await db.connect();
      const second = await db.connect();
      try {
        await first.query('BEGIN'); await second.query('BEGIN');
        const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const sql = `INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh,transaksi_id) VALUES ($1,'Barang','Gereja','Petugas',$2,$3)`;
        await first.query(sql, ['RACE-LINK',user,expense]);
        const deletion = second.query('UPDATE transaksi SET is_deleted=true WHERE id=$1', [expense]).then(() => null, (error: Error) => error);
        await blocked(db,pid);
        await first.query('COMMIT');
        expect(await deletion).toMatchObject({ message: expect.stringMatching(/barang.*aktif/i) });
        await second.query('ROLLBACK');
        await db.query("UPDATE barang SET is_deleted=true WHERE kode='RACE-LINK'");
        await first.query('BEGIN'); await second.query('BEGIN');
        await first.query('UPDATE transaksi SET is_deleted=true WHERE id=$1', [expense]);
        const linking = second.query(sql, ['RACE-DELETED',user,expense]).then(() => null, (error: Error) => error);
        await blocked(db,pid);
        await first.query('COMMIT');
        expect(await linking).toMatchObject({ message: expect.stringMatching(/pengeluaran.*aktif/i) });
        await second.query('ROLLBACK');
        expect((await db.query('SELECT id FROM barang WHERE transaksi_id=$1 AND NOT is_deleted', [expense])).rows).toHaveLength(0);
      } finally {
        await first.query('ROLLBACK'); await second.query('ROLLBACK');
        first.release(); second.release();
      }
    });
  });

  it('BR-I01/03: barang dan riwayat awal commit/rollback sebagai satu transaksi aplikasi', async () => {
    await client.query('SAVEPOINT pencatatan');
    const row = await barang();
    await denied(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_baru,catatan,diubah_oleh) VALUES ($1,'baik','',$2)`, [row.id,user], /check constraint/i);
    await client.query('ROLLBACK TO SAVEPOINT pencatatan');
    expect((await client.query('SELECT id FROM barang WHERE id=$1', [row.id])).rows).toHaveLength(0);
    item = (await barang()).id;
    await history();
    expect((await client.query('SELECT b.id,h.kondisi_lama,h.kondisi_baru FROM barang b JOIN riwayat_kondisi_barang h ON h.barang_id=b.id WHERE b.id=$1', [item])).rows).toEqual([{ id: item,kondisi_lama: null,kondisi_baru: 'baik' }]);
  });

  it('BR-I01: metadata mengikuti aktor, audit tombstone/restore dan menolak edit terhapus', async () => {
    item = (await barang()).id;
    const h = await history();
    const l = await loan();
    for (const [table,id] of [['barang',item],['riwayat_kondisi_barang',h.id],['peminjaman_barang',l.id]]) {
      for (const sql of [`DELETE FROM ${table} WHERE id=$1`,`DELETE FROM ${table} WHERE false`,`TRUNCATE ${table} CASCADE`]) {
        await denied(sql, sql.includes('$1') ? [id] : [], /penghapusan fisik.*dilarang/i);
      }
    }
    const inserted = (await client.query(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh,updated_by,modified_by,updated_at,deleted_at,deleted_by) VALUES ('SPOOF','Nama','Tempat','Orang',$1,NULL,NULL,'2000-01-01',now(),$1) RETURNING *`, [user])).rows[0];
    expect(inserted).toMatchObject({ updated_by: user,modified_by: user,deleted_at: null,deleted_by: null });
    expect(inserted.updated_at).toEqual((await client.query('SELECT now() AS waktu')).rows[0].waktu);
    await denied(`INSERT INTO barang(kode,nama,lokasi,penanggung_jawab,dibuat_oleh,is_deleted) VALUES ('TOMBSTONE','Nama','Tempat','Orang',$1,true)`, [user], /baru.*aktif/i);
    await client.query("UPDATE peminjaman_barang SET tanggal_kembali='2026-11-18' WHERE id=$1", [l.id]);
    for (const [table,id] of [['peminjaman_barang',l.id],['barang',item]]) {
      const original = (await client.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
      const removed = (await client.query(`UPDATE ${table} SET is_deleted=true,updated_by=NULL,modified_by=NULL,deleted_at='2000-01-01',deleted_by=NULL WHERE id=$1 RETURNING *`, [id])).rows[0];
      expect(removed).toMatchObject({ is_deleted: true,updated_by: user,modified_by: user,deleted_by: user,deleted_at: removed.updated_at });
      await denied(`UPDATE ${table} SET updated_by=NULL WHERE id=$1`, [id], /dihapus.*dipulihkan/i);
      const field = table === 'barang' ? "nama='Ubah'" : "peminjam='Ubah'";
      await denied(`UPDATE ${table} SET is_deleted=false,${field} WHERE id=$1`, [id]);
      expect((await client.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0]).toEqual(removed);
      const restored = (await client.query(`UPDATE ${table} SET is_deleted=false WHERE id=$1 RETURNING *`, [id])).rows[0];
      expect(restored).toEqual(original);
      const events = (await client.query('SELECT aksi,siapa,ringkasan FROM audit_log WHERE objek=$1 AND objek_id=$2 ORDER BY id', [table,String(id)])).rows;
      expect(events.map((e) => e.aksi)).toEqual(['soft_delete','restore']);
      expect(events.map((e) => e.siapa)).toEqual([user,user]);
      expect(events[1].ringkasan.sebelum).toEqual(events[0].ringkasan.sesudah);
      expect(events[1].ringkasan.sesudah).toEqual({ is_deleted: false,deleted_at: null,deleted_by: null });
    }
    await client.query("SELECT set_config('oikonomos.actor_id','',true)");
    expect((await client.query('UPDATE barang SET updated_by=$2,modified_by=$2 WHERE id=$1 RETURNING updated_by,modified_by', [item,user])).rows[0]).toEqual({ updated_by: null,modified_by: null });
    await client.query("SELECT set_config('oikonomos.actor_id','2147483647',true)");
    await denied('UPDATE barang SET nama=nama WHERE id=$1', [item], /foreign key/i);
  });

  it('BR-I01: CHECK tombstone et FK metadata tetap menjaga ketiga tabel tanpa helper', async () => {
    item = (await barang()).id;
    const h = await history();
    const l = await loan();
    for (const [table,id] of [['barang',item],['riwayat_kondisi_barang',h.id],['peminjaman_barang',l.id]]) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      await denied(`UPDATE ${table} SET deleted_at=now() WHERE id=$1`, [id], /check constraint/i);
      await denied(`UPDATE ${table} SET deleted_by=$2 WHERE id=$1`, [id,user], /check constraint/i);
      await denied(`UPDATE ${table} SET is_deleted=true,deleted_at=NULL WHERE id=$1`, [id], /check constraint/i);
      for (const field of ['updated_by','modified_by']) await denied(`UPDATE ${table} SET ${field}=2147483647 WHERE id=$1`, [id], /foreign key/i);
      await denied(`UPDATE ${table} SET is_deleted=true,deleted_at=now(),deleted_by=2147483647 WHERE id=$1`, [id], /foreign key/i);
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
    await denied(`INSERT INTO riwayat_kondisi_barang(barang_id,kondisi_baru,catatan,diubah_oleh) VALUES (9223372036854775807,'baik','Baru',$1)`, [user], /foreign key/i);
    await denied(`INSERT INTO peminjaman_barang(barang_id,peminjam,tanggal_pinjam,dibuat_oleh) VALUES (9223372036854775807,'Nama','2026-11-18',$1)`, [user], /foreign key/i);
  });

  it('BR-I01: enum, default, FK dan tujuh kolom metadata pada ketiga tabel', async () => {
    expect((await client.query('SELECT unnest(enum_range(NULL::kondisi_barang)) AS kondisi')).rows.map((r) => r.kondisi)).toEqual(['baik','rusak','hilang']);
    const row = await barang();
    item = row.id;
    expect(row).toMatchObject({ kondisi: 'baik', keterangan: null, transaksi_id: null, dibuat_oleh: user });
    expect(row.dibuat_pada).toBeInstanceOf(Date);
    for (const record of [row, await history(), await loan()]) {
      expect(record).toMatchObject({ updated_by: user, modified_by: user, deleted_at: null, deleted_by: null, is_deleted: false });
      expect(record.updated_at).toEqual(record.modified_at);
    }
    for (const table of tables) {
      const columns = (await client.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`, [schema,table])).rows;
      for (const [name,type,nullable] of [
        ['updated_at','timestamp with time zone','NO'],['modified_at','timestamp with time zone','NO'],
        ['updated_by','integer','YES'],['modified_by','integer','YES'],['deleted_at','timestamp with time zone','YES'],
        ['deleted_by','integer','YES'],['is_deleted','boolean','NO'],
      ]) expect(columns.find((c) => c.column_name === name)).toMatchObject({ data_type: type,is_nullable: nullable });
      const fks = (await client.query(`SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.conrelid=$1::regclass AND c.confrelid='users'::regclass`, [table])).rows.map((r) => r.attname);
      expect(fks).toEqual(expect.arrayContaining(['updated_by','modified_by','deleted_by', table === 'riwayat_kondisi_barang' ? 'diubah_oleh' : 'dibuat_oleh']));
    }
  });
});
