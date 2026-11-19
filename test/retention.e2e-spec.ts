import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const databaseUrl = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const tables = ['users', 'laporan_mingguan', 'transaksi', 'saldo_awal', 'persembahan_bulanan', 'rekonsiliasi', 'audit_log'] as const;
const migration = '1794930000001_metadata-dan-soft-delete.sql';

suite('Retensi PostgreSQL nyata (schema acak, database khusus _test)', () => {
  const schema = `retention_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let before: Record<string, Record<string, unknown>[]>;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Gunakan database khusus berakhiran _test');
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      // Build the legacy schema before the migration under test. Later
      // migrations may depend on metadata functions that do not exist yet.
      if (name >= migration) continue;
      await pool.query((await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0]);
    }
    await pool.query(`
      INSERT INTO users(username,password_hash,nama,peran) VALUES ('legacy','test-only','Legacy','admin'),('actor','test-only','Actor','bendahara');
      INSERT INTO laporan_mingguan(tanggal) VALUES ('2026-11-15');
      INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES (1,'gereja','masuk','Legacy',123,'2026-11-15');
      INSERT INTO saldo_awal(kas,nominal,per_tanggal) VALUES ('gereja',456,'2026-11-08');
      INSERT INTO persembahan_bulanan(laporan_id,transaksi_id,nama,bulan,nominal) VALUES (1,1,'Legacy','2026-11-01',123);
      INSERT INTO rekonsiliasi(laporan_id,kas,saldo_sistem,saldo_fisik,dicek_oleh) VALUES (1,'gereja',579,579,1);
    `);
    before = {};
    for (const table of tables) before[table] = (await pool.query(`SELECT * FROM ${table}`)).rows;
    const names = await readdir('migrations');
    if (names.includes(migration)) await pool.query((await readFile(`migrations/${migration}`, 'utf8')).split('-- Down Migration')[0]);
  }, 30000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client?.query('ROLLBACK'); client?.release(); });

  const key = (table: string) => table === 'saldo_awal' ? "kas='gereja'" : 'id=1';
  const actor = () => client.query("SELECT set_config('oikonomos.actor_id','2',true)");

  it('metadata INSERT/UPDATE tujuh tabel hanya memakai aktor konteks, bukan input klien', async () => {
    await actor();
    const inserts: Record<string, string> = {
      users: "INSERT INTO users(username,password_hash,nama,peran,updated_at,modified_at,updated_by,modified_by,deleted_at,deleted_by) VALUES ('new','test','New','majelis','2000-01-01','2001-01-01',1,1,now(),1)",
      laporan_mingguan: "INSERT INTO laporan_mingguan(tanggal,updated_by) VALUES ('2026-11-22',1)",
      transaksi: "INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal,updated_by) VALUES (1,'gereja','masuk','new',1,'2026-11-15',1)",
      saldo_awal: "INSERT INTO saldo_awal(kas,nominal,per_tanggal,updated_by) VALUES ('pusat',1,'2026-11-08',1)",
      persembahan_bulanan: "INSERT INTO persembahan_bulanan(laporan_id,transaksi_id,nama,bulan,nominal,updated_by) VALUES (1,2,'New','2026-11-01',1,1)",
      rekonsiliasi: "INSERT INTO rekonsiliasi(laporan_id,kas,saldo_sistem,saldo_fisik,dicek_oleh,updated_by) VALUES (1,'pusat',1,1,1,1)",
      audit_log: "INSERT INTO audit_log(aksi,objek,ringkasan,updated_by) VALUES ('test','test','{}',1)",
    };
    for (const table of tables) {
      const row = (await client.query(`${inserts[table]} RETURNING *`)).rows[0];
      expect(row).toMatchObject({ updated_by: 2, modified_by: 2, is_deleted: false, deleted_at: null, deleted_by: null });
      expect(row.updated_at).toEqual(row.modified_at);
      expect(row.updated_at).toEqual((await client.query('SELECT now() AS time')).rows[0].time);
      if (table !== 'audit_log') {
        const changed = (await client.query(`UPDATE ${table} SET updated_by=1,modified_by=1,updated_at='2000-01-01',modified_at='2001-01-01',deleted_at=now(),deleted_by=1 WHERE ${key(table)} RETURNING *`)).rows[0];
        expect(changed).toMatchObject({ updated_by: 2, modified_by: 2, deleted_at: null, deleted_by: null });
        expect(changed.updated_at).toEqual(row.updated_at);
        expect(changed.modified_at).toEqual(row.updated_at);
      }
    }
    await client.query("SELECT set_config('oikonomos.actor_id','',true)");
    expect((await client.query('UPDATE users SET updated_by=2 WHERE id=1 RETURNING updated_by,modified_by')).rows[0]).toEqual({ updated_by: null, modified_by: null });
  });

  async function denied(sql: string, message: RegExp) {
    await client.query('SAVEPOINT denied');
    await expect(client.query(sql)).rejects.toThrow(message);
    await client.query('ROLLBACK TO SAVEPOINT denied');
  }

  it('soft-delete menyimpan tombstone pertama, menolak edit, dan restore hanya membersihkan tombstone', async () => {
    await actor();
    for (const table of ['users', 'saldo_awal', 'rekonsiliasi']) {
      const original = (await client.query(`SELECT * FROM ${table} WHERE ${key(table)}`)).rows[0];
      const removed = (await client.query(`UPDATE ${table} SET is_deleted=true,deleted_by=1,deleted_at='2000-01-01' WHERE ${key(table)} RETURNING *`)).rows[0];
      expect(removed).toMatchObject({ is_deleted: true, deleted_by: 2, updated_by: 2, modified_by: 2 });
      expect(removed.deleted_at).toEqual(removed.updated_at);
      await client.query("SELECT set_config('oikonomos.actor_id','1',true)");
      await denied(`UPDATE ${table} SET deleted_at=now(),deleted_by=1 WHERE ${key(table)}`, /dihapus.*dipulihkan/i);
      await denied(`UPDATE ${table} SET is_deleted=true WHERE ${key(table)}`, /dihapus.*dipulihkan/i);
      expect((await client.query(`SELECT * FROM ${table} WHERE ${key(table)}`)).rows[0]).toEqual(removed);
      const field = table === 'users' ? "nama='tampered'" : table === 'saldo_awal' ? 'nominal=999' : 'saldo_fisik=999';
      await denied(`UPDATE ${table} SET is_deleted=false,${field} WHERE ${key(table)}`, /pemulihan.*data/i);
      const restored = (await client.query(`UPDATE ${table} SET is_deleted=false,deleted_at=now(),deleted_by=2 WHERE ${key(table)} RETURNING *`)).rows[0];
      expect(restored).toMatchObject({ is_deleted: false, deleted_at: null, deleted_by: null, updated_by: 1, modified_by: 1 });
      for (const column of Object.keys(original).filter((name) => !['updated_at','updated_by','modified_at','modified_by'].includes(name))) expect(restored[column]).toEqual(original[column]);
      await actor();
    }
    await client.query("SELECT set_config('oikonomos.actor_id','',true)");
    expect((await client.query('UPDATE users SET is_deleted=true WHERE id=1 RETURNING deleted_by,deleted_at')).rows[0]).toMatchObject({ deleted_by: null, deleted_at: expect.any(Date) });
  });

  it('menolak INSERT tombstone dan semua DELETE/TRUNCATE termasuk tabel kosong', async () => {
    await denied("INSERT INTO users(username,password_hash,nama,peran,is_deleted) VALUES ('dead','test','Dead','admin',true)", /baru.*aktif/i);
    for (const table of tables) {
      await denied(`DELETE FROM ${table} WHERE ${key(table)}`, /penghapusan fisik.*dilarang/i);
      await denied(`DELETE FROM ${table} WHERE false`, /penghapusan fisik.*dilarang/i);
      await denied(`TRUNCATE ${table} CASCADE`, /penghapusan fisik.*dilarang/i);
      expect((await client.query(`SELECT count(*)::int AS total FROM ${table}`)).rows[0].total).toBe(before[table].length);
    }
  });

  it('audit_log append-only termasuk metadata, soft-delete dan restore', async () => {
    for (const change of ["aksi='tamper'", 'updated_by=2', 'is_deleted=true', 'is_deleted=false']) {
      await denied(`UPDATE audit_log SET ${change} WHERE id=1`, /audit.*tidak dapat diubah/i);
    }
  });

  it('menjaga CHECK tombstone dan FK aktor pada semua tabel bahkan tanpa trigger metadata', async () => {
    for (const table of tables) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      // Inspect all three actor FKs; invalid actor context exercises them with triggers enabled below.
      const fks = (await client.query(`SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.conrelid=$1::regclass AND c.confrelid='users'::regclass`, [table])).rows.map((r) => r.attname);
      expect(fks).toEqual(expect.arrayContaining(['updated_by','modified_by','deleted_by']));
      await denied(`UPDATE ${table} SET deleted_at=now() WHERE ${key(table)}`, /check constraint/i);
      await denied(`UPDATE ${table} SET deleted_by=1 WHERE ${key(table)}`, /check constraint/i);
      await denied(`UPDATE ${table} SET is_deleted=true,deleted_at=NULL WHERE ${key(table)}`, /check constraint/i);
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
    await client.query("SELECT set_config('oikonomos.actor_id','999999',true)");
    await denied('UPDATE users SET nama=nama WHERE id=1', /foreign key constraint/i);
  });

  it('melarang soft-delete laporan dengan anak aktif dan pemisahan pasangan persembahan/transaksi', async () => {
    await denied('UPDATE laporan_mingguan SET is_deleted=true WHERE id=1', /anak aktif/i);
    await denied('UPDATE transaksi SET is_deleted=true WHERE id=1', /pasangan.*aktif/i);
    await denied('UPDATE persembahan_bulanan SET is_deleted=true WHERE id=1', /pasangan.*aktif/i);
  });

  it('laporan tanpa anak dapat dipulihkan tetapi anak baru tidak boleh menunjuk laporan terhapus', async () => {
    const id = (await client.query("INSERT INTO laporan_mingguan(tanggal) VALUES ('2026-12-06') RETURNING id")).rows[0].id;
    await client.query(`UPDATE laporan_mingguan SET is_deleted=true WHERE id=${id}`);
    await denied(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES (${id},'gereja','masuk','bad',1,'2026-12-06')`, /laporan.*dihapus/i);
    await denied(`UPDATE transaksi SET laporan_id=${id} WHERE id=1`, /laporan.*dihapus/i);
    await client.query(`UPDATE laporan_mingguan SET is_deleted=false WHERE id=${id}`);
    const tid = (await client.query(`INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal) VALUES (${id},'gereja','masuk','standalone',1,'2026-12-06') RETURNING id`)).rows[0].id;
    await client.query(`UPDATE transaksi SET is_deleted=true WHERE id=${tid}`);
    await denied(`INSERT INTO persembahan_bulanan(laporan_id,transaksi_id,nama,bulan,nominal) VALUES (${id},${tid},'bad','2026-12-01',1)`, /transaksi.*dihapus/i);
    await client.query(`UPDATE laporan_mingguan SET is_deleted=true WHERE id=${id}`);
    await denied(`UPDATE transaksi SET is_deleted=false WHERE id=${tid}`, /laporan.*dihapus/i);
    await client.query(`UPDATE laporan_mingguan SET is_deleted=false WHERE id=${id}`);
    await client.query(`UPDATE transaksi SET is_deleted=false WHERE id=${tid}`);
  });

  it('metadata dan soft-delete tetap tunduk pada laporan terkunci', async () => {
    await client.query('UPDATE laporan_mingguan SET terkunci=true WHERE id=1');
    for (const table of ['laporan_mingguan', 'transaksi', 'persembahan_bulanan', 'rekonsiliasi']) {
      await denied(`UPDATE ${table} SET updated_by=2 WHERE id=1`, /Laporan terkunci/);
      await denied(`UPDATE ${table} SET is_deleted=true WHERE id=1`, /Laporan terkunci/);
    }
    await denied("UPDATE saldo_awal SET is_deleted=true WHERE kas='gereja'", /Saldo awal/);
  });

  it('audit soft-delete/restore tetap tersimpan tanpa membocorkan kolom akun', async () => {
    await actor();
    await client.query('UPDATE users SET is_deleted=true WHERE id=1');
    const deleted = (await client.query('SELECT deleted_at FROM users WHERE id=1')).rows[0].deleted_at;
    await client.query('UPDATE users SET is_deleted=false WHERE id=1');
    const records = (await client.query("SELECT siapa,aksi,objek,objek_id,ringkasan,updated_by,modified_by FROM audit_log WHERE objek='users' ORDER BY id")).rows;
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.aksi)).toEqual(['soft_delete', 'restore']);
    for (const record of records) {
      expect(record).toMatchObject({ siapa: 2, objek: 'users', objek_id: '1', updated_by: 2, modified_by: 2 });
      expect(Object.keys(record.ringkasan).sort()).toEqual(['pengguna_database','sebelum','sesudah']);
      for (const state of [record.ringkasan.sebelum,record.ringkasan.sesudah]) expect(Object.keys(state).sort()).toEqual(['deleted_at','deleted_by','is_deleted']);
      expect(record.ringkasan.pengguna_database).toBeTypeOf('string');
    }
    expect(records[0].ringkasan.sesudah).toMatchObject({ is_deleted: true, deleted_by: 2 });
    expect(new Date(records[0].ringkasan.sesudah.deleted_at)).toEqual(deleted);
    expect(records[1].ringkasan.sebelum).toEqual(records[0].ringkasan.sesudah);
    expect(records[1].ringkasan.sesudah).toEqual({ is_deleted: false, deleted_at: null, deleted_by: null });
    await client.query("UPDATE users SET nama='Changed' WHERE id=1");
    expect((await client.query("SELECT count(*)::int AS total FROM audit_log WHERE objek='users'")).rows[0].total).toBe(2);
    await client.query("UPDATE saldo_awal SET is_deleted=true WHERE kas='gereja'");
    expect((await client.query("SELECT objek_id FROM audit_log WHERE aksi='soft_delete' AND objek='saldo_awal'")).rows).toEqual([{ objek_id: 'gereja' }]);
  });

  it('down menolak tombstone agar tidak mengaktifkan ulang data secara diam-diam', async () => {
    await client.query('UPDATE users SET is_deleted=true WHERE id=1');
    const sql = (await readFile(`migrations/${migration}`, 'utf8')).split('-- Down Migration')[1];
    await denied(sql, /tombstone.*rollback/i);
  });

  it('down/up schema sendiri menjaga semua baris lama dan memasang kembali proteksi', async () => {
    const [up, down] = (await readFile(`migrations/${migration}`, 'utf8')).split('-- Down Migration');
    await client.query(down);
    for (const table of tables) expect((await client.query(`SELECT * FROM ${table}`)).rows).toEqual(before[table]);
    await client.query(up);
    for (const table of tables) await denied(`DELETE FROM ${table} WHERE false`, /penghapusan fisik.*dilarang/i);
    expect((await client.query('SELECT updated_by,is_deleted FROM users WHERE id=1')).rows[0]).toEqual({ updated_by: null, is_deleted: false });
  });

  it('menambah tujuh kolom dengan default tanpa mengarang pelaku atau menghilangkan data lama', async () => {
    const definitions = (await client.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1`, [schema])).rows;
    for (const table of tables) {
      for (const [column, type, nullable] of [
        ['updated_at', 'timestamp with time zone', 'NO'], ['modified_at', 'timestamp with time zone', 'NO'],
        ['updated_by', 'integer', 'YES'], ['modified_by', 'integer', 'YES'], ['deleted_at', 'timestamp with time zone', 'YES'],
        ['deleted_by', 'integer', 'YES'], ['is_deleted', 'boolean', 'NO'],
      ]) {
        expect(definitions.find((d) => d.table_name === table && d.column_name === column)).toMatchObject({ data_type: type, is_nullable: nullable });
      }
      const rows = (await client.query(`SELECT * FROM ${table}`)).rows;
      expect(rows).toHaveLength(before[table].length);
      for (const [index, row] of rows.entries()) {
        expect(row).toMatchObject(before[table][index]);
        expect(row.updated_at).toBeInstanceOf(Date);
        expect(row.modified_at).toEqual(row.updated_at);
        expect(row).toMatchObject({ updated_by: null, modified_by: null, deleted_at: null, deleted_by: null, is_deleted: false });
      }
      for (const name of ['updated_at', 'modified_at']) expect(definitions.find((d) => d.table_name === table && d.column_name === name).column_default).toBe('now()');
      expect(definitions.find((d) => d.table_name === table && d.column_name === 'is_deleted').column_default).toBe('false');
    }
  });
});
