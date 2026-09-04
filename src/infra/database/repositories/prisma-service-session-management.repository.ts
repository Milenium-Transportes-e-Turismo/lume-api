import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  ServiceSessionManagementRepository,
  type ListManagedServiceSessionsInput,
  type ListManagedServiceSessionsResult,
  type ManagedServiceSession,
  type MutateManagedServiceSessionInput,
  type ServiceSessionDepartmentScope,
} from '../../../application/contracts/service-session-management.repository';
import {
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  normalizeUserDepartment,
  type Department,
  type PresentedUserDepartment,
} from '../../../domain/access/access.constants';
import type {
  ServiceControlMode,
  ServicePriority,
  ServicePrioritySource,
  ServiceSessionStatus,
} from '../../../domain/whatsapp/service-session';
import {
  decidePriorityInterruption,
  selectPriorityResumeCandidate,
  type EffectiveServicePriority,
  type PausedPriorityCandidate,
} from '../../../domain/whatsapp/service-priority-coordination';
import { selectAssignmentCandidate } from '../../../domain/whatsapp/assignment-strategy';
import {
  DepartmentCode,
  MutationActorType,
  Prisma,
  ServiceAssignmentSource,
  ServiceAssignmentStatus,
  ServiceSessionControlMode as PrismaControlMode,
  ServiceSessionPriority as PrismaPriority,
  ServiceSessionPrioritySource as PrismaPrioritySource,
  ServiceSessionStatus as PrismaSessionStatus,
  UserAccountStatus,
} from '../prisma/generated/client';
import { rethrowKnownPrismaConflict } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

const sessionInclude = {
  sourceChannel: { select: { name: true } },
  thread: {
    select: {
      contact: { select: { phoneNormalized: true, displayName: true } },
    },
  },
  currentDepartment: {
    select: {
      id: true,
      code: true,
      name: true,
      serviceQueues: {
        where: { enabled: true },
        orderBy: [{ priorityWeight: 'desc' }, { id: 'asc' }],
        take: 1,
        select: { priorityWeight: true },
      },
    },
  },
  responsibleUser: { select: { id: true, name: true } },
  queue: { select: { id: true, name: true, priorityWeight: true } },
} as const satisfies Prisma.ServiceSessionInclude;

type SessionRow = Prisma.ServiceSessionGetPayload<{
  include: typeof sessionInclude;
}>;

const departmentToPrisma: Readonly<Record<Department, DepartmentCode>> = {
  'client-company': DepartmentCode.CLIENT_COMPANY,
  'human-resources': DepartmentCode.HUMAN_RESOURCES,
  'personnel-department': DepartmentCode.PERSONNEL_DEPARTMENT,
  commercial: DepartmentCode.COMMERCIAL,
  purchasing: DepartmentCode.PURCHASING,
  controlling: DepartmentCode.CONTROLLING,
  maintenance: DepartmentCode.MAINTENANCE,
  monitoring: DepartmentCode.MONITORING,
  management: DepartmentCode.MANAGEMENT,
  directorate: DepartmentCode.DIRECTORATE,
  operations: DepartmentCode.OPERATIONS,
  cleaning: DepartmentCode.CLEANING,
  financial: DepartmentCode.FINANCIAL,
  'information-technology': DepartmentCode.INFORMATION_TECHNOLOGY,
};

const departmentFromPrisma: Readonly<Record<DepartmentCode, Department>> = {
  CLIENT_COMPANY: 'client-company',
  HUMAN_RESOURCES: 'human-resources',
  PERSONNEL_DEPARTMENT: 'personnel-department',
  COMMERCIAL: 'commercial',
  PURCHASING: 'purchasing',
  CONTROLLING: 'controlling',
  MAINTENANCE: 'maintenance',
  MONITORING: 'monitoring',
  MANAGEMENT: 'management',
  DIRECTORATE: 'directorate',
  OPERATIONS: 'operations',
  CLEANING: 'cleaning',
  FINANCIAL: 'financial',
  INFORMATION_TECHNOLOGY: 'information-technology',
};

const statusToPrisma: Readonly<
  Record<ServiceSessionStatus, PrismaSessionStatus>
> = {
  open: PrismaSessionStatus.OPEN,
  'waiting-customer': PrismaSessionStatus.WAITING_CUSTOMER,
  'waiting-human': PrismaSessionStatus.WAITING_HUMAN,
  'paused-by-higher-priority': PrismaSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
  closing: PrismaSessionStatus.CLOSING,
  closed: PrismaSessionStatus.CLOSED,
};

const statusFromPrisma: Readonly<
  Record<PrismaSessionStatus, ServiceSessionStatus>
> = {
  OPEN: 'open',
  WAITING_CUSTOMER: 'waiting-customer',
  WAITING_HUMAN: 'waiting-human',
  PAUSED_BY_HIGHER_PRIORITY: 'paused-by-higher-priority',
  CLOSING: 'closing',
  CLOSED: 'closed',
};

const controlToPrisma: Readonly<Record<ServiceControlMode, PrismaControlMode>> =
  { ai: PrismaControlMode.AI, human: PrismaControlMode.HUMAN };

const controlFromPrisma: Readonly<
  Record<PrismaControlMode, ServiceControlMode>
> = { AI: 'ai', HUMAN: 'human' };

const priorityToPrisma: Readonly<Record<ServicePriority, PrismaPriority>> = {
  low: PrismaPriority.LOW,
  normal: PrismaPriority.NORMAL,
  high: PrismaPriority.HIGH,
  urgent: PrismaPriority.URGENT,
};

const priorityFromPrisma: Readonly<Record<PrismaPriority, ServicePriority>> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

const prioritySourceToPrisma: Readonly<
  Record<ServicePrioritySource, PrismaPrioritySource>
> = {
  'ai-agent': PrismaPrioritySource.AI_AGENT,
  'human-user': PrismaPrioritySource.HUMAN_USER,
  system: PrismaPrioritySource.SYSTEM,
  import: PrismaPrioritySource.IMPORT,
};

const prioritySourceFromPrisma: Readonly<
  Record<PrismaPrioritySource, ServicePrioritySource>
> = {
  AI_AGENT: 'ai-agent',
  HUMAN_USER: 'human-user',
  SYSTEM: 'system',
  IMPORT: 'import',
};

const assignmentStrategyFromPrisma = {
  MANUAL: 'manual',
  ROUND_ROBIN: 'round-robin',
  LEAST_LOAD: 'least-load',
} as const;

function serviceAssigneeAuthorityWhere(
  departmentAliases?: readonly string[],
): Prisma.UserWhereInput {
  return {
    OR: [
      { isAdministrator: true },
      {
        ...(departmentAliases
          ? { departments: { hasSome: [...departmentAliases] } }
          : {}),
        permissionCodes: { has: 'service:assume' },
      },
    ],
  };
}

function pendingActions(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function availableActions(
  row: SessionRow,
): ManagedServiceSession['availableActions'] {
  if (row.status === PrismaSessionStatus.CLOSED) return [];
  const actions: ManagedServiceSession['availableActions'][number][] = [
    'ASSUME',
    'TRANSFER_USER',
    'TRANSFER_DEPARTMENT',
    'CHANGE_PRIORITY',
  ];
  if (!row.isForeground) {
    if (row.controlMode === PrismaControlMode.HUMAN) {
      actions.push('CLOSE');
      if (row.responsibleUserId) actions.push('RETURN_TO_QUEUE');
    }
    return actions;
  }
  if (row.controlMode === PrismaControlMode.HUMAN) {
    actions.push('RETURN_TO_AI', 'CLOSE');
    if (row.responsibleUserId) actions.push('RETURN_TO_QUEUE');
  }
  return actions;
}

function toManaged(row: SessionRow): ManagedServiceSession {
  return {
    id: row.id,
    companyId: row.companyId,
    threadId: row.threadId,
    sourceChannelId: row.sourceChannelId,
    sourceChannelName: row.sourceChannel.name,
    contactPhone: row.thread.contact.phoneNormalized,
    contactName: row.thread.contact.displayName,
    currentDepartmentId: row.currentDepartmentId,
    currentDepartmentCode: row.currentDepartment
      ? departmentFromPrisma[row.currentDepartment.code]
      : null,
    currentDepartmentName: row.currentDepartment?.name ?? null,
    responsibleUserId: row.responsibleUserId,
    responsibleUserName: row.responsibleUser?.name ?? null,
    queueId: row.queueId,
    queueName: row.queue?.name ?? null,
    responsible:
      row.responsibleUserId && row.responsibleUser
        ? { id: row.responsibleUserId, name: row.responsibleUser.name }
        : null,
    queue:
      row.queueId && row.queue
        ? { id: row.queueId, name: row.queue.name }
        : null,
    relatedServiceSessionId: row.relatedServiceSessionId,
    status: statusFromPrisma[row.status],
    controlMode: controlFromPrisma[row.controlMode],
    priority: priorityFromPrisma[row.priority],
    priorityReason: row.priorityReason,
    prioritySource: prioritySourceFromPrisma[row.prioritySource],
    conversationResolved: row.conversationResolved,
    pendingActions: pendingActions(row.pendingActions),
    resolutionConfirmedByCustomer: row.resolutionConfirmedByCustomer,
    aiClosingStartedAt: row.closingStartedAt,
    closingDeadlineAt: row.closingDeadlineAt,
    closedAt: row.closedAt,
    isForeground: row.isForeground,
    availableActions: availableActions(row),
    version: row.version,
    publicContinuationCode: row.publicContinuationCode,
    continuationCodeExpiresAt: row.continuationCodeExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function prismaDepartments(
  values: readonly PresentedUserDepartment[],
): DepartmentCode[] {
  return [
    ...new Set(
      values
        .map((value) => departmentToPrisma[normalizeUserDepartment(value)])
        .filter((code) => code !== DepartmentCode.CLIENT_COMPANY),
    ),
  ];
}

function accessWhere(
  companyId: string,
  accessibleDepartments: ServiceSessionDepartmentScope,
): Prisma.ServiceSessionWhereInput {
  if (accessibleDepartments === null) return { companyId };
  const codes = prismaDepartments(accessibleDepartments);
  if (codes.length === 0) return { companyId, id: '__not-accessible__' };
  return {
    companyId,
    OR: [
      { currentDepartmentId: null },
      { currentDepartment: { is: { code: { in: codes } } } },
    ],
  };
}

function validateCommandId(value: string): string {
  const commandId = value.trim();
  if (!commandId || commandId.length > 120) {
    throw validationError('commandId deve possuir entre 1 e 120 caracteres.');
  }
  return commandId;
}

const restorableStatuses = new Set<ServiceSessionStatus>([
  'open',
  'waiting-customer',
  'waiting-human',
]);

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function organizationalWeight(row: SessionRow): number {
  return (
    row.queue?.priorityWeight ??
    row.currentDepartment?.serviceQueues[0]?.priorityWeight ??
    0
  );
}

function effectivePriority(row: SessionRow): EffectiveServicePriority {
  return {
    priority: priorityFromPrisma[row.priority],
    organizationalWeight: organizationalWeight(row),
  };
}

async function effectivePriorityForSnapshot(
  transaction: Prisma.TransactionClient,
  input: {
    readonly companyId: string;
    readonly priority: ServicePriority;
    readonly queueId: string | null;
    readonly currentDepartmentId: string | null;
  },
): Promise<EffectiveServicePriority> {
  const explicitQueue = input.queueId
    ? await transaction.serviceQueue.findFirst({
        where: { id: input.queueId, companyId: input.companyId },
        select: { priorityWeight: true },
      })
    : null;
  const departmentQueue =
    explicitQueue || !input.currentDepartmentId
      ? null
      : await transaction.serviceQueue.findFirst({
          where: {
            companyId: input.companyId,
            departmentId: input.currentDepartmentId,
            enabled: true,
          },
          orderBy: [{ priorityWeight: 'desc' }, { id: 'asc' }],
          select: { priorityWeight: true },
        });
  return {
    priority: input.priority,
    organizationalWeight:
      explicitQueue?.priorityWeight ?? departmentQueue?.priorityWeight ?? 0,
  };
}

function canChallengeForeground(status: ServiceSessionStatus): boolean {
  return (
    status === 'open' ||
    status === 'waiting-human' ||
    status === 'paused-by-higher-priority'
  );
}

function canBeInterrupted(status: PrismaSessionStatus): boolean {
  return (
    status !== PrismaSessionStatus.CLOSED &&
    status !== PrismaSessionStatus.CLOSING &&
    status !== PrismaSessionStatus.PAUSED_BY_HIGHER_PRIORITY
  );
}

function safeResumeFallback(input: {
  readonly controlMode: ServiceControlMode;
  readonly responsibleUserId: string | null;
  readonly queueId: string | null;
}): Exclude<
  ServiceSessionStatus,
  'paused-by-higher-priority' | 'closing' | 'closed'
> {
  if (input.controlMode === 'human' && input.responsibleUserId === null) {
    return input.queueId ? 'waiting-human' : 'open';
  }
  return 'open';
}

function coordinationCommandId(
  commandId: string,
  action: string,
  sessionId: string,
): string {
  return `priority-${createHash('sha256')
    .update(`${commandId}:${action}:${sessionId}`)
    .digest('hex')}`;
}

async function lockCoordination(
  transaction: Prisma.TransactionClient,
  companyId: string,
  namespace: string,
  key: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${namespace}:${key}`}))
  `;
}

interface PauseContext {
  readonly interruptedBySessionId: string;
  readonly previousStatus: Exclude<
    ServiceSessionStatus,
    'paused-by-higher-priority' | 'closing' | 'closed'
  >;
  readonly pausedAt: Date;
}

function pauseContext(event: {
  readonly beforeSnapshot: Prisma.JsonValue;
  readonly metadata: Prisma.JsonValue;
  readonly createdAt: Date;
}): PauseContext | null {
  const metadata = jsonRecord(event.metadata);
  const before = jsonRecord(event.beforeSnapshot);
  const interruptedBySessionId = metadata?.interruptedBySessionId;
  const previousStatus = before?.status;
  if (
    typeof interruptedBySessionId !== 'string' ||
    typeof previousStatus !== 'string' ||
    !restorableStatuses.has(previousStatus as ServiceSessionStatus)
  ) {
    return null;
  }
  return {
    interruptedBySessionId,
    previousStatus: previousStatus as PauseContext['previousStatus'],
    pausedAt: event.createdAt,
  };
}

async function latestPauseContexts(
  transaction: Prisma.TransactionClient,
  input: {
    readonly companyId: string;
    readonly sessionIds: readonly string[];
  },
): Promise<ReadonlyMap<string, PauseContext>> {
  if (input.sessionIds.length === 0) return new Map();
  const events = await transaction.serviceSessionEvent.findMany({
    where: {
      companyId: input.companyId,
      serviceSessionId: { in: [...input.sessionIds] },
      name: 'priority-interrupted',
    },
    orderBy: [{ resultingVersion: 'desc' }, { createdAt: 'desc' }],
    select: {
      serviceSessionId: true,
      beforeSnapshot: true,
      metadata: true,
      createdAt: true,
    },
  });
  const contexts = new Map<string, PauseContext>();
  for (const event of events) {
    if (contexts.has(event.serviceSessionId)) continue;
    const parsed = pauseContext(event);
    if (parsed) contexts.set(event.serviceSessionId, parsed);
  }
  return contexts;
}

async function persistPrioritySideEffect(
  transaction: Prisma.TransactionClient,
  input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly triggeringCommandId: string;
    readonly beforeRow: SessionRow;
    readonly status: ServiceSessionStatus;
    readonly isForeground: boolean;
    readonly name: 'priority-interrupted' | 'priority-resumed';
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
  },
): Promise<SessionRow> {
  const commandId = coordinationCommandId(
    input.triggeringCommandId,
    input.name,
    input.beforeRow.id,
  );
  const eventFingerprint = fingerprint({
    commandId,
    sessionId: input.beforeRow.id,
    expectedVersion: input.beforeRow.version,
    status: input.status,
    isForeground: input.isForeground,
    metadata: input.metadata,
  });
  const updated = await transaction.serviceSession.updateMany({
    where: {
      id: input.beforeRow.id,
      companyId: input.companyId,
      version: input.beforeRow.version,
      isForeground: input.beforeRow.isForeground,
    },
    data: {
      status: statusToPrisma[input.status],
      isForeground: input.isForeground,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw conflict(
      'A coordenação de prioridade encontrou uma atualização concorrente.',
    );
  }
  const afterRow = await transaction.serviceSession.findFirst({
    where: { id: input.beforeRow.id, companyId: input.companyId },
    include: sessionInclude,
  });
  if (!afterRow) throw notFound('Atendimento');
  const before = toManaged(input.beforeRow);
  const after = toManaged(afterRow);
  await transaction.serviceSessionEvent.create({
    data: {
      companyId: input.companyId,
      serviceSessionId: input.beforeRow.id,
      commandId,
      commandFingerprint: eventFingerprint,
      name: input.name,
      expectedVersion: input.beforeRow.version,
      resultingVersion: input.beforeRow.version + 1,
      actorType: MutationActorType.HUMAN_USER,
      actorUserId: input.actorUserId,
      beforeSnapshot: asPrismaJson(before),
      afterSnapshot: asPrismaJson(after),
      metadata: asPrismaJson(input.metadata),
      createdAt: input.occurredAt,
    },
  });
  await transaction.tenantAuditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: `service-session.${input.name}`,
      targetType: 'service-session',
      targetId: input.beforeRow.id,
      metadata: asPrismaJson({
        commandId,
        triggeringCommandId: input.triggeringCommandId,
        expectedVersion: input.beforeRow.version,
        resultingVersion: input.beforeRow.version + 1,
        ...input.metadata,
      }),
      createdAt: input.occurredAt,
    },
  });
  return afterRow;
}

async function persistPriorityObservation(
  transaction: Prisma.TransactionClient,
  input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly triggeringCommandId: string;
    readonly beforeRow: SessionRow;
    readonly afterRow: SessionRow;
    readonly name: 'priority-interrupted';
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
  },
): Promise<void> {
  const commandId = coordinationCommandId(
    input.triggeringCommandId,
    input.name,
    input.beforeRow.id,
  );
  const eventFingerprint = fingerprint({
    commandId,
    sessionId: input.beforeRow.id,
    expectedVersion: input.beforeRow.version,
    resultingVersion: input.afterRow.version,
    metadata: input.metadata,
  });
  await transaction.serviceSessionEvent.create({
    data: {
      companyId: input.companyId,
      serviceSessionId: input.beforeRow.id,
      commandId,
      commandFingerprint: eventFingerprint,
      name: input.name,
      expectedVersion: input.beforeRow.version,
      resultingVersion: input.afterRow.version,
      actorType: MutationActorType.HUMAN_USER,
      actorUserId: input.actorUserId,
      beforeSnapshot: asPrismaJson(toManaged(input.beforeRow)),
      afterSnapshot: asPrismaJson(toManaged(input.afterRow)),
      metadata: asPrismaJson(input.metadata),
      createdAt: input.occurredAt,
    },
  });
  await transaction.tenantAuditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: `service-session.${input.name}`,
      targetType: 'service-session',
      targetId: input.beforeRow.id,
      metadata: asPrismaJson({
        commandId,
        triggeringCommandId: input.triggeringCommandId,
        expectedVersion: input.beforeRow.version,
        resultingVersion: input.afterRow.version,
        ...input.metadata,
      }),
      createdAt: input.occurredAt,
    },
  });
}

function endedAssignmentStatus(
  eventName: MutateManagedServiceSessionInput['eventName'],
): ServiceAssignmentStatus {
  if (eventName === 'transfer') return ServiceAssignmentStatus.TRANSFERRED;
  if (eventName === 'return-to-queue') {
    return ServiceAssignmentStatus.RETURNED_TO_QUEUE;
  }
  return ServiceAssignmentStatus.RELEASED;
}

async function assertTargets(
  transaction: Prisma.TransactionClient,
  input: MutateManagedServiceSessionInput,
): Promise<void> {
  const departmentId = input.after.currentDepartmentId;
  let departmentCode: DepartmentCode | null = null;
  if (departmentId) {
    const department = await transaction.tenantDepartment.findFirst({
      where: { id: departmentId, companyId: input.companyId },
      select: { code: true },
    });
    if (!department) throw validationError('Departamento de destino inválido.');
    if (department.code === DepartmentCode.CLIENT_COMPANY) {
      throw validationError(
        'Empresa cliente não pode receber atendimentos internos.',
      );
    }
    departmentCode = department.code;
  }
  if (input.after.queueId) {
    const queue = await transaction.serviceQueue.findFirst({
      where: {
        id: input.after.queueId,
        companyId: input.companyId,
        enabled: true,
        ...(departmentId ? { departmentId } : {}),
      },
      select: { id: true },
    });
    if (!queue) {
      throw validationError(
        'A fila selecionada não pertence ao departamento de destino.',
      );
    }
  }
  if (input.after.responsibleUserId) {
    if (!departmentCode) {
      throw validationError(
        'Um responsável direto exige departamento definido.',
      );
    }
    const acceptedDepartmentCodes: string[] = [
      departmentFromPrisma[departmentCode],
    ];
    if (departmentCode === DepartmentCode.CONTROLLING) {
      acceptedDepartmentCodes.push('controllership');
    }
    const user = await transaction.user.findFirst({
      where: {
        id: input.after.responsibleUserId,
        companyId: input.companyId,
        isActive: true,
        status: UserAccountStatus.ACTIVE,
        deletedAt: null,
        ...serviceAssigneeAuthorityWhere(acceptedDepartmentCodes),
      },
      select: { id: true },
    });
    if (!user) {
      throw validationError(
        'O responsável selecionado não está ativo no departamento de destino.',
      );
    }
  }
}

async function resolveAutomaticAssignment(
  transaction: Prisma.TransactionClient,
  input: MutateManagedServiceSessionInput,
): Promise<MutateManagedServiceSessionInput['after']> {
  if (
    input.after.controlMode !== 'human' ||
    input.after.status === 'closed' ||
    input.after.responsibleUserId !== null ||
    input.after.queueId === null ||
    !['return-to-queue', 'transfer'].includes(input.eventName)
  ) {
    return input.after;
  }

  const queue = await transaction.serviceQueue.findFirst({
    where: {
      id: input.after.queueId,
      companyId: input.companyId,
      enabled: true,
    },
    select: {
      department: { select: { code: true } },
      assignmentStrategy: true,
      maxConcurrentAttendances: true,
    },
  });
  if (!queue || queue.assignmentStrategy === 'MANUAL') return input.after;

  const departmentCode = departmentFromPrisma[queue.department.code];
  const departmentAliases =
    departmentCode === 'controlling'
      ? ['controlling', 'controllership']
      : [departmentCode];
  const users = await transaction.user.findMany({
    where: {
      companyId: input.companyId,
      isActive: true,
      status: UserAccountStatus.ACTIVE,
      deletedAt: null,
      departments: { hasSome: departmentAliases },
      permissionCodes: { has: 'service:assume' },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (users.length === 0) return input.after;

  const userIds = users.map((user) => user.id);
  const [loads, assignmentHistory] = await Promise.all([
    transaction.serviceSession.groupBy({
      by: ['responsibleUserId'],
      where: {
        companyId: input.companyId,
        responsibleUserId: { in: userIds },
        status: { not: PrismaSessionStatus.CLOSED },
      },
      _count: { _all: true },
    }),
    transaction.serviceSessionAssignment.findMany({
      where: {
        companyId: input.companyId,
        assignedUserId: { in: userIds },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { assignedUserId: true, startedAt: true },
    }),
  ]);
  const loadByUser = new Map(
    loads.flatMap((load) =>
      load.responsibleUserId
        ? [[load.responsibleUserId, load._count._all] as const]
        : [],
    ),
  );
  const lastAssignedByUser = new Map<string, Date>();
  for (const assignment of assignmentHistory) {
    if (
      assignment.assignedUserId &&
      !lastAssignedByUser.has(assignment.assignedUserId)
    ) {
      lastAssignedByUser.set(assignment.assignedUserId, assignment.startedAt);
    }
  }
  const selected = selectAssignmentCandidate({
    strategy: assignmentStrategyFromPrisma[queue.assignmentStrategy],
    candidates: users.map((user) => ({
      userId: user.id,
      activeAttendances: loadByUser.get(user.id) ?? 0,
      maxConcurrentAttendances: queue.maxConcurrentAttendances,
      availableForAssignment: true,
      lastAssignedAt: lastAssignedByUser.get(user.id) ?? null,
    })),
  });
  return selected
    ? {
        ...input.after,
        status: 'open',
        responsibleUserId: selected.userId,
      }
    : input.after;
}

@Injectable()
export class PrismaServiceSessionManagementRepository extends ServiceSessionManagementRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(
    input: ListManagedServiceSessionsInput,
  ): Promise<ListManagedServiceSessionsResult> {
    const access = accessWhere(input.companyId, input.accessibleDepartments);
    const search = input.search?.trim();
    const where: Prisma.ServiceSessionWhereInput = {
      AND: [
        access,
        input.status ? { status: statusToPrisma[input.status] } : {},
        input.controlMode
          ? { controlMode: controlToPrisma[input.controlMode] }
          : {},
        input.priority ? { priority: priorityToPrisma[input.priority] } : {},
        input.responsibleUserId
          ? { responsibleUserId: input.responsibleUserId }
          : {},
        search
          ? {
              OR: [
                {
                  thread: {
                    is: {
                      contact: {
                        is: {
                          displayName: {
                            contains: search,
                            mode: 'insensitive',
                          },
                        },
                      },
                    },
                  },
                },
                {
                  thread: {
                    is: {
                      contact: {
                        is: { phoneNormalized: { contains: search } },
                      },
                    },
                  },
                },
                { publicContinuationCode: { contains: search } },
                {
                  sourceChannel: {
                    is: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const skip = (input.page - 1) * input.pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceSession.findMany({
        where,
        include: sessionInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take: input.pageSize,
      }),
      this.prisma.serviceSession.count({ where }),
    ]);
    return {
      items: rows.map(toManaged),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async getAccessible(input: {
    readonly companyId: string;
    readonly sessionId: string;
    readonly accessibleDepartments: ServiceSessionDepartmentScope;
  }): Promise<ManagedServiceSession | null> {
    const row = await this.prisma.serviceSession.findFirst({
      where: {
        AND: [
          { id: input.sessionId },
          accessWhere(input.companyId, input.accessibleDepartments),
        ],
      },
      include: sessionInclude,
    });
    return row ? toManaged(row) : null;
  }

  async listAssignmentTargets(input: { readonly companyId: string }) {
    const [departments, users] = await Promise.all([
      this.prisma.tenantDepartment.findMany({
        where: {
          companyId: input.companyId,
          code: { not: DepartmentCode.CLIENT_COMPANY },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          isDefault: true,
          serviceQueues: {
            where: { enabled: true },
            orderBy: [{ priorityWeight: 'desc' }, { name: 'asc' }],
            select: {
              id: true,
              name: true,
              assignmentStrategy: true,
              maxConcurrentAttendances: true,
            },
          },
        },
      }),
      this.prisma.user.findMany({
        where: {
          companyId: input.companyId,
          isActive: true,
          status: UserAccountStatus.ACTIVE,
          deletedAt: null,
          ...serviceAssigneeAuthorityWhere(),
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          departments: true,
          isAdministrator: true,
        },
      }),
    ]);

    return departments.map((department) => {
      const code = departmentFromPrisma[department.code];
      const aliases =
        code === 'controlling'
          ? new Set(['controlling', 'controllership'])
          : new Set([code]);
      return {
        id: department.id,
        code,
        name: department.name,
        isDefault: department.isDefault,
        queues: department.serviceQueues.map((queue) => ({
          id: queue.id,
          name: queue.name,
          assignmentStrategy:
            assignmentStrategyFromPrisma[queue.assignmentStrategy],
          maxConcurrentAttendances: queue.maxConcurrentAttendances,
        })),
        users: users
          .filter((user) =>
            user.isAdministrator
              ? true
              : user.departments.some((userDepartment) =>
                  aliases.has(userDepartment),
                ),
          )
          .map((user) => ({ id: user.id, name: user.name })),
      };
    });
  }

  async mutate(input: MutateManagedServiceSessionInput) {
    const commandId = validateCommandId(input.commandId);
    const commandFingerprint = fingerprint({
      operation: input.eventName,
      sessionId: input.sessionId,
      expectedVersion: input.expectedVersion,
      actorUserId: input.actorUserId,
      after: input.after,
      assignmentReason: input.assignmentReason ?? null,
      publicContinuationCode: input.publicContinuationCode ?? null,
      continuationCodeExpiresAt: input.continuationCodeExpiresAt ?? null,
    });
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await lockCoordination(
            transaction,
            input.companyId,
            'service-session-command',
            commandId,
          );
          const replay = await transaction.serviceSessionEvent.findUnique({
            where: {
              companyId_commandId: { companyId: input.companyId, commandId },
            },
          });
          if (replay) {
            if (
              replay.serviceSessionId !== input.sessionId ||
              replay.actorUserId !== input.actorUserId ||
              replay.commandFingerprint !== commandFingerprint
            ) {
              throw conflict('commandId já foi utilizado com outro conteúdo.');
            }
            const replayed = await transaction.serviceSession.findFirst({
              where: { id: input.sessionId, companyId: input.companyId },
              include: sessionInclude,
            });
            if (!replayed) throw notFound('Atendimento');
            return { session: toManaged(replayed), replayed: true };
          }

          const locatedRow = await transaction.serviceSession.findFirst({
            where: {
              AND: [
                { id: input.sessionId },
                accessWhere(input.companyId, input.accessibleDepartments),
              ],
            },
            include: sessionInclude,
          });
          if (!locatedRow) throw notFound('Atendimento');
          await lockCoordination(
            transaction,
            input.companyId,
            'service-session-thread',
            locatedRow.threadId,
          );
          const beforeRow = await transaction.serviceSession.findFirst({
            where: {
              AND: [
                { id: input.sessionId },
                accessWhere(input.companyId, input.accessibleDepartments),
              ],
            },
            include: sessionInclude,
          });
          if (!beforeRow) throw notFound('Atendimento');
          if (
            beforeRow.version !== input.expectedVersion ||
            input.after.version !== input.expectedVersion + 1
          ) {
            throw conflict(
              'O atendimento foi atualizado. Recarregue os dados antes de tentar novamente.',
            );
          }
          await assertTargets(transaction, input);
          const effectiveAfter = await resolveAutomaticAssignment(
            transaction,
            input,
          );

          const coordinationAt = new Date();
          const targetPriority = await effectivePriorityForSnapshot(
            transaction,
            {
              companyId: input.companyId,
              priority: effectiveAfter.priority,
              queueId: effectiveAfter.queueId,
              currentDepartmentId: effectiveAfter.currentDepartmentId,
            },
          );
          let coordinatedStatus = effectiveAfter.status;
          let coordinatedForeground =
            beforeRow.isForeground && effectiveAfter.status !== 'closed';
          let interruptedForeground: SessionRow | null = null;
          let resumedPredecessor: {
            readonly row: SessionRow;
            readonly context: PauseContext;
          } | null = null;
          let coordinationReason:
            | 'target-already-foreground'
            | 'strictly-higher-priority'
            | 'same-session'
            | 'tie-keeps-current'
            | 'lower-priority'
            | 'foreground-not-interruptible'
            | 'no-current-foreground'
            | 'resume-after-close'
            | 'resume-after-priority-drop'
            | 'no-linked-predecessor' = beforeRow.isForeground
            ? 'target-already-foreground'
            : 'lower-priority';

          if (beforeRow.isForeground) {
            const pausedRows = await transaction.serviceSession.findMany({
              where: {
                companyId: input.companyId,
                threadId: beforeRow.threadId,
                id: { not: beforeRow.id },
                status: PrismaSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
                isForeground: false,
              },
              include: sessionInclude,
            });
            const contexts = await latestPauseContexts(transaction, {
              companyId: input.companyId,
              sessionIds: pausedRows.map((row) => row.id),
            });
            const rowsById = new Map(pausedRows.map((row) => [row.id, row]));
            const linkedCandidates = pausedRows.flatMap((row) => {
              const context = contexts.get(row.id);
              return context?.interruptedBySessionId === beforeRow.id
                ? [
                    {
                      sessionId: row.id,
                      ...effectivePriority(row),
                      previousStatus: context.previousStatus,
                      pausedAt: context.pausedAt,
                    } satisfies PausedPriorityCandidate,
                  ]
                : [];
            });
            const selected = selectPriorityResumeCandidate(linkedCandidates);
            const selectedRow = selected
              ? (rowsById.get(selected.sessionId) ?? null)
              : null;
            const selectedContext = selected
              ? (contexts.get(selected.sessionId) ?? null)
              : null;
            if (effectiveAfter.status === 'closed') {
              coordinatedForeground = false;
              if (selectedRow && selectedContext) {
                resumedPredecessor = {
                  row: selectedRow,
                  context: selectedContext,
                };
                coordinationReason = 'resume-after-close';
              } else {
                coordinationReason = 'no-linked-predecessor';
              }
            } else if (selectedRow && selectedContext && selected) {
              const decision = decidePriorityInterruption({
                foreground: {
                  sessionId: beforeRow.id,
                  ...targetPriority,
                },
                challenger: selected,
              });
              if (decision.action === 'interrupt') {
                coordinatedStatus = 'paused-by-higher-priority';
                coordinatedForeground = false;
                resumedPredecessor = {
                  row: selectedRow,
                  context: selectedContext,
                };
                coordinationReason = 'resume-after-priority-drop';
              }
            }
          } else if (
            effectiveAfter.status !== 'closed' &&
            canChallengeForeground(effectiveAfter.status)
          ) {
            const foreground = await transaction.serviceSession.findFirst({
              where: {
                companyId: input.companyId,
                threadId: beforeRow.threadId,
                id: { not: beforeRow.id },
                isForeground: true,
                status: { not: PrismaSessionStatus.CLOSED },
              },
              include: sessionInclude,
            });
            if (!foreground) {
              coordinatedForeground = true;
              coordinationReason = 'no-current-foreground';
            } else if (!canBeInterrupted(foreground.status)) {
              coordinationReason = 'foreground-not-interruptible';
            } else {
              const decision = decidePriorityInterruption({
                foreground: {
                  sessionId: foreground.id,
                  ...effectivePriority(foreground),
                },
                challenger: {
                  sessionId: beforeRow.id,
                  ...targetPriority,
                },
              });
              if (decision.action === 'interrupt') {
                interruptedForeground = foreground;
                coordinatedForeground = true;
                coordinationReason = 'strictly-higher-priority';
              } else {
                coordinationReason = decision.reason;
              }
            }
            if (
              coordinatedForeground &&
              effectiveAfter.status === 'paused-by-higher-priority'
            ) {
              const contexts = await latestPauseContexts(transaction, {
                companyId: input.companyId,
                sessionIds: [beforeRow.id],
              });
              coordinatedStatus =
                contexts.get(beforeRow.id)?.previousStatus ??
                safeResumeFallback(effectiveAfter);
            } else if (
              !coordinatedForeground &&
              beforeRow.status === PrismaSessionStatus.PAUSED_BY_HIGHER_PRIORITY
            ) {
              coordinatedStatus = 'paused-by-higher-priority';
            }
          } else {
            coordinatedForeground = false;
          }

          if (interruptedForeground) {
            await persistPrioritySideEffect(transaction, {
              companyId: input.companyId,
              actorUserId: input.actorUserId,
              triggeringCommandId: commandId,
              beforeRow: interruptedForeground,
              status: 'paused-by-higher-priority',
              isForeground: false,
              name: 'priority-interrupted',
              occurredAt: coordinationAt,
              metadata: {
                interruptedBySessionId: beforeRow.id,
                triggeringEventName: input.eventName,
                foregroundPriority:
                  priorityFromPrisma[interruptedForeground.priority],
                foregroundOrganizationalWeight: organizationalWeight(
                  interruptedForeground,
                ),
                challengerPriority: targetPriority.priority,
                challengerOrganizationalWeight:
                  targetPriority.organizationalWeight,
                tiePolicy: 'current-foreground-wins',
              },
            });
          }

          const coordinatedAfter: MutateManagedServiceSessionInput['after'] = {
            ...effectiveAfter,
            status: coordinatedStatus,
          };

          const updated = await transaction.serviceSession.updateMany({
            where: {
              id: input.sessionId,
              companyId: input.companyId,
              version: input.expectedVersion,
              isForeground: beforeRow.isForeground,
            },
            data: {
              currentDepartmentId: coordinatedAfter.currentDepartmentId,
              responsibleUserId: coordinatedAfter.responsibleUserId,
              queueId: coordinatedAfter.queueId,
              status: statusToPrisma[coordinatedAfter.status],
              controlMode: controlToPrisma[coordinatedAfter.controlMode],
              priority: priorityToPrisma[coordinatedAfter.priority],
              priorityReason: coordinatedAfter.priorityReason,
              prioritySource:
                prioritySourceToPrisma[coordinatedAfter.prioritySource],
              isForeground: coordinatedForeground,
              conversationResolved: coordinatedAfter.conversationResolved,
              pendingActions: asPrismaJson(coordinatedAfter.pendingActions),
              resolutionConfirmedByCustomer:
                coordinatedAfter.resolutionConfirmedByCustomer,
              closingStartedAt: coordinatedAfter.aiClosingStartedAt,
              closingDeadlineAt: coordinatedAfter.aiClosingStartedAt
                ? new Date(
                    coordinatedAfter.aiClosingStartedAt.getTime() + 30 * 60_000,
                  )
                : null,
              closedAt: coordinatedAfter.closedAt,
              ...(input.publicContinuationCode
                ? {
                    publicContinuationCode: input.publicContinuationCode,
                    continuationCodeExpiresAt:
                      input.continuationCodeExpiresAt ?? null,
                  }
                : {}),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw conflict(
              'O atendimento foi atualizado. Recarregue os dados antes de tentar novamente.',
            );
          }

          if (resumedPredecessor) {
            await persistPrioritySideEffect(transaction, {
              companyId: input.companyId,
              actorUserId: input.actorUserId,
              triggeringCommandId: commandId,
              beforeRow: resumedPredecessor.row,
              status: resumedPredecessor.context.previousStatus,
              isForeground: true,
              name: 'priority-resumed',
              occurredAt: coordinationAt,
              metadata: {
                resumedAfterSessionId: beforeRow.id,
                triggeringEventName: input.eventName,
                resumeReason: coordinationReason,
                restoredStatus: resumedPredecessor.context.previousStatus,
                priority: priorityFromPrisma[resumedPredecessor.row.priority],
                organizationalWeight: organizationalWeight(
                  resumedPredecessor.row,
                ),
                tiePolicy: 'current-foreground-wins',
              },
            });
          }

          const assignmentChanged =
            beforeRow.currentDepartmentId !==
              coordinatedAfter.currentDepartmentId ||
            beforeRow.responsibleUserId !==
              coordinatedAfter.responsibleUserId ||
            beforeRow.queueId !== coordinatedAfter.queueId ||
            coordinatedAfter.status === 'closed';
          if (assignmentChanged) {
            const previous =
              await transaction.serviceSessionAssignment.findFirst({
                where: {
                  companyId: input.companyId,
                  serviceSessionId: input.sessionId,
                  status: ServiceAssignmentStatus.ACTIVE,
                },
                orderBy: { startedAt: 'desc' },
                select: { id: true },
              });
            await transaction.serviceSessionAssignment.updateMany({
              where: {
                companyId: input.companyId,
                serviceSessionId: input.sessionId,
                status: ServiceAssignmentStatus.ACTIVE,
              },
              data: {
                status: endedAssignmentStatus(input.eventName),
                endedAt: new Date(),
              },
            });
            if (
              coordinatedAfter.status !== 'closed' &&
              coordinatedAfter.currentDepartmentId
            ) {
              await transaction.serviceSessionAssignment.create({
                data: {
                  companyId: input.companyId,
                  serviceSessionId: input.sessionId,
                  departmentId: coordinatedAfter.currentDepartmentId,
                  assignedUserId: coordinatedAfter.responsibleUserId,
                  queueId: coordinatedAfter.queueId,
                  assignedByUserId: input.actorUserId,
                  previousAssignmentId: previous?.id ?? null,
                  status: ServiceAssignmentStatus.ACTIVE,
                  source: ServiceAssignmentSource.MANUAL,
                  reason: input.assignmentReason ?? null,
                },
              });
            }
          }

          const afterRow = await transaction.serviceSession.findFirst({
            where: { id: input.sessionId, companyId: input.companyId },
            include: sessionInclude,
          });
          if (!afterRow) throw notFound('Atendimento');
          if (
            beforeRow.isForeground &&
            coordinatedStatus === 'paused-by-higher-priority' &&
            resumedPredecessor
          ) {
            await persistPriorityObservation(transaction, {
              companyId: input.companyId,
              actorUserId: input.actorUserId,
              triggeringCommandId: commandId,
              beforeRow,
              afterRow,
              name: 'priority-interrupted',
              occurredAt: coordinationAt,
              metadata: {
                interruptedBySessionId: resumedPredecessor.row.id,
                triggeringEventName: input.eventName,
                foregroundPriority: targetPriority.priority,
                foregroundOrganizationalWeight:
                  targetPriority.organizationalWeight,
                challengerPriority:
                  priorityFromPrisma[resumedPredecessor.row.priority],
                challengerOrganizationalWeight: organizationalWeight(
                  resumedPredecessor.row,
                ),
                tiePolicy: 'current-foreground-wins',
              },
            });
          }
          const before = toManaged(beforeRow);
          const after = toManaged(afterRow);
          const coordinationMetadata = {
            reason: coordinationReason,
            targetWasForeground: beforeRow.isForeground,
            targetIsForeground: afterRow.isForeground,
            targetPriority: targetPriority.priority,
            targetOrganizationalWeight: targetPriority.organizationalWeight,
            interruptedSessionId: interruptedForeground?.id ?? null,
            resumedSessionId: resumedPredecessor?.row.id ?? null,
            tiePolicy: 'current-foreground-wins',
          } as const;
          await transaction.serviceSessionEvent.create({
            data: {
              companyId: input.companyId,
              serviceSessionId: input.sessionId,
              commandId,
              commandFingerprint,
              name: input.eventName,
              expectedVersion: input.expectedVersion,
              resultingVersion: input.expectedVersion + 1,
              actorType: MutationActorType.HUMAN_USER,
              actorUserId: input.actorUserId,
              beforeSnapshot: asPrismaJson(before),
              afterSnapshot: asPrismaJson(after),
              metadata: asPrismaJson({
                ...(input.metadata ?? {}),
                priorityCoordination: coordinationMetadata,
              }),
              createdAt: coordinationAt,
            },
          });
          await transaction.tenantAuditLog.create({
            data: {
              companyId: input.companyId,
              actorUserId: input.actorUserId,
              action: `service-session.${input.eventName}`,
              targetType: 'service-session',
              targetId: input.sessionId,
              metadata: asPrismaJson({
                commandId,
                expectedVersion: input.expectedVersion,
                resultingVersion: input.expectedVersion + 1,
                assignmentReason: input.assignmentReason ?? null,
                priorityCoordination: coordinationMetadata,
              }),
              createdAt: coordinationAt,
            },
          });
          return { session: after, replayed: false };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2034'
      ) {
        throw conflict(
          'A coordenação de prioridade encontrou uma atualização concorrente.',
        );
      }
      rethrowKnownPrismaConflict(error);
    }
  }
}
