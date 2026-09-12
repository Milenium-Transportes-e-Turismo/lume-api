import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_CONTINUATION_CODE_TTL_MS } from '../../../domain/whatsapp/service-session';
import {
  ContinuityClassification,
  ContinuityFallbackAction,
  ConversationState,
  DeliveryStatus,
  DepartmentCode,
  FlowStep,
  MessageDirection,
  RequestStatus,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
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
const attemptId = '00000000-0000-4000-8000-000000000008';
const now = new Date('2026-08-29T12:00:00.000Z');
const CUSTOMER_CLOSE_DELAY = 3_600_000;
const CUSTOMER_REMINDER_DELAY = 10_800_000;
function lifecycleMessage(patch: Record<string, unknown> = {}) {
  return {
    id: messageId,
    text: 'Qual é a data de saída?',
    direction: MessageDirection.OUTBOUND,
    deliveryStatus: DeliveryStatus.DELIVERED,
    automationPurpose: 'customer-information-reminder',
    createdAt: new Date(now.getTime() - CUSTOMER_CLOSE_DELAY),
    attempts: [],
    ...patch,
  };
}

function session(
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: sessionId,
    companyId,
    threadId,
    sourceChannelId: channelId,
    currentDepartmentId: null,
    responsibleUserId: null,
    queueId: null,
    status: ServiceSessionStatus.OPEN,
    controlMode: ServiceSessionControlMode.AI,
    priority: ServiceSessionPriority.NORMAL,
    priorityReason: null,
    prioritySource: ServiceSessionPrioritySource.SYSTEM,
    isForeground: true,
    version: 1,
    publicContinuationCode: null,
    continuationCodeExpiresAt: null,
    conversationResolved: true,
    pendingActions: [],
    resolutionConfirmedByCustomer: false,
    closingStartedAt: null,
    closingDeadlineAt: null,
    closedAt: null,
    createdAt: new Date('2026-08-29T10:00:00.000Z'),
    updatedAt: new Date('2026-08-29T11:00:00.000Z'),
    ...patch,
  };
}

function conversation(
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: conversationId,
    companyId,
    channelId,
    contactId,
    threadId,
    department: DepartmentCode.COMMERCIAL,
    conversationState: ConversationState.BOT_ACTIVE,
    flowStep: FlowStep.MAIN_MENU,
    requestStatus: RequestStatus.NOT_STARTED,
    resumeState: null,
    resumeFlowStep: null,
    assignedToUserId: null,
    closedAt: null,
    version: 3,
    contact: {
      id: contactId,
      phoneNormalized: '5534999999999',
      displayName: 'Contato',
    },
    channel: { id: channelId, name: 'Canal', phoneNumber: '5534111111111' },
    assignedTo: null,
    quoteRequests: [],
    _count: { quoteRequests: 0 },
    ...patch,
  };
}

function repositoryWithTransaction(
  prisma: Record<string, unknown>,
  transaction: Record<string, unknown> = prisma,
) {
  return new PrismaWhatsAppRepository(
    {
      ...prisma,
      $transaction: vi.fn(
        async (callback: (client: Record<string, unknown>) => unknown) =>
          callback(transaction),
      ),
    } as never,
    new ConfigService({ WHATSAPP_ENABLED: true }),
  );
}

describe('PrismaWhatsAppRepository service-session lifecycle', () => {
  it('persists a structured AI resolution in the outbound transaction with CAS and attribution', async () => {
    const unresolved = session({ conversationResolved: false, version: 3 });
    const resolved = session({ conversationResolved: true, version: 4 });
    const agentId = '00000000-0000-4000-8000-000000000091';
    const agentExecutionId = '00000000-0000-4000-8000-000000000092';
    const serviceSessionEventCreate = vi.fn(async () => ({}));
    const messageCreate = vi.fn(async ({ data }) => ({
      id: messageId,
      actorUserId: null,
      providerMessageId: null,
      mediaAssetId: null,
      media: null,
      automationPurpose: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    }));
    const attempt = {
      id: attemptId,
      attemptNumber: 1,
      status: 'PENDING',
      providerMessageId: null,
      errorCode: null,
      errorMessage: null,
      dispatchClaimId: null,
      dispatchFingerprint: null,
      dispatchClaimedAt: null,
      dispatchState: 'READY',
      dispatchOwnerId: null,
      dispatchLeaseUntil: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
    };
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      integrationInbox: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      whatsAppConversation: {
        findUnique: vi.fn(async () => conversation()),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      whatsAppThread: {
        upsert: vi.fn(async () => ({ id: threadId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findFirst: vi.fn(async () => unresolved),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => resolved),
      },
      serviceSessionEvent: { create: serviceSessionEventCreate },
      quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
      quoteProposalDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      agentExecution: {
        findFirst: vi.fn(async () => ({ id: agentExecutionId, agentId })),
      },
      whatsAppMessage: { create: messageCreate },
      whatsAppMessageAttempt: {
        create: vi.fn(async () => attempt),
      },
    };
    const repository = repositoryWithTransaction({}, transaction);

    await repository.createOutbound({
      companyId,
      conversationId,
      commandId: '00000000-0000-4000-8000-000000000093',
      expectedVersion: 3,
      automatic: true,
      actorAgentId: agentId,
      agentExecutionId,
      conversationResolved: true,
      kind: 'text',
      text: 'Sua solicitação foi resolvida.',
    });

    expect(transaction.serviceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: sessionId,
          companyId,
          version: 3,
        }),
        data: expect.objectContaining({
          conversationResolved: true,
          version: { increment: 1 },
        }),
      }),
    );
    expect(serviceSessionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'ai-conversation-resolved',
          actorAgentId: agentId,
          expectedVersion: 3,
          resultingVersion: 4,
          metadata: expect.objectContaining({
            messageId,
            agentExecutionId,
            signal: 'structured-ai-completed',
          }),
        }),
      }),
    );
  });

  it('reinforces the pending question after three hours and starts a one-hour customer deadline', async () => {
    const closing = session({
      status: ServiceSessionStatus.CLOSING,
      version: 2,
      closingStartedAt: now,
      closingDeadlineAt: new Date(now.getTime() + CUSTOMER_CLOSE_DELAY),
    });
    const messageCreate = vi.fn(async ({ data }) => ({
      id: messageId,
      ...data,
    }));
    const outboxCreate = vi.fn(async () => ({}));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppConversation: {
        findFirst: vi.fn(async () => conversation()),
        findUnique: vi.fn(async () => conversation()),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findUnique: vi.fn(async () => session()),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => closing),
      },
      whatsAppMessage: {
        findFirst: vi.fn(async () =>
          lifecycleMessage({
            automationPurpose: 'customer-information-request',
            createdAt: new Date(now.getTime() - CUSTOMER_REMINDER_DELAY),
          }),
        ),
        count: vi.fn(async () => 0),
        create: messageCreate,
      },
      quoteRequest: { count: vi.fn(async () => 0) },
      quoteProposalDocument: { count: vi.fn(async () => 0) },
      serviceSessionEvent: { create: vi.fn(async () => ({})) },
      whatsAppMessageAttempt: {
        create: vi.fn(async () => ({ id: attemptId })),
      },
      integrationOutbox: {
        aggregate: vi.fn(async () => ({ _max: { aggregateSequence: null } })),
        create: outboxCreate,
      },
    };
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: sessionId, companyId, threadId }]),
      serviceSession: { findMany: vi.fn(async () => []) },
    };
    const repository = repositoryWithTransaction(prisma, transaction);

    await expect(
      repository.processServiceSessionLifecycle({ now, limit: 1 }),
    ).resolves.toEqual({ closingStarted: 1, closed: 0, skipped: 0 });
    expect(transaction.serviceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          version: 1,
        }),
        data: expect.objectContaining({
          status: ServiceSessionStatus.CLOSING,
          closingStartedAt: now,
          closingDeadlineAt: new Date(now.getTime() + CUSTOMER_CLOSE_DELAY),
        }),
      }),
    );
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceSessionId: sessionId,
          text: 'Quando puder, me responda para continuarmos:\n\nQual é a data de saída?',
          automationPurpose: 'customer-information-reminder',
          deliveryStatus: DeliveryStatus.PENDING,
        }),
      }),
    );
    expect(messageCreate.mock.invocationCallOrder[0]).toBeLessThan(
      outboxCreate.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('closes a due session with a tenant-scoped three-digit code valid for exactly seven days', async () => {
    const due = session({
      status: ServiceSessionStatus.CLOSING,
      closingStartedAt: new Date(now.getTime() - CUSTOMER_CLOSE_DELAY),
      closingDeadlineAt: now,
      version: 4,
    });
    const closed = session({
      status: ServiceSessionStatus.CLOSED,
      isForeground: false,
      conversationResolved: true,
      closingStartedAt: null,
      closingDeadlineAt: null,
      closedAt: now,
      publicContinuationCode: '845',
      continuationCodeExpiresAt: new Date(
        now.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS,
      ),
      version: 5,
    });
    const closedConversation = conversation({
      conversationState: ConversationState.CLOSED,
      flowStep: FlowStep.CLOSED,
      closedAt: now,
      version: 4,
    });
    const sessionUpdate = vi.fn(
      async (_input: { data: Record<string, unknown> }) => ({ count: 1 }),
    );
    const messageCreate = vi.fn(async ({ data }) => ({
      id: messageId,
      ...data,
    }));
    const outboxCreate = vi.fn(async () => ({}));
    const serviceSessionFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: sessionId, companyId, threadId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppConversation: {
        findFirst: vi.fn(async () => conversation()),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(conversation())
          .mockResolvedValueOnce(closedConversation),
      },
      serviceSession: {
        findUnique: vi.fn(async () => due),
        findMany: serviceSessionFindMany,
        updateMany: sessionUpdate,
        findUniqueOrThrow: vi.fn(async () => closed),
      },
      whatsAppMessage: {
        findFirst: vi.fn(async () => ({
          ...lifecycleMessage(),
        })),
        create: messageCreate,
      },
      quoteRequest: { count: vi.fn(async () => 0) },
      quoteProposalDocument: { count: vi.fn(async () => 0) },
      serviceSessionEvent: { create: vi.fn(async () => ({})) },
      whatsAppConversationTransition: { create: vi.fn(async () => ({})) },
      whatsAppMessageAttempt: {
        create: vi.fn(async () => ({ id: attemptId })),
      },
      integrationOutbox: {
        aggregate: vi.fn(async () => ({ _max: { aggregateSequence: 2 } })),
        create: outboxCreate,
      },
    };
    const repository = repositoryWithTransaction(
      { serviceSession: { findMany: serviceSessionFindMany } },
      transaction,
    );

    await expect(
      repository.processServiceSessionLifecycle({ now, limit: 1 }),
    ).resolves.toEqual({ closingStarted: 0, closed: 1, skipped: 0 });
    const closingUpdate = sessionUpdate.mock.calls[0]?.[0];
    expect(closingUpdate?.data.publicContinuationCode).toMatch(/^\d{3}$/u);
    expect(closingUpdate?.data.continuationCodeExpiresAt).toEqual(
      new Date(now.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS),
    );
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          automationPurpose: 'service-session-closure',
          text: expect.stringMatching(/CONTINUAR \d{3}/u),
        }),
      }),
    );
    expect(messageCreate.mock.invocationCallOrder[0]).toBeLessThan(
      outboxCreate.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('resumes the linked priority predecessor instead of closing the shared conversation', async () => {
    const predecessorSessionId = '00000000-0000-4000-8000-000000000020';
    const predecessorDepartmentId = '00000000-0000-4000-8000-000000000021';
    const predecessorUserId = '00000000-0000-4000-8000-000000000022';
    const predecessorQueueId = '00000000-0000-4000-8000-000000000023';
    const due = session({
      status: ServiceSessionStatus.CLOSING,
      priority: ServiceSessionPriority.URGENT,
      closingStartedAt: new Date(now.getTime() - CUSTOMER_CLOSE_DELAY),
      closingDeadlineAt: now,
      version: 4,
    });
    const closed = session({
      status: ServiceSessionStatus.CLOSED,
      priority: ServiceSessionPriority.URGENT,
      isForeground: false,
      closingStartedAt: null,
      closingDeadlineAt: null,
      closedAt: now,
      publicContinuationCode: '845',
      continuationCodeExpiresAt: new Date(
        now.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS,
      ),
      version: 5,
    });
    const pausedPredecessor = session({
      id: predecessorSessionId,
      currentDepartmentId: predecessorDepartmentId,
      responsibleUserId: predecessorUserId,
      queueId: predecessorQueueId,
      status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
      controlMode: ServiceSessionControlMode.HUMAN,
      priority: ServiceSessionPriority.HIGH,
      isForeground: false,
      conversationResolved: false,
      version: 7,
      queue: { priorityWeight: 25 },
      currentDepartment: { serviceQueues: [{ priorityWeight: 25 }] },
    });
    const resumedPredecessor = session({
      id: predecessorSessionId,
      currentDepartmentId: predecessorDepartmentId,
      responsibleUserId: predecessorUserId,
      queueId: predecessorQueueId,
      status: ServiceSessionStatus.OPEN,
      controlMode: ServiceSessionControlMode.HUMAN,
      priority: ServiceSessionPriority.HIGH,
      isForeground: true,
      conversationResolved: false,
      version: 8,
    });
    const resumedConversation = conversation({
      department: DepartmentCode.FINANCIAL,
      conversationState: ConversationState.HUMAN_ACTIVE,
      flowStep: FlowStep.HUMAN_SERVICE,
      assignedToUserId: predecessorUserId,
      version: 4,
    });
    const sessionUpdate = vi.fn(async () => ({ count: 1 }));
    const sessionEventCreate = vi.fn(async () => ({}));
    const conversationUpdate = vi.fn(async () => ({ count: 1 }));
    const transitionCreate = vi.fn(async () => ({}));
    const messageCreate = vi.fn(async () => ({}));
    const auditCreate = vi.fn(async () => ({}));
    const serviceSessionFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: sessionId, companyId, threadId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pausedPredecessor]);
    const executeRaw = vi.fn(async () => 1);
    const transaction = {
      $executeRaw: executeRaw,
      whatsAppConversation: {
        findFirst: vi.fn(async () => conversation()),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(conversation())
          .mockResolvedValueOnce(resumedConversation),
        updateMany: conversationUpdate,
      },
      serviceSession: {
        findUnique: vi.fn(async () => due),
        findMany: serviceSessionFindMany,
        updateMany: sessionUpdate,
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce(closed)
          .mockResolvedValueOnce(resumedPredecessor),
      },
      serviceSessionEvent: {
        findMany: vi.fn(async () => [
          {
            serviceSessionId: predecessorSessionId,
            beforeSnapshot: { status: 'open' },
            metadata: { interruptedBySessionId: sessionId },
            createdAt: new Date(now.getTime() - 45 * 60 * 1_000),
          },
        ]),
        create: sessionEventCreate,
      },
      whatsAppMessage: {
        findFirst: vi.fn(async () => ({
          ...lifecycleMessage(),
        })),
        create: messageCreate,
      },
      quoteRequest: { count: vi.fn(async () => 0) },
      quoteProposalDocument: { count: vi.fn(async () => 0) },
      tenantDepartment: {
        findFirst: vi.fn(async () => ({ code: DepartmentCode.FINANCIAL })),
      },
      tenantAuditLog: { create: auditCreate },
      whatsAppConversationTransition: { create: transitionCreate },
    };
    const repository = repositoryWithTransaction(
      { serviceSession: { findMany: serviceSessionFindMany } },
      transaction,
    );

    await expect(
      repository.processServiceSessionLifecycle({ now, limit: 1 }),
    ).resolves.toEqual({ closingStarted: 0, closed: 1, skipped: 0 });

    expect(executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      `${companyId}:service-session-thread:${threadId}`,
    );
    expect(sessionUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: sessionId,
          companyId,
          version: 4,
        }),
        data: expect.objectContaining({
          status: ServiceSessionStatus.CLOSED,
          isForeground: false,
          publicContinuationCode: expect.stringMatching(/^\d{3}$/u),
        }),
      }),
    );
    expect(sessionUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: predecessorSessionId,
          companyId,
          threadId,
          version: 7,
          status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
          isForeground: false,
        }),
        data: {
          status: ServiceSessionStatus.OPEN,
          isForeground: true,
          version: { increment: 1 },
        },
      }),
    );
    expect(sessionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          serviceSessionId: predecessorSessionId,
          name: 'priority-resumed',
          expectedVersion: 7,
          resultingVersion: 8,
          metadata: expect.objectContaining({
            resumedAfterSessionId: sessionId,
            restoredStatus: 'open',
          }),
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          action: 'service-session.priority-resumed',
          targetId: predecessorSessionId,
        }),
      }),
    );
    expect(conversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: conversationId,
          companyId,
          threadId,
          version: 3,
        }),
        data: expect.objectContaining({
          department: DepartmentCode.FINANCIAL,
          conversationState: ConversationState.HUMAN_ACTIVE,
          flowStep: FlowStep.HUMAN_SERVICE,
          assignedToUserId: predecessorUserId,
          closedAt: null,
        }),
      }),
    );
    expect(transitionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'priority-resumed',
          serviceSessionId: predecessorSessionId,
          fromState: ConversationState.BOT_ACTIVE,
          toState: ConversationState.HUMAN_ACTIVE,
        }),
      }),
    );
    expect(messageCreate).not.toHaveBeenCalled();
  });
});

interface FoundationInvoker {
  ensureFoundationForConversation(
    transaction: Record<string, unknown>,
    conversation: Record<string, unknown>,
    options: {
      commandSeed: string;
      occurredAt: Date;
      direction: MessageDirection;
      desiredConversationState: ConversationState;
      messageText?: string;
    },
  ): Promise<{ threadId: string; session: Record<string, unknown> }>;
}

describe('PrismaWhatsAppRepository service continuity', () => {
  it('exposes only the exact pending fallback decision for silent classification', async () => {
    const currentDepartmentId = '00000000-0000-4000-8000-000000000020';
    const source = session({
      currentDepartmentId,
      version: 8,
      conversationResolved: false,
    });
    const prisma = {
      whatsAppMessage: {
        findUnique: vi.fn(async () => ({
          id: messageId,
          companyId,
          conversationId,
          serviceSessionId: sessionId,
          direction: MessageDirection.INBOUND,
          kind: 'TEXT',
          text: 'Agora preciso de uma cotação.',
          occurredAt: now,
        })),
        findMany: vi.fn(async () => [
          {
            direction: MessageDirection.INBOUND,
            text: 'Assunto anterior.',
            occurredAt: new Date(now.getTime() - 30 * 60 * 1_000),
          },
        ]),
      },
      serviceSessionContinuityDecision: {
        findFirst: vi.fn(async () => ({
          id: '00000000-0000-4000-8000-000000000021',
          sourceServiceSessionId: sessionId,
        })),
      },
      serviceSession: { findUnique: vi.fn(async () => source) },
      tenantDepartment: {
        findMany: vi.fn(async () => [
          {
            id: currentDepartmentId,
            code: DepartmentCode.COMMERCIAL,
            name: 'Comercial',
          },
        ]),
      },
    };
    const repository = repositoryWithTransaction(prisma);

    await expect(
      repository.getPendingContinuityClassification(
        companyId,
        conversationId,
        'evolution:source-1',
      ),
    ).resolves.toEqual({
      decisionId: '00000000-0000-4000-8000-000000000021',
      sourceServiceSessionId: sessionId,
      expectedVersion: 8,
      currentDepartmentId,
      previousMessages: [
        {
          direction: 'inbound',
          text: 'Assunto anterior.',
          occurredAt: '2026-08-29T11:30:00.000Z',
        },
      ],
      userMessage: 'Agora preciso de uma cotação.',
      allowedTargetDepartments: [
        { id: currentDepartmentId, code: 'commercial', name: 'Comercial' },
      ],
    });
    expect(
      prisma.serviceSessionContinuityDecision.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          sourceServiceSessionId: sessionId,
          targetServiceSessionId: sessionId,
          classification: ContinuityClassification.UNCERTAIN,
          fallbackAction: ContinuityFallbackAction.REOPEN_PREVIOUS,
          createdAt: now,
        }),
      }),
    );
  });

  it('atomically closes the prior session and relates a new subject before automation', async () => {
    const decisionId = '00000000-0000-4000-8000-000000000021';
    const currentDepartmentId = '00000000-0000-4000-8000-000000000022';
    const agentId = '00000000-0000-4000-8000-000000000023';
    const agentExecutionId = '00000000-0000-4000-8000-000000000024';
    const targetSessionId = '00000000-0000-4000-8000-000000000025';
    const source = session({
      currentDepartmentId,
      version: 8,
      conversationResolved: false,
    });
    const closed = session({
      currentDepartmentId,
      version: 9,
      status: ServiceSessionStatus.CLOSED,
      isForeground: false,
      closedAt: now,
    });
    const target = session({
      id: targetSessionId,
      currentDepartmentId,
      relatedServiceSessionId: sessionId,
      version: 1,
      conversationResolved: false,
    });
    const eventCreate = vi.fn(async () => ({}));
    const participantCreateMany = vi.fn(async () => ({ count: 1 }));
    const messageUpdateMany = vi.fn(async () => ({ count: 1 }));
    const continuityUpdateMany = vi.fn(async () => ({ count: 1 }));
    const sessionCreate = vi.fn(async () => target);
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      serviceSessionEvent: {
        findUnique: vi.fn(async () => null),
        create: eventCreate,
      },
      whatsAppConversation: {
        findUnique: vi.fn(async () => conversation()),
      },
      serviceSessionContinuityDecision: {
        findUnique: vi.fn(async () => ({
          id: decisionId,
          companyId,
          sourceServiceSessionId: sessionId,
          targetServiceSessionId: sessionId,
          targetDepartmentId: currentDepartmentId,
          agentExecutionId: null,
          classification: ContinuityClassification.UNCERTAIN,
          fallbackAction: ContinuityFallbackAction.REOPEN_PREVIOUS,
          confidence: null,
          reason: 'fallback seguro',
          commandId: 'continuity-seed',
          createdAt: now,
        })),
        updateMany: continuityUpdateMany,
      },
      whatsAppMessage: {
        findUnique: vi.fn(async () => ({
          conversationId,
          serviceSessionId: sessionId,
          direction: MessageDirection.INBOUND,
          occurredAt: now,
        })),
        updateMany: messageUpdateMany,
      },
      serviceSession: {
        findUnique: vi.fn(async () => source),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => closed),
        create: sessionCreate,
      },
      agentExecution: {
        findFirst: vi.fn(async () => ({
          id: agentExecutionId,
          status: 'SUCCEEDED',
        })),
      },
      tenantDepartment: {
        findFirst: vi.fn(async () => ({
          id: currentDepartmentId,
          code: DepartmentCode.COMMERCIAL,
        })),
      },
      whatsAppChannelAutomaticTargetDepartment: { findFirst: vi.fn() },
      whatsAppConversationTransition: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({})),
      },
      conversationParticipant: {
        findMany: vi.fn(async () => [
          {
            whatsappContactId: contactId,
            registrationId: null,
            role: 'UNKNOWN',
            isPrimary: false,
            confidence: null,
            identificationSource: 'phone-match',
            confirmedByUserId: null,
            confirmedAt: null,
            metadata: {},
          },
        ]),
        createMany: participantCreateMany,
      },
    };
    const repository = repositoryWithTransaction({}, transaction);

    await expect(
      repository.applyContinuityClassification({
        companyId,
        conversationId,
        sourceEventId: 'evolution:source-1',
        decisionId,
        commandId: '00000000-0000-5000-8000-000000000026',
        expectedVersion: 8,
        classification: 'new-subject',
        confidence: 0.93,
        reason: 'A cotação é um assunto independente.',
        targetDepartmentId: currentDepartmentId,
        actorAgentId: agentId,
        agentExecutionId,
      }),
    ).resolves.toEqual({
      serviceSessionId: targetSessionId,
      version: 1,
      classification: 'new-subject',
      idempotent: false,
    });
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          threadId,
          sourceChannelId: channelId,
          relatedServiceSessionId: sessionId,
          currentDepartmentId,
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.AI,
        }),
      }),
    );
    expect(messageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          conversationId,
          serviceSessionId: sessionId,
        }),
        data: { serviceSessionId: targetSessionId },
      }),
    );
    expect(participantCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            companyId,
            serviceSessionId: targetSessionId,
            whatsappContactId: contactId,
          }),
        ],
      }),
    );
    expect(continuityUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetServiceSessionId: targetSessionId,
          targetDepartmentId: currentDepartmentId,
          agentExecutionId,
          classification: ContinuityClassification.NEW_SUBJECT,
          fallbackAction: ContinuityFallbackAction.CREATE_NEW,
          confidence: 0.93,
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'continuity-classified-new-subject',
          expectedVersion: 8,
          resultingVersion: 9,
          actorAgentId: agentId,
        }),
      }),
    );
  });

  it('cancels a formal closing on inbound before the message is persisted', async () => {
    const closing = session({
      status: ServiceSessionStatus.CLOSING,
      closingStartedAt: new Date(now.getTime() - 5 * 60 * 1_000),
      closingDeadlineAt: new Date(now.getTime() + 25 * 60 * 1_000),
      version: 2,
    });
    const reopened = session({
      conversationResolved: false,
      version: 3,
    });
    const eventCreate = vi.fn(async () => ({}));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppThread: {
        upsert: vi.fn(async () => ({ id: threadId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      whatsAppConversation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findFirst: vi.fn(async () => closing),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => reopened),
      },
      serviceSessionEvent: { create: eventCreate },
      quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
      quoteProposalDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const repository = repositoryWithTransaction({}, transaction);

    const result = await (
      repository as unknown as FoundationInvoker
    ).ensureFoundationForConversation(transaction, conversation(), {
      commandSeed: 'customer-reply',
      occurredAt: now,
      direction: MessageDirection.INBOUND,
      desiredConversationState: ConversationState.BOT_ACTIVE,
      messageText: 'Sim, mais uma coisa',
    });

    expect(result.session).toMatchObject({
      status: ServiceSessionStatus.OPEN,
      conversationResolved: false,
      closingStartedAt: null,
      closingDeadlineAt: null,
      version: 3,
    });
    expect(transaction.serviceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 2 }),
        data: expect.objectContaining({
          status: ServiceSessionStatus.OPEN,
          conversationResolved: false,
          closingStartedAt: null,
          closingDeadlineAt: null,
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'customer-replied-during-ai-closing',
          expectedVersion: 2,
          resultingVersion: 3,
        }),
      }),
    );
  });

  it('resets an open AI resolution when the customer sends a new message', async () => {
    const resolved = session({ conversationResolved: true, version: 4 });
    const reset = session({ conversationResolved: false, version: 5 });
    const eventCreate = vi.fn(async () => ({}));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      whatsAppThread: {
        upsert: vi.fn(async () => ({ id: threadId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      whatsAppConversation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      serviceSession: {
        findFirst: vi.fn(async () => resolved),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => reset),
      },
      serviceSessionEvent: { create: eventCreate },
      quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
      quoteProposalDocument: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const repository = repositoryWithTransaction({}, transaction);

    const result = await (
      repository as unknown as FoundationInvoker
    ).ensureFoundationForConversation(transaction, conversation(), {
      commandSeed: 'customer-new-message',
      occurredAt: now,
      direction: MessageDirection.INBOUND,
      desiredConversationState: ConversationState.BOT_ACTIVE,
      messageText: 'Agora tenho outro pedido',
    });

    expect(result.session).toMatchObject({
      status: ServiceSessionStatus.OPEN,
      conversationResolved: false,
      version: 5,
    });
    expect(transaction.serviceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          version: 4,
        }),
        data: expect.objectContaining({
          conversationResolved: false,
          resolutionConfirmedByCustomer: false,
          version: { increment: 1 },
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'customer-message-reset-ai-resolution',
          expectedVersion: 4,
          resultingVersion: 5,
        }),
      }),
    );
  });

  it('blocks the stale formal question claim after inbound reopened the session', async () => {
    const attemptFind = vi.fn();
    const open = session({ conversationResolved: false, version: 3 });
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
          channel: { instanceName: 'lume-channel' },
          conversationId,
          serviceSessionId: sessionId,
          actorUserId: null,
          actorType: 'SYSTEM',
          source: 'AUTOMATION',
          automationPurpose: 'service-session-closing-question',
          direction: 'OUTBOUND',
          deliveryStatus: 'PENDING',
        })),
      },
      serviceSession: { findUnique: vi.fn(async () => open) },
      whatsAppMessageAttempt: { findUnique: attemptFind },
    };
    const repository = repositoryWithTransaction({}, transaction);

    await expect(
      repository.claimEvolutionDispatch({
        companyId,
        messageId,
        attemptId,
        commandId: '00000000-0000-4000-8000-000000000009',
        ownerId: '00000000-0000-4000-8000-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(attemptFind).not.toHaveBeenCalled();
  });

  it('reopens the latest session on the safe uncertain fallback inside two hours', async () => {
    const previous = session({
      status: ServiceSessionStatus.CLOSED,
      isForeground: false,
      conversationResolved: true,
      closedAt: new Date(now.getTime() - 60 * 60 * 1_000),
      publicContinuationCode: '845',
      continuationCodeExpiresAt: new Date(
        now.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS,
      ),
      version: 7,
    });
    const reopened = session({ version: 8, conversationResolved: false });
    const continuityCreate = vi.fn(async () => ({}));
    const transaction = foundationTransaction({
      findFirstResults: [null, previous],
      reopened,
      continuityCreate,
    });
    const repository = repositoryWithTransaction({}, transaction);

    const result = await (
      repository as unknown as FoundationInvoker
    ).ensureFoundationForConversation(transaction, conversation(), {
      commandSeed: 'inbound-1',
      occurredAt: now,
      direction: MessageDirection.INBOUND,
      desiredConversationState: ConversationState.BOT_ACTIVE,
      messageText: 'Tenho outra dúvida',
    });

    expect(result.session.id).toBe(sessionId);
    expect(continuityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          sourceServiceSessionId: sessionId,
          targetServiceSessionId: sessionId,
          classification: ContinuityClassification.UNCERTAIN,
          fallbackAction: ContinuityFallbackAction.REOPEN_PREVIOUS,
        }),
      }),
    );
  });

  it('creates a new session after two hours and never relates it without an AI justification', async () => {
    const previous = session({
      status: ServiceSessionStatus.CLOSED,
      isForeground: false,
      closedAt: new Date(now.getTime() - 2 * 60 * 60 * 1_000 - 1),
      version: 3,
    });
    const newSessionId = '00000000-0000-4000-8000-000000000099';
    const created = session({ id: newSessionId, version: 1 });
    const continuityCreate = vi.fn(async () => ({}));
    const transaction = foundationTransaction({
      findFirstResults: [null, previous],
      created,
      continuityCreate,
    });
    const repository = repositoryWithTransaction({}, transaction);

    const result = await (
      repository as unknown as FoundationInvoker
    ).ensureFoundationForConversation(transaction, conversation(), {
      commandSeed: 'inbound-2',
      occurredAt: now,
      direction: MessageDirection.INBOUND,
      desiredConversationState: ConversationState.BOT_ACTIVE,
      messageText: 'Novo tema',
    });

    expect(result.session.id).toBe(newSessionId);
    expect(transaction.serviceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          relatedServiceSessionId: expect.anything(),
        }),
      }),
    );
    expect(continuityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classification: ContinuityClassification.NEW_SUBJECT,
          fallbackAction: ContinuityFallbackAction.CREATE_NEW,
          sourceServiceSessionId: sessionId,
          targetServiceSessionId: newSessionId,
        }),
      }),
    );
  });

  it('looks up a public code only inside the same tenant/thread and reopens the matching session', async () => {
    const previous = session({
      status: ServiceSessionStatus.CLOSED,
      isForeground: false,
      closedAt: new Date(now.getTime() - 3 * 60 * 60 * 1_000),
      publicContinuationCode: '845',
      continuationCodeExpiresAt: new Date(now.getTime() + 1_000),
      version: 5,
    });
    const continuityCreate = vi.fn(async () => ({}));
    const transaction = foundationTransaction({
      findFirstResults: [null, previous],
      reopened: session({ version: 6 }),
      continuityCreate,
    });
    const repository = repositoryWithTransaction({}, transaction);

    await (
      repository as unknown as FoundationInvoker
    ).ensureFoundationForConversation(transaction, conversation(), {
      commandSeed: 'inbound-3',
      occurredAt: now,
      direction: MessageDirection.INBOUND,
      desiredConversationState: ConversationState.BOT_ACTIVE,
      messageText: 'CONTINUAR 845',
    });

    expect(transaction.serviceSession.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId,
          threadId,
          publicContinuationCode: '845',
          status: ServiceSessionStatus.CLOSED,
        }),
      }),
    );
    expect(continuityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classification: ContinuityClassification.CONTINUATION,
          fallbackAction: null,
        }),
      }),
    );
  });
});

function foundationTransaction(input: {
  findFirstResults: readonly (Record<string, unknown> | null)[];
  reopened?: Record<string, unknown>;
  created?: Record<string, unknown>;
  continuityCreate: ReturnType<typeof vi.fn>;
}) {
  const findFirst = vi.fn();
  for (const result of input.findFirstResults) {
    findFirst.mockResolvedValueOnce(result);
  }
  return {
    $executeRaw: vi.fn(async () => 1),
    whatsAppThread: {
      upsert: vi.fn(async () => ({ id: threadId })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    whatsAppConversation: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    serviceSession: {
      findFirst,
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => input.reopened ?? input.created),
      create: vi.fn(async () => input.created),
    },
    tenantDepartment: { findUnique: vi.fn(async () => null) },
    serviceSessionEvent: { create: vi.fn(async () => ({})) },
    serviceSessionContinuityDecision: { create: input.continuityCreate },
    quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
    quoteProposalDocument: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}
