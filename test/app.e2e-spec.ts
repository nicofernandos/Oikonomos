import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { HealthController } from '../src/health.controller.js';

describe('Keamanan endpoint aplikasi (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AppController, HealthController],
      providers: [AppService],
    })
      .overrideProvider(DatabaseService).useValue({ query: vi.fn().mockResolvedValue([{ now: new Date('2026-11-15T00:00:00Z') }]) })
      .overrideProvider(ConfigService).useValue({ getOrThrow: () => 'e2e-test-secret-with-at-least-32-bytes' })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('root memerlukan autentikasi', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(401);
  });

  it('health tetap publik', () => request(app.getHttpServer()).get('/api/health').expect(200));

  afterEach(async () => {
    await app.close();
  });
});
