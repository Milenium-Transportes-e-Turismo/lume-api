import { RoutePlannerModule } from '../route-planner/route-planner.module';
import { TourismIntakeReviewService } from '../../infra/integrations/whatsapp-ai/tourism-intake-review.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WhatsAppChannelManagementRepository } from '../../application/contracts/whatsapp-channel-management.repository';
import { ServiceSessionManagementRepository } from '../../application/contracts/service-session-management.repository';
import { WhatsAppMediaStorage } from '../../application/contracts/whatsapp-media.storage';
import { MediaInterpretationGateway } from '../../application/contracts/media-interpretation.gateway';
import { MediaInterpretationRepository } from '../../application/contracts/media-interpretation.repository';
import { WhatsAppRepository } from '../../application/contracts/whatsapp.repository';
import { EvolutionInstanceManagementGateway } from '../../application/contracts/evolution-instance-management.gateway';
import {
  CreateWhatsAppChannelUseCase,
  ManageWhatsAppChannelUseCase,
  QueryWhatsAppChannelsUseCase,
} from '../../application/use-cases/whatsapp/manage-whatsapp-channels.use-case';
import {
  ManageServiceSessionUseCase,
  QueryServiceSessionsUseCase,
} from '../../application/use-cases/whatsapp/manage-service-sessions.use-case';
import { InterpretWhatsAppMediaUseCase } from '../../application/use-cases/whatsapp/interpret-whatsapp-media.use-case';
import {
  CreateHumanOutboundWhatsAppUseCase,
  QueryWhatsAppUseCase,
  StartHumanWhatsAppConversationUseCase,
  TransitionWhatsAppConversationUseCase,
} from '../../application/use-cases/whatsapp/whatsapp.use-cases';
import { EvolutionWebhookService } from '../../infra/integrations/evolution/evolution-webhook.service';
import { EvolutionMediaContentService } from '../../infra/integrations/evolution/evolution-media-content.service';
import { EvolutionProfilePictureService } from '../../infra/integrations/evolution/evolution-profile-picture.service';
import { HttpEvolutionOutboundGateway } from '../../infra/integrations/evolution/evolution-outbound.client';
import { HttpEvolutionInstanceManagementGateway } from '../../infra/integrations/evolution/evolution-instance-management.client';
import { ApiWhatsAppAutomationProvider } from '../../infra/integrations/whatsapp/api-whatsapp-automation.provider';
import { ServiceSessionLifecycleWorker } from '../../infra/integrations/whatsapp/service-session-lifecycle.worker';
import { WhatsAppAutomationDecisionStore } from '../../infra/integrations/whatsapp/whatsapp-automation-decision.store';
import { WhatsAppAutomationCheckpointStore } from '../../infra/integrations/whatsapp/whatsapp-automation-checkpoint.store';
import { WhatsAppAutomationDispatcher } from '../../infra/integrations/whatsapp/whatsapp-automation.dispatcher';
import { WhatsAppAutomationEventStore } from '../../infra/integrations/whatsapp/whatsapp-automation-event.store';
import { PlatformWhatsAppConversationAgent } from '../../infra/integrations/whatsapp-ai/platform-whatsapp-conversation-agent';
import { HttpOpenAiMediaInterpretationGateway } from '../../infra/agents/http-openai-media-interpretation.gateway';
import { MediaInterpretationGatewayRegistry } from '../../infra/agents/media-interpretation-gateway.registry';
import { MEDIA_INTERPRETATION_PROVIDER_ADAPTERS } from '../../infra/agents/media-interpretation.tokens';
import { PrismaMediaInterpretationRepository } from '../../infra/database/repositories/prisma-media-interpretation.repository';
import { MediaInterpretationWorker } from '../../infra/integrations/whatsapp/media-interpretation.worker';
import { WhatsAppRetentionService } from '../../infra/retention/whatsapp-retention.service';
import { WhatsAppHistoryImportService } from '../../infra/imports/whatsapp-history-import.service';
import { WhatsAppAndroidMediaImportService } from '../../infra/imports/whatsapp-android-media-import.service';
import { FileSystemWhatsAppMediaStorage } from '../../infra/storage/file-system-whatsapp-media.storage';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { NotificationsController } from './notifications.controller';
import { QuoteProposalController } from './quote-proposal.controller';
import { WhatsAppPanelController } from './whatsapp-panel.controller';
import { WhatsAppHistoryImportController } from './whatsapp-history-import.controller';
import { WhatsAppContactsController } from './whatsapp-contacts.controller';
import { WhatsAppContactsService } from './whatsapp-contacts.service';
import { WhatsAppChannelsController } from './whatsapp-channels.controller';
import { ServiceSessionsController } from './service-sessions.controller';
import { WhatsAppMediaInterpretationController } from './whatsapp-media-interpretation.controller';
import { AgentsRuntimeModule } from '../agents/agents-runtime.module';
import { CommercialModule } from '../commercial/commercial.module';

@Module({
  imports: [AgentsRuntimeModule, CommercialModule, RoutePlannerModule],
  controllers: [
    EvolutionWebhookController,
    WhatsAppPanelController,
    QuoteProposalController,
    NotificationsController,
    WhatsAppHistoryImportController,
    WhatsAppContactsController,
    WhatsAppChannelsController,
    ServiceSessionsController,
    WhatsAppMediaInterpretationController,
  ],
  providers: [
    EvolutionWebhookService,
    EvolutionMediaContentService,
    EvolutionProfilePictureService,
    FileSystemWhatsAppMediaStorage,
    {
      provide: WhatsAppMediaStorage,
      useExisting: FileSystemWhatsAppMediaStorage,
    },
    HttpEvolutionOutboundGateway,
    HttpEvolutionInstanceManagementGateway,
    {
      provide: EvolutionInstanceManagementGateway,
      useExisting: HttpEvolutionInstanceManagementGateway,
    },
    {
      provide: QueryWhatsAppChannelsUseCase,
      useFactory: (repository: WhatsAppChannelManagementRepository) =>
        new QueryWhatsAppChannelsUseCase(repository),
      inject: [WhatsAppChannelManagementRepository],
    },
    {
      provide: CreateWhatsAppChannelUseCase,
      useFactory: (
        repository: WhatsAppChannelManagementRepository,
        evolution: EvolutionInstanceManagementGateway,
        config: ConfigService,
      ) =>
        new CreateWhatsAppChannelUseCase(
          repository,
          evolution,
          config.get<string>('TENANT_API_PUBLIC_URL') ?? '',
        ),
      inject: [
        WhatsAppChannelManagementRepository,
        EvolutionInstanceManagementGateway,
        ConfigService,
      ],
    },
    {
      provide: ManageWhatsAppChannelUseCase,
      useFactory: (
        repository: WhatsAppChannelManagementRepository,
        evolution: EvolutionInstanceManagementGateway,
      ) => new ManageWhatsAppChannelUseCase(repository, evolution),
      inject: [
        WhatsAppChannelManagementRepository,
        EvolutionInstanceManagementGateway,
      ],
    },
    {
      provide: QueryServiceSessionsUseCase,
      useFactory: (repository: ServiceSessionManagementRepository) =>
        new QueryServiceSessionsUseCase(repository),
      inject: [ServiceSessionManagementRepository],
    },
    {
      provide: ManageServiceSessionUseCase,
      useFactory: (repository: ServiceSessionManagementRepository) =>
        new ManageServiceSessionUseCase(repository),
      inject: [ServiceSessionManagementRepository],
    },
    TourismIntakeReviewService,
    PlatformWhatsAppConversationAgent,
    ApiWhatsAppAutomationProvider,
    ServiceSessionLifecycleWorker,
    MediaInterpretationWorker,
    WhatsAppAutomationCheckpointStore,
    WhatsAppAutomationDecisionStore,
    WhatsAppAutomationEventStore,
    WhatsAppAutomationDispatcher,
    WhatsAppRetentionService,
    WhatsAppAndroidMediaImportService,
    WhatsAppHistoryImportService,
    WhatsAppContactsService,
    PrismaMediaInterpretationRepository,
    {
      provide: MediaInterpretationRepository,
      useExisting: PrismaMediaInterpretationRepository,
    },
    HttpOpenAiMediaInterpretationGateway,
    {
      provide: MEDIA_INTERPRETATION_PROVIDER_ADAPTERS,
      useFactory: (openAi: HttpOpenAiMediaInterpretationGateway) => [openAi],
      inject: [HttpOpenAiMediaInterpretationGateway],
    },
    MediaInterpretationGatewayRegistry,
    {
      provide: MediaInterpretationGateway,
      useExisting: MediaInterpretationGatewayRegistry,
    },
    {
      provide: InterpretWhatsAppMediaUseCase,
      useFactory: (
        repository: MediaInterpretationRepository,
        gateway: MediaInterpretationGateway,
        storage: WhatsAppMediaStorage,
      ) => new InterpretWhatsAppMediaUseCase(repository, gateway, storage),
      inject: [
        MediaInterpretationRepository,
        MediaInterpretationGateway,
        WhatsAppMediaStorage,
      ],
    },
    {
      provide: StartHumanWhatsAppConversationUseCase,
      useFactory: (repository: WhatsAppRepository) =>
        new StartHumanWhatsAppConversationUseCase(repository),
      inject: [WhatsAppRepository],
    },
    {
      provide: TransitionWhatsAppConversationUseCase,
      useFactory: (repository: WhatsAppRepository) =>
        new TransitionWhatsAppConversationUseCase(repository),
      inject: [WhatsAppRepository],
    },
    {
      provide: CreateHumanOutboundWhatsAppUseCase,
      useFactory: (repository: WhatsAppRepository) =>
        new CreateHumanOutboundWhatsAppUseCase(repository),
      inject: [WhatsAppRepository],
    },
    {
      provide: QueryWhatsAppUseCase,
      useFactory: (repository: WhatsAppRepository) =>
        new QueryWhatsAppUseCase(repository),
      inject: [WhatsAppRepository],
    },
  ],
  exports: [EvolutionInstanceManagementGateway],
})
export class WhatsAppModule {}
