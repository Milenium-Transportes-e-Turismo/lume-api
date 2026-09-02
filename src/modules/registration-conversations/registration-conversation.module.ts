import { Module } from '@nestjs/common';

import {
  ConversationIdentityResolver,
  ConversationRegistrationRepository,
} from '../../application/contracts/conversation-registration.repository';
import {
  ConversationRegistrationUseCase,
  IdentifyConversationParticipantUseCase,
  RegistrationDataReviewUseCase,
} from '../../application/use-cases/registrations/conversation-registration.use-case';
import { DatabaseModule } from '../../infra/database/database.module';
import { PrismaConversationRegistrationRepository } from '../../infra/database/repositories/prisma-conversation-registration.repository';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';
import { InternalRegistrationConversationsController } from './internal-registration-conversations.controller';
import { RegistrationDataReviewsController } from './registration-data-reviews.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [
    InternalRegistrationConversationsController,
    RegistrationDataReviewsController,
  ],
  providers: [
    PrismaConversationRegistrationRepository,
    {
      provide: ConversationRegistrationRepository,
      useExisting: PrismaConversationRegistrationRepository,
    },
    {
      provide: IdentifyConversationParticipantUseCase,
      inject: [ConversationRegistrationRepository],
      useFactory: (repository: ConversationRegistrationRepository) =>
        new IdentifyConversationParticipantUseCase(repository),
    },
    {
      provide: ConversationIdentityResolver,
      useExisting: IdentifyConversationParticipantUseCase,
    },
    {
      provide: ConversationRegistrationUseCase,
      inject: [ConversationRegistrationRepository],
      useFactory: (repository: ConversationRegistrationRepository) =>
        new ConversationRegistrationUseCase(repository),
    },
    {
      provide: RegistrationDataReviewUseCase,
      inject: [ConversationRegistrationRepository],
      useFactory: (repository: ConversationRegistrationRepository) =>
        new RegistrationDataReviewUseCase(repository),
    },
    ServiceIdentityGuard,
  ],
  exports: [
    ConversationIdentityResolver,
    IdentifyConversationParticipantUseCase,
    ConversationRegistrationUseCase,
    RegistrationDataReviewUseCase,
  ],
})
export class RegistrationConversationModule {}
