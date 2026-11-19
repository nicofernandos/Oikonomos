import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PasswordHasher } from '../src/auth/password-hasher.js';

const testUrl = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;

suite('BR-I01–BR-I04: API inventaris PostgreSQL asli', () => {
  let app: INestApplication;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let barangId: string;
  let purchasedId: string;
  let loanId: string;
  let expenseId: string;
  let incomingId: string;
  const schema = `inventory_${randomUUID().replaceAll('-', '')}`;
  const ids: Record<string, number> = {};
  const tokens: Record<string, string> = {};
  const item = { kode: 'INV-001', nama: 'Keyboard', lokasi: 'Gudang', penanggung_jawab: 'Petugas Jemaat', keterangan: 'Hibah jemaat' };

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!url.pathname.endsWith('_test')) throw new Error('Gunakan database khusus *_test');
    adminPool = new pg.Pool({ connectionString: testUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query((await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0]);
    }
    const hasher = new PasswordHasher();
    for (const role of ['admin', 'bendahara', 'majelis']) {
      ids[role] = (await pool.query('INSERT INTO users(username,password_hash,nama,peran) VALUES($1,$2,$1,$3) RETURNING id', [role, await hasher.hash('inventory-fixture-123'), role])).rows[0].id;
    }
    const laporan = (await pool.query("INSERT INTO laporan_mingguan(tanggal,dibuat_oleh) VALUES('2026-11-15',$1) RETURNING id", [ids.bendahara])).rows[0];
    for (const jenis of ['masuk', 'keluar']) {
      const tx = (await pool.query("INSERT INTO transaksi(laporan_id,kas,jenis,uraian,nominal,tanggal,dibuat_oleh) VALUES($1,'gereja',$2,'Fixture transaksi inventaris',1000,'2026-11-15',$3) RETURNING id::text", [laporan.id, jenis, ids.bendahara])).rows[0];
      if (jenis === 'masuk') incomingId = tx.id;
      else expenseId = tx.id;
    }
    const { AppModule } = await import('../src/app.module.js');
    const config: Record<string, string> = { DATABASE_URL: url.toString(), JWT_SECRET: 'inventory-only-test-secret-longer-than-32-bytes', REQUIRE_MAJELIS_APPROVAL: 'false' };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue({ get: (key: string) => config[key], getOrThrow: (key: string) => config[key] }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const jwt = module.get(JwtService);
    for (const role of ['admin', 'bendahara', 'majelis']) tokens[role] = await jwt.signAsync({ sub: ids[role] });
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
  const auth = (role = 'admin') => `Bearer ${tokens[role]}`;

  it('BR-A04: setiap endpoint inventaris tertutup tanpa token', async () => {
    const paths = [
      ['get', '/api/inventaris'], ['post', '/api/inventaris'], ['get', '/api/inventaris/1'], ['patch', '/api/inventaris/1'], ['delete', '/api/inventaris/1'],
      ['post', '/api/inventaris/1/pulihkan'], ['get', '/api/inventaris/1/riwayat-kondisi'], ['post', '/api/inventaris/1/kondisi'],
      ['get', '/api/inventaris/1/peminjaman'], ['post', '/api/inventaris/1/peminjaman'], ['post', '/api/inventaris/1/peminjaman/1/kembali'],
    ] as const;
    for (const [method, path] of paths) await api()[method](path).send({}).expect(401);
  });

  it('BR-I04: admin membuat barang hibah lengkap dengan lokasi, penanggung jawab, dan metadata pelaku', async () => {
    const response = await api().post('/api/inventaris').set('Authorization', auth()).send(item).expect(201);
    barangId = response.body.id;
    expect(barangId).toBeTypeOf('string');
    expect(response.body).toMatchObject({ ...item, transaksi_id: null, kondisi: 'baik', is_deleted: false, updated_by: ids.admin, modified_by: ids.admin });
    const rows = (await pool.query('SELECT kondisi_lama,kondisi_baru,diubah_oleh FROM riwayat_kondisi_barang WHERE barang_id=$1', [barangId])).rows;
    expect(rows).toEqual([{ kondisi_lama: null, kondisi_baru: 'baik', diubah_oleh: ids.admin }]);
    await api().post('/api/inventaris').set('Authorization', auth()).send(item).expect(409);
  });

  it('BR-I01: pembelian hanya merujuk pengeluaran aktif dan tidak membuat transaksi keuangan baru', async () => {
    const before = (await pool.query('SELECT count(*)::text AS total FROM transaksi')).rows;
    await api().post('/api/inventaris').set('Authorization', auth()).send({ ...item, kode: 'INVALID-INCOMING', transaksi_id: incomingId }).expect(400);
    await api().post('/api/inventaris').set('Authorization', auth()).send({ ...item, kode: 'INVALID-MISSING', transaksi_id: '9999999' }).expect(400);
    const response = await api().post('/api/inventaris').set('Authorization', auth()).send({ ...item, kode: 'INV-002', transaksi_id: expenseId }).expect(201);
    purchasedId = response.body.id;
    expect(response.body.transaksi_id).toBe(expenseId);
    expect((await pool.query('SELECT count(*)::text AS total FROM transaksi')).rows).toEqual(before);
  });

  it('hanya admin boleh menulis; bendahara dan majelis dapat membaca seluruh detail inventaris', async () => {
    for (const role of ['bendahara', 'majelis']) {
      for (const path of ['/api/inventaris', `/api/inventaris/${barangId}`, `/api/inventaris/${barangId}/riwayat-kondisi`, `/api/inventaris/${barangId}/peminjaman`]) {
        await api().get(path).set('Authorization', auth(role)).expect(200);
      }
      const writes = [
        ['post', '/api/inventaris', { ...item, kode: 'DENIED' }], ['patch', `/api/inventaris/${barangId}`, { nama: 'Dilarang' }],
        ['delete', `/api/inventaris/${barangId}`, {}], ['post', `/api/inventaris/${barangId}/pulihkan`, {}],
        ['post', `/api/inventaris/${barangId}/kondisi`, { kondisi: 'rusak', catatan: 'Dilarang' }],
        ['post', `/api/inventaris/${barangId}/peminjaman`, { peminjam: 'Dilarang', tanggal_pinjam: '2026-11-15' }],
        ['post', `/api/inventaris/${barangId}/peminjaman/1/kembali`, { tanggal_kembali: '2026-11-16' }],
      ] as const;
      for (const [method, path, body] of writes) await api()[method](path).set('Authorization', auth(role)).send(body).expect(403);
    }
  });

  it('BR-I02: perubahan kondisi menambah riwayat tanpa menimpa riwayat lama', async () => {
    await api().post(`/api/inventaris/${barangId}/kondisi`).set('Authorization', auth()).send({ kondisi: 'rusak', catatan: 'Tombol mengalami kerusakan' }).expect(201);
    const history = await api().get(`/api/inventaris/${barangId}/riwayat-kondisi`).set('Authorization', auth('majelis')).expect(200);
    expect(history.body).toHaveLength(2);
    const rows = (await pool.query('SELECT kondisi_lama,kondisi_baru FROM riwayat_kondisi_barang WHERE barang_id=$1 ORDER BY id', [barangId])).rows;
    expect(rows).toEqual([{ kondisi_lama: null, kondisi_baru: 'baik' }, { kondisi_lama: 'baik', kondisi_baru: 'rusak' }]);
    await api().patch(`/api/inventaris/${barangId}`).set('Authorization', auth()).send({ kondisi: 'hilang' }).expect(400);
    await api().post(`/api/inventaris/${barangId}/kondisi`).set('Authorization', auth()).send({ kondisi: 'rusak', catatan: 'Tidak berubah' }).expect(409);
    expect((await pool.query('SELECT count(*)::int AS total FROM riwayat_kondisi_barang WHERE barang_id=$1', [barangId])).rows[0].total).toBe(2);
  });

  it('BR-I03: dua peminjaman bersamaan hanya menghasilkan satu pinjaman aktif', async () => {
    const body = { peminjam: 'Pemuda Jemaat', tanggal_pinjam: '2026-11-15', rencana_kembali: '2026-11-22' };
    const responses = await Promise.all([1, 2].map(() => api().post(`/api/inventaris/${purchasedId}/peminjaman`).set('Authorization', auth()).send(body)));
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    loanId = responses.find((response) => response.status === 201)!.body.id;
    expect(loanId).toBeTypeOf('string');
    expect((await pool.query('SELECT count(*)::int AS total FROM peminjaman_barang WHERE barang_id=$1 AND tanggal_kembali IS NULL AND NOT is_deleted', [purchasedId])).rows[0].total).toBe(1);
    await api().delete(`/api/inventaris/${purchasedId}`).set('Authorization', auth()).expect(409);
  });

  it('BR-I03: pengembalian memeriksa tanggal dan kepemilikan pinjaman, lalu membebaskan barang', async () => {
    await api().post(`/api/inventaris/${barangId}/peminjaman/${loanId}/kembali`).set('Authorization', auth()).send({ tanggal_kembali: '2026-11-22' }).expect(404);
    await api().post(`/api/inventaris/${purchasedId}/peminjaman/${loanId}/kembali`).set('Authorization', auth()).send({ tanggal_kembali: '2026-11-14' }).expect(400);
    await api().post(`/api/inventaris/${purchasedId}/peminjaman/${loanId}/kembali`).set('Authorization', auth()).send({ tanggal_kembali: '2026-11-22', catatan: 'Sudah dikembalikan' }).expect(201);
    expect((await pool.query('SELECT tanggal_kembali::text,updated_by FROM peminjaman_barang WHERE id=$1', [loanId])).rows[0]).toEqual({ tanggal_kembali: '2026-11-22', updated_by: ids.admin });
    await api().post(`/api/inventaris/${purchasedId}/peminjaman/${loanId}/kembali`).set('Authorization', auth()).send({ tanggal_kembali: '2026-11-22' }).expect(409);
  });

  it('retensi: soft-delete dan restore barang tidak menghilangkan barang atau riwayat', async () => {
    await api().patch(`/api/inventaris/${barangId}`).set('Authorization', auth()).send({ lokasi: 'Ruang Ibadah', penanggung_jawab: 'Petugas Musik' }).expect(200);
    const removed = await api().delete(`/api/inventaris/${barangId}`).set('Authorization', auth()).expect(200);
    expect(removed.body).toMatchObject({ id: barangId, is_deleted: true, deleted_by: ids.admin });
    await api().get(`/api/inventaris/${barangId}`).set('Authorization', auth('bendahara')).expect(404);
    const list = await api().get('/api/inventaris').set('Authorization', auth('majelis')).expect(200);
    expect(list.body.some((row: { id: string }) => row.id === barangId)).toBe(false);
    expect((await pool.query('SELECT is_deleted,deleted_by FROM barang WHERE id=$1', [barangId])).rows[0]).toEqual({ is_deleted: true, deleted_by: ids.admin });
    const restored = await api().post(`/api/inventaris/${barangId}/pulihkan`).set('Authorization', auth()).send({}).expect(201);
    expect(restored.body).toMatchObject({ id: barangId, is_deleted: false, deleted_at: null, deleted_by: null, lokasi: 'Ruang Ibadah' });
    expect((await pool.query('SELECT count(*)::int AS total FROM riwayat_kondisi_barang WHERE barang_id=$1', [barangId])).rows[0].total).toBe(2);
  });

  it('validasi: tanggal, teks, ID, metadata palsu, dan body kosong ditolak', async () => {
    for (const body of [{ ...item, kode: 'BAD', lokasi: '' }, { ...item, kode: 'BAD', nama: 'Nama\u0000Uji' }, { ...item, kode: 'BAD', penanggung_jawab: '' }, { ...item, kode: 'BAD', updated_by: ids.majelis }]) {
      await api().post('/api/inventaris').set('Authorization', auth()).send(body).expect(400);
    }
    for (const id of ['0', '-1', '9223372036854775808', 'abc']) await api().get(`/api/inventaris/${id}`).set('Authorization', auth()).expect(400);
    await api().get('/api/inventaris/99999999').set('Authorization', auth()).expect(404);
    await api().patch(`/api/inventaris/${barangId}`).set('Authorization', auth()).send({}).expect(400);
    await api().post(`/api/inventaris/${barangId}/peminjaman`).set('Authorization', auth()).send({ peminjam: 'Uji', tanggal_pinjam: '2026-02-30' }).expect(400);
    await api().post(`/api/inventaris/${barangId}/peminjaman`).set('Authorization', auth()).send({ peminjam: 'Uji', tanggal_pinjam: '2026-11-15', rencana_kembali: '2026-11-14' }).expect(400);
  });
});
