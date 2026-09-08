import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CommercialQuoteRepository } from '../../../application/contracts/commercial-quote.repository';
import {
  WhatsAppContinuityClassificationError,
  type WhatsAppConversationAgentResult,
} from '../../../application/contracts/whatsapp-conversation-agent';
import type { WhatsAppRepository } from '../../../application/contracts/whatsapp.repository';
import { WhatsAppAutomationExecutionError } from '../../../application/contracts/whatsapp-automation.provider';
import type { HttpEvolutionOutboundGateway } from '../evolution/evolution-outbound.client';
import type { PlatformWhatsAppConversationAgent } from '../whatsapp-ai/platform-whatsapp-conversation-agent';
import { deterministicCommandId } from '../../../domain/whatsapp/whatsapp-automation-flow';
import { UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT } from '../../../domain/whatsapp/whatsapp.constants';
import { ApiWhatsAppAutomationProvider } from './api-whatsapp-automation.provider';
import type { WhatsAppAutomationDecisionStore } from './whatsapp-automation-decision.store';
import type { WhatsAppAutomationCheckpointStore } from './whatsapp-automation-checkpoint.store';

const ids = {
  event: '00000000-0000-4000-8000-000000000001',
  company: '00000000-0000-4000-8000-000000000002',
  conversation: '00000000-0000-4000-8000-000000000003',
  execution: '00000000-0000-4000-8000-000000000004',
  message: '00000000-0000-4000-8000-000000000005',
  attempt: '00000000-0000-4000-8000-000000000006',
};

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.conversation,
    department: 'commercial',
    conversationState: 'bot-active',
    flowStep: 'main-menu',
    requestStatus: 'not-started',
    resumeState: null,
    version: 1,
    mainMenuPresentedAt: null,
    followUpMenuPresentedAt: null,
    departmentContactOption: null,
    currentQuoteRequest: null,
    assignedTo: null,
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evolution:source-1',
    messageId: ids.message,
    conversationId: ids.conversation,
    channelId: '00000000-0000-4000-8000-000000000007',
    companyId: ids.company,
    contact: {
      id: '00000000-0000-4000-8000-000000000008',
      phone: '5534999999999',
      displayName: 'Cliente',
    },
    message: {
      providerMessageId: 'provider-1',
      direction: 'inbound',
      deliveryStatus: 'received',
      kind: 'text',
      text: 'olá',
      media: null,
      occurredAt: '2026-08-06T12:00:00.000Z',
    },
    conversation: conversation(),
    automationAllowed: true,
    canGenerateReply: true,
    canSendReply: true,
    contextualTransition: false,
    isFirstContact: true,
    ...overrides,
  };
}

function event(
  topic:
    | 'whatsapp.inbound.persisted'
    | 'whatsapp.inbound.human-notification'
    | 'whatsapp.outbound.requested' = 'whatsapp.inbound.persisted',
  payloadOverride: Record<string, unknown> = {},
) {
  return {
    id: ids.event,
    companyId: ids.company,
    topic,
    aggregateType: 'whatsapp-conversation',
    aggregateId: ids.conversation,
    aggregateSequence: 1,
    executionId: ids.execution,
    correlationId: 'evolution:source-1',
    createdAt: new Date('2026-08-06T12:00:00.000Z'),
    payload: payload(payloadOverride),
    attempts: 0,
    maxAttempts: 8,
  } as const;
}

function createSubject(input?: {
  repository?: Partial<
    Record<keyof WhatsAppRepository, ReturnType<typeof vi.fn>>
  >;
  evolutionResult?: Record<string, unknown>;
  config?: Record<string, unknown>;
}) {
  const calls: string[] = [];
  const repository = {
    findWebhookChannel: vi.fn().mockResolvedValue({ agentsEnabled: true }),
    getPendingContinuityClassification: vi.fn(async () => null),
    applyContinuityClassification: vi.fn(async () => ({
      serviceSessionId: '00000000-0000-4000-8000-000000000010',
      version: 2,
      classification: 'uncertain',
      idempotent: false,
    })),
    getAutomationBatch: vi.fn(async () => {
      calls.push('batch');
      return {
        conversation: conversation(),
        batch: {
          messages: [
            {
              sourceEventId: 'evolution:source-1',
              messageId: ids.message,
              occurredAt: '2026-08-06T12:00:00.000Z',
              persistedAt: '2026-08-06T12:00:00.000Z',
              kind: 'text',
              text: 'olá',
            },
          ],
        },
      };
    }),
    assertAutomaticReplyAllowed: vi.fn(async () => ({
      allowed: true,
      threadId: '00000000-0000-4000-8000-000000000009',
      serviceSessionId: '00000000-0000-4000-8000-000000000010',
      serviceSessionVersion: 1,
    })),
    createOutbound: vi.fn(async (command: { text?: string }) => {
      calls.push('create-outbound');
      return {
        id: ids.message,
        kind: 'text',
        text: command.text,
        recipientPhone: '5534999999999',
        attempts: [{ id: ids.attempt }],
      };
    }),
    claimEvolutionDispatch: vi.fn(async () => {
      calls.push('claim');
      return { shouldSend: true, state: 'leased' };
    }),
    recordEvolutionResult: vi.fn(async () => {
      calls.push('result');
      return {};
    }),
    markEvolutionDispatchUnknown: vi.fn(async () => {
      calls.push('reconciliation-required');
      return { state: 'unknown', requiresReconciliation: true };
    }),
    transition: vi.fn(async (command: { name: string }) => {
      calls.push(`transition:${command.name}`);
      return conversation({
        version: 2,
        mainMenuPresentedAt: '2026-08-06T12:00:01.000Z',
      });
    }),
    completeOutboxExecution: vi.fn(async () => {
      calls.push('complete');
      return {};
    }),
    ...input?.repository,
  };
  const agent = {
    classifyContinuity: vi.fn(),
    complete: vi.fn(async (): Promise<WhatsAppConversationAgentResult> => ({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      attempt: 1,
      agentId: '00000000-0000-4000-8000-000000000091',
      agentExecutionId: '00000000-0000-4000-8000-000000000092',
      output: {
        message: 'Olá! Como posso ajudar?',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'undecided',
      },
    })),
  };
  const evolution = {
    send: vi.fn(
      async () =>
        input?.evolutionResult ?? {
          outcome: 'confirmed',
          deliveryStatus: 'sent',
          providerMessageId: 'evolution-message-1',
          httpStatus: 201,
          requiresReconciliation: false,
        },
    ),
  };
  const decisionStore = {
    getOrCreate: vi.fn(
      async (
        _event: unknown,
        _agentInput: unknown,
        createDecision: () => Promise<unknown>,
      ) => createDecision(),
    ),
  };
  const checkpointStore = {
    getOrCreate: vi.fn(
      async (_event: unknown, createCheckpoint: () => Promise<unknown>) =>
        createCheckpoint(),
    ),
  };
  const subject = new ApiWhatsAppAutomationProvider(
    repository as unknown as WhatsAppRepository,
    repository as unknown as CommercialQuoteRepository,
    agent as unknown as PlatformWhatsAppConversationAgent,
    checkpointStore as unknown as WhatsAppAutomationCheckpointStore,
    decisionStore as unknown as WhatsAppAutomationDecisionStore,
    evolution as unknown as HttpEvolutionOutboundGateway,
    {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    },
    new ConfigService({
      WHATSAPP_API_DEBOUNCE_MS: 2_000,
      WHATSAPP_API_DEPARTMENT_COLLECTION_MS: 120_000,
      ...input?.config,
    }),
  );
  return {
    subject,
    repository,
    agent,
    checkpointStore,
    decisionStore,
    evolution,
    calls,
  };
}

describe('ApiWhatsAppAutomationProvider', () => {
  it('conclui sem responder eventos recebidos antes da ativação atual', async () => {
    const { subject, repository, evolution, checkpointStore, agent, calls } =
      createSubject({
        config: {
          WHATSAPP_ENABLED: true,
          WHATSAPP_AUTOMATION_ACTIVE_SINCE: '2026-08-06T12:01:00.000Z',
        },
      });

    await subject.execute(event());

    expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'succeeded',
        consumedSourceEventIds: ['evolution:source-1'],
      }),
    );
    expect(repository.getAutomationBatch).not.toHaveBeenCalled();
    expect(checkpointStore.getOrCreate).not.toHaveBeenCalled();
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(evolution.send).not.toHaveBeenCalled();
    expect(agent.complete).not.toHaveBeenCalled();
    expect(calls).toEqual(['complete']);
  });

  it('usa o início do processo como barreira quando o marco não foi configurado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:01:00.000Z'));
    try {
      const { subject, repository, evolution } = createSubject({
        config: { WHATSAPP_ENABLED: true },
      });

      await subject.execute(event());

      expect(repository.completeOutboxExecution).toHaveBeenCalled();
      expect(repository.createOutbound).not.toHaveBeenCalled();
      expect(evolution.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('processa normalmente evento recebido após a ativação atual', async () => {
    const { subject, repository, evolution } = createSubject({
      config: {
        WHATSAPP_ENABLED: true,
        WHATSAPP_AUTOMATION_ACTIVE_SINCE: '2026-08-06T11:59:00.000Z',
      },
    });

    await subject.execute(event());

    expect(repository.createOutbound).toHaveBeenCalled();
    expect(evolution.send).toHaveBeenCalled();
  });

  it('classifies and applies continuity before loading any customer-facing batch', async () => {
    const getPendingContinuityClassification = vi.fn(async () => ({
      decisionId: '00000000-0000-4000-8000-000000000020',
      sourceServiceSessionId: '00000000-0000-4000-8000-000000000010',
      expectedVersion: 8,
      currentDepartmentId: '00000000-0000-4000-8000-000000000021',
      previousMessages: [
        {
          direction: 'inbound' as const,
          text: 'Assunto anterior',
          occurredAt: '2026-08-06T11:30:00.000Z',
        },
      ],
      userMessage: 'Novo pedido',
      allowedTargetDepartments: [
        {
          id: '00000000-0000-4000-8000-000000000021',
          code: 'commercial',
          name: 'Comercial',
        },
      ],
    }));
    const applyContinuityClassification = vi.fn(async (_input: unknown) => ({
      serviceSessionId: '00000000-0000-4000-8000-000000000022',
      version: 1,
      classification: 'new-subject' as const,
      idempotent: false,
    }));
    const { subject, repository, agent } = createSubject({
      repository: {
        getPendingContinuityClassification,
        applyContinuityClassification,
      },
    });
    agent.classifyContinuity.mockResolvedValueOnce({
      classification: 'new-subject',
      confidence: 0.91,
      reason: 'O pedido inicia outro atendimento.',
      targetDepartmentId: '00000000-0000-4000-8000-000000000021',
      agentId: '00000000-0000-4000-8000-000000000023',
      agentExecutionId: '00000000-0000-4000-8000-000000000024',
    });

    await subject.execute(event());

    expect(agent.classifyContinuity).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: 'evolution:source-1',
        serviceSessionId: '00000000-0000-4000-8000-000000000010',
        userMessage: 'Novo pedido',
      }),
    );
    expect(applyContinuityClassification).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 8,
        classification: 'new-subject',
        confidence: 0.91,
        actorAgentId: '00000000-0000-4000-8000-000000000023',
        agentExecutionId: '00000000-0000-4000-8000-000000000024',
      }),
    );
    expect(
      applyContinuityClassification.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.getAutomationBatch.mock.invocationCallOrder[0]);
  });

  it('persists UNCERTAIN safely before responding when the classifier fails', async () => {
    const applyContinuityClassification = vi.fn(async (_input: unknown) => ({
      serviceSessionId: '00000000-0000-4000-8000-000000000010',
      version: 9,
      classification: 'uncertain' as const,
      idempotent: false,
    }));
    const { subject, repository, agent } = createSubject({
      repository: {
        getPendingContinuityClassification: vi.fn(async () => ({
          decisionId: '00000000-0000-4000-8000-000000000020',
          sourceServiceSessionId: '00000000-0000-4000-8000-000000000010',
          expectedVersion: 8,
          currentDepartmentId: '00000000-0000-4000-8000-000000000021',
          previousMessages: [],
          userMessage: 'Ainda é sobre aquilo.',
          allowedTargetDepartments: [],
        })),
        applyContinuityClassification,
      },
    });
    agent.classifyContinuity.mockRejectedValueOnce(
      new WhatsAppContinuityClassificationError(
        '00000000-0000-4000-8000-000000000023',
        '00000000-0000-4000-8000-000000000024',
      ),
    );

    await subject.execute(event());

    expect(applyContinuityClassification).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'uncertain',
        confidence: null,
        targetDepartmentId: '00000000-0000-4000-8000-000000000021',
        actorAgentId: '00000000-0000-4000-8000-000000000023',
        agentExecutionId: '00000000-0000-4000-8000-000000000024',
      }),
    );
    expect(
      applyContinuityClassification.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.getAutomationBatch.mock.invocationCallOrder[0]);
    expect(agent.complete).toHaveBeenCalledOnce();
  });

  it('processa atendimento natural, atribuição da IA e conclusão na ordem durável', async () => {
    const { subject, repository, evolution, calls } = createSubject();

    await subject.execute(event());

    expect(repository.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Olá! Como posso ajudar?',
        automatic: true,
        actorAgentId: '00000000-0000-4000-8000-000000000091',
        agentExecutionId: '00000000-0000-4000-8000-000000000092',
      }),
    );
    expect(evolution.send).toHaveBeenCalledWith({
      kind: 'text',
      recipientPhone: '5534999999999',
      sourceChannelId: '00000000-0000-4000-8000-000000000007',
      text: 'Olá! Como posso ajudar?',
    });
    expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        automationProvider: 'api',
        outcome: 'succeeded',
        consumedSourceEventIds: ['evolution:source-1'],
      }),
    );
    expect(calls).toEqual([
      'batch',
      'create-outbound',
      'claim',
      'result',
      'complete',
    ]);
  });

  it('persiste a prioridade silenciosa da IA na mesma fronteira do outbound', async () => {
    const { subject, repository, agent } = createSubject();
    agent.complete.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      attempt: 1,
      agentId: '00000000-0000-4000-8000-000000000091',
      agentExecutionId: '00000000-0000-4000-8000-000000000092',
      output: {
        message: 'Vou priorizar sua solicitação.',
        collectionStatus: 'collecting',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'undecided',
        priority: 'urgent',
        priorityReason: 'Veículo parado em operação.',
      },
    });

    await subject.execute(event());

    expect(repository.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionPriority: {
          priority: 'urgent',
          reason: 'Veículo parado em operação.',
        },
      }),
    );
  });

  it('analisa pagamento após orçamento e encaminha ao Financeiro sem emitir menu ou reiniciar coleta', async () => {
    const text =
      'Quero falar sobre o pagamento de uma viagem de quinze dias atrás';
    const current = conversation({
      mainMenuPresentedAt: '2026-08-06T11:00:00.000Z',
      flowStep: 'commercial-follow-up-menu',
      requestStatus: 'under-review',
      currentQuoteRequest: {
        id: '00000000-0000-4000-8000-000000000095',
        version: 3,
        status: 'under-review',
        sequence: 1,
        origin: 'Uberlândia',
        destination: 'Goiânia',
      },
    });
    const { subject, repository, agent, evolution } = createSubject({
      repository: {
        getAutomationBatch: vi.fn(async () => ({
          conversation: current,
          batch: {
            messages: [
              {
                sourceEventId: 'evolution:source-1',
                messageId: ids.message,
                occurredAt: '2026-08-06T12:00:00.000Z',
                persistedAt: '2026-08-06T12:00:00.000Z',
                kind: 'text',
                text,
              },
            ],
          },
        })),
      },
    });
    agent.complete.mockResolvedValueOnce({
      provider: 'openai',
      model: 'test',
      attempt: 1,
      output: {
        message: 'Vou encaminhar seu atendimento ao Financeiro.',
        collectionStatus: 'human-handoff',
        customerDecision: 'human-requested',
        targetDepartment: 'financial',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
      },
    });
    await subject.execute(
      event('whatsapp.inbound.persisted', {
        isFirstContact: false,
        conversation: current,
      }),
    );
    expect(agent.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        aiMode: 'natural-service',
        userMessage: text,
        currentConversation: expect.objectContaining({
          currentQuoteRequest: current.currentQuoteRequest,
        }),
      }),
    );
    expect(repository.transition).toHaveBeenCalledTimes(1);
    expect(repository.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'forward',
        metadata: expect.objectContaining({ targetDepartment: 'financial' }),
      }),
    );
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(evolution.send).not.toHaveBeenCalled();
  });

  it('persists the structured natural-service completion for the formal lifecycle', async () => {
    const { subject, repository, agent } = createSubject();
    agent.complete.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      attempt: 1,
      agentId: '00000000-0000-4000-8000-000000000091',
      agentExecutionId: '00000000-0000-4000-8000-000000000092',
      output: {
        message: 'Sua solicitação foi resolvida.',
        collectionStatus: 'completed',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'undecided',
      },
    });

    await subject.execute(event());

    expect(repository.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationResolved: true,
        actorAgentId: '00000000-0000-4000-8000-000000000091',
        agentExecutionId: '00000000-0000-4000-8000-000000000092',
      }),
    );
  });

  it('uses the claimed message channel route as the outbound source of truth', async () => {
    const actualChannelId = '00000000-0000-4000-8000-000000000077';
    const { subject, repository, evolution } = createSubject({
      repository: {
        claimEvolutionDispatch: vi.fn(async () => ({
          shouldSend: true,
          state: 'leased',
          sourceChannelId: actualChannelId,
          instanceName: 'tenant-channel-b',
        })),
      },
    });

    await subject.execute(event());

    expect(repository.claimEvolutionDispatch).toHaveBeenCalledOnce();
    expect(evolution.send).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannelId: actualChannelId,
        instanceName: 'tenant-channel-b',
      }),
    );
  });

  it('delega o envio do handoff ao outbox transacional e interrompe o envio direto', async () => {
    const { subject, repository, evolution, agent, calls } = createSubject();
    agent.complete.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      attempt: 1,
      agentId: '00000000-0000-4000-8000-000000000091',
      agentExecutionId: '00000000-0000-4000-8000-000000000092',
      output: {
        message: 'Vou encaminhar sua solicitação.',
        collectionStatus: 'human-handoff',
        extractedDataPatch: {},
        missingFields: [],
        summaryPresented: false,
        customerDecision: 'human-requested',
        priority: 'high',
        priorityReason: 'Cliente pediu atendimento humano.',
      },
    });

    await subject.execute(event());

    expect(repository.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'forward',
        expectedVersion: 1,
        automaticHumanHandoff: expect.objectContaining({
          customerMessage: 'Vou encaminhar sua solicitação.',
          actorAgentId: '00000000-0000-4000-8000-000000000091',
          agentExecutionId: '00000000-0000-4000-8000-000000000092',
          sessionPriority: {
            priority: 'high',
            reason: 'Cliente pediu atendimento humano.',
          },
          occurredAt: expect.any(Date),
        }),
      }),
    );
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(evolution.send).not.toHaveBeenCalled();
    expect(calls).toEqual(['batch', 'transition:forward', 'complete']);
  });

  it('não responde automaticamente quando a conversa está em atendimento humano', async () => {
    const { subject, repository, evolution } = createSubject({
      repository: {
        getAutomationBatch: vi.fn(async () => ({
          conversation: conversation({
            conversationState: 'human-active',
            flowStep: 'human-service',
          }),
          batch: {
            messages: [
              {
                sourceEventId: 'evolution:source-1',
                messageId: ids.message,
                occurredAt: '2026-08-06T12:00:00.000Z',
                kind: 'text',
                text: 'preciso de ajuda',
              },
            ],
          },
        })),
      },
    });

    await subject.execute(
      event('whatsapp.inbound.human-notification', {
        conversation: conversation({
          conversationState: 'human-active',
          flowStep: 'human-service',
        }),
        automationAllowed: false,
        canGenerateReply: false,
        canSendReply: false,
      }),
    );

    expect(evolution.send).not.toHaveBeenCalled();
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded' }),
    );
  });

  it.each([
    'text',
    'image',
    'sticker',
    'audio',
    'video',
    'document',
    'unknown',
  ])(
    'mantém silêncio absoluto no atendimento humano para mensagem %s',
    async (kind) => {
      const current = conversation({
        conversationState: 'human-active',
        flowStep: 'human-service',
        assignedTo: { id: 'user-1', name: 'Atendente' },
      });
      const { subject, repository, evolution, agent } = createSubject({
        repository: {
          getAutomationBatch: vi.fn(async () => ({
            conversation: current,
            batch: {
              messages: [
                {
                  sourceEventId: 'evolution:source-1',
                  messageId: ids.message,
                  occurredAt: '2026-08-06T12:00:00.000Z',
                  kind,
                  text: kind === 'text' ? 'mensagem para o atendente' : null,
                },
              ],
            },
          })),
        },
      });

      await subject.execute(
        event('whatsapp.inbound.human-notification', {
          conversation: current,
          message: {
            providerMessageId: `provider-${kind}-1`,
            direction: 'inbound',
            deliveryStatus: 'received',
            kind,
            text: kind === 'text' ? 'mensagem para o atendente' : null,
            media:
              kind === 'text' ? null : { mimeType: 'application/octet-stream' },
            occurredAt: '2026-08-06T12:00:00.000Z',
          },
          automationAllowed: false,
          canGenerateReply: false,
          canSendReply: false,
          isFirstContact: false,
        }),
      );

      expect(agent.complete).not.toHaveBeenCalled();
      expect(repository.transition).not.toHaveBeenCalled();
      expect(repository.createOutbound).not.toHaveBeenCalled();
      expect(evolution.send).not.toHaveBeenCalled();
      expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'succeeded' }),
      );
    },
  );

  it('responde mídia com orientação fixa sem chamar IA nem avançar o fluxo', async () => {
    const current = conversation({
      flowStep: 'commercial-menu',
      mainMenuPresentedAt: '2026-08-06T11:59:00.000Z',
      version: 3,
    });
    const { subject, repository, evolution, agent } = createSubject({
      repository: {
        getAutomationBatch: vi.fn(async () => ({
          conversation: current,
          batch: {
            messages: [
              {
                sourceEventId: 'evolution:source-1',
                messageId: ids.message,
                occurredAt: '2026-08-06T12:00:00.000Z',
                kind: 'image',
                text: null,
              },
            ],
            pendingQuestion: null,
          },
        })),
      },
    });

    await subject.execute(
      event('whatsapp.inbound.persisted', {
        conversation: current,
        message: {
          providerMessageId: 'provider-image-1',
          direction: 'inbound',
          deliveryStatus: 'received',
          kind: 'image',
          text: null,
          media: { mimeType: 'image/jpeg' },
          occurredAt: '2026-08-06T12:00:00.000Z',
        },
        isFirstContact: false,
        reopenedAfterClosure: false,
      }),
    );

    expect(agent.complete).not.toHaveBeenCalled();
    expect(repository.transition).not.toHaveBeenCalled();
    expect(repository.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        purpose: 'unsupported-message-kind',
        inReplyToMessageId: ids.message,
        text: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      }),
    );
    expect(evolution.send).toHaveBeenCalledWith({
      kind: 'text',
      recipientPhone: '5534999999999',
      sourceChannelId: '00000000-0000-4000-8000-000000000007',
      text: UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
    });
  });

  it('reagenda resposta automática enquanto a interpretação durável está pendente', async () => {
    const { subject, repository, evolution, agent } = createSubject({
      config: {
        WHATSAPP_ENABLED: true,
        WHATSAPP_AUTOMATION_ACTIVE_SINCE: '2026-08-06T11:59:00.000Z',
      },
      repository: {
        getAutomationBatch: vi.fn(async () => ({
          conversation: conversation(),
          batch: {
            messages: [
              {
                sourceEventId: 'evolution:source-1',
                messageId: ids.message,
                occurredAt: '2026-08-06T12:00:00.000Z',
                kind: 'image',
                text: null,
                mediaInterpretationStatus: 'pending',
                interpretedText: null,
                interpretationSource: 'none',
              },
            ],
          },
        })),
      },
    });

    await expect(
      subject.execute(
        event('whatsapp.inbound.persisted', {
          message: {
            providerMessageId: 'provider-image-1',
            direction: 'inbound',
            deliveryStatus: 'received',
            kind: 'image',
            text: null,
            media: { mimeType: 'image/jpeg' },
            occurredAt: '2026-08-06T12:00:00.000Z',
          },
        }),
      ),
    ).rejects.toMatchObject({
      outcome: 'retryable-failure',
      errorCode: 'MEDIA_INTERPRETATION_PENDING',
    });
    expect(agent.complete).not.toHaveBeenCalled();
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(evolution.send).not.toHaveBeenCalled();
  });

  it('usa o contexto multimodal efetivo na primeira resposta automática', async () => {
    const interpretedText =
      'Correção humana: cliente solicita orçamento para 20 passageiros.';
    const interpretationId = '00000000-0000-4000-8000-000000000099';
    const { subject, agent } = createSubject({
      config: {
        WHATSAPP_ENABLED: true,
        WHATSAPP_AUTOMATION_ACTIVE_SINCE: '2026-08-06T11:59:00.000Z',
      },
      repository: {
        getAutomationBatch: vi.fn(async () => ({
          conversation: conversation(),
          batch: {
            messages: [
              {
                sourceEventId: 'evolution:source-1',
                messageId: ids.message,
                occurredAt: '2026-08-06T12:00:00.000Z',
                kind: 'document',
                text: null,
                mediaInterpretationStatus: 'succeeded',
                mediaInterpretationId: interpretationId,
                interpretedText,
                interpretationSource: 'human',
              },
            ],
          },
        })),
      },
    });

    await subject.execute(
      event('whatsapp.inbound.persisted', {
        message: {
          providerMessageId: 'provider-document-1',
          direction: 'inbound',
          deliveryStatus: 'received',
          kind: 'document',
          text: null,
          media: { mimeType: 'application/pdf' },
          occurredAt: '2026-08-06T12:00:00.000Z',
        },
      }),
    );

    expect(agent.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: interpretedText,
        mediaInterpretations: [{ interpretationId, effectiveSource: 'human' }],
      }),
    );
  });

  it('não repete envio quando a Evolution retorna resultado ambíguo', async () => {
    const { subject, repository } = createSubject({
      evolutionResult: {
        outcome: 'ambiguous',
        deliveryStatus: 'pending',
        errorCode: 'EVOLUTION_DISPATCH_TIMEOUT',
        errorMessage: 'Sem confirmação.',
        requiresReconciliation: true,
      },
    });
    const outboundPayload = {
      attemptId: ids.attempt,
      message: {
        providerMessageId: null,
        direction: 'outbound',
        deliveryStatus: 'pending',
        kind: 'text',
        text: 'Resposta humana',
        media: null,
        occurredAt: '2026-08-06T12:00:00.000Z',
      },
      conversation: conversation({ conversationState: 'human-active' }),
      automatic: false,
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: true,
      isFirstContact: false,
    };

    await expect(
      subject.execute(event('whatsapp.outbound.requested', outboundPayload)),
    ).rejects.toMatchObject({
      outcome: 'terminal-failure',
      errorCode: 'EVOLUTION_RECONCILIATION_REQUIRED',
    } satisfies Partial<WhatsAppAutomationExecutionError>);
    expect(repository.recordEvolutionResult).not.toHaveBeenCalled();
    expect(repository.markEvolutionDispatchUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: ids.message,
        attemptId: ids.attempt,
        ownerId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        errorCode: 'EVOLUTION_DISPATCH_TIMEOUT',
      }),
    );
    expect(repository.completeOutboxExecution).not.toHaveBeenCalled();
    expect(repository.claimEvolutionDispatch).toHaveBeenCalledTimes(1);
  });

  it('repete apenas a persistência local quando o resultado confirmado falha uma vez', async () => {
    const recordEvolutionResult = vi
      .fn()
      .mockRejectedValueOnce(new Error('Falha transitória de persistência.'))
      .mockResolvedValueOnce({});
    const { subject, repository, evolution } = createSubject({
      repository: { recordEvolutionResult },
    });

    await subject.execute(
      event('whatsapp.outbound.requested', { attemptId: ids.attempt }),
    );

    expect(evolution.send).toHaveBeenCalledOnce();
    expect(recordEvolutionResult).toHaveBeenCalledTimes(2);
    expect(recordEvolutionResult.mock.calls[0]?.[0]).toEqual(
      recordEvolutionResult.mock.calls[1]?.[0],
    );
    expect(repository.markEvolutionDispatchUnknown).not.toHaveBeenCalled();
    expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        automationProvider: 'api',
        outcome: 'succeeded',
      }),
    );
  });

  it('marca o envio confirmado como ambíguo após falha persistente sem reenviar', async () => {
    const recordEvolutionResult = vi
      .fn()
      .mockRejectedValue(new Error('Persistência indisponível.'));
    const { subject, repository, evolution } = createSubject({
      repository: { recordEvolutionResult },
    });

    await expect(
      subject.execute(
        event('whatsapp.outbound.requested', { attemptId: ids.attempt }),
      ),
    ).rejects.toMatchObject({
      outcome: 'terminal-failure',
      errorCode: 'EVOLUTION_RECONCILIATION_REQUIRED',
    } satisfies Partial<WhatsAppAutomationExecutionError>);

    expect(evolution.send).toHaveBeenCalledOnce();
    expect(recordEvolutionResult).toHaveBeenCalledTimes(2);
    expect(recordEvolutionResult.mock.calls[0]?.[0]).toEqual(
      recordEvolutionResult.mock.calls[1]?.[0],
    );
    expect(repository.markEvolutionDispatchUnknown).toHaveBeenCalledOnce();
    expect(repository.markEvolutionDispatchUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: ids.company,
        messageId: ids.message,
        attemptId: ids.attempt,
        errorCode: 'EVOLUTION_RESULT_PERSISTENCE_FAILED',
      }),
    );
    expect(repository.completeOutboxExecution).not.toHaveBeenCalled();
  });

  it('inclui a geração reconciliada nas chaves de claim e resultado', async () => {
    const { subject, repository } = createSubject();
    const generation = '00000000-0000-4000-8000-000000000009';
    const outboundPayload = {
      attemptId: ids.attempt,
      dispatchGeneration: generation,
      message: {
        providerMessageId: null,
        direction: 'outbound',
        deliveryStatus: 'pending',
        kind: 'text',
        text: 'Resposta humana',
        media: null,
        occurredAt: '2026-08-06T12:00:00.000Z',
      },
      conversation: conversation({ conversationState: 'human-active' }),
      automatic: false,
      automationAllowed: false,
      canGenerateReply: false,
      canSendReply: true,
      isFirstContact: false,
    };

    await subject.execute(
      event('whatsapp.outbound.requested', outboundPayload),
    );

    const claimCommandId = deterministicCommandId(
      'evolution:source-1',
      `evolution-claim:${ids.message}:${generation}`,
    );
    const resultCommandId = deterministicCommandId(
      'evolution:source-1',
      `evolution-result:${ids.message}:${generation}`,
    );
    expect(repository.claimEvolutionDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ids.attempt,
        commandId: claimCommandId,
      }),
    );
    expect(repository.recordEvolutionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ids.attempt,
        commandId: resultCommandId,
      }),
    );
    expect(claimCommandId).not.toBe(
      deterministicCommandId(
        'evolution:source-1',
        `evolution-claim:${ids.message}:initial`,
      ),
    );
  });

  it('rejeita envelope divergente antes de criar checkpoint ou executar efeitos', async () => {
    const { subject, repository, checkpointStore, evolution } = createSubject();

    await expect(
      subject.execute(
        event('whatsapp.inbound.persisted', {
          companyId: '00000000-0000-4000-8000-000000000099',
        }),
      ),
    ).rejects.toMatchObject({
      outcome: 'terminal-failure',
      errorCode: 'AUTOMATION_ENVELOPE_INVALID',
    } satisfies Partial<WhatsAppAutomationExecutionError>);

    expect(checkpointStore.getOrCreate).not.toHaveBeenCalled();
    expect(repository.createOutbound).not.toHaveBeenCalled();
    expect(evolution.send).not.toHaveBeenCalled();
  });

  it('aceita envio automático persistido quando o envelope autoriza a saída', async () => {
    const { subject, repository, evolution } = createSubject();

    await subject.execute(
      event('whatsapp.outbound.requested', {
        attemptId: ids.attempt,
        message: {
          providerMessageId: null,
          direction: 'outbound',
          deliveryStatus: 'pending',
          kind: 'text',
          text: 'Mensagem automática',
          media: null,
          occurredAt: '2026-08-06T12:00:00.000Z',
        },
        automatic: true,
        automationAllowed: false,
        canGenerateReply: false,
        canSendReply: true,
        isFirstContact: false,
      }),
    );

    expect(evolution.send).toHaveBeenCalledOnce();
    expect(repository.completeOutboxExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded' }),
    );
  });
});

it('abre a coleta natural e persiste os dados do áudio antes de responder', async () => {
  const quote = {
    id: '00000000-0000-4000-8000-000000000077',
    sequence: 1,
    status: 'collecting-information',
    version: 1,
  };
  const patchQuoteRequest = vi.fn(async (_company, _id, patch) => ({
    ...quote,
    ...patch,
    version: 2,
  }));
  const { subject, repository, agent, calls } = createSubject({
    repository: {
      transition: vi.fn(async () => {
        calls.push('transition:start-quote');
        return conversation({
          version: 2,
          flowStep: 'quote-data-collection',
          requestStatus: 'collecting-information',
          currentQuoteRequest: quote,
        });
      }),
    },
  });
  Object.assign(repository, { patchQuoteRequest });
  agent.complete.mockResolvedValueOnce({
    provider: 'openai',
    model: 'gpt-5.6-terra',
    attempt: 1,
    output: {
      message: 'Qual sua preferência de veículo?',
      collectionStatus: 'collecting',
      extractedDataPatch: {
        serviceType: 'eventual',
        origin: 'Uberlândia',
        destination: 'Goiânia',
        departureAt: '2026-10-08T09:00:00-03:00',
        returnAt: '2026-10-10T21:00:00-03:00',
        passengerCount: 15,
        structuredData: { tripType: 'round_trip' },
      },
      missingFields: ['vehicleType'],
      summaryPresented: false,
      customerDecision: 'undecided',
    },
  });
  await subject.execute(event());
  expect(repository.transition).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'start-quote', expectedVersion: 1 }),
  );
  expect(patchQuoteRequest).toHaveBeenCalledWith(
    ids.company,
    quote.id,
    expect.objectContaining({
      origin: 'Uberlândia',
      destination: 'Goiânia',
      passengerCount: 15,
      expectedVersion: 1,
      departureAt: new Date('2026-10-08T09:00:00-03:00'),
    }),
  );
  expect(calls.indexOf('transition:start-quote')).toBeLessThan(
    calls.indexOf('create-outbound'),
  );
  expect(repository.createOutbound).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 2 }),
  );
});

it('suprime eventos já enfileirados quando os agentes do canal estão desabilitados', async () => {
  const { subject, agent, repository } = createSubject({
    repository: {
      findWebhookChannel: vi.fn().mockResolvedValue({ agentsEnabled: false }),
    },
  });
  await subject.execute(event());
  expect(agent.complete).not.toHaveBeenCalled();
  expect(agent.classifyContinuity).not.toHaveBeenCalled();
  expect(repository.createOutbound).not.toHaveBeenCalled();
  expect(repository.completeOutboxExecution).toHaveBeenCalled();
});
