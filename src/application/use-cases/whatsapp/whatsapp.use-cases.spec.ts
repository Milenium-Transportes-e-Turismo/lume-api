import { describe, expect, it } from 'vitest';

import {
  WhatsAppRepository,
  type ClaimEvolutionDispatchInput,
  type ConversationAccessScope,
  type ConversationListQuery,
  type CreateHumanOutboundInput,
  type CreateOutboundInput,
  type EvolutionResultInput,
  type MessageListQuery,
  type PersistWebhookMessageResult,
  type PersistWebhookMessageInput,
  type ReconcileAutomationOutboxInput,
  type StartHumanWhatsAppConversationInput,
  type TransitionCommand,
  type TransitionListQuery,
  type WebhookChannelConfiguration,
} from '../../contracts/whatsapp.repository';
import {
  ClaimEvolutionDispatchUseCase,
  CreateHumanOutboundWhatsAppUseCase,
  CreateOutboundWhatsAppUseCase,
  PersistWebhookWhatsAppMessageUseCase,
  QueryWhatsAppUseCase,
  ReconcileAutomationOutboxUseCase,
  RecordEvolutionResultUseCase,
  StartHumanWhatsAppConversationUseCase,
  TransitionWhatsAppConversationUseCase,
} from './whatsapp.use-cases';

class RecordingWhatsAppRepository extends WhatsAppRepository {
  calls: string[] = [];

  async findWebhookChannel(
    _channelId: string,
  ): Promise<WebhookChannelConfiguration | null> {
    this.calls.push('findWebhookChannel');
    return null;
  }
  async persistWebhookMessage(
    _input: PersistWebhookMessageInput,
  ): Promise<PersistWebhookMessageResult> {
    this.calls.push('persistWebhookMessage');
    return {
      accepted: true,
      duplicate: false,
      messageId: 'message',
      conversationId: 'conversation',
    };
  }
  async persistWebhookGroupMessage() {
    this.calls.push('persistWebhookGroupMessage');
    return {
      accepted: true as const,
      duplicate: false,
      groupId: '00000000-0000-4000-8000-000000000010',
      groupMessageId: '00000000-0000-4000-8000-000000000011',
      conversationId: null,
      threadId: null,
      serviceSessionId: null,
      automationAllowed: false as const,
      canGenerateReply: false as const,
      canSendReply: false as const,
    };
  }
  async syncWebhookGroup() {
    this.calls.push('syncWebhookGroup');
    return { operation: 'syncWebhookGroup' };
  }
  async assertAutomaticReplyAllowed() {
    this.calls.push('assertAutomaticReplyAllowed');
    return {
      allowed: true as const,
      threadId: '00000000-0000-4000-8000-000000000012',
      serviceSessionId: '00000000-0000-4000-8000-000000000013',
      serviceSessionVersion: 1,
    };
  }
  async getPendingContinuityClassification() {
    this.calls.push('getPendingContinuityClassification');
    return null;
  }
  async applyContinuityClassification() {
    this.calls.push('applyContinuityClassification');
    return {
      serviceSessionId: '00000000-0000-4000-8000-000000000013',
      version: 2,
      classification: 'uncertain' as const,
      idempotent: false,
    };
  }
  async processServiceSessionLifecycle() {
    this.calls.push('processServiceSessionLifecycle');
    return { closingStarted: 0, closed: 0, skipped: 0 };
  }
  async transition(_input: TransitionCommand) {
    this.calls.push('transition');
    return { operation: 'transition' };
  }
  async startHumanConversation(_input: StartHumanWhatsAppConversationInput) {
    this.calls.push('startHumanConversation');
    return {
      id: 'conversation',
      version: 1,
      conversationState: 'human-active' as const,
      assignedTo: null,
      idempotent: false,
    };
  }
  async createOutbound(_input: CreateOutboundInput) {
    this.calls.push('createOutbound');
    return { operation: 'createOutbound' };
  }
  async authorizeHumanOutbound(_input: CreateHumanOutboundInput) {
    this.calls.push('authorizeHumanOutbound');
  }
  async createHumanOutbound(_input: CreateHumanOutboundInput) {
    this.calls.push('createHumanOutbound');
    return { operation: 'createHumanOutbound' };
  }
  async claimEvolutionDispatch(_input: ClaimEvolutionDispatchInput) {
    this.calls.push('claimEvolutionDispatch');
    return { operation: 'claimEvolutionDispatch' };
  }
  async recordEvolutionResult(_input: EvolutionResultInput) {
    this.calls.push('recordEvolutionResult');
    return { operation: 'recordEvolutionResult' };
  }
  async markEvolutionDispatchUnknown() {
    this.calls.push('markEvolutionDispatchUnknown');
    return { operation: 'markEvolutionDispatchUnknown' };
  }
  async completeOutboxExecution() {
    this.calls.push('completeOutboxExecution');
    return { operation: 'completeOutboxExecution' };
  }
  async reconcileAutomationOutbox(_input: ReconcileAutomationOutboxInput) {
    this.calls.push('reconcileAutomationOutbox');
    return { operation: 'reconcileAutomationOutbox' };
  }
  async listConversations(_companyId: string, _query: ConversationListQuery) {
    this.calls.push('listConversations');
    return { operation: 'listConversations' };
  }
  async getConversation(
    _companyId: string,
    _conversationId: string,
    _scope: ConversationAccessScope,
  ) {
    this.calls.push('getConversation');
    return { operation: 'getConversation' };
  }
  async getAutomationBatch(
    _companyId: string,
    _conversationId: string,
    _sourceEventId: string,
    _windowSeconds: number,
  ) {
    this.calls.push('getAutomationBatch');
    return { operation: 'getAutomationBatch' };
  }
  async listMessages(
    _companyId: string,
    _conversationId: string,
    _query: MessageListQuery,
    _scope: ConversationAccessScope,
  ) {
    this.calls.push('listMessages');
    return { operation: 'listMessages' };
  }
  async listTransitions(
    _companyId: string,
    _conversationId: string,
    _query: TransitionListQuery,
    _scope: ConversationAccessScope,
  ) {
    this.calls.push('listTransitions');
    return { operation: 'listTransitions' };
  }
}

describe('casos de uso WhatsApp', () => {
  it('delega comandos transacionais ao repositório', async () => {
    const repository = new RecordingWhatsAppRepository();
    const common = {
      companyId: 'company',
      conversationId: 'conversation',
      commandId: 'command',
    };

    await new PersistWebhookWhatsAppMessageUseCase(repository).execute(
      {} as PersistWebhookMessageInput,
    );
    await new TransitionWhatsAppConversationUseCase(repository).execute({
      ...common,
      expectedVersion: 1,
      name: 'mark-read',
      actorType: 'system',
    });
    await new StartHumanWhatsAppConversationUseCase(repository).execute({
      companyId: 'company',
      phoneNormalized: '5534999999999',
      commandId: 'start-command',
      actorUserId: 'user',
    });
    await new CreateOutboundWhatsAppUseCase(repository).execute({
      ...common,
      expectedVersion: 1,
      automatic: true,
      kind: 'text',
      text: 'Olá',
    });
    const humanOutbound = new CreateHumanOutboundWhatsAppUseCase(repository);
    const humanCommand = {
      ...common,
      idempotencyKey: 'idempotency',
      expectedVersion: 1,
      actorUserId: 'user',
      text: 'Resposta humana',
    };
    await humanOutbound.authorize(humanCommand);
    await humanOutbound.execute(humanCommand);
    await new ClaimEvolutionDispatchUseCase(repository).execute({
      companyId: 'company',
      messageId: 'message',
      attemptId: 'attempt',
      commandId: 'command',
      ownerId: 'owner',
    });
    await new RecordEvolutionResultUseCase(repository).execute({
      companyId: 'company',
      messageId: 'message',
      commandId: 'command',
      attemptId: 'attempt',
      status: 'sent',
    });
    await new ReconcileAutomationOutboxUseCase(repository).execute({
      companyId: 'company',
      eventId: 'event',
      commandId: 'reconciliation',
      resolution: 'confirmed-not-sent',
      evidence: 'Envio ausente no provedor.',
      serviceIdentityId: 'service',
      serviceIdentityName: 'Operação',
    });

    expect(repository.calls).toEqual([
      'persistWebhookMessage',
      'transition',
      'startHumanConversation',
      'createOutbound',
      'authorizeHumanOutbound',
      'createHumanOutbound',
      'claimEvolutionDispatch',
      'recordEvolutionResult',
      'reconcileAutomationOutbox',
    ]);
  });

  it('delega todas as consultas com o companyId recebido', async () => {
    const repository = new RecordingWhatsAppRepository();
    const query = new QueryWhatsAppUseCase(repository);
    const scope = { departments: ['operations'] as const };

    await query.listConversations('company', { page: 1, pageSize: 20 });
    await query.getConversation('company', 'conversation', scope);
    await query.getAutomationBatch(
      'company',
      'conversation',
      'source-event',
      120,
    );
    await query.listMessages(
      'company',
      'conversation',
      {
        page: 1,
        pageSize: 50,
      },
      scope,
    );
    await query.listTransitions(
      'company',
      'conversation',
      {
        page: 1,
        pageSize: 50,
      },
      scope,
    );
    expect(repository.calls).toEqual([
      'listConversations',
      'getConversation',
      'getAutomationBatch',
      'listMessages',
      'listTransitions',
    ]);
  });
});
