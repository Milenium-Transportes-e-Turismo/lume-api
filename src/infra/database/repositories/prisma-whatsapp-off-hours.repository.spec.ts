import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentExecutionStatus,
  ConversationState,
  DepartmentCode,
  FlowStep,
  MutationActorType,
  RequestStatus,
  ServiceAssignmentSource,
  ServiceAssignmentStatus,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  channel: '00000000-0000-4000-8000-000000000002',
  contact: '00000000-0000-4000-8000-000000000003',
  conversation: '00000000-0000-4000-8000-000000000004',
  thread: '00000000-0000-4000-8000-000000000005',
  session: '00000000-0000-4000-8000-000000000006',
  department: '00000000-0000-4000-8000-000000000007',
  queue: '00000000-0000-4000-8000-000000000008',
  message: '00000000-0000-4000-8000-000000000009',
  attempt: '00000000-0000-4000-8000-000000000010',
  agent: '00000000-0000-4000-8000-000000000011',
  execution: '00000000-0000-4000-8000-000000000012',
};

const occurredAt = new Date('2026-08-30T15:00:00.000Z'); // Sunday in São Paulo.

function conversation(
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const createdAt = new Date('2026-08-29T12:00:00.000Z');
  return {
    id: ids.conversation,
    companyId: ids.company,
    channelId: ids.channel,
    contactId: ids.contact,
    threadId: ids.thread,
    department: DepartmentCode.COMMERCIAL,
    conversationState: ConversationState.BOT_ACTIVE,
    flowStep: FlowStep.MAIN_MENU,
    requestStatus: RequestStatus.NOT_STARTED,
    resumeState: null,
    resumeFlowStep: null,
    assignedToUserId: null,
    mainMenuPresentedAt: createdAt,
    followUpMenuPresentedAt: null,
    contextualFollowUpAt: null,
    departmentContactOption: null,
    unreadCount: 1,
    lastInboundAt: createdAt,
    lastOutboundAt: null,
    lastMessagePreview: 'Preciso falar com alguém.',
    closedAt: null,
    archivedAt: null,
    archiveReason: null,
    archivedByUserId: null,
    archiveExemptedAt: null,
    version: 3,
    createdAt,
    updatedAt: createdAt,
    contact: {
      id: ids.contact,
      phoneNormalized: '5534999999999',
      phoneDisplay: '+55 34 99999-9999',
      displayName: 'Cliente',
      profilePictureUrl: null,
    },
    channel: {
      id: ids.channel,
      name: 'Canal principal',
      phoneNumber: '5534111111111',
    },
    assignedTo: null,
    quoteRequests: [],
    _count: { quoteRequests: 0 },
    ...patch,
  };
}

function session(
  patch: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const createdAt = new Date('2026-08-29T12:00:00.000Z');
  return {
    id: ids.session,
    companyId: ids.company,
    threadId: ids.thread,
    sourceChannelId: ids.channel,
    currentDepartmentId: ids.department,
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
    conversationResolved: false,
    pendingActions: [],
    resolutionConfirmedByCustomer: false,
    closingStartedAt: null,
    closingDeadlineAt: null,
    offHoursHandoffNotifiedAt: null,
    closedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function createHarness(input?: { alreadyNotified?: boolean }) {
  const notificationAt = input?.alreadyNotified
    ? new Date('2026-08-29T15:00:00.000Z')
    : null;
  const initialConversation = conversation();
  const updatedConversation = conversation({
    conversationState: ConversationState.SENT_TO_HUMAN,
    flowStep: FlowStep.HUMAN_SERVICE,
    resumeFlowStep: FlowStep.MAIN_MENU,
    lastOutboundAt: input?.alreadyNotified ? null : occurredAt,
    lastMessagePreview: input?.alreadyNotified
      ? 'Preciso falar com alguém.'
      : 'Recebemos sua solicitação e retornaremos no próximo período.',
    version: 4,
    updatedAt: occurredAt,
  });
  const initialSession = session({
    offHoursHandoffNotifiedAt: notificationAt,
  });
  const updatedSession = session({
    queueId: ids.queue,
    status: ServiceSessionStatus.WAITING_HUMAN,
    controlMode: ServiceSessionControlMode.HUMAN,
    priority: ServiceSessionPriority.HIGH,
    priorityReason: 'Cliente pediu atendimento humano.',
    prioritySource: ServiceSessionPrioritySource.AI_AGENT,
    version: 2,
    offHoursHandoffNotifiedAt: notificationAt ?? occurredAt,
    updatedAt: occurredAt,
  });
  const messageCreate = vi.fn(async ({ data }) => ({
    id: ids.message,
    ...data,
  }));
  const outboxCreate = vi.fn(async () => ({}));
  const sessionUpdate = vi.fn(async () => ({ count: 1 }));
  const eventCreate = vi.fn(async () => ({}));
  const auditCreate = vi.fn(async () => ({}));
  const assignmentCreate = vi.fn(async () => ({}));
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    whatsAppConversationTransition: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    whatsAppConversation: {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(initialConversation)
        .mockResolvedValueOnce(updatedConversation),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    quoteProposalDocument: { findFirst: vi.fn(async () => null) },
    tenantDepartment: {
      findUnique: vi.fn(async () => ({
        id: ids.department,
        code: DepartmentCode.COMMERCIAL,
        humanServiceHoursOverride: {
          timeZone: 'America/Sao_Paulo',
          weekly: { 1: [{ start: '08:00', end: '18:00' }] },
          holidays: [],
          exceptions: {},
        },
        serviceQueues: [{ id: ids.queue }],
      })),
    },
    whatsAppChannel: { findUnique: vi.fn() },
    serviceQueue: { upsert: vi.fn() },
    company: {
      findUnique: vi.fn(async () => ({
        humanServiceHours: {
          timeZone: 'America/Sao_Paulo',
          weekly: { 0: [{ start: '00:00', end: '23:59' }] },
          holidays: [],
          exceptions: {},
        },
        offHoursHandoffMessage:
          'Recebemos sua solicitação e retornaremos no próximo período.',
      })),
    },
    agentExecution: {
      findFirst: vi.fn(async () => ({
        id: ids.execution,
        agentId: ids.agent,
        status: AgentExecutionStatus.SUCCEEDED,
      })),
    },
    whatsAppMessage: { create: messageCreate },
    whatsAppMessageAttempt: {
      create: vi.fn(async () => ({ id: ids.attempt })),
    },
    serviceSession: {
      updateMany: sessionUpdate,
      findUniqueOrThrow: vi.fn(async () => updatedSession),
    },
    serviceSessionEvent: { create: eventCreate },
    serviceSessionAssignment: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: assignmentCreate,
    },
    integrationOutbox: {
      aggregate: vi.fn(async () => ({ _max: { aggregateSequence: null } })),
      create: outboxCreate,
    },
    tenantAuditLog: { create: auditCreate },
  };
  const prisma = {
    ...transaction,
    $transaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const repository = new PrismaWhatsAppRepository(
    prisma as never,
    new ConfigService({ WHATSAPP_ENABLED: true }),
  );
  const foundation = vi.fn(async () => ({
    threadId: ids.thread,
    session: initialSession,
  }));
  Object.defineProperty(repository, 'ensureFoundationForConversation', {
    value: foundation,
  });
  return {
    repository,
    transaction,
    messageCreate,
    outboxCreate,
    sessionUpdate,
    eventCreate,
    auditCreate,
    assignmentCreate,
  };
}

function handoffCommand() {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: '00000000-0000-4000-8000-000000000020',
    expectedVersion: 3,
    name: 'forward' as const,
    actorType: 'system' as const,
    metadata: { reason: 'customer-requested-human' },
    automaticHumanHandoff: {
      customerMessage: 'Vou encaminhar sua solicitação.',
      occurredAt,
      actorAgentId: ids.agent,
      agentExecutionId: ids.execution,
      sessionPriority: {
        priority: 'high' as const,
        reason: 'Cliente pediu atendimento humano.',
      },
    },
  };
}

describe('PrismaWhatsAppRepository human service hours', () => {
  it('claims off-hours notification, queue and HUMAN control atomically with audit', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition(handoffCommand()),
    ).resolves.toMatchObject({
      idempotent: false,
      humanHandoff: {
        targetDepartmentId: ids.department,
        queueId: ids.queue,
        humanServiceOpen: false,
        scheduleSource: 'department',
        offHoursNotificationClaimed: true,
        messageId: ids.message,
      },
    });

    expect(harness.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ids.session,
          companyId: ids.company,
          version: 1,
        }),
        data: expect.objectContaining({
          status: ServiceSessionStatus.WAITING_HUMAN,
          controlMode: ServiceSessionControlMode.HUMAN,
          queueId: ids.queue,
          offHoursHandoffNotifiedAt: occurredAt,
          priority: ServiceSessionPriority.HIGH,
          priorityReason: 'Cliente pediu atendimento humano.',
          prioritySource: ServiceSessionPrioritySource.AI_AGENT,
        }),
      }),
    );
    expect(harness.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: MutationActorType.AI_AGENT,
          actorAgentId: ids.agent,
          expectedVersion: 1,
          resultingVersion: 2,
        }),
      }),
    );
    expect(harness.assignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: ids.company,
          departmentId: ids.department,
          queueId: ids.queue,
          status: ServiceAssignmentStatus.ACTIVE,
          source: ServiceAssignmentSource.AUTOMATIC,
        }),
      }),
    );
    expect(harness.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: 'Recebemos sua solicitação e retornaremos no próximo período.',
          automationPurpose: 'off-hours-handoff',
          serviceSessionId: ids.session,
        }),
      }),
    );
    expect(harness.messageCreate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.outboxCreate.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
    expect(harness.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'whatsapp.service-session.handoff',
          targetType: 'service-session',
          targetId: ids.session,
        }),
      }),
    );
    expect(
      harness.transaction.whatsAppChannel.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('does not enqueue a second off-hours message after the session claim', async () => {
    const harness = createHarness({ alreadyNotified: true });

    await expect(
      harness.repository.transition(handoffCommand()),
    ).resolves.toMatchObject({
      humanHandoff: {
        offHoursNotificationClaimed: false,
        messageId: null,
      },
    });

    expect(harness.messageCreate).not.toHaveBeenCalled();
    expect(harness.outboxCreate).not.toHaveBeenCalled();
    expect(harness.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 1 }),
        data: expect.objectContaining({
          controlMode: ServiceSessionControlMode.HUMAN,
          offHoursHandoffNotifiedAt: new Date('2026-08-29T15:00:00.000Z'),
        }),
      }),
    );
  });
});
