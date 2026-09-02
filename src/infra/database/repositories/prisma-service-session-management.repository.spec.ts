import { describe, expect, it, vi } from 'vitest';

import type { ManagedServiceSession } from '../../../application/contracts/service-session-management.repository';
import {
  DepartmentCode,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaServiceSessionManagementRepository } from './prisma-service-session-management.repository';

function repositoryHarness() {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const findFirst = vi.fn().mockResolvedValue(null);
  const tenantDepartmentFindMany = vi.fn().mockResolvedValue([]);
  const userFindMany = vi.fn().mockResolvedValue([]);
  const transaction = vi.fn((operations: readonly Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const prisma = {
    serviceSession: { findMany, count, findFirst },
    tenantDepartment: { findMany: tenantDepartmentFindMany },
    user: { findMany: userFindMany },
    $transaction: transaction,
  };

  return {
    repository: new PrismaServiceSessionManagementRepository(
      prisma as unknown as PrismaService,
    ),
    findMany,
    findFirst,
    tenantDepartmentFindMany,
  };
}

function managedSession(
  patch: Partial<ManagedServiceSession> = {},
): ManagedServiceSession {
  const now = new Date('2026-08-29T12:00:00.000Z');
  return {
    id: 'session-1',
    companyId: 'company-1',
    threadId: 'thread-1',
    sourceChannelId: 'channel-1',
    sourceChannelName: 'Canal principal',
    contactPhone: '5534999999999',
    contactName: 'Cliente',
    currentDepartmentId: 'department-commercial',
    currentDepartmentCode: 'commercial',
    currentDepartmentName: 'Comercial',
    responsibleUserId: null,
    responsibleUserName: null,
    queueId: null,
    queueName: null,
    responsible: null,
    queue: null,
    relatedServiceSessionId: null,
    isForeground: true,
    availableActions: ['ASSUME', 'TRANSFER_DEPARTMENT'],
    status: 'waiting-human',
    controlMode: 'human',
    priority: 'normal',
    priorityReason: null,
    prioritySource: 'system',
    conversationResolved: false,
    pendingActions: [],
    resolutionConfirmedByCustomer: false,
    aiClosingStartedAt: null,
    closedAt: null,
    version: 2,
    publicContinuationCode: null,
    continuationCodeExpiresAt: null,
    closingDeadlineAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function sessionRow() {
  const now = new Date('2026-08-29T12:00:00.000Z');
  return {
    id: 'session-1',
    companyId: 'company-1',
    threadId: 'thread-1',
    sourceChannelId: 'channel-1',
    sourceChannel: { name: 'Canal principal' },
    thread: {
      contact: {
        phoneNormalized: '5534999999999',
        displayName: 'Cliente',
      },
    },
    currentDepartmentId: 'department-commercial',
    currentDepartment: {
      id: 'department-commercial',
      code: DepartmentCode.COMMERCIAL,
      name: 'Comercial',
      serviceQueues: [],
    },
    responsibleUserId: null,
    responsibleUser: null,
    queueId: null,
    queue: null,
    relatedServiceSessionId: null,
    status: ServiceSessionStatus.WAITING_HUMAN,
    controlMode: ServiceSessionControlMode.HUMAN,
    priority: ServiceSessionPriority.NORMAL,
    priorityReason: null,
    prioritySource: ServiceSessionPrioritySource.SYSTEM,
    conversationResolved: false,
    pendingActions: [],
    resolutionConfirmedByCustomer: false,
    closingStartedAt: null,
    closingDeadlineAt: null,
    closedAt: null,
    isForeground: true,
    version: 2,
    publicContinuationCode: null,
    continuationCodeExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function listInput(
  accessibleDepartments: Parameters<
    PrismaServiceSessionManagementRepository['list']
  >[0]['accessibleDepartments'],
) {
  return {
    companyId: 'company-1',
    accessibleDepartments,
    page: 1,
    pageSize: 20,
  };
}

describe('PrismaServiceSessionManagementRepository access scope', () => {
  it('mantém o companyId como único filtro de acesso para escopo tenant-wide', async () => {
    const { repository, findMany } = repositoryHarness();

    await repository.list(listInput(null));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ companyId: 'company-1' }]),
        }),
      }),
    );
    expect(findMany.mock.calls[0]?.[0]?.where?.AND?.[0]).toEqual({
      companyId: 'company-1',
    });
  });

  it('preserva tenant e identificador no acesso direto tenant-wide', async () => {
    const { repository, findFirst } = repositoryHarness();

    await repository.getAccessible({
      companyId: 'company-1',
      sessionId: 'session-1',
      accessibleDepartments: null,
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ id: 'session-1' }, { companyId: 'company-1' }],
        },
      }),
    );
  });

  it('remove CLIENT_COMPANY de um escopo departamental misto', async () => {
    const { repository, findMany } = repositoryHarness();

    await repository.list(listInput(['client-company', 'commercial']));

    expect(findMany.mock.calls[0]?.[0]?.where?.AND?.[0]).toEqual({
      companyId: 'company-1',
      OR: [
        { currentDepartmentId: null },
        {
          currentDepartment: {
            is: { code: { in: [DepartmentCode.COMMERCIAL] } },
          },
        },
      ],
    });
  });

  it('mantém a sentinela de negação quando sobra um escopo vazio', async () => {
    const { repository, findMany } = repositoryHarness();

    await repository.list(listInput(['client-company']));

    expect(findMany.mock.calls[0]?.[0]?.where?.AND?.[0]).toEqual({
      companyId: 'company-1',
      id: '__not-accessible__',
    });
  });

  it('não publica client-company como destino de assignment', async () => {
    const { repository, tenantDepartmentFindMany } = repositoryHarness();

    await repository.listAssignmentTargets({ companyId: 'company-1' });

    expect(tenantDepartmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          code: { not: DepartmentCode.CLIENT_COMPANY },
        },
      }),
    );
  });

  it('rejeita transferência direta para um UUID de client-company', async () => {
    const row = sessionRow();
    const tenantDepartmentFindFirst = vi
      .fn()
      .mockResolvedValue({ code: DepartmentCode.CLIENT_COMPANY });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      serviceSessionEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      serviceSession: { findFirst: vi.fn().mockResolvedValue(row) },
      tenantDepartment: { findFirst: tenantDepartmentFindFirst },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaServiceSessionManagementRepository(
      prisma as unknown as PrismaService,
    );
    const before = managedSession();
    const after = managedSession({
      currentDepartmentId: 'department-client-company',
      currentDepartmentCode: 'client-company',
      currentDepartmentName: 'Empresa cliente',
      version: 3,
    });

    await expect(
      repository.mutate({
        companyId: 'company-1',
        sessionId: 'session-1',
        actorUserId: 'user-1',
        commandId: 'command-transfer-client-company',
        expectedVersion: 2,
        accessibleDepartments: null,
        eventName: 'transfer',
        before,
        after,
        assignmentReason: 'Tentativa inválida',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Empresa cliente não pode receber atendimentos internos.',
    });
    expect(tenantDepartmentFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'department-client-company',
        companyId: 'company-1',
      },
      select: { code: true },
    });
  });
});
