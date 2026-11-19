import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC } from './public.decorator.js';
import type { AuthUser } from './user.js';

export type AuthRequest = Request & { user: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Token diperlukan');
    let sub: unknown;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: unknown }>(match[1]);
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
    if (typeof sub !== 'number' || !Number.isSafeInteger(sub) || sub <= 0 || sub > 2147483647) {
      throw new UnauthorizedException('Token tidak valid');
    }
    request.user = await this.auth.findActiveUser(sub);
    return true;
  }
}
