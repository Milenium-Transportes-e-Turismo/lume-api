import { describe, expect, it, vi } from 'vitest';

import {
  ServiceSessionManagementRepository,
  type ManagedServiceSession,
  type MutateManagedServiceSessionInput,
} from '../../contracts/service-session-management.repository';
import {
  ManageServiceSessionUseCase,
  QueryServiceSessionsUseCase,
} from './manage-service-sessions.use-case';

function session(
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
    currentDepartmentId: 'department-1',
    currentDepartmentCode: 'commercial',
    currentDepartmentName: 'Comercial',
    responsibleUserId: null,
    responsibleUserName: null,
    queueId: 'queue-1',
    queueName: 'Comercial',
    responsible: null,
    queue: { id: 'queue-1', name: 'Comercial' },
    relatedServiceSessionId: null,
    isForeground: true,
    availableActions: [
      'ASSUME',
      'TRANSFER_USER',
      'TRANSFER_DEPARTMENT',
      'CHANGE_PRIORITY',
      'RETURN_TO_AI',
      'CLOSE',
    ],
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

class RecordingRepository extends ServiceSessionManagementRepository {
  current: ManagedServiceSession | null = session();
  mutations: MutateManagedServiceSessionInput[] = [];

  list = vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });

  listAssignmentTargets = vi.fn().mockResolvedValue([]);

  getAccessible = vi.fn(async () => this.current);

  async mutate(input: MutateManagedServiceSessionInput) {
    this.mutations.push(input);
    this.current = { ...input.before, ...input.after };
    return { session: this.current, replayed: false };
  }
}

const actor = {
  companyId: 'company-1',
  actorUserId: 'user-1',
  accessibleDepartments: ['commercial'] as const,
};

describe('ManageServiceSessionUseCase', () => {
  it('assume para o próprio usuário autenticado e preserva o canal de origem', async () => {
    const repository = new RecordingRepository();
    const useCase = new ManageServiceSessionUseCase(repository);

    const result = await useCase.assume({
      ...actor,
      sessionId: 'session-1',
      commandId: 'command-1',
      expectedVersion: 2,
    });

    expect(result).toMatchObject({
      responsibleUserId: 'user-1',
      controlMode: 'human',
      sourceChannelId: 'channel-1',
      version: 3,
    });
  });

  it('transfere departamento sem trocar thread ou sourceChannel', async () => {
    const repository = new RecordingRepository();
    const useCase = new ManageServiceSessionUseCase(repository);

    const result = await useCase.transfer({
      ...actor,
      sessionId: 'session-1',
      commandId: 'command-2',
      expectedVersion: 2,
      departmentId: 'department-2',
      queueId: 'queue-2',
      reason: 'Encaminhamento financeiro',
    });

    expect(result).toMatchObject({
      threadId: 'thread-1',
      sourceChannelId: 'channel-1',
      currentDepartmentId: 'department-2',
      queueId: 'queue-2',
      responsibleUserId: null,
    });
    expect(repository.mutations[0]?.assignmentReason).toBe(
      'Encaminhamento financeiro',
    );
  });

  it('retorno explícito para IA limpa assignment e nunca ocorre implicitamente', async () => {
    const repository = new RecordingRepository();
    repository.current = session({ responsibleUserId: 'user-2' });
    const useCase = new ManageServiceSessionUseCase(repository);

    await expect(
      useCase.returnToAi({
        ...actor,
        sessionId: 'session-1',
        commandId: 'command-3',
        expectedVersion: 2,
      }),
    ).resolves.toMatchObject({
      controlMode: 'ai',
      responsibleUserId: null,
      queueId: null,
    });
  });

  it('fecha sessão humana com código público de 7 dias sem fechar a thread', async () => {
    const repository = new RecordingRepository();
    const useCase = new ManageServiceSessionUseCase(repository);

    const result = await useCase.close({
      ...actor,
      sessionId: 'session-1',
      commandId: 'command-4',
      expectedVersion: 2,
      reason: 'Demanda resolvida',
    });
    const mutation = repository.mutations[0];

    expect(result).toMatchObject({ status: 'closed', threadId: 'thread-1' });
    expect(mutation?.publicContinuationCode).toMatch(/^\d{3}$/u);
    expect(
      (mutation?.continuationCodeExpiresAt?.getTime() ?? 0) -
        (mutation?.after.closedAt?.getTime() ?? 0),
    ).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it('nega versão desatualizada antes de persistir', async () => {
    const repository = new RecordingRepository();
    const useCase = new ManageServiceSessionUseCase(repository);

    await expect(
      useCase.assume({
        ...actor,
        sessionId: 'session-1',
        commandId: 'command-5',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.mutations).toHaveLength(0);
  });

  it('propaga escopo tenant-wide nulo para leitura e mutação', async () => {
    const repository = new RecordingRepository();
    const useCase = new ManageServiceSessionUseCase(repository);

    await useCase.assume({
      ...actor,
      accessibleDepartments: null,
      sessionId: 'session-1',
      commandId: 'command-tenant-wide',
      expectedVersion: 2,
    });

    expect(repository.getAccessible).toHaveBeenCalledWith({
      companyId: 'company-1',
      sessionId: 'session-1',
      accessibleDepartments: null,
    });
    expect(repository.mutations[0]?.accessibleDepartments).toBeNull();
  });
});

describe('QueryServiceSessionsUseCase', () => {
  it('força tenant e escopo departamental do usuário no filtro', async () => {
    const repository = new RecordingRepository();
    const useCase = new QueryServiceSessionsUseCase(repository);

    await useCase.list(actor, { page: 1, pageSize: 20 });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        accessibleDepartments: ['commercial'],
      }),
    );
  });

  it('delimita os destinos de assignment pelo tenant autenticado', async () => {
    const repository = new RecordingRepository();
    const useCase = new QueryServiceSessionsUseCase(repository);

    await useCase.assignmentTargets(actor);

    expect(repository.listAssignmentTargets).toHaveBeenCalledWith({
      companyId: 'company-1',
    });
  });

  it('preserva null como escopo tenant-wide na listagem', async () => {
    const repository = new RecordingRepository();
    const useCase = new QueryServiceSessionsUseCase(repository);

    await useCase.list(
      { ...actor, accessibleDepartments: null },
      { page: 1, pageSize: 20 },
    );

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        accessibleDepartments: null,
      }),
    );
  });
});
