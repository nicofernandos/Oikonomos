import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';

const state = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({ default: {
  types: { setTypeParser: vi.fn() },
  Pool: class { connect = state.connect; end = state.end; },
} }));

beforeEach(() => {
  state.query.mockReset().mockResolvedValue({ rows: [] });
  state.connect.mockReset().mockResolvedValue({ query: state.query, release: state.release });
  state.release.mockReset();
});
const database = () => new DatabaseService(new ConfigService({ DATABASE_URL: 'postgresql://unused-test' }));

describe('Konteks pelaku transaksi database', () => {
  it('menetapkan pelaku hanya dalam transaksi yang sama sebelum mutasi', async () => {
    const db = database();
    await db.withTransaction(async (client) => { await client.query('SELECT 1'); }, 7);
    expect(state.query.mock.calls).toEqual([
      ['BEGIN'], ["SELECT set_config('oikonomos.actor_id', $1, true)", ['7']], ['SELECT 1'], ['COMMIT'],
    ]);
    expect(state.release).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, 2147483648])('menolak ID pelaku tidak valid %s sebelum mengambil koneksi', async (actor) => {
    const callback = vi.fn();
    await expect(database().withTransaction(callback, actor)).rejects.toThrow('ID pelaku tidak valid');
    expect(state.connect).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('tetap melakukan rollback dan melepaskan koneksi bila set context gagal', async () => {
    state.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('context gagal')).mockResolvedValueOnce({ rows: [] });
    const callback = vi.fn();
    await expect(database().withTransaction(callback, 7)).rejects.toThrow('context gagal');
    expect(callback).not.toHaveBeenCalled();
    expect(state.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
});
