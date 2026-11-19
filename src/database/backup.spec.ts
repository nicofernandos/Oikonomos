import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const run = (file: string, env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [resolve('scripts', file)], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
});

describe('Pengamanan backup operasional', () => {
  it('menolak backup tanpa tujuan eksplisit dan tidak membocorkan URL database', () => {
    const result = run('database-backup.mjs', { DATABASE_URL: 'postgres://private-value@localhost/test' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('BACKUP_DIRECTORY wajib');
    expect(result.stderr).not.toContain('private-value');
  });

  it('menolak restore tanpa database target eksplisit', () => {
    const result = run('database-restore-check.mjs', {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RESTORE_DATABASE_URL wajib');
  });
});
