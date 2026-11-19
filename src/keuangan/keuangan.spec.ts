import { describe, it, expect, vi } from 'vitest';
import { KeuanganService } from './keuangan.service.js';

const bendahara = {
  id: 7,
  username: 'b',
  nama: 'B',
  peran: 'bendahara',
  aktif: true,
} as const;
describe('finance access', () => {
  it('denies admins report creation before touching the repository', async () => {
    const repo = { create: vi.fn() };
    const service = new (KeuanganService as any)(repo, {
      get: () => undefined,
    });
    await expect(
      Promise.resolve().then(() =>
        service.create(
          { ...bendahara, peran: 'admin' },
          { tanggal: '2026-11-15' },
        ),
      ),
    ).rejects.toThrow('bendahara');
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('rejects malformed approval configuration instead of treating strings as truthy', () => {
    for (const value of ['yes', 'FALSE', '1', '', true])
      expect(
        () => new (KeuanganService as any)({}, { get: () => value }),
      ).toThrow('REQUIRE_MAJELIS_APPROVAL');
  });
  it('authorizes only bendahara for standalone locking and only majelis for configured approval', () => {
    const repo = { lock: vi.fn() };
    for (const enabled of [false, true]) {
      const service = new (KeuanganService as any)(repo, {
        get: () => String(enabled),
      });
      for (const peran of ['admin', 'bendahara', 'majelis']) {
        const user = { ...bendahara, peran };
        if (peran === (enabled ? 'majelis' : 'bendahara')) {
          service.lock(user, '1', {});
          expect(repo.lock).toHaveBeenLastCalledWith(1, 7, enabled);
        } else expect(() => service.lock(user, '1', {})).toThrow();
      }
    }
  });
});
