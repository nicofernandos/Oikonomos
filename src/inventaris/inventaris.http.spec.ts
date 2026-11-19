import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseService } from '../database/database.service.js';
import { InventarisModule } from './inventaris.module.js';
const id = '9007199254740993';
const metadata = { updated_at: '2026-11-18T00:00:00.000Z', updated_by: 7, modified_at: '2026-11-18T00:00:00.000Z', modified_by: 7, deleted_at: null, deleted_by: null, is_deleted: false };
const payload = { kode: 'K-1', nama: 'Kursi', lokasi: 'Aula', penanggung_jawab: 'B' };
let role = 'admin';
let item: any;
let loan: any;
let history: any[];
const rows = (sql: string, params: any[] = []) => {
  if (sql.includes('FROM users')) return [{ id: 7, username: 'a', nama: 'A', peran: role, aktif: true }];
  if (sql.startsWith('INSERT INTO barang')) { item = { id, ...payload, keterangan: null, kondisi: params[3], transaksi_id: null, dibuat_oleh: 7, dibuat_pada: metadata.updated_at, ...metadata }; return [item]; }
  if (sql.startsWith('UPDATE barang')) {
    if (sql.includes('is_deleted=true')) Object.assign(item, { is_deleted: true, deleted_by: 7, deleted_at: metadata.updated_at });
    else if (sql.includes('is_deleted=false')) Object.assign(item, { is_deleted: false, deleted_by: null, deleted_at: null });
    else if (sql.includes('kondisi=$2')) item.kondisi = params[1];
    else item.nama = params[1];
    return [item];
  }
  if (sql.startsWith('INSERT INTO riwayat')) { const row = { id: String(history.length + 1), barang_id: params[0], kondisi_lama: params[1], kondisi_baru: params[2], catatan: params[3], diubah_oleh: params[4], waktu: metadata.updated_at, ...metadata }; history.push(row); return [row]; }
  if (sql.includes('FROM riwayat_kondisi_barang')) return history;
  if (sql.startsWith('SELECT') && sql.includes('FROM barang')) return item && (!item.is_deleted || !sql.includes('is_deleted = false')) ? [item] : [];
  if (sql.startsWith('INSERT INTO peminjaman_barang')) { loan = { id: '2', barang_id: params[0], peminjam: params[1], tanggal_pinjam: params[2], rencana_kembali: params[3], tanggal_kembali: null, catatan: params[4], dibuat_oleh: 7, dibuat_pada: metadata.updated_at, ...metadata }; return [loan]; }
  if (sql.startsWith('UPDATE peminjaman_barang')) { loan.tanggal_kembali = params[2]; return [loan]; }
  if (sql.includes('FROM peminjaman_barang')) return loan && (!sql.includes('tanggal_kembali IS NULL') || !loan.tanggal_kembali) ? [loan] : [];
  return [];
};
const client = { query: vi.fn(async (sql: string, params?: any[]) => ({ rows: rows(sql, params) })) };
const db = { query: vi.fn(async (sql: string, params?: any[]) => rows(sql, params)), withTransaction: vi.fn(async (fn: any) => fn(client)) };
const writes = [
  ['post', '', payload], ['patch', '/1', { nama: 'Bangku' }], ['delete', '/1', {}], ['post', '/1/pulihkan', {}],
  ['post', '/1/kondisi', { kondisi: 'rusak', catatan: 'Patah' }],
  ['post', '/1/peminjaman', { peminjam: 'A', tanggal_pinjam: '2026-11-18' }],
  ['post', '/1/peminjaman/2/kembali', { tanggal_kembali: '2026-11-19' }],
] as const;
describe('inventory HTTP (real JWT guard/controller/service/repository; mocked SQL)', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule, InventarisModule] })
      .overrideProvider(DatabaseService).useValue(db)
      .overrideProvider(ConfigService).useValue({ get: () => undefined, getOrThrow: () => 'test-only-secret-not-a-real-credential-32bytes' }).compile();
    app = mod.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    token = await mod.get(JwtService).signAsync({ sub: 7 });
  });
  beforeEach(() => { role = 'admin'; item = { id, ...payload, kondisi: 'baik', ...metadata }; loan = undefined; history = []; vi.clearAllMocks(); });
  afterAll(async () => { await app?.close(); });
  it('protects every inventory route by default', async () => {
    for (const path of ['', '/1', '/1/riwayat-kondisi', '/1/peminjaman']) await request(app.getHttpServer()).get('/api/inventaris' + path).expect(401);
    for (const [verb, path, body] of writes) await request(app.getHttpServer())[verb]('/api/inventaris' + path).send(body).expect(401);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  it('permits all roles to read and only admin to write, before inventory SQL', async () => {
    for (const peran of ['admin','bendahara','majelis']) {
      role = peran;
      for (const path of ['', '/' + id, '/' + id + '/riwayat-kondisi', '/' + id + '/peminjaman']) await request(app.getHttpServer()).get('/api/inventaris' + path).auth(token, { type: 'bearer' }).expect(200);
      if (peran === 'admin') continue;
      db.withTransaction.mockClear(); client.query.mockClear();
      for (const [verb,path,body] of writes) await request(app.getHttpServer())[verb]('/api/inventaris' + path).auth(token, { type: 'bearer' }).send(body).expect(403);
      expect(db.withTransaction).not.toHaveBeenCalled(); expect(client.query).not.toHaveBeenCalled();
    }
  });
  it('serves full lifecycle routes with string IDs, metadata and exact statuses', async () => {
    const api = (verb: 'get'|'post'|'patch'|'delete', path = '') => request(app.getHttpServer())[verb]('/api/inventaris' + path).auth(token, { type: 'bearer' });
    const created = await api('post').send(payload).expect(201);
    expect(created.body).toMatchObject({ id, ...metadata });
    expect((await api('get').expect(200)).body).toHaveLength(1);
    expect((await api('get','/' + id).expect(200)).body.id).toBe(id);
    await api('patch','/' + id).send({ nama: 'Bangku' }).expect(200);
    const changed = await api('post','/' + id + '/kondisi').send({ kondisi: 'rusak', catatan: 'Patah' }).expect(201);
    expect(changed.body.riwayat.kondisi_lama).toBe('baik');
    expect((await api('get','/' + id + '/riwayat-kondisi').expect(200)).body).toHaveLength(2);
    const borrowed = await api('post','/' + id + '/peminjaman').send({ peminjam: 'A', tanggal_pinjam: '2026-11-18' }).expect(201);
    expect(borrowed.body.id).toBe('2');
    await api('delete','/' + id).send({}).expect(409);
    await api('post','/' + id + '/peminjaman').send({ peminjam: 'B', tanggal_pinjam: '2026-11-18' }).expect(409);
    expect((await api('get','/' + id + '/peminjaman').expect(200)).body).toHaveLength(1);
    expect((await api('post','/' + id + '/peminjaman/2/kembali').send({ tanggal_kembali: '2026-11-19' }).expect(201)).body.tanggal_kembali).toBe('2026-11-19');
    expect((await api('delete','/' + id).send({}).expect(200)).body.is_deleted).toBe(true);
    await api('get','/' + id).expect(404);
    expect((await api('post','/' + id + '/pulihkan').send({}).expect(201)).body.is_deleted).toBe(false);
  });
  it('strictly rejects unknown fields and malformed IDs before SQL', async () => {
    for (const body of [{ ...payload, dibuat_oleh: 1 }, { ...payload, is_deleted: true }, { ...payload, transaksi_id: 1 }, { ...payload, nama: '\u0000' }]) await request(app.getHttpServer()).post('/api/inventaris').auth(token, { type: 'bearer' }).send(body).expect(400);
    for (const value of ['01','0','1e2','9223372036854775808']) await request(app.getHttpServer()).get('/api/inventaris/' + value).auth(token, { type: 'bearer' }).expect(400);
    await request(app.getHttpServer()).patch('/api/inventaris/1').auth(token, { type: 'bearer' }).send({ kondisi: 'rusak' }).expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled(); expect(client.query).not.toHaveBeenCalled();
  });
});
