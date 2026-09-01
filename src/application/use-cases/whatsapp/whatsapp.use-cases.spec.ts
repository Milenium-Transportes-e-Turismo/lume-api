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
  type PersistWebhookMessageInput,
  type ReconcileAutomationOutboxInput,
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
  async persistWebhookMessage(_input: PersistWebhookMessageInput) {
    this.calls.push('persistWebhookMessage');
    return { operation: 'persistWebhookMessage' };
  }
  async transition(_input: TransitionCommand) {
    this.calls.push('transition');
    return { operation: 'transition' };
  }
  async createOutbound(_input: CreateOutboundInput) {
    this.calls.push('createOutbound');
    return { operation: 'createOutbound' };
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
    await new CreateOutboundWhatsAppUseCase(repository).execute({
      ...common,
      automatic: true,
      kind: 'text',
      text: 'Olá',
    });
    await new CreateHumanOutboundWhatsAppUseCase(repository).execute({
      ...common,
      idempotencyKey: 'idempotency',
      expectedVersion: 1,
      actorUserId: 'user',
      text: 'Resposta humana',
    });
    await new ClaimEvolutionDispatchUseCase(repository).execute({
      companyId: 'company',
      messageId: 'message',
      attemptId: 'attempt',
      commandId: 'command',
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
      'createOutbound',
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
