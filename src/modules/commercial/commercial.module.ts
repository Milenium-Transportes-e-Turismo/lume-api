import { Module } from '@nestjs/common';

import { CommercialQuoteRepository } from '../../application/contracts/commercial-quote.repository';
import {
  PatchQuoteRequestUseCase,
  QuoteProposalUseCase,
} from '../../application/use-cases/commercial/commercial-quotes.use-case';
import { ConfirmedServiceRepository } from '../../application/contracts/confirmed-service.repository';
import { ConfirmedServicesService } from '../../application/use-cases/commercial/confirmed-services.service';
import { ConfirmedServicesController } from './confirmed-services.controller';

@Module({
  controllers: [ConfirmedServicesController],
  providers: [
    {
      provide: PatchQuoteRequestUseCase,
      useFactory: (repository: CommercialQuoteRepository) =>
        new PatchQuoteRequestUseCase(repository),
      inject: [CommercialQuoteRepository],
    },
    {
      provide: QuoteProposalUseCase,
      useFactory: (repository: CommercialQuoteRepository) =>
        new QuoteProposalUseCase(repository),
      inject: [CommercialQuoteRepository],
    },
    {
      provide: ConfirmedServicesService,
      useFactory: (repository: ConfirmedServiceRepository) =>
        new ConfirmedServicesService(repository),
      inject: [ConfirmedServiceRepository],
    },
  ],
  exports: [
    PatchQuoteRequestUseCase,
    QuoteProposalUseCase,
    ConfirmedServicesService,
  ],
})
export class CommercialModule {}
