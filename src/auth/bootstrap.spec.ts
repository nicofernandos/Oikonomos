import { PasswordHasher } from './password-hasher.js';

const state = vi.hoisted(() => ({
  query: vi.fn(), connect: vi.fn(), end: vi.fn(), release: vi.fn(),
}));
vi.mock('pg', () => ({ default: { Pool: class {
  query = state.query;
  connect = state.connect;
  end = state.end;
} } }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn().mockResolvedValue('') }));
vi.mock('../../dist/auth/password-hasher.js', () => ({ PasswordHasher }));

beforeEach(() => {
  vi.resetModules();
  state.query.mockReset().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
  state.connect.mockReset().mockResolvedValue({ query: state.query, release: state.release });
  state.end.mockReset();
  state.release.mockReset();
  vi.stubEnv('ADMIN_USERNAME', 'bootstrap');
  vi.stubEnv('ADMIN_PASSWORD', '1234567890');
  vi.stubEnv('ADMIN_NAMA', 'Administrator');
  vi.stubEnv('DATABASE_URL', 'postgres://unused-test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const run = () => import('../../scripts/' + 'create-admin.mjs');

it('clears any inherited metadata actor locally for an unknown bootstrap creator', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await run();
  expect(state.query.mock.calls[0][0]).toBe('BEGIN');
  expect(state.query.mock.calls[1]).toEqual([
    "SELECT set_config('oikonomos.actor_id', $1, true)", [''],
  ]);
});

it('rolls back and releases the client when bootstrap audit fails', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  state.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
    .mockRejectedValueOnce(new Error('audit unavailable')).mockResolvedValueOnce({ rows: [] });
  await expect(run()).rejects.toThrow('audit unavailable');
  expect(state.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
  expect(state.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  expect(state.release).toHaveBeenCalled();
  expect(state.end).toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it('never overwrites an existing bootstrap account', async () => {
  state.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
  await expect(run()).rejects.toThrow('Username sudah digunakan');
  expect(state.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  expect(state.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log'))).toBe(false);
});

it('rejects a short bootstrap password without opening a connection', async () => {
  vi.stubEnv('ADMIN_PASSWORD', '123456789');
  await expect(run()).rejects.toThrow('10–128 karakter');
  expect(state.connect).not.toHaveBeenCalled();
});

it('bootstraps a ten-character password with an audit in the same transaction', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await run();
  expect(state.connect).toHaveBeenCalledTimes(1);
  const calls = state.query.mock.calls;
  expect(calls[0][0]).toBe('BEGIN');
  expect(calls[1]).toEqual(["SELECT set_config('oikonomos.actor_id', $1, true)", ['']]);
  expect(calls[2][0]).toContain('INSERT INTO users');
  expect(await new PasswordHasher().verify('1234567890', calls[2][1][1])).toBe(true);
  expect(calls[3][0]).toContain('INSERT INTO audit_log');
  expect(calls[3][1].slice(0, 4)).toEqual([null, 'create', 'users', '1']);
  expect(JSON.stringify(calls[3])).not.toMatch(/1234567890|scrypt|password_hash|token/);
  expect(calls[4][0]).toBe('COMMIT');
  expect(state.release).toHaveBeenCalled();
  expect(state.end).toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('Admin berhasil dibuat');
});
