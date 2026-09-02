import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type {
  PersistWebhookGroupMessageInput,
  PersistWebhookMessageInput,
} from '../../../application/contracts/whatsapp.repository';
import {
  ConversationState,
  DepartmentCode,
  FlowStep,
  RequestStatus,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const companyId = '00000000-0000-4000-8000-000000000001';
const channelId = '00000000-0000-4000-8000-000000000002';
const contactId = '00000000-0000-4000-8000-000000000003';
const conversationId = '00000000-0000-4000-8000-000000000004';
const threadId = '00000000-0000-4000-8000-000000000005';
const sessionId = '00000000-0000-4000-8000-000000000006';
const messageId = '00000000-0000-4000-8000-000000000007';
const occurredAt = new Date('2026-08-29T12:00:00.000Z');

function directInput(
  direction: 'inbound' | 'outbound',
): PersistWebhookMessageInput {
  return {
    channel: {
      id: channelId,
      companyId,
      instanceName: 'lume',
      webhookSecretHash: 'a'.repeat(64),
      ignoreGroups: false,
      ignoreFromMe: false,
      enabled: true,
    },
    automationEnabled: true,
    externalEventId: 'provider-message-1',
    providerMessageId: 'provider-message-1',
    correlationId: 'evolution:provider-message-1',
    payloadHash: 'b'.repeat(64),
    phoneNormalized: '5534999999999',
    direction,
    occurredAt,
    kind: 'text',
    text: 'Mensagem',
  };
}

function legacyConversation(
  state: ConversationState = ConversationState.BOT_ACTIVE,
) {
  return {
    id: conversationId,
    companyId,
    channelId,
    contactId,
    threadId,
    department: DepartmentCode.COMMERCIAL,
    conversationState: state,
    flowStep:
      state === ConversationState.SENT_TO_HUMAN
        ? FlowStep.HUMAN_SERVICE
        : FlowStep.MAIN_MENU,
    requestStatus: RequestStatus.NOT_STARTED,
    resumeState: null,
    resumeFlowStep: null,
    assignedToUserId: null,
    closedAt: null,
    version: state === ConversationState.SENT_TO_HUMAN ? 2 : 1,
  };
}

function serviceSession(
  controlMode: ServiceSessionControlMode = ServiceSessionControlMode.AI,
) {
  return {
    id: sessionId,
    companyId,
    threadId,
    sourceChannelId: channelId,
    currentDepartmentId: null,
    responsibleUserId: null,
    queueId: null,
    status: ServiceSessionStatus.OPEN,
    controlMode,
    priority: ServiceSessionPriority.NORMAL,
    isForeground: true,
    version: controlMode === ServiceSessionControlMode.AI ? 1 : 2,
    closedAt: null,
    updatedAt: occurredAt,
  };
}

function repositoryWithTransaction(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: Record<string, unknown>) => unknown) =>
        callback(transaction),
    ),
  };
  return new PrismaWhatsAppRepository(
    prisma as never,
    new ConfigService({ WHATSAPP_ENABLED: true }),
  );
}

describe('PrismaWhatsAppRepository dual-write', () => {
  it('resolves registration candidates before publishing the first automatic reply without creating a registration', async () => {
    const participantCreateMany = vi.fn(async () => ({ count: 2 }));
    const outboxCreate = vi.fn(async (_input: unknown) => ({}));
    const registrationCreate = vi.fn();
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      integrationInbox: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'inbox-1' })),
        update: vi.fn(async () => ({})),
      },
      whatsAppMessage: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }) => ({ id: messageId, ...data })),
      },
      whatsAppContact: {
        upsert: vi.fn(async () => ({
          id: contactId,
          phoneNormalized: '5534999999999',
          displayName: 'Contato',
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      whatsAppConversation: {
        findFirst: vi.fn(async () => legacyConversation()),
        findUniqueOrThrow: vi.fn(async () => legacyConversation()),
        update: vi.fn(async () => ({})),
      },
      whatsAppThread: {
        upsert: vi.fn(async () => ({ id: threadId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findFirst: vi.fn(async () => serviceSession()),
      },
      quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
      quoteProposalDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      registrationPhone: {
        findMany: vi.fn(async () => [
          { registrationId: '00000000-0000-4000-8000-000000000020' },
          { registrationId: '00000000-0000-4000-8000-000000000021' },
        ]),
      },
      conversationParticipant: {
        findMany: vi.fn(async () => []),
        createMany: participantCreateMany,
      },
      tenantDepartment: { findUnique: vi.fn(async () => null) },
      integrationOutbox: {
        aggregate: vi.fn(async () => ({ _max: { aggregateSequence: null } })),
        create: outboxCreate,
      },
      registration: { create: registrationCreate },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.persistWebhookMessage(directInput('inbound')),
    ).resolves.toMatchObject({
      automationAllowed: true,
      threadId,
      serviceSessionId: sessionId,
    });
    expect(participantCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          companyId,
          serviceSessionId: sessionId,
          registrationId: '00000000-0000-4000-8000-000000000020',
        }),
        expect.objectContaining({
          companyId,
          serviceSessionId: sessionId,
          registrationId: '00000000-0000-4000-8000-000000000021',
        }),
      ]),
    });
    expect(registrationCreate).not.toHaveBeenCalled();
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          registrationId: expect.anything(),
        }),
      }),
    );
    expect(JSON.stringify(outboxCreate.mock.calls[0]?.[0])).not.toContain(
      '00000000-0000-4000-8000-000000000020',
    );
  });

  it('classifies an unknown fromMe echo as external human and blocks AI with an optimistic session event', async () => {
    const messageCreate = vi.fn(async ({ data }) => ({
      id: messageId,
      ...data,
    }));
    const sessionUpdateMany = vi.fn(async () => ({ count: 1 }));
    const sessionEventCreate = vi.fn(async () => ({}));
    const transitionCreate = vi.fn(async () => ({}));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      integrationInbox: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'inbox-1' })),
        update: vi.fn(async () => ({})),
      },
      whatsAppMessage: {
        findUnique: vi.fn(async () => null),
        create: messageCreate,
      },
      whatsAppContact: {
        upsert: vi.fn(async () => ({
          id: contactId,
          phoneNormalized: '5534999999999',
          displayName: 'Contato',
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      whatsAppConversation: {
        findFirst: vi.fn(async () => legacyConversation()),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce(legacyConversation())
          .mockResolvedValueOnce(
            legacyConversation(ConversationState.SENT_TO_HUMAN),
          ),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
      whatsAppThread: {
        upsert: vi.fn(async () => ({ id: threadId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findFirst: vi.fn(async () => serviceSession()),
        updateMany: sessionUpdateMany,
        findUniqueOrThrow: vi.fn(async () =>
          serviceSession(ServiceSessionControlMode.HUMAN),
        ),
      },
      serviceSessionEvent: { create: sessionEventCreate },
      quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
      quoteProposalDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      whatsAppConversationTransition: { create: transitionCreate },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.persistWebhookMessage(
      directInput('outbound'),
    );

    expect(result).toMatchObject({
      conversationId,
      threadId,
      serviceSessionId: sessionId,
      automationAllowed: false,
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: sessionId,
          companyId,
          version: 1,
        }),
        data: expect.objectContaining({
          controlMode: ServiceSessionControlMode.HUMAN,
        }),
      }),
    );
    expect(sessionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: 'EXTERNAL_HUMAN',
          expectedVersion: 1,
          resultingVersion: 2,
        }),
      }),
    );
    expect(transitionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          threadId,
          serviceSessionId: sessionId,
          name: 'external-human-takeover',
        }),
      }),
    );
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          actorType: 'EXTERNAL_HUMAN',
          source: 'WHATSAPP_APP',
        }),
      }),
    );
  });

  it('replays the provider id inside the same tenant without mutating session state twice', async () => {
    const sessionCreate = vi.fn();
    const transaction = {
      integrationInbox: {
        findUnique: vi.fn(async () => ({ id: 'inbox-1' })),
      },
      whatsAppMessage: {
        findUnique: vi.fn(async ({ where }) => {
          expect(where).toEqual({
            companyId_channelId_providerMessageId: {
              companyId,
              channelId,
              providerMessageId: 'provider-message-1',
            },
          });
          return {
            id: messageId,
            conversationId,
            threadId,
            serviceSessionId: sessionId,
          };
        }),
      },
      serviceSession: { create: sessionCreate },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.persistWebhookMessage(directInput('outbound')),
    ).resolves.toMatchObject({
      duplicate: true,
      threadId,
      serviceSessionId: sessionId,
    });
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('rechecks the human-controlled session inside the Evolution claim transaction', async () => {
    const attemptFind = vi.fn();
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      integrationInbox: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'claim-inbox-1' })),
        update: vi.fn(async () => ({})),
      },
      whatsAppMessage: {
        findUnique: vi.fn(async () => ({
          id: messageId,
          channelId,
          channel: { instanceName: 'lume-channel' },
          conversationId,
          serviceSessionId: sessionId,
          actorUserId: null,
          actorType: 'SYSTEM',
          source: 'AUTOMATION',
          automationPurpose: null,
          direction: 'OUTBOUND',
          deliveryStatus: 'PENDING',
        })),
      },
      whatsAppConversation: {
        findUnique: vi.fn(async () =>
          legacyConversation(ConversationState.SENT_TO_HUMAN),
        ),
      },
      serviceSession: {
        findFirst: vi.fn(async () =>
          serviceSession(ServiceSessionControlMode.HUMAN),
        ),
      },
      whatsAppMessageAttempt: { findUnique: attemptFind },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.claimEvolutionDispatch({
        companyId,
        messageId,
        attemptId: '00000000-0000-4000-8000-000000000008',
        commandId: '00000000-0000-4000-8000-000000000009',
        ownerId: '00000000-0000-4000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(attemptFind).not.toHaveBeenCalled();
  });

  it('returns the tenant-scoped message channel route in an Evolution claim', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000008';
    const claimedAttempt = {
      id: attemptId,
      messageId,
      status: 'PENDING',
      dispatchState: 'READY',
      dispatchClaimId: null,
      dispatchFingerprint: null,
      dispatchClaimedAt: null,
      dispatchLeaseUntil: null,
    };
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      integrationInbox: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      whatsAppMessage: {
        findUnique: vi.fn(async () => ({
          id: messageId,
          channelId,
          channel: { instanceName: 'tenant-channel-a' },
          conversationId,
          serviceSessionId: sessionId,
          actorUserId: null,
          actorType: 'SYSTEM',
          source: 'AUTOMATION',
          automationPurpose: 'quote-proposal',
          direction: 'OUTBOUND',
          deliveryStatus: 'PENDING',
        })),
      },
      whatsAppMessageAttempt: {
        findUnique: vi.fn(async () => claimedAttempt),
        update: vi.fn(async ({ data }) => ({
          ...claimedAttempt,
          ...data,
        })),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.claimEvolutionDispatch({
        companyId,
        messageId,
        attemptId,
        commandId: '00000000-0000-4000-8000-000000000009',
        ownerId: '00000000-0000-4000-8000-000000000010',
      }),
    ).resolves.toMatchObject({
      shouldSend: true,
      sourceChannelId: channelId,
      instanceName: 'tenant-channel-a',
    });
  });

  it('returns the session to AI only after the complete quote batch is delivered', async () => {
    const quoteRequestId = '00000000-0000-4000-8000-000000000020';
    const documentId = '00000000-0000-4000-8000-000000000021';
    const batchId = '00000000-0000-4000-8000-000000000022';
    const actorId = '00000000-0000-4000-8000-000000000023';
    const departmentId = '00000000-0000-4000-8000-000000000024';
    const deliveredConversation = {
      ...legacyConversation(ConversationState.HUMAN_ACTIVE),
      flowStep: FlowStep.QUOTE_SEND_PENDING,
      requestStatus: RequestStatus.UNDER_REVIEW,
      assignedToUserId: actorId,
      version: 7,
    };
    const sessionUpdateMany = vi.fn(async () => ({ count: 1 }));
    const sessionEventCreate = vi.fn(async () => ({}));
    const transitionCreate = vi.fn(async () => ({}));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppConversation: {
        findUniqueOrThrow: vi.fn(async () => deliveredConversation),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      quoteRequest: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: quoteRequestId,
          companyId,
          conversationId,
          threadId,
          serviceSessionId: sessionId,
          status: RequestStatus.UNDER_REVIEW,
          version: 3,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      quoteProposalDocument: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [
          {
            id: documentId,
            messageId,
            providerMessageId: 'provider-quote-1',
            sentAt: occurredAt,
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      whatsAppThread: { upsert: vi.fn(async () => ({ id: threadId })) },
      serviceSession: {
        findFirst: vi.fn(async () => ({
          ...serviceSession(ServiceSessionControlMode.HUMAN),
          responsibleUserId: actorId,
        })),
        updateMany: sessionUpdateMany,
        findUniqueOrThrow: vi.fn(async () => ({
          ...serviceSession(ServiceSessionControlMode.AI),
          status: ServiceSessionStatus.WAITING_CUSTOMER,
          currentDepartmentId: departmentId,
          version: 3,
        })),
      },
      serviceSessionEvent: { create: sessionEventCreate },
      tenantDepartment: {
        findUnique: vi.fn(async () => ({ id: departmentId })),
      },
      whatsAppConversationTransition: { create: transitionCreate },
    };
    const repository = repositoryWithTransaction(transaction);
    const internals = repository as unknown as {
      completeQuoteProposalBatchIfReady(
        client: Record<string, unknown>,
        input: {
          companyId: string;
          conversationId: string;
          quoteRequestId: string;
          triggeringDocumentId: string;
          deliveryBatchId: string;
        },
      ): Promise<void>;
    };

    await internals.completeQuoteProposalBatchIfReady(transaction, {
      companyId,
      conversationId,
      quoteRequestId,
      triggeringDocumentId: documentId,
      deliveryBatchId: batchId,
    });

    expect(sessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: sessionId,
          companyId,
          version: 2,
        }),
        data: expect.objectContaining({
          status: ServiceSessionStatus.WAITING_CUSTOMER,
          controlMode: ServiceSessionControlMode.AI,
          responsibleUserId: null,
        }),
      }),
    );
    expect(sessionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'quote-proposal-delivery-return-to-ai',
          actorType: 'SERVICE',
          expectedVersion: 2,
          resultingVersion: 3,
        }),
      }),
    );
    expect(transitionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId,
          serviceSessionId: sessionId,
          name: 'proposal-delivery-confirmed',
        }),
      }),
    );
  });

  it('stores group messages with AI off and never touches conversation, thread or session delegates', async () => {
    const conversationCreate = vi.fn();
    const threadCreate = vi.fn();
    const sessionCreate = vi.fn();
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppGroupMessage: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: messageId })),
      },
      integrationInbox: {
        create: vi.fn(async () => ({ id: 'group-inbox-1' })),
        update: vi.fn(async () => ({})),
      },
      whatsAppGroup: {
        upsert: vi.fn(async ({ create }) => {
          expect(create.aiMode).toBe('OFF');
          return { id: threadId };
        }),
      },
      registrationPhone: {
        findMany: vi.fn(async () => [
          { registrationId: '00000000-0000-4000-8000-000000000030' },
        ]),
      },
      whatsAppGroupParticipant: {
        upsert: vi.fn(async ({ create }) => {
          expect(create.linkedRegistrationId).toBe(
            '00000000-0000-4000-8000-000000000030',
          );
          return {
            id: contactId,
            whatsappId: 'participant',
          };
        }),
      },
      whatsAppConversation: { create: conversationCreate },
      whatsAppThread: { create: threadCreate },
      serviceSession: { create: sessionCreate },
    };
    const repository = repositoryWithTransaction(transaction);
    const input: PersistWebhookGroupMessageInput = {
      channel: directInput('inbound').channel,
      externalEventId: 'group-provider-1',
      providerMessageId: 'group-provider-1',
      correlationId: 'evolution:group-provider-1',
      payloadHash: 'c'.repeat(64),
      groupWhatsappId: '120363000000000000@g.us',
      participant: {
        whatsappId: '5534999999999@s.whatsapp.net',
        phoneNormalized: '5534999999999',
      },
      direction: 'inbound',
      occurredAt,
      kind: 'text',
      text: 'Grupo',
    };

    await expect(repository.persistWebhookGroupMessage(input)).resolves.toEqual(
      expect.objectContaining({
        conversationId: null,
        threadId: null,
        serviceSessionId: null,
        automationAllowed: false,
      }),
    );
    expect(conversationCreate).not.toHaveBeenCalled();
    expect(threadCreate).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});
