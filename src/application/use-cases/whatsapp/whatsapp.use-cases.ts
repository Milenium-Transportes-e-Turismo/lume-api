import { WhatsAppRepository } from '../../contracts/whatsapp.repository';
import type {
  ClaimEvolutionDispatchInput,
  CompleteOutboxExecutionInput,
  ConversationAccessScope,
  ConversationListQuery,
  CreateHumanOutboundInput,
  CreateOutboundInput,
  EvolutionResultInput,
  MessageListQuery,
  PersistWebhookMessageInput,
  ReconcileAutomationOutboxInput,
  StartHumanWhatsAppConversationInput,
  TransitionCommand,
  TransitionListQuery,
} from '../../contracts/whatsapp.repository';

export class PersistWebhookWhatsAppMessageUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: PersistWebhookMessageInput) {
    return this.repository.persistWebhookMessage(input);
  }
}

export class TransitionWhatsAppConversationUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: TransitionCommand) {
    return this.repository.transition(input);
  }
}

export class StartHumanWhatsAppConversationUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}

  execute(input: StartHumanWhatsAppConversationInput) {
    return this.repository.startHumanConversation(input);
  }
}

export class CreateOutboundWhatsAppUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: CreateOutboundInput) {
    return this.repository.createOutbound(input);
  }
}

export class CreateHumanOutboundWhatsAppUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  authorize(input: CreateHumanOutboundInput) {
    return this.repository.authorizeHumanOutbound(input);
  }
  execute(input: CreateHumanOutboundInput) {
    return this.repository.createHumanOutbound(input);
  }
}

export class ClaimEvolutionDispatchUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: ClaimEvolutionDispatchInput) {
    return this.repository.claimEvolutionDispatch(input);
  }
}

export class RecordEvolutionResultUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: EvolutionResultInput) {
    return this.repository.recordEvolutionResult(input);
  }
}

export class CompleteOutboxExecutionUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: CompleteOutboxExecutionInput) {
    return this.repository.completeOutboxExecution(input);
  }
}

export class ReconcileAutomationOutboxUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}
  execute(input: ReconcileAutomationOutboxInput) {
    return this.repository.reconcileAutomationOutbox(input);
  }
}

export class QueryWhatsAppUseCase {
  constructor(private readonly repository: WhatsAppRepository) {}

  listConversations(companyId: string, query: ConversationListQuery) {
    return this.repository.listConversations(companyId, query);
  }

  getConversation(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ) {
    return this.repository.getConversation(companyId, conversationId, scope);
  }

  getAutomationBatch(
    companyId: string,
    conversationId: string,
    sourceEventId: string,
    windowSeconds: number,
  ) {
    return this.repository.getAutomationBatch(
      companyId,
      conversationId,
      sourceEventId,
      windowSeconds,
    );
  }

  listMessages(
    companyId: string,
    conversationId: string,
    query: MessageListQuery,
    scope: ConversationAccessScope,
  ) {
    return this.repository.listMessages(
      companyId,
      conversationId,
      query,
      scope,
    );
  }

  listTransitions(
    companyId: string,
    conversationId: string,
    query: TransitionListQuery,
    scope: ConversationAccessScope,
  ) {
    return this.repository.listTransitions(
      companyId,
      conversationId,
      query,
      scope,
    );
  }
}
