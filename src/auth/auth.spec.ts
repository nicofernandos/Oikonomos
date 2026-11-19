import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import { DatabaseService } from '../database/database.service.js';

const user = { id: 1, username: 'admin', nama: 'Administrator', peran: 'admin' as const, aktif: true };
const client = { query: vi.fn() };
const db = { query: vi.fn(), withTransaction: vi.fn(async (fn) => fn(client)) };

describe('Auth API', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let hash: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DatabaseService).useValue(db)
      .overrideProvider(ConfigService).useValue({ getOrThrow: () => 'test-secret-that-is-at-least-32-bytes-long' })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = module.get(JwtService);
    hash = await module.get(PasswordHasher).hash('strong-password-123');
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { db.query.mockReset(); client.query.mockReset(); db.withTransaction.mockClear(); });

  it('logs in and never exposes the password hash', async () => {
    db.query.mockResolvedValue([{ ...user, password_hash: hash }]);
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ username: 'admin', password: 'strong-password-123' }).expect(200);
    expect(response.body.user).toEqual(user);
    expect(response.body.expires_in).toBe(28800);
    const payload = await jwt.verifyAsync(response.body.access_token);
    expect(payload.sub).toBe(1);
    expect(payload.exp - payload.iat).toBe(28800);
    await expect(jwt.verifyAsync(response.body.access_token, { clockTimestamp: payload.exp })).rejects.toThrow();
    expect(JSON.stringify(response.body)).not.toContain(hash);
  });

  it('rejects wrong passwords, unknown users, and inactive accounts uniformly', async () => {
    const service = app.get(AuthService);
    for (const rows of [[{ ...user, password_hash: hash }], [], [{ ...user, aktif: false, password_hash: hash }]]) {
      db.query.mockResolvedValue(rows);
      await expect(service.login({ username: 'admin', password: 'incorrect' })).rejects.toThrow('Username atau password salah');
    }
    db.query.mockResolvedValue([{ ...user, aktif: false, password_hash: hash }]);
    await expect(service.login({ username: 'admin', password: 'strong-password-123' })).rejects.toThrow('Username atau password salah');
  });

  it('rejects an active soft-deleted login account using a database predicate', async () => {
    db.query.mockImplementation(async (sql) => /is_deleted\s*=\s*false/i.test(sql)
      ? [] : [{ ...user, is_deleted: true, password_hash: hash }]);
    await expect(app.get(AuthService).login({ username: user.username, password: 'strong-password-123' }))
      .rejects.toThrow('Username atau password salah');
    expect(db.query.mock.calls[0][0]).toMatch(/is_deleted\s*=\s*false/i);
  });

  it('validates login input', async () => {
    const response = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 42 }).expect(400);
    expect(response.body.message).toContain('Username harus berupa teks');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires a valid, unexpired bearer token', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer invalid').expect(401);
    const expired = await jwt.signAsync({ sub: 1 }, { expiresIn: -1 });
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    const wrongAlgorithm = await jwt.signAsync({ sub: 1 }, { algorithm: 'HS384' });
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${wrongAlgorithm}`).expect(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('loads the current profile and rejects disabled or deleted users', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    db.query.mockResolvedValue([user]);
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toEqual(user);
    db.query.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('revokes an existing bearer token after soft deletion even while active', async () => {
    const token = await jwt.signAsync({ sub: user.id });
    let deleted = false;
    db.query.mockImplementation(async (sql) => deleted && /is_deleted\s*=\s*false/i.test(sql)
      ? [] : [{ ...user, is_deleted: deleted }]);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    deleted = true;
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    expect(db.query.mock.calls[1][0]).toMatch(/aktif\s*=\s*true.*is_deleted\s*=\s*false/i);
  });

  it('restricts user creation to admins', async () => {
    db.query.mockResolvedValue([{ ...user, peran: 'majelis' }]);
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).post('/api/auth/users').set('Authorization', `Bearer ${token}`)
      .send({ username: 'bendahara', password: 'strong-password-123', nama: 'Bendahara', peran: 'bendahara' }).expect(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('creates users with a hash and handles duplicate usernames', async () => {
    const service = app.get(AuthService);
    const dto = { username: 'newuser', password: 'strong-password-123', nama: 'New User', peran: 'majelis' as const };
    client.query.mockResolvedValue({ rows: [{ ...user, password_hash: hash }] });
    await expect(service.createUser(user, dto)).resolves.toEqual(user);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    const audit = client.query.mock.calls[1];
    expect(audit[0]).toContain('INSERT INTO audit_log');
    expect(audit[1].slice(0, 4)).toEqual([1, 'create', 'users', '1']);
    expect(JSON.stringify(audit)).not.toMatch(/password|token|scrypt/i);
    expect(JSON.stringify(audit)).not.toContain(dto.password);
    expect(JSON.stringify(audit)).not.toContain(hash);
    const params = client.query.mock.calls[0][1];
    expect(params[1]).not.toBe(dto.password);
    expect(await app.get(PasswordHasher).verify(dto.password, params[1])).toBe(true);
    client.query.mockRejectedValue({ code: '23505' });
    await expect(service.createUser(user, dto)).rejects.toThrow('Username sudah digunakan');
  });

  it('requires the old password and stores the new password as a hash', async () => {
    const service = app.get(AuthService);
    client.query.mockResolvedValueOnce({ rows: [{ ...user, password_hash: hash }] });
    await expect(service.changePassword(user, { currentPassword: 'wrong', newPassword: '1234567890' })).rejects.toThrow('Password saat ini salah');
    expect(client.query).toHaveBeenCalledTimes(1);
    client.query.mockReset().mockResolvedValueOnce({ rows: [{ ...user, password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [user] }).mockResolvedValueOnce({ rows: [] });
    await service.changePassword(user, { currentPassword: 'strong-password-123', newPassword: '1234567890' });
    const params = client.query.mock.calls[1][1];
    expect(await app.get(PasswordHasher).verify('1234567890', params[0])).toBe(true);
    expect(params[2]).toBe(hash);
    expect(client.query.mock.calls[2][0]).toContain('INSERT INTO audit_log');
    expect(JSON.stringify(client.query.mock.calls[2][1])).not.toContain(hash);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('creates an audited account through canonical users with a ten-character password', async () => {
    const dto = { username: 'newuser', password: '1234567890', nama: 'New User', peran: 'majelis' };
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [{ ...user, password_hash: hash }] });
    const token = await jwt.signAsync({ sub: 1 });
    const response = await request(app.getHttpServer()).post('/api/users')
      .set('Authorization', `Bearer ${token}`).send(dto).expect(201);
    expect(response.body).toEqual(user);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[1][0]).toContain('INSERT INTO audit_log');
    expect(await app.get(PasswordHasher).verify(dto.password, client.query.mock.calls[0][1][1])).toBe(true);
  });

  it('lists sanitized accounts for admins only', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    db.query.mockResolvedValueOnce([user]).mockResolvedValueOnce([{ ...user, password_hash: hash }]);
    const response = await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toEqual([user]);
    for (const peran of ['bendahara', 'majelis']) {
      db.query.mockResolvedValue([{ ...user, peran }]);
      await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
    }
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('updates account name, role and active status atomically with a private audit', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    const updated = { ...user, id: 2, nama: 'New Name', peran: 'bendahara', aktif: false };
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [{ ...updated, password_hash: hash }] });
    const response = await request(app.getHttpServer()).patch('/api/users/2').set('Authorization', `Bearer ${token}`)
      .send({ nama: ' New Name ', peran: 'bendahara', aktif: false }).expect(200);
    expect(response.body).toEqual(updated);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual(['New Name', 'bendahara', false, 2]);
    const audit = client.query.mock.calls[1];
    expect(audit[0]).toContain('INSERT INTO audit_log');
    expect(audit[1].slice(0, 4)).toEqual([1, 'update', 'users', '2']);
    expect(JSON.stringify(audit)).not.toMatch(/password|token|scrypt/i);
    expect(JSON.stringify(audit)).not.toContain(hash);
  });

  it('resets passwords from an explicit body and never audits secrets', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [{ ...user, password_hash: hash }] });
    const response = await request(app.getHttpServer()).post('/api/users/1/reset-password')
      .set('Authorization', `Bearer ${token}`).send({ password: '1234567890' }).expect(200);
    expect(response.body).toEqual(user);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(await app.get(PasswordHasher).verify('1234567890', client.query.mock.calls[0][1][0])).toBe(true);
    const audit = client.query.mock.calls[1];
    expect(audit[0]).toContain('INSERT INTO audit_log');
    expect(audit[1].slice(0, 4)).toEqual([1, 'reset-password', 'users', '1']);
    const summary = JSON.parse(audit[1][4]);
    expect(summary).toEqual(user);
    expect(JSON.stringify(summary)).not.toMatch(/password|token|scrypt/i);
    expect(JSON.stringify(audit)).not.toContain(hash);
    expect(JSON.stringify(audit)).not.toContain('1234567890');
  });

  it.each([{}, { nama: null }, { nama: '  ' }, { peran: 'root' }, { aktif: 'false' }, { aktif: null }, { password: '1234567890' }, { username: 'changed' }])('rejects invalid account updates %j', async (body) => {
    db.query.mockResolvedValue([user]);
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch('/api/users/2').set('Authorization', `Bearer ${token}`).send(body).expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('accepts a ten-character self-service password', async () => {
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValueOnce({ rows: [{ ...user, password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [user] }).mockResolvedValueOnce({ rows: [] });
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'strong-password-123', newPassword: '1234567890' }).expect(200);
  });

  it.each(['bendahara', 'majelis'])('rejects all canonical account writes by %s', async (peran) => {
    db.query.mockResolvedValue([{ ...user, peran }]);
    const token = await jwt.signAsync({ sub: 1 });
    for (const [method, path, body] of [
      ['post', '/api/users', { username: 'newuser', password: '1234567890', nama: 'New', peran: 'majelis' }],
      ['patch', '/api/users/2', { aktif: false }],
      ['post', '/api/users/2/reset-password', { password: '1234567890' }],
    ] as const) {
      await request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`).send(body).expect(403);
    }
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('requires authentication on every canonical users route', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
    await request(app.getHttpServer()).post('/api/users').send({}).expect(401);
    await request(app.getHttpServer()).patch('/api/users/1').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/users/1/reset-password').send({}).expect(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an existing token immediately when its account is disabled', async () => {
    const token = await jwt.signAsync({ sub: 1 });
    db.query.mockResolvedValueOnce([user]).mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${token}`).expect(401);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it.each([{ password: '123456789' }, { password: null }, {}, { password: 1234567890 }])('rejects invalid explicit reset password %j', async (body) => {
    db.query.mockResolvedValue([user]);
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).post('/api/users/1/reset-password').set('Authorization', `Bearer ${token}`).send(body).expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it.each([{ password: '123456789' }, { nama: '  ' }, { peran: 'root' }, { username: '!' }])('validates canonical creation %j', async (override) => {
    db.query.mockResolvedValue([user]);
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).post('/api/users').set('Authorization', `Bearer ${token}`)
      .send({ username: 'newuser', nama: 'New', peran: 'majelis', password: '1234567890', ...override }).expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('does not report a successful mutation when the audit insert fails', async () => {
    const service = app.get(AuthService);
    client.query.mockResolvedValueOnce({ rows: [user] }).mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.createUser(user, { username: 'newuser', password: '1234567890', nama: 'New', peran: 'majelis' }))
      .rejects.toThrow('audit unavailable');
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns not found without an audit for an unknown account update', async () => {
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [] });
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch('/api/users/999').set('Authorization', `Bearer ${token}`).send({ aktif: false }).expect(404);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('supports a partial active-status update without overwriting other fields', async () => {
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [{ ...user, aktif: false }] });
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch('/api/users/1').set('Authorization', `Bearer ${token}`).send({ aktif: false }).expect(200);
    expect(client.query.mock.calls[0][1]).toEqual([null, null, false, 1]);
  });

  it.each(['0', '-1', '2147483648', '9007199254740993', 'abc', '0x2', '2e0', '2.0', '02', '+2', '2\n', '2\r', '2\r\n', '２'])('rejects invalid account identifiers %s before writing', async (id) => {
    db.query.mockResolvedValue([user]);
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch(`/api/users/${encodeURIComponent(id)}`).set('Authorization', `Bearer ${token}`).send({ aktif: false }).expect(400);
    await request(app.getHttpServer()).post(`/api/users/${encodeURIComponent(id)}/reset-password`).set('Authorization', `Bearer ${token}`).send({ password: '1234567890' }).expect(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['1', '2147483647'])('accepts canonical account identifier %s on both writes', async (id) => {
    db.query.mockResolvedValue([user]);
    client.query.mockResolvedValue({ rows: [{ ...user, id: Number(id), password_hash: hash }] });
    const token = await jwt.signAsync({ sub: 1 });
    await request(app.getHttpServer()).patch(`/api/users/${id}`).set('Authorization', `Bearer ${token}`).send({ aktif: false }).expect(200);
    expect(client.query.mock.calls[0][1][3]).toBe(Number(id));
    client.query.mockClear();
    await request(app.getHttpServer()).post(`/api/users/${id}/reset-password`).set('Authorization', `Bearer ${token}`).send({ password: '1234567890' }).expect(200);
    expect(client.query.mock.calls[0][1][1]).toBe(Number(id));
  });

  it('limits login attempts per IP', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await request(app.getHttpServer()).post('/api/auth/login').send({});
      expect([400, 429]).toContain(response.status);
    }
    await request(app.getHttpServer()).post('/api/auth/login').send({}).expect(429);
  });
});

describe('PasswordHasher', () => {
  it('uses unique salts and rejects malformed hashes', async () => {
    const hasher = new PasswordHasher();
    const first = await hasher.hash('secret');
    expect(await hasher.hash('secret')).not.toBe(first);
    expect(await hasher.verify('secret', first)).toBe(true);
    expect(await hasher.verify('wrong', first)).toBe(false);
    expect(await hasher.verify('secret', 'invalid')).toBe(false);
  });
});
