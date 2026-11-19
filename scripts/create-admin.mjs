import 'reflect-metadata';
import { parseEnv } from 'node:util';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PasswordHasher } from '../dist/auth/password-hasher.js';

// Existing environment values take precedence over .env.
try {
  const values = parseEnv(await readFile('.env', 'utf8'));
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password, ADMIN_NAMA: nama, DATABASE_URL } = process.env;
if (!username || !/^[a-zA-Z0-9_.-]{3,100}$/.test(username) || !password || password.length < 10 || password.length > 128 || !nama?.trim() || nama.length > 200 || !DATABASE_URL) {
  throw new Error('Isi DATABASE_URL, ADMIN_USERNAME (3–100 karakter), ADMIN_PASSWORD (10–128 karakter), dan ADMIN_NAMA (1–200 karakter)');
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
  const hash = await new PasswordHasher().hash(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // No authenticated creator exists during bootstrap; keep metadata actor unknown.
    await client.query("SELECT set_config('oikonomos.actor_id', $1, true)", ['']);
    const result = await client.query(
      `INSERT INTO users (username, password_hash, nama, peran) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hash, nama.trim()],
    );
    if (!result.rowCount) throw new Error('Username sudah digunakan; tidak ada akun yang diubah');
    await client.query(
      'INSERT INTO audit_log (siapa, aksi, objek, objek_id, ringkasan) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [null, 'create', 'users', String(result.rows[0].id), JSON.stringify({ username, nama: nama.trim(), peran: 'admin', aktif: true, sumber: 'bootstrap' })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('Admin berhasil dibuat');
} finally {
  await pool.end();
}
