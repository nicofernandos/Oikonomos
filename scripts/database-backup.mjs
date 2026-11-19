import { spawn } from 'node:child_process';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { databaseEnvironment } from './database-environment.mjs';

async function backup() {
  const directory = process.env.BACKUP_DIRECTORY;
  if (!directory || !isAbsolute(directory)) throw new Error('BACKUP_DIRECTORY wajib berupa path absolut ke penyimpanan backup terpisah');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi melalui environment');
  process.umask(0o077);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `oikonomos-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.dump`;
  const target = join(directory, name);
  const partial = `${target}.partial`;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', partial], {
        env: databaseEnvironment(process.env.DATABASE_URL), stdio: 'ignore',
      });
      child.once('error', () => reject(new Error('pg_dump tidak dapat dijalankan')));
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('pg_dump gagal; periksa koneksi dan versi PostgreSQL')));
    });
    await chmod(partial, 0o600);
    await rename(partial, target);
    console.log(target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
backup().catch((error) => { console.error(error.message); process.exitCode = 1; });
