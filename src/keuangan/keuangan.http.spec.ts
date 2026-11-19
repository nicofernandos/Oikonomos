import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseService } from '../database/database.service.js';
import { KeuanganModule } from './keuangan.module.js';

const openings = ['gereja', 'pusat', 'diakonia', 'pembangunan'].map((kas) => ({
  kas,
  per_tanggal: '2026-11-08',
}));
const report = { id: 1, tanggal: '2026-11-15', terkunci: false };
let role = 'bendahara';
let locked = false;
const rows = (sql: string) => {
  if (sql.includes('FROM users'))
    return [{ id: 7, username: 'b', nama: 'B', peran: role, aktif: true }];
  if (sql.includes('FROM saldo_awal') && !sql.includes('SUM')) return openings;
  if (sql.includes('SUM'))
    return openings.map((r) => ({ kas: r.kas, saldo: '0' }));
  if (sql.includes('FROM laporan_mingguan'))
    return sql.includes('LIMIT 1 FOR UPDATE')
      ? []
      : [{ ...report, terkunci: locked }];
  if (sql.includes('INSERT INTO laporan')) return [report];
  if (sql.includes('INSERT INTO transaksi'))
    return [{ id: '1', nominal: '25', tanggal: '2026-11-15' }];
  if (sql.includes('INSERT INTO persembahan'))
    return [{ id: '1', nominal: '25', bulan: '2026-11-01' }];
  if (sql.includes('INSERT INTO rekonsiliasi'))
    return [
      {
        id: '1',
        kas: 'gereja',
        saldo_sistem: '0',
        saldo_fisik: '0',
        selisih: '0',
      },
    ];
  return [];
};
const client = { query: vi.fn(async (sql: string) => ({ rows: rows(sql) })) };
const db = {
  query: vi.fn(async (sql: string) => rows(sql)),
  withTransaction: vi.fn(async (fn: any) => fn(client)),
};
describe('finance HTTP contract (real controllers, service, repository and JWT guard)', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule, KeuanganModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(db)
      .overrideProvider(ConfigService)
      .useValue({
        get: () => undefined,
        getOrThrow: () => 'test-only-secret-not-a-real-credential-32bytes',
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await module.get(JwtService).signAsync({ sub: 7 });
  });
  beforeEach(() => {
    role = 'bendahara';
    locked = false;
    db.withTransaction.mockClear();
    client.query.mockClear();
  });
  afterAll(async () => {
    await app?.close();
  });
  const tx = {
    kas: 'gereja',
    jenis: 'masuk',
    nominal: 25,
    tanggal: '2026-11-15',
    uraian: 'Syukur',
  };
  it('requires authentication for every finance endpoint', async () => {
    for (const path of ['/laporan', '/laporan/1', '/saldo?tanggal=2026-11-15'])
      await request(app.getHttpServer())
        .get('/api' + path)
        .expect(401);
    await request(app.getHttpServer())
      .post('/api/laporan')
      .send({ tanggal: '2026-11-15' })
      .expect(401);
  });
  it('exposes list, create, full detail and saldo under target routes', async () => {
    await request(app.getHttpServer())
      .get('/api/laporan')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/api/laporan')
      .auth(token, { type: 'bearer' })
      .send({ tanggal: '2026-11-15' })
      .expect(201);
    expect(created.body.tanggal).toBe('2026-11-15');
    const detail = await request(app.getHttpServer())
      .get('/api/laporan/1')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.kas.gereja.saldo_akhir).toBe('0');
    const saldo = await request(app.getHttpServer())
      .get('/api/saldo?tanggal=2026-11-15')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(saldo.body).toMatchObject({
      tanggal: '2026-11-15',
      total: '0',
      kas: { gereja: '0' },
    });
  });
  it('accepts validated transaction, offering and per-fund reconciliation bodies', async () => {
    const transaction = await request(app.getHttpServer())
      .post('/api/laporan/1/transaksi')
      .auth(token, { type: 'bearer' })
      .send(tx)
      .expect(201);
    expect(transaction.body.nominal).toBe('25');
    const offering = await request(app.getHttpServer())
      .post('/api/laporan/1/persembahan')
      .auth(token, { type: 'bearer' })
      .send({
        nama: 'A',
        bulan: '2026-11-01',
        tanggal: '2026-11-15',
        nominal: 25,
      })
      .expect(201);
    expect(offering.body.peringatan).toEqual([]);
    await request(app.getHttpServer())
      .post('/api/laporan/1/rekonsiliasi')
      .auth(token, { type: 'bearer' })
      .send({ kas: 'gereja', saldo_fisik: 0 })
      .expect(201);
  });
  it('rejects invalid dates, unsafe amounts, unknown fields and malformed IDs before writes', async () => {
    for (const body of [
      { ...tx, nominal: 9007199254740992 },
      { ...tx, tanggal: '2026-02-30' },
      { ...tx, saldo: 5 },
      { ...tx, kas: 'lain' },
    ])
      await request(app.getHttpServer())
        .post('/api/laporan/1/transaksi')
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
    for (const id of ['1abc', '1.0', '0', '2147483648'])
      await request(app.getHttpServer())
        .get('/api/laporan/' + id)
        .auth(token, { type: 'bearer' })
        .expect(400);
    await request(app.getHttpServer())
      .get('/api/saldo?tanggal=2026-02-30')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/saldo')
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  it('allows all roles to read but only bendahara to write', async () => {
    for (const value of ['admin', 'majelis']) {
      role = value;
      await request(app.getHttpServer())
        .get('/api/laporan')
        .auth(token, { type: 'bearer' })
        .expect(200);
      for (const [path, body] of [
        ['', { tanggal: '2026-11-15' }],
        ['/1/transaksi', tx],
        ['/1/persembahan', { nama: 'A' }],
        ['/1/rekonsiliasi', { kas: 'gereja', saldo_fisik: 0 }],
        ['/1/kunci', {}],
      ] as const)
        await request(app.getHttpServer())
          .post('/api/laporan' + path)
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(403);
    }
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  it('rejects locked report mutations and exposes no legacy CRUD, delete or unlock', async () => {
    locked = true;
    await request(app.getHttpServer())
      .post('/api/laporan/1/transaksi')
      .auth(token, { type: 'bearer' })
      .send(tx)
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/laporan/1/kunci')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .patch('/api/keuangan/1')
      .auth(token, { type: 'bearer' })
      .send(tx)
      .expect(404);
    await request(app.getHttpServer())
      .delete('/api/laporan/1')
      .auth(token, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/laporan/1/buka')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(404);
  });
});
