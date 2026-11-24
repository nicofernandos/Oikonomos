import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { AuthUser, UserRow } from './user.js';
import type { PasswordHasher } from './password-hasher.js';

export const publicUser = (row: AuthUser): AuthUser => ({
  id: row.id, username: row.username, nama: row.nama, peran: row.peran, aktif: row.aktif,
});

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  private async audit(client: PoolClient, actor: AuthUser, action: string, user: AuthUser) {
    await client.query(
      'INSERT INTO audit_log (siapa, aksi, objek, objek_id, ringkasan) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actor.id, action, 'users', String(user.id), JSON.stringify(publicUser(user))],
    );
  }

  async list() {
    const rows = await this.db.query<AuthUser>('SELECT id, username, nama, peran, aktif FROM users WHERE is_deleted = false ORDER BY id');
    return rows.map(publicUser);
  }

  async detail(id: number) {
    const [row] = await this.db.query<AuthUser>(
      'SELECT id, username, nama, peran, aktif FROM users WHERE id = $1 AND is_deleted = false', [id],
    );
    if (!row) throw new NotFoundException('Pengguna tidak ditemukan');
    return publicUser(row);
  }

  async update(actor: AuthUser, id: number, input: UpdateUserDto) {
    return this.db.withTransaction(async (client) => {
      const { rows: [row] } = await client.query<AuthUser>(
        `UPDATE users SET nama = COALESCE($1, nama), peran = COALESCE($2, peran), aktif = COALESCE($3, aktif)
         WHERE id = $4 AND is_deleted = false RETURNING id, username, nama, peran, aktif`,
        [input.nama?.trim() ?? null, input.peran ?? null, input.aktif ?? null, id],
      );
      if (!row) throw new NotFoundException('Pengguna tidak ditemukan');
      await this.audit(client, actor, 'update', row);
      return publicUser(row);
    }, actor.id);
  }

  async resetPassword(actor: AuthUser, id: number, hash: string) {
    return this.db.withTransaction(async (client) => {
      const { rows: [row] } = await client.query<AuthUser>(
        'UPDATE users SET password_hash = $1 WHERE id = $2 AND is_deleted = false RETURNING id, username, nama, peran, aktif',
        [hash, id],
      );
      if (!row) throw new NotFoundException('Pengguna tidak ditemukan');
      await this.audit(client, actor, 'reset-password', row);
      return publicUser(row);
    }, actor.id);
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, passwords: PasswordHasher) {
    return this.db.withTransaction(async (client) => {
      const { rows: [row] } = await client.query<UserRow>(
        'SELECT id, password_hash FROM users WHERE id = $1 AND aktif = true AND is_deleted = false', [user.id],
      );
      const valid = await passwords.verify(currentPassword, row?.password_hash);
      if (!valid || !row) throw new UnauthorizedException('Password saat ini salah');
      const hash = await passwords.hash(newPassword);
      const { rows: [updated] } = await client.query<AuthUser>(
        `UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3 AND aktif = true AND is_deleted = false
         RETURNING id, username, nama, peran, aktif`, [hash, user.id, row.password_hash],
      );
      if (!updated) throw new UnauthorizedException('Password telah berubah, silakan coba lagi');
      await this.audit(client, user, 'change-password', updated);
      return { message: 'Password berhasil diubah' };
    }, user.id);
  }

  async create(actor: AuthUser, input: { username: string; nama: string; peran: AuthUser['peran'] }, hash: string) {
    return this.db.withTransaction(async (client) => {
      const { rows: [row] } = await client.query<AuthUser>(
        `INSERT INTO users (username, password_hash, nama, peran)
         VALUES ($1, $2, $3, $4) RETURNING id, username, nama, peran, aktif`,
        [input.username, hash, input.nama.trim(), input.peran],
      );
      await this.audit(client, actor, 'create', row);
      return publicUser(row);
    }, actor.id);
  }
}
