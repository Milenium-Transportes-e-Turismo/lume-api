import { Global, Module } from '@nestjs/common';

import {
  RefreshTokensRepository,
  PasswordChangeChallengesRepository,
  TenantAuditLogsRepository,
  TenantBootstrapRepository,
  UsersRepository,
} from '../../application/contracts/repositories';
import { WhatsAppRepository } from '../../application/contracts/whatsapp.repository';
import { CommercialQuoteRepository } from '../../application/contracts/commercial-quote.repository';
import { DataExchangeRepository } from '../../application/contracts/data-exchange.repository';
import { PrismaService } from './prisma/prisma.service';
import { PrismaRefreshTokensRepository } from './repositories/prisma-refresh-tokens.repository';
import { PrismaPasswordChangeChallengesRepository } from './repositories/prisma-password-change-challenges.repository';
import { PrismaTenantAuditLogsRepository } from './repositories/prisma-tenant-audit-logs.repository';
import { PrismaTenantBootstrapRepository } from './repositories/prisma-tenant-bootstrap.repository';
import { PrismaUsersRepository } from './repositories/prisma-users.repository';
import { PrismaWhatsAppRepository } from './repositories/prisma-whatsapp.repository';
import { PrismaDataExchangeRepository } from './repositories/prisma-data-exchange.repository';
import { RoutingRepository } from '../../application/contracts/routing.repository';
import { PrismaRoutingRepository } from './repositories/prisma-routing.repository';
import { PassengerRepository } from '../../application/contracts/passenger.repository';
import { PrismaPassengerRepository } from './repositories/prisma-passenger.repository';
import { ContractRepository } from '../../application/contracts/contract.repository';
import { PrismaContractRepository } from './repositories/prisma-contract.repository';
import { RouteRepository } from '../../application/contracts/route.repository';
import { PrismaRouteRepository } from './repositories/prisma-route.repository';
import { FixedPointRepository } from '../../application/contracts/fixed-point.repository';
import { PrismaFixedPointRepository } from './repositories/prisma-fixed-point.repository';
import { RegistrationIdentityCandidateReader } from '../../application/contracts/registration-identity-candidate.reader';
import { PrismaRegistrationIdentityCandidateReader } from './repositories/prisma-registration-identity-candidate.reader';
import { PreAdmissionAccessRepository } from '../../application/contracts/pre-admission-access.repository';
import { PrismaPreAdmissionAccessRepository } from './repositories/prisma-pre-admission-access.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: TenantBootstrapRepository,
      useClass: PrismaTenantBootstrapRepository,
    },
    { provide: UsersRepository, useClass: PrismaUsersRepository },
    {
      provide: RefreshTokensRepository,
      useClass: PrismaRefreshTokensRepository,
    },
    {
      provide: PasswordChangeChallengesRepository,
      useClass: PrismaPasswordChangeChallengesRepository,
    },
    {
      provide: TenantAuditLogsRepository,
      useClass: PrismaTenantAuditLogsRepository,
    },
    PrismaWhatsAppRepository,
    { provide: WhatsAppRepository, useExisting: PrismaWhatsAppRepository },
    {
      provide: CommercialQuoteRepository,
      useExisting: PrismaWhatsAppRepository,
    },
    { provide: DataExchangeRepository, useClass: PrismaDataExchangeRepository },
    { provide: RoutingRepository, useClass: PrismaRoutingRepository },
    { provide: PassengerRepository, useClass: PrismaPassengerRepository },
    { provide: ContractRepository, useClass: PrismaContractRepository },
    { provide: RouteRepository, useClass: PrismaRouteRepository },
    { provide: FixedPointRepository, useClass: PrismaFixedPointRepository },
    {
      provide: RegistrationIdentityCandidateReader,
      useClass: PrismaRegistrationIdentityCandidateReader,
    },
    {
      provide: PreAdmissionAccessRepository,
      useClass: PrismaPreAdmissionAccessRepository,
    },
  ],
  exports: [
    PrismaService,
    TenantBootstrapRepository,
    UsersRepository,
    RefreshTokensRepository,
    PasswordChangeChallengesRepository,
    TenantAuditLogsRepository,
    WhatsAppRepository,
    CommercialQuoteRepository,
    DataExchangeRepository,
    RoutingRepository,
    PassengerRepository,
    ContractRepository,
    RouteRepository,
    FixedPointRepository,
    RegistrationIdentityCandidateReader,
    PreAdmissionAccessRepository,
  ],
})
export class DatabaseModule {}
