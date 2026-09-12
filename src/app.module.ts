import { TransportImportModule } from './modules/transport-import/transport-import.module';
import { TransportCatalogModule } from './modules/transport/transport-catalog.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnvironment } from './config/env';
import { DatabaseModule } from './infra/database/database.module';
import { SecurityModule } from './infra/security.module';
import { AccessModule } from './modules/access/access.module';
import { AgentsRuntimeModule } from './modules/agents/agents-runtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { LicenseModule } from './modules/license/license.module';
import { SupportModule } from './modules/support/support.module';
import { TenantBootstrapModule } from './modules/tenant-bootstrap.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { DataExchangeModule } from './modules/data-exchange/data-exchange.module';
import { DocumentManagementModule } from './modules/documents/document-management.module';
import { PlatformAdministrationModule } from './modules/administration/platform-administration.module';
import { AppErrorFilter } from './shared/http/filters/app-error.filter';
import { ClientsModule } from './modules/clients/clients.module';
import { RoutePlannerModule } from './modules/route-planner/route-planner.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { CustomerContextModule } from './modules/customer-context/customer-context.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { OperationalTripsModule } from './modules/trips/operational-trips.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PreAdmissionModule } from './modules/pre-admission/pre-admission.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'),
            limit: config.getOrThrow<number>('RATE_LIMIT_MAX'),
          },
        ],
      }),
    }),
    DatabaseModule,
    SecurityModule,
    AgentsRuntimeModule,
    TenantBootstrapModule,
    AuthModule,
    UsersModule,
    AccessModule,
    LicenseModule,
    SupportModule,
    HealthModule,
    WhatsAppModule,
    DataExchangeModule,
    KnowledgeModule,
    DocumentManagementModule,
    PlatformAdministrationModule,
    ClientsModule,
    RoutePlannerModule,
    RegistrationsModule,
    CustomerContextModule,
    CommercialModule,
    OperationalTripsModule,
    IdentityModule,
    PreAdmissionModule,
    TransportImportModule,
    TransportCatalogModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppErrorFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
