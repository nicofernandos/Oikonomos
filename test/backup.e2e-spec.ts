import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const url = process.env.OIKONOMOS_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Backup dan uji restore PostgreSQL nyata', () => {
  it('backup data, restore ke database kosong, cocokkan nilai, dan tolak restore ulang', async () => {
    const base = new URL(url!);
    if (!base.pathname.endsWith('_test')) throw new Error('Gunakan database khusus berakhiran _test');
    const suffix = randomUUID().replaceAll('-', '');
    const sourceName = `backup_${suffix}_test`;
    const targetName = `restore_${suffix}_test`;
    const admin = new pg.Pool({ connectionString: url });
    const owned: string[] = [];
    const directory = await mkdtemp(join(process.env.TMPDIR ?? join(homedir(), '.hermes/cache/scratch'), 'oikonomos-backup-'));
    let source: pg.Pool | undefined;
    let target: pg.Pool | undefined;
    try {
      for (const name of [sourceName, targetName]) {
        await admin.query(`CREATE DATABASE ${name}`);
        owned.push(name);
      }
      base.pathname = `/${sourceName}`;
      const sourceUrl = base.toString();
      source = new pg.Pool({ connectionString: sourceUrl });
      base.pathname = `/${targetName}`;
      const targetUrl = base.toString();
      target = new pg.Pool({ connectionString: targetUrl });
      for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
        await source.query((await readFile(join('migrations', name), 'utf8')).split('-- Down Migration')[0]);
      }
      await source.query(`INSERT INTO saldo_awal(kas,nominal,per_tanggal) VALUES('gereja',9007199254740993,'2026-11-08')`);
      const user = (await source.query("INSERT INTO users(username,password_hash,nama,peran) VALUES('retensi_backup','hash-fixture-bukan-login','Fixture Retensi','admin') RETURNING id")).rows[0];
      const client = await source.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('oikonomos.actor_id', $1, true)", [String(user.id)]);
        await client.query('UPDATE users SET is_deleted=true WHERE id=$1', [user.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const backup = spawnSync(process.execPath, ['scripts/database-backup.mjs'], {
        env: { ...process.env, DATABASE_URL: sourceUrl, BACKUP_DIRECTORY: directory }, encoding: 'utf8', timeout: 30000,
      });
      expect(backup.status, backup.stderr).toBe(0);
      const archive = backup.stdout.trim();
      expect((await stat(archive)).mode & 0o777).toBe(0o600);
      const environment = { ...process.env, DATABASE_URL: sourceUrl, RESTORE_DATABASE_URL: targetUrl, BACKUP_FILE: archive };
      const restored = spawnSync(process.execPath, ['scripts/database-restore-check.mjs'], { env: environment, encoding: 'utf8', timeout: 30000 });
      expect(restored.status, restored.stderr).toBe(0);
      expect(JSON.parse(restored.stdout).status).toBe('restore_berhasil');
      expect((await target.query('SELECT kas,nominal::text,per_tanggal::text FROM saldo_awal')).rows)
        .toEqual((await source.query('SELECT kas,nominal::text,per_tanggal::text FROM saldo_awal')).rows);
      const retained = (await target.query('SELECT id,is_deleted,deleted_at,deleted_by,updated_by,modified_by FROM users')).rows;
      expect(retained).toEqual((await source.query('SELECT id,is_deleted,deleted_at,deleted_by,updated_by,modified_by FROM users')).rows);
      expect(retained[0]).toMatchObject({ is_deleted: true, deleted_by: user.id, updated_by: user.id, modified_by: user.id });
      expect(retained[0].deleted_at).toBeInstanceOf(Date);
      const repeated = spawnSync(process.execPath, ['scripts/database-restore-check.mjs'], { env: environment, encoding: 'utf8', timeout: 30000 });
      expect(repeated.status).toBe(1);
      expect(repeated.stderr).toContain('Database restore tidak kosong');
    } finally {
      await source?.end();
      await target?.end();
      for (const name of owned.reverse()) await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
});
