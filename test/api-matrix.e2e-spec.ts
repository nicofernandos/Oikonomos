import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import pg from 'pg';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { DatabaseService } from '../src/database/database.service.js';

const testUrl = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
type Role = 'admin' | 'bendahara' | 'majelis';
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
const password = 'matrix-password-123';
const expectedRoutes = [
  'GET /api', 'GET /api/health', 'POST /api/auth/login', 'GET /api/auth/me',
  'POST /api/auth/users', 'PATCH /api/auth/password', 'GET /api/users', 'POST /api/users',
  'GET /api/users/:id', 'PATCH /api/users/:id', 'POST /api/users/:id/reset-password', 'GET /api/laporan',
  'POST /api/laporan', 'GET /api/laporan/:id', 'POST /api/laporan/:id/transaksi',
  'POST /api/laporan/:id/persembahan', 'POST /api/laporan/:id/rekonsiliasi',
  'POST /api/laporan/:id/kunci', 'GET /api/saldo',
  'GET /api/inventaris', 'POST /api/inventaris', 'GET /api/inventaris/:id',
  'PATCH /api/inventaris/:id', 'DELETE /api/inventaris/:id',
  'POST /api/inventaris/:id/pulihkan', 'POST /api/inventaris/:id/kondisi',
  'GET /api/inventaris/:id/riwayat-kondisi', 'GET /api/inventaris/:id/peminjaman',
  'POST /api/inventaris/:id/peminjaman', 'POST /api/inventaris/:id/peminjaman/:loanId/kembali',
].sort();
const adminOnly = new Set(['GET /api/users', 'GET /api/users/:id', 'POST /api/users', 'POST /api/auth/users', 'PATCH /api/users/:id', 'POST /api/users/:id/reset-password', ...expectedRoutes.filter((route) => route.includes('/api/inventaris') && !route.startsWith('GET '))]);
const treasurerOnly = new Set(['POST /api/laporan', 'POST /api/laporan/:id/transaksi', 'POST /api/laporan/:id/persembahan', 'POST /api/laporan/:id/rekonsiliasi', 'POST /api/laporan/:id/kunci']);
const publicRoutes = new Set(['GET /api/health', 'POST /api/auth/login']);

suite('Debug matrix semua route AppModule dengan PostgreSQL asli', () => {
  let app: INestApplication;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let jwt: JwtService;
  let reportId = 1;
  let openId = 1;
  let targetUserId = 1;
  let inventoryId = '1';
  let loanId = '1';
  const schema = `matrix_${randomUUID().replaceAll('-', '')}`;
  const tokens: Record<string, string> = {};
  const actualRoutes: string[] = [];
  const results: { route: string; scenario: string; role: string; expected: number; actual: number }[] = [];

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!url.pathname.endsWith('_test')) throw new Error('Database matrix wajib bernama *_test');
    admin = new pg.Pool({ connectionString: testUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query((await readFile(`migrations/${name}`, 'utf8')).split('-- Down Migration')[0]);
    }
    const hasher = new PasswordHasher();
    const ids: Record<string, number> = {};
    for (const role of ['admin', 'bendahara', 'majelis'] as const) {
      ids[role] = (await pool.query('INSERT INTO users(username,password_hash,nama,peran) VALUES($1,$2,$1,$3) RETURNING id', [role, await hasher.hash(password), role])).rows[0].id;
    }
    await pool.query("INSERT INTO saldo_awal(kas,nominal,per_tanggal) SELECT unnest(enum_range(NULL::jenis_kas)),100000,'2026-11-08'::date");
    const { AppModule } = await import('../src/app.module.js');
    const config: Record<string, string> = { DATABASE_URL: url.toString(), JWT_SECRET: 'matrix-only-secret-longer-than-thirty-two-bytes', REQUIRE_MAJELIS_APPROVAL: 'false' };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService).useValue({ get: (key: string) => config[key], getOrThrow: (key: string) => {
        if (!(key in config)) throw new Error('Konfigurasi matrix tidak tersedia');
        return config[key];
      } }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    jwt = module.get(JwtService);
    for (const role of ['admin', 'bendahara', 'majelis']) tokens[role] = await jwt.signAsync({ sub: ids[role] });
    for (const nestModule of app.get(ModulesContainer).values()) {
      for (const controller of nestModule.controllers.values()) {
        if (!controller.metatype) continue;
        const prototype = controller.metatype.prototype;
        const base = Reflect.getMetadata(PATH_METADATA, controller.metatype) ?? '';
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
          const path = `/api/${base}/${Reflect.getMetadata(PATH_METADATA, handler) ?? ''}`.replace(/\/+/g, '/').replace(/\/$/, '');
          actualRoutes.push(`${method} ${path}`);
        }
      }
    }
    actualRoutes.sort();
  }, 30000);

  afterAll(async () => {
    const output = process.env.API_DEBUG_REPORT;
    if (output) {
      const covered = [...new Set(results.filter((row) => row.scenario === 'happy').map((row) => row.route))].sort();
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify({ generated_at: new Date().toISOString(), scope: 'AppModule + PostgreSQL schema terisolasi', active_routes: actualRoutes, active_route_count: actualRoutes.length, happy_path_covered: covered, uncovered: actualRoutes.filter((route) => !covered.includes(route)), case_count: results.length, passed: results.filter((row) => row.expected === row.actual).length, failed: results.filter((row) => row.expected !== row.actual).length, cases: results }, null, 2));
    }
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  async function probe(method: Method, path: string, expected: number, role?: Role, body?: unknown, route = `${method.toUpperCase()} ${path.split('?')[0]}`, scenario = 'validation') {
    let call = request(app.getHttpServer())[method](path);
    if (role) call = call.set('Authorization', `Bearer ${tokens[role]}`);
    if (body !== undefined) call = call.set('Content-Type', 'application/json').send(JSON.stringify(body));
    const response = await call;
    results.push({ route, scenario, role: role ?? 'publik', expected, actual: response.status });
    expect(response.status, `${scenario}: ${method.toUpperCase()} ${path}, ${role ?? 'publik'}`).toBe(expected);
    return response;
  }

  function input(route: string) {
    const [verb, template] = route.split(' ');
    const path = template.replace(':id', String(template.startsWith('/api/users') ? targetUserId : template.startsWith('/api/inventaris') ? inventoryId : reportId)).replace(':loanId', loanId);
    let body: unknown;
    if (adminOnly.has(route)) body = route.startsWith('PATCH') ? { nama: 'Matrix Name' } : route.endsWith('reset-password') ? { password } : { username: 'denied_matrix', nama: 'Denied', password, peran: 'majelis' };
    if (route === 'POST /api/laporan') body = { tanggal: '2026-11-15' };
    if (route.endsWith('/transaksi')) body = { kas: 'gereja', jenis: 'masuk', nominal: 1, uraian: 'Uji hak akses', tanggal: '2026-11-15' };
    if (route.endsWith('/persembahan')) body = { nama: 'Fixture', bulan: '2026-11-01', nominal: 1, tanggal: '2026-11-15' };
    if (route.endsWith('/rekonsiliasi')) body = { kas: 'gereja', saldo_fisik: 100000 };
    if (route.endsWith('/kunci')) body = {};
    return { method: verb.toLowerCase() as Method, path: route === 'GET /api/saldo' ? `${path}?tanggal=2026-11-15` : path, body };
  }

  it('mencocokkan inventaris seluruh route aktif tanpa scaffold yang tidak terdaftar', () => {
    expect(actualRoutes).toEqual(expectedRoutes);
  });

  it('memeriksa autentikasi setiap route aktif', async () => {
    for (const route of expectedRoutes) {
      const spec = input(route);
      await probe(spec.method, spec.path, route === 'GET /api/health' ? 200 : route === 'POST /api/auth/login' ? 400 : 401, undefined, spec.method === 'get' ? undefined : {}, route, 'authentication');
    }
  });

  it('menjalankan happy path setiap endpoint dengan data nyata di schema uji', async () => {
    const happy = (method: Method, path: string, status: number, role?: Role, body?: unknown, route?: string) => probe(method, path, status, role, body, route, 'happy');
    await happy('get', '/api/health', 200);
    const login = await happy('post', '/api/auth/login', 200, undefined, { username: 'admin', password });
    expect(login.body.expires_in).toBe(28800);
    await happy('get', '/api', 200, 'admin');
    const me = await happy('get', '/api/auth/me', 200, 'admin');
    expect(me.body.username).toBe('admin');
    const user = await happy('post', '/api/users', 201, 'admin', { username: 'matrix_canonical', password, nama: 'Matrix User', peran: 'majelis' });
    targetUserId = user.body.id;
    await happy('post', '/api/auth/users', 201, 'admin', { username: 'matrix_alias', password, nama: 'Matrix Alias', peran: 'bendahara' });
    await happy('get', '/api/users', 200, 'admin');
    const userDetail = await happy('get', `/api/users/${targetUserId}`, 200, 'admin', undefined, 'GET /api/users/:id');
    expect(userDetail.body).toEqual(user.body);
    await happy('patch', `/api/users/${targetUserId}`, 200, 'admin', { nama: 'Matrix Renamed' }, 'PATCH /api/users/:id');
    await happy('post', `/api/users/${targetUserId}/reset-password`, 200, 'admin', { password: 'matrix-replacement-123' }, 'POST /api/users/:id/reset-password');
    await happy('patch', '/api/auth/password', 200, 'majelis', { currentPassword: password, newPassword: 'matrix-replacement-123' });
    const created = await happy('post', '/api/laporan', 201, 'bendahara', { tanggal: '2026-11-15' });
    reportId = created.body.id;
    await happy('get', '/api/laporan', 200, 'majelis');
    await happy('post', `/api/laporan/${reportId}/transaksi`, 201, 'bendahara', { kas: 'gereja', jenis: 'masuk', uraian: 'Matrix pemasukan', nominal: 25000, tanggal: '2026-11-15' }, 'POST /api/laporan/:id/transaksi');
    await happy('post', `/api/laporan/${reportId}/persembahan`, 201, 'bendahara', { nama: 'Matrix Jemaat', bulan: '2026-11-01', nominal: 5000, tanggal: '2026-11-15' }, 'POST /api/laporan/:id/persembahan');
    for (const kas of ['gereja', 'pusat', 'diakonia', 'pembangunan']) await happy('post', `/api/laporan/${reportId}/rekonsiliasi`, 201, 'bendahara', { kas, saldo_fisik: kas === 'gereja' ? 130000 : 100000 }, 'POST /api/laporan/:id/rekonsiliasi');
    await happy('post', `/api/laporan/${reportId}/kunci`, 201, 'bendahara', {}, 'POST /api/laporan/:id/kunci');
    const detail = await happy('get', `/api/laporan/${reportId}`, 200, 'majelis', undefined, 'GET /api/laporan/:id');
    expect(detail.body.total_saldo_akhir).toBe('430000');
    const saldo = await happy('get', '/api/saldo?tanggal=2026-11-15', 200, 'admin', undefined, 'GET /api/saldo');
    expect(saldo.body.total).toBe('430000');
    const item = await happy('post', '/api/inventaris', 201, 'admin', { kode: 'MATRIX-001', nama: 'Kursi', lokasi: 'Aula', penanggung_jawab: 'Petugas' });
    inventoryId = item.body.id;
    await happy('get', '/api/inventaris', 200, 'majelis');
    await happy('get', `/api/inventaris/${inventoryId}`, 200, 'majelis', undefined, 'GET /api/inventaris/:id');
    await happy('patch', `/api/inventaris/${inventoryId}`, 200, 'admin', { nama: 'Bangku' }, 'PATCH /api/inventaris/:id');
    await happy('post', `/api/inventaris/${inventoryId}/kondisi`, 201, 'admin', { kondisi: 'rusak', catatan: 'Patah' }, 'POST /api/inventaris/:id/kondisi');
    await happy('get', `/api/inventaris/${inventoryId}/riwayat-kondisi`, 200, 'majelis', undefined, 'GET /api/inventaris/:id/riwayat-kondisi');
    const loan = await happy('post', `/api/inventaris/${inventoryId}/peminjaman`, 201, 'admin', { peminjam: 'Petugas', tanggal_pinjam: '2026-11-18' }, 'POST /api/inventaris/:id/peminjaman');
    loanId = loan.body.id;
    await happy('get', `/api/inventaris/${inventoryId}/peminjaman`, 200, 'majelis', undefined, 'GET /api/inventaris/:id/peminjaman');
    await happy('post', `/api/inventaris/${inventoryId}/peminjaman/${loanId}/kembali`, 201, 'admin', { tanggal_kembali: '2026-11-19' }, 'POST /api/inventaris/:id/peminjaman/:loanId/kembali');
    await happy('delete', `/api/inventaris/${inventoryId}`, 200, 'admin', {}, 'DELETE /api/inventaris/:id');
    await happy('post', `/api/inventaris/${inventoryId}/pulihkan`, 201, 'admin', {}, 'POST /api/inventaris/:id/pulihkan');
    expect([...new Set(results.filter((row) => row.scenario === 'happy').map((row) => row.route))].sort()).toEqual(actualRoutes);
    openId = (await probe('post', '/api/laporan', 201, 'bendahara', { tanggal: '2026-11-22' })).body.id;
  });

  it('memeriksa matriks hak akses semua role pada seluruh route terbatas', async () => {
    for (const route of expectedRoutes) {
      for (const role of ['admin', 'bendahara', 'majelis'] as const) {
        const spec = input(route);
        if ((adminOnly.has(route) && role !== 'admin') || (treasurerOnly.has(route) && role !== 'bendahara')) {
          await probe(spec.method, spec.path, 403, role, spec.body, route, 'authorization');
        } else if (spec.method === 'get' && !publicRoutes.has(route)) {
          await probe(spec.method, spec.path, 200, role, undefined, route, 'authorization');
        }
      }
    }
  });

  it('menolak ID dan query tanggal yang tidak valid tanpa error database', async () => {
    for (const id of ['0', '-1', '2147483648', '9223372036854775808', 'abc']) {
      await probe('get', `/api/laporan/${id}`, 400, 'admin', undefined, 'GET /api/laporan/:id');
      await probe('patch', `/api/users/${id}`, 400, 'admin', { aktif: false }, 'PATCH /api/users/:id');
    }
    for (const query of ['', 'tanggal=2026-02-30', 'tanggal=2026-11-15T00%3A00%3A00Z', 'tanggal=2026-11-15&tanggal=2026-11-22']) {
      await probe('get', `/api/saldo?${query}`, 400, 'majelis', undefined, 'GET /api/saldo');
    }
  });

  it('menolak JWT subject di luar rentang ID PostgreSQL', async () => {
    const token = await jwt.signAsync({ sub: 2147483648 });
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    results.push({ route: 'GET /api/auth/me', scenario: 'jwt-subject-range', role: 'token-subject-invalid', expected: 401, actual: response.status });
    expect(response.status).toBe(401);
  });

  it.each(['hex', 'exponent', 'rounded', 'leading-zero', 'signed', 'newline'])('menolak ID pengguna nonkanonik tanpa alias target: %s', async (kind) => {
    const aliases: Record<string, string> = {
      hex: `0x${targetUserId.toString(16)}`, exponent: `${targetUserId}e0`, rounded: `${targetUserId}.0000000000000001`,
      'leading-zero': `0${targetUserId}`, signed: `%2B${targetUserId}`, newline: `${targetUserId}%0A`,
    };
    const id = aliases[kind];
    await probe('patch', `/api/users/${id}`, 400, 'admin', { nama: 'Tidak boleh berubah' }, 'PATCH /api/users/:id', `noncanonical-id-${kind}`);
    await probe('post', `/api/users/${id}/reset-password`, 400, 'admin', { password }, 'POST /api/users/:id/reset-password', `noncanonical-id-${kind}`);
  });

  it('menolak newline pada ID laporan dan nominal string', async () => {
    await probe('get', `/api/laporan/${reportId}%0A`, 400, 'admin', undefined, 'GET /api/laporan/:id', 'noncanonical-report-id');
    await probe('post', `/api/laporan/${openId}/transaksi`, 400, 'bendahara', { kas: 'gereja', jenis: 'masuk', nominal: '1\n', uraian: 'Nominal nonkanonik', tanggal: '2026-11-22' }, 'POST /api/laporan/:id/transaksi', 'noncanonical-money');
  });

  it.each(['high', 'low'])('menolak Unicode surrogate tidak berpasangan: %s', async (kind) => {
    const text = kind === 'high' ? 'Nama\uD800Uji' : 'Nama\uDC00Uji';
    await probe('post', '/api/users', 400, 'admin', { username: `matrix_unicode_${kind}`, password, nama: text, peran: 'majelis' }, 'POST /api/users', 'invalid-unicode');
    await probe('patch', `/api/users/${targetUserId}`, 400, 'admin', { nama: text }, 'PATCH /api/users/:id', 'invalid-unicode');
    await probe('post', `/api/laporan/${openId}/transaksi`, 400, 'bendahara', { kas: 'gereja', jenis: 'masuk', nominal: 1, uraian: text, tanggal: '2026-11-22' }, 'POST /api/laporan/:id/transaksi', 'invalid-unicode');
    await probe('post', `/api/laporan/${openId}/persembahan`, 400, 'bendahara', { nama: text, nominal: 1, bulan: '2026-11-01', tanggal: '2026-11-22' }, 'POST /api/laporan/:id/persembahan', 'invalid-unicode');
  });

  it('tetap menerima teks Unicode yang valid termasuk emoji', async () => {
    const response = await probe('post', `/api/laporan/${openId}/transaksi`, 201, 'bendahara', { kas: 'gereja', jenis: 'masuk', nominal: 1, uraian: 'Ucapan syukur 🙏', tanggal: '2026-11-22' }, 'POST /api/laporan/:id/transaksi', 'valid-unicode');
    expect(response.body.uraian).toBe('Ucapan syukur 🙏');
  });

  it.each(['login', 'create-user', 'legacy-create-user', 'update-user', 'transaction', 'offering'])('menolak NUL pada teks bisnis: %s', async (scenario) => {
    if (scenario === 'login') await probe('post', '/api/auth/login', 400, undefined, { username: 'Nama\u0000Uji', password }, 'POST /api/auth/login', scenario);
    if (scenario === 'create-user') await probe('post', '/api/users', 400, 'admin', { username: 'matrix_nul', password, nama: 'Nama\u0000Uji', peran: 'majelis' }, 'POST /api/users', scenario);
    if (scenario === 'legacy-create-user') await probe('post', '/api/auth/users', 400, 'admin', { username: 'matrix_nul_alias', password, nama: 'Nama\u0000Uji', peran: 'majelis' }, 'POST /api/auth/users', scenario);
    if (scenario === 'update-user') await probe('patch', `/api/users/${targetUserId}`, 400, 'admin', { nama: 'Nama\u0000Uji' }, 'PATCH /api/users/:id', scenario);
    if (scenario === 'transaction') await probe('post', `/api/laporan/${openId}/transaksi`, 400, 'bendahara', { kas: 'gereja', jenis: 'masuk', nominal: 1, uraian: 'Uraian\u0000Uji', tanggal: '2026-11-22' }, 'POST /api/laporan/:id/transaksi', scenario);
    if (scenario === 'offering') await probe('post', `/api/laporan/${openId}/persembahan`, 400, 'bendahara', { nama: 'Nama\u0000Uji', nominal: 1, bulan: '2026-11-01', tanggal: '2026-11-22' }, 'POST /api/laporan/:id/persembahan', scenario);
  });

  it('mengembalikan 503 saat query health gagal tanpa membocorkan detail', async () => {
    const spy = vi.spyOn(app.get(DatabaseService), 'query').mockRejectedValueOnce(new Error('private-database-error-fixture'));
    try {
      const response = await probe('get', '/api/health', 503, undefined, undefined, 'GET /api/health', 'database-outage-simulated');
      expect(JSON.stringify(response.body)).not.toContain('private-database-error-fixture');
    } finally { spy.mockRestore(); }
  });

  it('menolak method penghapusan yang tidak terdaftar dan JSON rusak', async () => {
    await probe('delete', `/api/laporan/${reportId}`, 404, 'bendahara');
    await probe('put', `/api/users/${targetUserId}`, 404, 'admin', {});
    const malformed = await request(app.getHttpServer()).post('/api/users').set('Authorization', `Bearer ${tokens.admin}`).set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
  });

  it('membatasi login dengan Retry-After tanpa memblokir pembacaan profil', async () => {
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const response = await request(app.getHttpServer()).post('/api/auth/login').send({});
      results.push({ route: 'POST /api/auth/login', scenario: 'rate-limit', role: 'publik', expected: response.status === 429 ? 429 : 400, actual: response.status });
      if (response.status === 429) {
        limited = true;
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        break;
      }
      expect(response.status).toBe(400);
    }
    expect(limited).toBe(true);
    await probe('get', '/api/auth/me', 200, 'admin');
  });
});
