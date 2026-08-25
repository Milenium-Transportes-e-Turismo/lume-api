import { Module } from '@nestjs/common';

import { RoutingRepository } from '../../application/contracts/routing.repository';
import { RoutingCompaniesUseCase } from '../../application/use-cases/routing/routing-companies.use-case';
import { RoutingController } from '../routing/routing.controller';

/**
 * O cadastro de clientes foi preservado porque é compartilhado por Comercial,
 * WhatsApp e futuros consumidores do núcleo de roteirização.
 */
@Module({
  controllers: [RoutingController],
  providers: [
    {
      provide: RoutingCompaniesUseCase,
      useFactory: (clients: RoutingRepository) =>
        new RoutingCompaniesUseCase(clients),
      inject: [RoutingRepository],
    },
  ],
  exports: [RoutingCompaniesUseCase],
})
export class ClientsModule {}
