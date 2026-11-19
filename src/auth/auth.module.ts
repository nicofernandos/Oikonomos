import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PasswordHasher } from './password-hasher.js';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoginThrottleGuard } from './login-throttle.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersRepository } from './users.repository.js';
import { AuthService } from './auth.service.js';
import { UsersController } from './users.controller.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET harus minimal 32 byte');
        return {
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: 28800, issuer: 'oikonomos', audience: 'oikonomos-api' },
          verifyOptions: { algorithms: ['HS256'], issuer: 'oikonomos', audience: 'oikonomos-api' },
        };
      },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    PasswordHasher,
    UsersRepository,
    AuthService,
    { provide: APP_GUARD, useClass: LoginThrottleGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
