import 'dotenv/config';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { validateEnvironment } from '../../config/env';
import { SecurityModule } from '../security.module';
import { TenantBootstrapModule } from '../../modules/tenant-bootstrap.module';
import { ProductionBootstrapService } from '../bootstrap/production-bootstrap.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    SecurityModule,
    TenantBootstrapModule,
  ],
})
class TenantBootstrapCliModule {}

async function run() {
  const app = await NestFactory.createApplicationContext(
    TenantBootstrapCliModule,
    {
      logger: ['error', 'warn'],
    },
  );
  try {
    const result = await app.get(ProductionBootstrapService).execute();
    process.stdout.write(
      `Bootstrap sincronizado para tenant ${result.tenantId}; channel=${result.channelId ?? 'disabled'}.\n`,
    );
  } finally {
    await app.close();
  }
}

void run();
