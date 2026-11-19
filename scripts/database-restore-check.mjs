import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { databaseEnvironment } from './database-environment.mjs';

async function checkRestore() {
  const url = process.env.RESTORE_DATABASE_URL;
  if (!url) throw new Error('RESTORE_DATABASE_URL wajib menunjuk database kosong khusus uji restore');
  const file = process.env.BACKUP_FILE;
  if (!file) throw new Error('BACKUP_FILE wajib menunjuk arsip pg_dump');
  if (url === process.env.DATABASE_URL) throw new Error('Database restore tidak boleh sama dengan database sumber');
  await access(file);
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')");
    if (rows[0].total !== 0) throw new Error('Database restore tidak kosong; tidak ada data yang diubah');
    await new Promise((resolve, reject) => {
      const child = spawn('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', '', file], {
        env: databaseEnvironment(url), stdio: 'ignore',
      });
      child.once('error', () => reject(new Error('pg_restore tidak dapat dijalankan')));
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('pg_restore gagal; periksa arsip dan versi PostgreSQL')));
    });
    const expected = ['users', 'laporan_mingguan', 'transaksi', 'saldo_awal', 'persembahan_bulanan', 'rekonsiliasi', 'audit_log'];
    const counts = {};
    for (const table of expected) {
      const result = await client.query(`SELECT count(*)::text AS total FROM ${table}`);
      counts[table] = result.rows[0].total;
    }
    console.log(JSON.stringify({ status: 'restore_berhasil', jumlah_baris: counts }));
  } finally {
    await client.end();
  }
}
checkRestore().catch((error) => {
  const safe = /^(RESTORE_DATABASE_URL|BACKUP_FILE|Database restore|pg_restore)/.test(error.message);
  console.error(safe ? error.message : 'Uji restore gagal; periksa target database dan arsip backup');
  process.exitCode = 1;
});
