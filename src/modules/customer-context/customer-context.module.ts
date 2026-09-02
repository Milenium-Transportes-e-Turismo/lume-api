import { Module } from '@nestjs/common';

import {
  CustomerContextRepository,
  CustomerContextResolver,
} from '../../application/contracts/customer-context.repository';
import { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import { DatabaseModule } from '../../infra/database/database.module';
import { PrismaCustomerContextRepository } from '../../infra/database/repositories/prisma-customer-context.repository';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';
import { CustomerContextController } from './customer-context.controller';
import { InternalCustomerContextController } from './internal-customer-context.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [CustomerContextController, InternalCustomerContextController],
  providers: [
    PrismaCustomerContextRepository,
    {
      provide: CustomerContextRepository,
      useExisting: PrismaCustomerContextRepository,
    },
    {
      provide: CustomerContextUseCase,
      inject: [CustomerContextRepository],
      useFactory: (repository: CustomerContextRepository) =>
        new CustomerContextUseCase(repository),
    },
    {
      provide: CustomerContextResolver,
      useExisting: CustomerContextUseCase,
    },
    ServiceIdentityGuard,
  ],
  exports: [CustomerContextResolver, CustomerContextUseCase],
})
export class CustomerContextModule {}
