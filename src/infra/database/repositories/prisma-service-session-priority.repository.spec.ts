import { describe, expect, it, vi } from 'vitest';

import type {
  ManagedServiceSession,
  MutateManagedServiceSessionInput,
} from '../../../application/contracts/service-session-management.repository';
import {
  DepartmentCode,
  Prisma,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import { PrismaServiceSessionManagementRepository } from './prisma-service-session-management.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  otherCompany: '00000000-0000-4000-8000-000000000002',
  thread: '00000000-0000-4000-8000-000000000003',
  channel: '00000000-0000-4000-8000-000000000004',
  department: '00000000-0000-4000-8000-000000000005',
  currentQueue: '00000000-0000-4000-8000-000000000006',
  challengerQueue: '00000000-0000-4000-8000-000000000007',
  current: '00000000-0000-4000-8000-000000000008',
  challenger: '00000000-0000-4000-8000-000000000009',
  foreign: '00000000-0000-4000-8000-000000000010',
  actor: '00000000-0000-4000-8000-000000000011',
  responsibleCurrent: '00000000-0000-4000-8000-000000000012',
  responsibleChallenger: '00000000-0000-4000-8000-000000000013',
};

const occurredAt = new Date('2026-08-29T15:00:00.000Z');

interface TestSessionRow extends Record<string, unknown> {
  id: string;
  companyId: string;
  threadId: string;
  sourceChannelId: string;
  currentDepartmentId: string | null;
  responsibleUserId: string | null;
  queueId: string | null;
  relatedServiceSessionId: string | null;
  status: ServiceSessionStatus;
  controlMode: ServiceSessionControlMode;
  priority: ServiceSessionPriority;
  priorityReason: string | null;
  prioritySource: ServiceSessionPrioritySource;
  isForeground: boolean;
  version: number;
  publicContinuationCode: string | null;
  continuationCodeExpiresAt: Date | null;
  conversationResolved: boolean;
  pendingActions: readonly string[];
  resolutionConfirmedByCustomer: boolean;
  closingStartedAt: Date | null;
  closingDeadlineAt: Date | null;
  offHoursHandoffNotifiedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sourceChannel: { name: string };
  thread: {
    contact: { phoneNormalized: string; displayName: string | null };
  };
  currentDepartment: {
    id: string;
    code: DepartmentCode;
    name: string;
    serviceQueues: readonly { priorityWeight: number }[];
  } | null;
  responsibleUser: { id: string; name: string } | null;
  queue: { id: string; name: string; priorityWeight: number } | null;
}

interface TestEvent extends Record<string, unknown> {
  companyId: string;
  serviceSessionId: string;
  commandId: string;
  commandFingerprint: string;
  name: string;
  expectedVersion: number;
  resultingVersion: number;
  actorUserId: string | null;
  beforeSnapshot: Prisma.JsonValue;
  afterSnapshot: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

function session(
  patch: Partial<TestSessionRow> & Pick<TestSessionRow, 'id'>,
): TestSessionRow {
  const { id, ...overrides } = patch;
  const queueId = patch.queueId ?? ids.currentQueue;
  const responsibleUserId = patch.responsibleUserId ?? ids.responsibleCurrent;
  const priorityWeight =
    queueId === ids.challengerQueue
      ? 20
      : queueId === ids.currentQueue
        ? 10
        : 0;
  return {
    id,
    companyId: ids.company,
    threadId: ids.thread,
    sourceChannelId: ids.channel,
    currentDepartmentId: ids.department,
    responsibleUserId,
    queueId,
    relatedServiceSessionId: null,
    status: ServiceSessionStatus.OPEN,
    controlMode: ServiceSessionControlMode.HUMAN,
    priority: ServiceSessionPriority.NORMAL,
    priorityReason: null,
    prioritySource: ServiceSessionPrioritySource.SYSTEM,
    isForeground: false,
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
    createdAt: occurredAt,
    updatedAt: occurredAt,
    sourceChannel: { name: 'Canal principal' },
    thread: {
      contact: {
        phoneNormalized: '5534999999999',
        displayName: 'Cliente',
      },
    },
    currentDepartment: {
      id: ids.department,
      code: DepartmentCode.COMMERCIAL,
      name: 'Comercial',
      serviceQueues: [{ priorityWeight }],
    },
    responsibleUser: responsibleUserId
      ? { id: responsibleUserId, name: 'Operador' }
      : null,
    queue: queueId ? { id: queueId, name: 'Fila', priorityWeight } : null,
    ...overrides,
  };
}

const statusFromPrisma = {
  OPEN: 'open',
  WAITING_CUSTOMER: 'waiting-customer',
  WAITING_HUMAN: 'waiting-human',
  PAUSED_BY_HIGHER_PRIORITY: 'paused-by-higher-priority',
  CLOSING: 'closing',
  CLOSED: 'closed',
} as const;

const controlFromPrisma = { AI: 'ai', HUMAN: 'human' } as const;
const priorityFromPrisma = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
const prioritySourceFromPrisma = {
  AI_AGENT: 'ai-agent',
  HUMAN_USER: 'human-user',
  SYSTEM: 'system',
  IMPORT: 'import',
} as const;

function managed(row: TestSessionRow): ManagedServiceSession {
  return {
    id: row.id,
    companyId: row.companyId,
    threadId: row.threadId,
    sourceChannelId: row.sourceChannelId,
    sourceChannelName: row.sourceChannel.name,
    contactPhone: row.thread.contact.phoneNormalized,
    contactName: row.thread.contact.displayName,
    currentDepartmentId: row.currentDepartmentId,
    currentDepartmentCode: 'commercial',
    currentDepartmentName: row.currentDepartment?.name ?? null,
    responsibleUserId: row.responsibleUserId,
    responsibleUserName: row.responsibleUser?.name ?? null,
    queueId: row.queueId,
    queueName: row.queue?.name ?? null,
    responsible: row.responsibleUser,
    queue: row.queue ? { id: row.queue.id, name: row.queue.name } : null,
    relatedServiceSessionId: row.relatedServiceSessionId,
    status: statusFromPrisma[row.status],
    controlMode: controlFromPrisma[row.controlMode],
    priority: priorityFromPrisma[row.priority],
    priorityReason: row.priorityReason,
    prioritySource: prioritySourceFromPrisma[row.prioritySource],
    conversationResolved: row.conversationResolved,
    pendingActions: row.pendingActions,
    resolutionConfirmedByCustomer: row.resolutionConfirmedByCustomer,
    aiClosingStartedAt: row.closingStartedAt,
    closedAt: row.closedAt,
    version: row.version,
    isForeground: row.isForeground,
    availableActions: ['ASSUME', 'CHANGE_PRIORITY', 'CLOSE'],
    publicContinuationCode: row.publicContinuationCode,
    continuationCodeExpiresAt: row.continuationCodeExpiresAt,
    closingDeadlineAt: row.closingDeadlineAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mutation(
  row: TestSessionRow,
  input: {
    commandId: string;
    eventName: MutateManagedServiceSessionInput['eventName'];
    after: Partial<MutateManagedServiceSessionInput['after']>;
  },
): MutateManagedServiceSessionInput {
  const before = managed(row);
  return {
    companyId: row.companyId,
    sessionId: row.id,
    actorUserId: ids.actor,
    commandId: input.commandId,
    expectedVersion: row.version,
    accessibleDepartments: ['commercial'],
    eventName: input.eventName,
    before,
    after: {
      status: before.status,
      controlMode: before.controlMode,
      currentDepartmentId: before.currentDepartmentId,
      responsibleUserId: before.responsibleUserId,
      queueId: before.queueId,
      priority: before.priority,
      priorityReason: before.priorityReason,
      prioritySource: before.prioritySource,
      conversationResolved: before.conversationResolved,
      pendingActions: before.pendingActions,
      resolutionConfirmedByCustomer: before.resolutionConfirmedByCustomer,
      aiClosingStartedAt: before.aiClosingStartedAt,
      closedAt: before.closedAt,
      version: before.version + 1,
      ...input.after,
    },
    metadata: { source: 'test' },
  };
}

function whereRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function whereValue(where: Record<string, unknown>, key: string): unknown {
  if (where[key] !== undefined) return where[key];
  const and = Array.isArray(where.AND) ? where.AND : [];
  for (const part of and) {
    const candidate = whereRecord(part)[key];
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function matchesWhere(row: TestSessionRow, rawWhere: unknown): boolean {
  const where = whereRecord(rawWhere);
  const id = whereValue(where, 'id');
  if (typeof id === 'string' && row.id !== id) return false;
  if (whereRecord(id).not === row.id) return false;
  const companyId = whereValue(where, 'companyId');
  if (typeof companyId === 'string' && row.companyId !== companyId)
    return false;
  const threadId = whereValue(where, 'threadId');
  if (typeof threadId === 'string' && row.threadId !== threadId) return false;
  const version = whereValue(where, 'version');
  if (typeof version === 'number' && row.version !== version) return false;
  const isForeground = whereValue(where, 'isForeground');
  if (typeof isForeground === 'boolean' && row.isForeground !== isForeground) {
    return false;
  }
  const status = whereValue(where, 'status');
  if (typeof status === 'string' && row.status !== status) return false;
  const statusFilter = whereRecord(status);
  if (typeof statusFilter.not === 'string' && row.status === statusFilter.not) {
    return false;
  }
  return true;
}

function cloneRows(rows: ReadonlyMap<string, TestSessionRow>) {
  return new Map<string, TestSessionRow>(structuredClone([...rows.entries()]));
}

function createHarness(input?: {
  currentWeight?: number;
  challengerWeight?: number;
  failUpdateForSessionId?: string;
}) {
  const current = session({
    id: ids.current,
    queueId: ids.currentQueue,
    responsibleUserId: ids.responsibleCurrent,
    isForeground: true,
  });
  current.queue = {
    id: ids.currentQueue,
    name: 'Fila atual',
    priorityWeight: input?.currentWeight ?? 10,
  };
  current.currentDepartment = {
    id: ids.department,
    code: DepartmentCode.COMMERCIAL,
    name: 'Comercial',
    serviceQueues: [{ priorityWeight: input?.currentWeight ?? 10 }],
  };
  const challenger = session({
    id: ids.challenger,
    queueId: ids.challengerQueue,
    responsibleUserId: ids.responsibleChallenger,
    status: ServiceSessionStatus.WAITING_HUMAN,
    isForeground: false,
  });
  challenger.queue = {
    id: ids.challengerQueue,
    name: 'Fila desafiante',
    priorityWeight: input?.challengerWeight ?? 20,
  };
  challenger.currentDepartment = {
    id: ids.department,
    code: DepartmentCode.COMMERCIAL,
    name: 'Comercial',
    serviceQueues: [{ priorityWeight: input?.challengerWeight ?? 20 }],
  };
  const foreign = session({
    id: ids.foreign,
    companyId: ids.otherCompany,
    priority: ServiceSessionPriority.URGENT,
    isForeground: true,
  });
  const rows = new Map(
    [current, challenger, foreign].map((row) => [row.id, row] as const),
  );
  const events: TestEvent[] = [];
  const audits: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];

  const serviceSession = {
    findFirst: vi.fn(async ({ where }: { where: unknown }) => {
      const row = [...rows.values()].find((candidate) =>
        matchesWhere(candidate, where),
      );
      return row ? structuredClone(row) : null;
    }),
    findMany: vi.fn(async ({ where }: { where: unknown }) =>
      structuredClone(
        [...rows.values()].filter((row) => matchesWhere(row, where)),
      ),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: unknown;
        data: Record<string, unknown>;
      }) => {
        updateCalls.push({ where, data });
        const row = [...rows.values()].find((candidate) =>
          matchesWhere(candidate, where),
        );
        if (!row || input?.failUpdateForSessionId === row.id) {
          return { count: 0 };
        }
        for (const [key, value] of Object.entries(data)) {
          if (key === 'version') {
            const increment = whereRecord(value).increment;
            row.version += typeof increment === 'number' ? increment : 0;
          } else {
            row[key] = value;
          }
        }
        row.updatedAt = occurredAt;
        return { count: 1 };
      },
    ),
  };
  const serviceSessionEvent = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const compound = whereRecord(where.companyId_commandId);
      return (
        events.find(
          (event) =>
            event.companyId === compound.companyId &&
            event.commandId === compound.commandId,
        ) ?? null
      );
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const sessionIds = whereRecord(where.serviceSessionId).in;
      return events
        .filter(
          (event) =>
            event.companyId === where.companyId &&
            event.name === where.name &&
            Array.isArray(sessionIds) &&
            sessionIds.includes(event.serviceSessionId),
        )
        .sort(
          (first, second) =>
            second.resultingVersion - first.resultingVersion ||
            second.createdAt.getTime() - first.createdAt.getTime(),
        );
    }),
    create: vi.fn(async ({ data }: { data: TestEvent }) => {
      events.push(data);
      return data;
    }),
  };
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    serviceSession,
    serviceSessionEvent,
    tenantDepartment: {
      findFirst: vi.fn(async () => ({ code: DepartmentCode.COMMERCIAL })),
    },
    serviceQueue: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const queueId = where.id;
          const weight =
            queueId === ids.challengerQueue
              ? (input?.challengerWeight ?? 20)
              : (input?.currentWeight ?? 10);
          return {
            id: typeof queueId === 'string' ? queueId : ids.currentQueue,
            priorityWeight: weight,
            assignmentStrategy: 'MANUAL',
            maxConcurrentAttendances: null,
            department: { code: DepartmentCode.COMMERCIAL },
          };
        },
      ),
    },
    user: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => ({
          id: where.id,
        }),
      ),
    },
    serviceSessionAssignment: {
      findFirst: vi.fn(async () => ({ id: 'assignment-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({})),
    },
    tenantAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      }),
    },
  };
  const transactionCall = vi.fn(
    async (
      callback: (client: typeof transaction) => Promise<unknown>,
      _options: { isolationLevel: string },
    ) => {
      const rowsBefore = cloneRows(rows);
      const eventCountBefore = events.length;
      const auditCountBefore = audits.length;
      try {
        return await callback(transaction);
      } catch (error) {
        rows.clear();
        for (const [key, value] of rowsBefore) rows.set(key, value);
        events.splice(eventCountBefore);
        audits.splice(auditCountBefore);
        throw error;
      }
    },
  );
  const prisma = { ...transaction, $transaction: transactionCall };
  return {
    repository: new PrismaServiceSessionManagementRepository(prisma as never),
    rows,
    events,
    audits,
    updateCalls,
    transaction,
    transactionCall,
  };
}

describe('PrismaServiceSessionManagementRepository priority coordination', () => {
  it('interrupts only on strict superiority and replays the command idempotently', async () => {
    const harness = createHarness();
    const challenger = harness.rows.get(ids.challenger)!;
    const command = mutation(challenger, {
      commandId: 'priority-command-1',
      eventName: 'change-priority',
      after: {
        priority: 'urgent',
        priorityReason: 'Risco operacional imediato',
        prioritySource: 'human-user',
      },
    });

    const first = await harness.repository.mutate(command);
    const updatesAfterFirst = harness.updateCalls.length;
    const eventsAfterFirst = harness.events.length;
    const replay = await harness.repository.mutate(command);

    expect(first).toMatchObject({
      replayed: false,
      session: {
        id: ids.challenger,
        priority: 'urgent',
        status: 'waiting-human',
        isForeground: true,
      },
    });
    expect(replay.replayed).toBe(true);
    expect(harness.updateCalls).toHaveLength(updatesAfterFirst);
    expect(harness.events).toHaveLength(eventsAfterFirst);
    expect(harness.rows.get(ids.current)).toMatchObject({
      status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
      isForeground: false,
      controlMode: ServiceSessionControlMode.HUMAN,
      responsibleUserId: ids.responsibleCurrent,
      queueId: ids.currentQueue,
      sourceChannelId: ids.channel,
      version: 2,
    });
    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: ids.company,
          serviceSessionId: ids.current,
          name: 'priority-interrupted',
          expectedVersion: 1,
          resultingVersion: 2,
          metadata: expect.objectContaining({
            interruptedBySessionId: ids.challenger,
          }),
        }),
      ]),
    );
  });

  it.each([
    {
      eventName: 'assume' as const,
      commandId: 'priority-command-assume',
      after: {
        status: 'open' as const,
        controlMode: 'human' as const,
        responsibleUserId: ids.actor,
      },
    },
    {
      eventName: 'transfer' as const,
      commandId: 'priority-command-transfer',
      after: {
        status: 'waiting-human' as const,
        controlMode: 'human' as const,
        responsibleUserId: null,
        currentDepartmentId: ids.department,
        queueId: ids.challengerQueue,
      },
    },
  ])(
    'coordinates a superior background session through the real $eventName path',
    async ({ eventName, commandId, after }) => {
      const harness = createHarness();
      const challenger = harness.rows.get(ids.challenger)!;

      const result = await harness.repository.mutate(
        mutation(challenger, { commandId, eventName, after }),
      );

      expect(result.session).toMatchObject({
        id: ids.challenger,
        isForeground: true,
        sourceChannelId: ids.channel,
      });
      expect(harness.rows.get(ids.current)).toMatchObject({
        status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
        isForeground: false,
      });
      expect(harness.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            commandId,
            name: eventName,
            metadata: expect.objectContaining({
              priorityCoordination: expect.objectContaining({
                reason: 'strictly-higher-priority',
                interruptedSessionId: ids.current,
              }),
            }),
          }),
        ]),
      );
    },
  );

  it('uses queue weight inside the urgency band and keeps the foreground on a tie', async () => {
    const harness = createHarness({
      currentWeight: 10,
      challengerWeight: 10,
    });
    const challenger = harness.rows.get(ids.challenger)!;
    const command = mutation(challenger, {
      commandId: 'priority-command-tie',
      eventName: 'change-priority',
      after: {
        priority: 'normal',
        priorityReason: 'Revisão sem aumento efetivo',
        prioritySource: 'human-user',
      },
    });

    const result = await harness.repository.mutate(command);

    expect(result.session.isForeground).toBe(false);
    expect(harness.rows.get(ids.current)).toMatchObject({
      status: ServiceSessionStatus.OPEN,
      isForeground: true,
      version: 1,
    });
    const mainEvent = harness.events.find(
      (event) => event.commandId === 'priority-command-tie',
    );
    expect(mainEvent?.metadata).toMatchObject({
      priorityCoordination: expect.objectContaining({
        reason: 'tie-keeps-current',
        tiePolicy: 'current-foreground-wins',
      }),
    });
  });

  it('resumes the linked predecessor after the urgent foreground closes', async () => {
    const harness = createHarness();
    const challenger = harness.rows.get(ids.challenger)!;
    await harness.repository.mutate(
      mutation(challenger, {
        commandId: 'priority-command-promote',
        eventName: 'change-priority',
        after: {
          priority: 'urgent',
          priorityReason: 'Urgência confirmada',
          prioritySource: 'human-user',
        },
      }),
    );
    const promoted = harness.rows.get(ids.challenger)!;

    const result = await harness.repository.mutate({
      ...mutation(promoted, {
        commandId: 'priority-command-close',
        eventName: 'close-human',
        after: {
          status: 'closed',
          closedAt: new Date('2026-08-29T16:00:00.000Z'),
        },
      }),
      publicContinuationCode: '845',
      continuationCodeExpiresAt: new Date('2026-09-05T16:00:00.000Z'),
    });

    expect(result.session).toMatchObject({
      id: ids.challenger,
      status: 'closed',
      isForeground: false,
    });
    expect(harness.rows.get(ids.current)).toMatchObject({
      status: ServiceSessionStatus.OPEN,
      isForeground: true,
      controlMode: ServiceSessionControlMode.HUMAN,
      responsibleUserId: ids.responsibleCurrent,
      queueId: ids.currentQueue,
      sourceChannelId: ids.channel,
      version: 3,
    });
    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: ids.company,
          serviceSessionId: ids.current,
          name: 'priority-resumed',
          metadata: expect.objectContaining({
            resumedAfterSessionId: ids.challenger,
            restoredStatus: 'open',
          }),
        }),
      ]),
    );
    expect(harness.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: ids.company,
          action: 'service-session.priority-resumed',
          targetId: ids.current,
        }),
      ]),
    );
  });

  it('keeps foreign tenant sessions out and rolls both updates back on a stale CAS', async () => {
    const harness = createHarness({
      failUpdateForSessionId: ids.challenger,
    });
    const foreignBefore = structuredClone(harness.rows.get(ids.foreign));
    const challenger = harness.rows.get(ids.challenger)!;

    await expect(
      harness.repository.mutate(
        mutation(challenger, {
          commandId: 'priority-command-race',
          eventName: 'change-priority',
          after: {
            priority: 'urgent',
            priorityReason: 'Comando concorrente',
            prioritySource: 'human-user',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(harness.rows.get(ids.current)).toMatchObject({
      status: ServiceSessionStatus.OPEN,
      isForeground: true,
      version: 1,
    });
    expect(harness.rows.get(ids.foreign)).toEqual(foreignBefore);
    expect(harness.events).toHaveLength(0);
    expect(harness.audits).toHaveLength(0);
    expect(harness.transactionCall).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(harness.transaction.$executeRaw).toHaveBeenCalled();
    expect(harness.updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: expect.objectContaining({
            id: ids.current,
            companyId: ids.company,
            version: 1,
            isForeground: true,
          }),
        }),
        expect.objectContaining({
          where: expect.objectContaining({
            id: ids.challenger,
            companyId: ids.company,
            version: 1,
            isForeground: false,
          }),
        }),
      ]),
    );
  });
});
