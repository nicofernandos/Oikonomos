import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; expires: number }>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['login', 'changePassword'].includes(context.getHandler().name) || context.getClass().name !== 'AuthController') return true;
    const now = Date.now();
    for (const [key, value] of this.attempts) {
      if (value.expires <= now) this.attempts.delete(key);
    }
    const key = `${context.getHandler().name}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
    const entry = this.attempts.get(key) ?? { count: 0, expires: now + 60000 };
    if (entry.count >= 5 || (!this.attempts.has(key) && this.attempts.size >= 10000)) {
      context.switchToHttp().getResponse<Response>().setHeader('Retry-After', Math.max(1, Math.ceil((entry.expires - now) / 1000)));
      throw new HttpException('Terlalu banyak percobaan, coba lagi nanti', HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count += 1;
    this.attempts.set(key, entry);
    return true;
  }
}
