import { Module } from '@nestjs/common';

import { CommercialQuoteRepository } from '../../application/contracts/commercial-quote.repository';
import {
  PatchQuoteRequestUseCase,
  QuoteProposalUseCase,
} from '../../application/use-cases/commercial/commercial-quotes.use-case';

@Module({
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
  ],
  exports: [PatchQuoteRequestUseCase, QuoteProposalUseCase],
})
export class CommercialModule {}
