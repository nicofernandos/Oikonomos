import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AuthModule } from '../src/auth/auth.module.js';
import { KeuanganModule } from '../src/keuangan/keuangan.module.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { HealthController } from '../src/health.controller.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { DatabaseService } from '../src/database/database.service.js';

const databaseUrl = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('API fase 1 dengan PostgreSQL asli (schema terisolasi)', () => {
  let app: INestApplication;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let isolatedUrl: string;
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const tokens: Record<string, string> = {};
  const ids: Record<string, number> = {};
  let reportId: number;
  let transactionId: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!url.pathname.endsWith('_test')) throw new Error('Gunakan database khusus dengan nama berakhiran _test');
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    isolatedUrl = url.toString();
    pool = new pg.Pool({ connectionString: isolatedUrl });
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = (await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0];
      await pool.query(sql);
    }
    const hasher = new PasswordHasher();
    for (const role of ['admin', 'bendahara', 'majelis']) {
      const { rows } = await pool.query(`INSERT INTO users(username,password_hash,nama,peran) VALUES($1::text,$2,$1::text,$1::text::peran_user) RETURNING id`, [role, await hasher.hash('test-password-123')]);
      ids[role] = rows[0].id;
    }
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ DATABASE_URL: isolatedUrl, JWT_SECRET: 'integration-only-secret-with-at-least-32-bytes', REQUIRE_MAJELIS_APPROVAL: 'false' })] }), AuthModule, KeuanganModule],
      controllers: [HealthController, AppController], providers: [AppService],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const role of ['admin', 'bendahara', 'majelis']) {
      const response = await request(app.getHttpServer()).post('/api/auth/login').send({ username: role, password: 'test-password-123' }).expect(200);
      expect(response.body.expires_in).toBe(28800);
      tokens[role] = response.body.access_token;
    }
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });

  const api = () => request(app.getHttpServer());
  const bearer = (role = 'bendahara') => `Bearer ${tokens[role]}`;

  it('hanya health/login publik dan scaffold lama tidak aktif', async () => {
    await api().get('/api/health').expect(200);
    await api().get('/api').expect(401);
    await api().get('/api/laporan').expect(401);
    await api().post('/api/laporan').set('Authorization', bearer('admin')).send({ tanggal: '2026-11-15' }).expect(403);
    await api().get('/api/keuangan').set('Authorization', bearer()).expect(404);
    await api().get('/api/inventaris').set('Authorization', bearer()).expect(404);
  });

  it('memerlukan saldo awal lengkap dan membuat laporan pertama secara berurutan', async () => {
    await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-15' }).expect(409);
    await pool.query(`INSERT INTO saldo_awal(kas,nominal,per_tanggal) SELECT unnest(enum_range(NULL::jenis_kas)),100000,'2026-11-08'::date`);
    await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-08' }).expect(409);
    await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-16' }).expect(400);
    const response = await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-15' }).expect(201);
    reportId = response.body.id;
    expect(reportId).toBeTypeOf('number');
    expect((await pool.query('SELECT updated_by,modified_by,(updated_at=modified_at) AS waktu_sama,is_deleted FROM laporan_mingguan WHERE id=$1', [reportId])).rows[0])
      .toEqual({ updated_by: ids.bendahara, modified_by: ids.bendahara, waktu_sama: true, is_deleted: false });
    await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-22' }).expect(409);
  });

  it('mengaudit empat saldo awal dari proses bootstrap database', async () => {
    const { rows } = await pool.query("SELECT ringkasan FROM audit_log WHERE objek='saldo_awal' ORDER BY id");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.ringkasan.sesudah.nominal).toBe('100000');
      expect(row.ringkasan.pengguna_database).toBeTypeOf('string');
    }
  });

  it('memvalidasi nominal, tanggal, dan hak menulis', async () => {
    const body = { kas: 'gereja', jenis: 'masuk', uraian: 'Persembahan ibadah', nominal: 25000, tanggal: '2026-11-15' };
    await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer('majelis')).send(body).expect(403);
    for (const nominal of [0, -1, 1.5, 9007199254740992]) {
      await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer()).send({ ...body, nominal }).expect(400);
    }
    await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer()).send({ ...body, tanggal: '2026-11-16' }).expect(400);
    const response = await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer()).send(body).expect(201);
    transactionId = String(response.body.id);
    const { rows } = await pool.query('SELECT nominal::text,dibuat_oleh FROM transaksi WHERE id=$1', [transactionId]);
    expect(rows[0]).toEqual({ nominal: '25000', dibuat_oleh: ids.bendahara });
    expect((await pool.query('SELECT updated_by,modified_by FROM transaksi WHERE id=$1', [transactionId])).rows[0])
      .toEqual({ updated_by: ids.bendahara, modified_by: ids.bendahara });
  });

  it('membuat persembahan dan transaksi gereja secara atomik', async () => {
    await api().post(`/api/laporan/${reportId}/persembahan`).set('Authorization', bearer()).send({ nama: 'Jemaat Uji', bulan: '2026-11-01', nominal: 5000, tanggal: '2026-11-15' }).expect(201);
    const { rows } = await pool.query(`SELECT p.nominal::text, t.kas, t.jenis, t.nominal::text AS nominal_transaksi FROM persembahan_bulanan p JOIN transaksi t ON t.id=p.transaksi_id`);
    expect(rows).toEqual([{ nominal: '5000', kas: 'gereja', jenis: 'masuk', nominal_transaksi: '5000' }]);
    const before = await pool.query('SELECT count(*)::int AS total FROM transaksi');
    await api().post(`/api/laporan/${reportId}/persembahan`).set('Authorization', bearer()).send({ nama: 'Tidak Valid', bulan: '2026-11-02', nominal: 5000, tanggal: '2026-11-15' }).expect(400);
    expect((await pool.query('SELECT count(*)::int AS total FROM transaksi')).rows).toEqual(before.rows);
  });

  it('me-rollback transaksi dan persembahan jika penulisan audit gagal', async () => {
    await pool.query(`CREATE FUNCTION tolak_audit_uji() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.aksi='tambah_persembahan' THEN RAISE EXCEPTION 'Kegagalan audit untuk uji atomicity'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER audit_gagal_uji BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION tolak_audit_uji();`);
    const before = (await pool.query('SELECT (SELECT count(*) FROM transaksi)::text AS transaksi,(SELECT count(*) FROM persembahan_bulanan)::text AS persembahan')).rows;
    try {
      await api().post(`/api/laporan/${reportId}/persembahan`).set('Authorization', bearer()).send({ nama: 'Rollback Uji', bulan: '2026-11-01', nominal: 1, tanggal: '2026-11-15' }).expect(500);
      expect((await pool.query('SELECT (SELECT count(*) FROM transaksi)::text AS transaksi,(SELECT count(*) FROM persembahan_bulanan)::text AS persembahan')).rows).toEqual(before);
    } finally {
      await pool.query('DROP TRIGGER audit_gagal_uji ON audit_log; DROP FUNCTION tolak_audit_uji()');
    }
  });

  it('menolak kunci tanpa empat rekonsiliasi nol atau snapshot yang sudah berubah', async () => {
    await api().post(`/api/laporan/${reportId}/kunci`).set('Authorization', bearer()).send({}).expect(409);
    for (const kas of ['gereja', 'pusat', 'diakonia', 'pembangunan']) {
      await api().post(`/api/laporan/${reportId}/rekonsiliasi`).set('Authorization', bearer()).send({ kas, saldo_fisik: kas === 'gereja' ? 130000 : 100000 }).expect(201);
    }
    await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer()).send({ kas: 'gereja', jenis: 'keluar', uraian: 'Pembelian alat tulis', nominal: 1000, tanggal: '2026-11-15' }).expect(201);
    await api().post(`/api/laporan/${reportId}/kunci`).set('Authorization', bearer()).send({}).expect(409);
    await api().post(`/api/laporan/${reportId}/rekonsiliasi`).set('Authorization', bearer()).send({ kas: 'gereja', saldo_fisik: 129000 }).expect(201);
    await api().post(`/api/laporan/${reportId}/kunci`).set('Authorization', bearer()).send({}).expect(201);
    expect((await pool.query('SELECT terkunci,dikunci_oleh FROM laporan_mingguan WHERE id=$1', [reportId])).rows[0]).toEqual({ terkunci: true, dikunci_oleh: ids.bendahara });
  });

  it('melindungi laporan terkunci melalui API dan trigger database', async () => {
    await api().post(`/api/laporan/${reportId}/transaksi`).set('Authorization', bearer()).send({ kas: 'gereja', jenis: 'masuk', uraian: 'Dilarang', nominal: 1, tanggal: '2026-11-15' }).expect(409);
    await expect(pool.query('UPDATE transaksi SET nominal=1 WHERE id=$1', [transactionId])).rejects.toThrow('Laporan terkunci');
    await expect(pool.query('UPDATE laporan_mingguan SET terkunci=false WHERE id=$1', [reportId])).rejects.toThrow('Laporan terkunci');
    await expect(pool.query("UPDATE saldo_awal SET nominal=0 WHERE kas='gereja'")).rejects.toThrow('Saldo awal');
    await api().get(`/api/laporan/${reportId}`).set('Authorization', bearer('majelis')).expect(200);
    const response = await api().get('/api/saldo?tanggal=2026-11-15').set('Authorization', bearer('admin')).expect(200);
    expect(JSON.stringify(response.body)).toContain('129000');
    expect(JSON.stringify(response.body)).toContain('429000');
  });

  it('membuat koreksi laporan terkunci pada laporan berikutnya dan melarang minggu terlewat', async () => {
    await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-29' }).expect(409);
    const next = await api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-22' }).expect(201);
    await api().post(`/api/laporan/${next.body.id}/transaksi`).set('Authorization', bearer()).send({ kas: 'gereja', jenis: 'keluar', uraian: 'Koreksi nominal persembahan minggu sebelumnya', nominal: 500, tanggal: '2026-11-22', koreksi_dari: Number(transactionId) }).expect(201);
    expect((await pool.query('SELECT koreksi_dari::text FROM transaksi WHERE laporan_id=$1', [next.body.id])).rows[0].koreksi_dari).toBe(transactionId);
  });

  it('mengaudit perubahan akun tanpa menyimpan rahasia dan menolak akses akun nonaktif', async () => {
    const created = await api().post('/api/users').set('Authorization', bearer('admin')).send({ username: 'anggota_uji', password: 'password10', nama: 'Anggota Uji', peran: 'majelis' }).expect(201);
    const id = created.body.id;
    expect(created.body).not.toHaveProperty('password_hash');
    await api().patch(`/api/users/${id}`).set('Authorization', bearer('admin')).send({ aktif: false }).expect(200);
    await api().post(`/api/users/${id}/reset-password`).set('Authorization', bearer('admin')).send({ password: 'pengganti10' }).expect(200);
    await api().patch(`/api/users/${id}`).set('Authorization', bearer('admin')).send({ aktif: true }).expect(200);
    await api().post('/api/auth/login').send({ username: 'anggota_uji', password: 'password10' }).expect(401);
    const login = await api().post('/api/auth/login').send({ username: 'anggota_uji', password: 'pengganti10' }).expect(200);
    expect(login.body.user.id).toBe(id);
    expect((await pool.query('SELECT updated_by,modified_by FROM users WHERE id=$1', [id])).rows[0])
      .toEqual({ updated_by: ids.admin, modified_by: ids.admin });
    await app.get(DatabaseService).withTransaction(async (client) => {
      await client.query('UPDATE users SET is_deleted=true WHERE id=$1', [id]);
    }, ids.admin);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${login.body.access_token}`).expect(401);
    const users = await api().get('/api/users').set('Authorization', bearer('admin')).expect(200);
    expect(users.body.some((user: { id: number }) => user.id === id)).toBe(false);
    await api().post(`/api/users/${id}/reset-password`).set('Authorization', bearer('admin')).send({ password: 'pengganti10' }).expect(404);
    expect((await pool.query('SELECT is_deleted,aktif,deleted_by,(deleted_at IS NOT NULL) AS tercatat FROM users WHERE id=$1', [id])).rows[0])
      .toEqual({ is_deleted: true, aktif: true, deleted_by: ids.admin, tercatat: true });
    const audits = (await pool.query('SELECT ringkasan FROM audit_log')).rows;
    expect(audits.length).toBeGreaterThan(5);
    expect(JSON.stringify(audits)).not.toMatch(/password10|pengganti10|password_hash|access_token/);
    await pool.query('UPDATE users SET aktif=false WHERE id=$1', [ids.majelis]);
    await api().get('/api/laporan').set('Authorization', bearer('majelis')).expect(401);
  });

  it('memerlukan majelis yang bukan penginput terakhir bila persetujuan aktif', async () => {
    const nextId = (await pool.query("SELECT id FROM laporan_mingguan WHERE tanggal='2026-11-22'")).rows[0].id;
    for (const kas of ['gereja', 'pusat', 'diakonia', 'pembangunan']) {
      await api().post(`/api/laporan/${nextId}/rekonsiliasi`).set('Authorization', bearer()).send({ kas, saldo_fisik: kas === 'gereja' ? 128500 : 100000 }).expect(201);
    }
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ DATABASE_URL: isolatedUrl, JWT_SECRET: 'integration-only-secret-with-at-least-32-bytes', REQUIRE_MAJELIS_APPROVAL: 'true' })] }),
      AuthModule, KeuanganModule,
    ] }).compile();
    const approvalApp = module.createNestApplication();
    approvalApp.setGlobalPrefix('api');
    approvalApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await approvalApp.init();
    const approvalApi = () => request(approvalApp.getHttpServer());
    try {
      await approvalApi().post(`/api/laporan/${nextId}/kunci`).set('Authorization', bearer()).send({}).expect(403);
      await pool.query("UPDATE users SET peran='majelis' WHERE id=$1", [ids.bendahara]);
      await approvalApi().post(`/api/laporan/${nextId}/kunci`).set('Authorization', bearer()).send({}).expect(409);
      await pool.query('UPDATE users SET aktif=true WHERE id=$1', [ids.majelis]);
      await approvalApi().post(`/api/laporan/${nextId}/kunci`).set('Authorization', bearer('majelis')).send({}).expect(201);
      expect((await pool.query('SELECT terkunci,disetujui_oleh FROM laporan_mingguan WHERE id=$1', [nextId])).rows[0]).toEqual({ terkunci: true, disetujui_oleh: ids.majelis });
    } finally {
      await pool.query("UPDATE users SET peran='bendahara' WHERE id=$1", [ids.bendahara]);
      await approvalApp.close();
    }
  });

  it('menserialisasi dua permintaan pembuatan laporan bersamaan', async () => {
    const responses = await Promise.all([1, 2].map(() => api().post('/api/laporan').set('Authorization', bearer()).send({ tanggal: '2026-11-29' })));
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect((await pool.query("SELECT count(*)::int AS total FROM laporan_mingguan WHERE tanggal='2026-11-29'")).rows[0].total).toBe(1);
  });

  it('mengabaikan transaksi soft-delete dalam saldo tanpa menghilangkan record dan dapat memulihkan recordnya', async () => {
    const report = (await pool.query("SELECT id FROM laporan_mingguan WHERE tanggal='2026-11-29'")).rows[0];
    const response = await api().post(`/api/laporan/${report.id}/transaksi`).set('Authorization', bearer()).send({ kas: 'gereja', jenis: 'masuk', nominal: 777, tanggal: '2026-11-29', uraian: 'Uji retensi transaksi terbuka' }).expect(201);
    const id = response.body.id;
    await app.get(DatabaseService).withTransaction(async (client) => {
      await client.query('UPDATE transaksi SET is_deleted=true WHERE id=$1', [id]);
    }, ids.bendahara);
    let saldo = await api().get('/api/saldo?tanggal=2026-11-29').set('Authorization', bearer()).expect(200);
    expect(saldo.body.kas.gereja).toBe('128500');
    const detail = await api().get(`/api/laporan/${report.id}`).set('Authorization', bearer()).expect(200);
    expect(detail.body.kas.gereja.penerimaan).toEqual([]);
    expect((await pool.query('SELECT nominal::text,is_deleted,deleted_by FROM transaksi WHERE id=$1', [id])).rows[0])
      .toEqual({ nominal: '777', is_deleted: true, deleted_by: ids.bendahara });
    await app.get(DatabaseService).withTransaction(async (client) => {
      await client.query('UPDATE transaksi SET is_deleted=false WHERE id=$1', [id]);
    }, ids.bendahara);
    saldo = await api().get('/api/saldo?tanggal=2026-11-29').set('Authorization', bearer()).expect(200);
    expect(saldo.body.kas.gereja).toBe('129277');
    expect((await pool.query('SELECT is_deleted,deleted_at,deleted_by FROM transaksi WHERE id=$1', [id])).rows[0])
      .toEqual({ is_deleted: false, deleted_at: null, deleted_by: null });
  });
});
