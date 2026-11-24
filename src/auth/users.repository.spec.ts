import { UsersRepository } from './users.repository.js';
import type { DatabaseService } from '../database/database.service.js';
import { PasswordHasher } from './password-hasher.js';

const actor = { id: 17, username: 'admin', nama: 'Admin', peran: 'admin' as const, aktif: true };
const target = { ...actor, id: 42, username: 'target', is_deleted: true };
const client = { query: vi.fn() };
const db = { query: vi.fn(), withTransaction: vi.fn(async (fn) => fn(client)) };
const repository = new UsersRepository(db as unknown as DatabaseService);

beforeEach(() => { db.query.mockReset(); client.query.mockReset(); db.withTransaction.mockClear(); });

it.each(['update', 'reset'] as const)('does not %s a soft-deleted account or audit it', async (operation) => {
  client.query.mockImplementation(async (sql) => ({ rows: /is_deleted\s*=\s*false/i.test(sql) ? [] : [target] }));
  const result = operation === 'update'
    ? repository.update(actor, target.id, { aktif: true })
    : repository.resetPassword(actor, target.id, 'new-hash');
  await expect(result).rejects.toThrow('Pengguna tidak ditemukan');
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls[0][0]).toMatch(/WHERE id = \$\d AND is_deleted\s*=\s*false/i);
});

it.each(['before-read', 'before-write'] as const)('rejects self-service password change when soft-deleted %s', async (stage) => {
  const passwords = { verify: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue('new-hash') };
  client.query.mockImplementation(async (sql) => ({ rows: /is_deleted\s*=\s*false/i.test(sql)
    && (stage === 'before-read' || sql.startsWith('UPDATE')) ? [] : [{ ...target, password_hash: 'old-hash' }] }));
  await expect(repository.changePassword(target, 'old', 'new', passwords as unknown as PasswordHasher))
    .rejects.toThrow(stage === 'before-read' ? 'Password saat ini salah' : 'Password telah berubah');
  expect(client.query).toHaveBeenCalledTimes(stage === 'before-read' ? 1 : 2);
  for (const [sql] of client.query.mock.calls) expect(sql).toMatch(/aktif = true AND is_deleted = false/i);
  if (stage === 'before-read') expect(passwords.hash).not.toHaveBeenCalled();
});

it.each(['create', 'update', 'reset', 'change'] as const)('propagates the authenticated actor for %s metadata without exposing it publicly', async (operation) => {
  client.query.mockResolvedValue({ rows: [{ ...target, password_hash: 'old-hash', updated_by: actor.id, modified_by: actor.id }] });
  const passwords = { verify: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue('new-hash') };
  const result = await (operation === 'create' ? repository.create(actor, target, 'new-hash')
    : operation === 'update' ? repository.update(actor, target.id, { nama: 'Updated' })
    : operation === 'reset' ? repository.resetPassword(actor, target.id, 'new-hash')
    : repository.changePassword(actor, 'old', 'new', passwords as unknown as PasswordHasher));
  expect(db.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), actor.id);
  expect(result).toEqual(operation === 'change' ? { message: 'Password berhasil diubah' }
    : { id: target.id, username: target.username, nama: target.nama, peran: target.peran, aktif: true });
  const audit = client.query.mock.calls.at(-1)!;
  expect(audit[0]).toContain('INSERT INTO audit_log');
  expect(audit[1][0]).toBe(actor.id);
  expect(JSON.stringify(JSON.parse(audit[1][4]))).not.toMatch(/password|token|hash|updated_by|modified_by|is_deleted/i);
});

it('omits soft-deleted users from the list while preserving the public shape', async () => {
  db.query.mockImplementation(async (sql) => /WHERE is_deleted\s*=\s*false/i.test(sql) ? [actor] : [actor, target]);
  await expect(repository.list()).resolves.toEqual([actor]);
  expect(db.query.mock.calls[0][0]).toMatch(/WHERE is_deleted\s*=\s*false/i);
});

it('treats a soft-deleted account detail as not found', async () => {
  db.query.mockImplementation(async (sql) => /is_deleted\s*=\s*false/i.test(sql) ? [] : [target]);
  await expect(repository.detail(target.id)).rejects.toThrow('Pengguna tidak ditemukan');
  expect(db.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('WHERE id = $1 AND is_deleted = false'), [target.id]);
});
