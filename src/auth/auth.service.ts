import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PasswordHasher } from './password-hasher.js';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { AuthUser, UserRow } from './user.js';

import { UsersRepository, publicUser } from './users.repository.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly users: UsersRepository,
  ) {}

  async login(dto: LoginDto) {
    const [row] = await this.db.query<UserRow>(
      'SELECT id, username, nama, peran, aktif, password_hash FROM users WHERE username = $1 AND is_deleted = false',
      [dto.username],
    );
    const valid = await this.passwords.verify(dto.password, row?.password_hash);
    if (!valid || !row?.aktif) throw new UnauthorizedException('Username atau password salah');
    return {
      access_token: await this.jwt.signAsync({ sub: row.id }),
      token_type: 'Bearer',
      expires_in: 28800,
      user: publicUser(row),
    };
  }

  async findActiveUser(id: number): Promise<AuthUser> {
    const [row] = await this.db.query<AuthUser>(
      'SELECT id, username, nama, peran, aktif FROM users WHERE id = $1 AND aktif = true AND is_deleted = false', [id],
    );
    if (!row) throw new UnauthorizedException('Pengguna tidak aktif atau tidak ditemukan');
    return publicUser(row);
  }

  private requireAdmin(actor: AuthUser) {
    if (actor.peran !== 'admin') throw new ForbiddenException('Hanya admin yang dapat mengelola pengguna');
  }

  private validateUserId(id: number) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      throw new BadRequestException('ID pengguna tidak valid');
    }
  }

  async listUsers(actor: AuthUser) {
    this.requireAdmin(actor);
    return this.users.list();
  }

  async getUser(actor: AuthUser, id: number) {
    this.requireAdmin(actor);
    this.validateUserId(id);
    return this.users.detail(id);
  }

  async updateUser(actor: AuthUser, id: number, dto: UpdateUserDto) {
    this.requireAdmin(actor);
    this.validateUserId(id);
    if (dto.nama === undefined && dto.peran === undefined && dto.aktif === undefined) {
      throw new BadRequestException('Isi minimal satu perubahan pengguna');
    }
    return this.users.update(actor, id, dto);
  }

  async createUser(actor: AuthUser, dto: CreateUserDto): Promise<AuthUser> {
    if (actor.peran !== 'admin') throw new ForbiddenException('Hanya admin yang dapat membuat pengguna');
    const hash = await this.passwords.hash(dto.password);
    try {
      return await this.users.create(actor, dto, hash);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ConflictException('Username sudah digunakan');
      }
      throw error;
    }
  }

  async resetPassword(actor: AuthUser, id: number, dto: ResetPasswordDto) {
    this.requireAdmin(actor);
    this.validateUserId(id);
    const hash = await this.passwords.hash(dto.password);
    return this.users.resetPassword(actor, id, hash);
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    return this.users.changePassword(user, dto.currentPassword, dto.newPassword, this.passwords);
  }
}
