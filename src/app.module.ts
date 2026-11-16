import { Module } from '@nestjs/common';
// import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { KeuanganModule } from './keuangan/keuangan.module.js';
import { InventarisModule } from './inventaris/inventaris.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller.js';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';

// export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    // ObserveModule.forRoot({
    //   appKey: process.env.OBSERVE_APP_KEY ?? '1d34a92ba37bed2f7045870b0eef1230d75750192b1b59946f2adfa49957a6c6',
    //   appSecret: process.env.OBSERVE_APP_SECRET ?? '1d34a92ba37bed2f7045870b0eef1230d75750192b1b59946f2adfa49957a6c6',
    //   serviceId: 'backend',
    // }),
    KeuanganModule,
    InventarisModule,
    AuthModule,
    DatabaseModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
