import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { TransitionCommand } from '../../../application/contracts/whatsapp.repository';
import {
  ConversationState,
  DepartmentCode,
  FlowStep,
  RequestStatus,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
  ServiceSessionStatus,
  UserAccountStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  conversation: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  channel: '00000000-0000-4000-8000-000000000004',
  contact: '00000000-0000-4000-8000-000000000005',
  responsible: '00000000-0000-4000-8000-000000000006',
  otherAttendant: '00000000-0000-4000-8000-000000000007',
  thread: '00000000-0000-4000-8000-000000000008',
  session: '00000000-0000-4000-8000-000000000009',
  department: '00000000-0000-4000-8000-000000000010',
  message: '00000000-0000-4000-8000-000000000011',
  attempt: '00000000-0000-4000-8000-000000000012',
};

function returnToBotCommand(
  actorUserId = ids.otherAttendant,
): TransitionCommand {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    expectedVersion: 3,
    name: 'return-to-bot',
    actorType: 'user',
    actorUserId,
  };
}

function acceptTransferCommand(
  actorUserId = ids.otherAttendant,
): TransitionCommand {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    expectedVersion: 3,
    name: 'accept-transfer',
    actorType: 'user',
    actorUserId,
  };
}

function takeOverCommand(actorUserId = ids.otherAttendant): TransitionCommand {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    expectedVersion: 3,
    name: 'take-over',
    actorType: 'user',
    actorUserId,
  };
}

function transferCommand(
  name: 'request-transfer' | 'change-department',
  metadata?: Readonly<Record<string, unknown>>,
  actorUserId = ids.responsible,
): TransitionCommand {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    expectedVersion: 3,
    name,
    targetDepartment: 'financial',
    metadata,
    actorType: 'user',
    actorUserId,
  };
}

function genericUserCommand(
  name: 'archive' | 'unarchive' | 'mark-read' | 'close',
  actorUserId = ids.otherAttendant,
): TransitionCommand {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    commandId: ids.command,
    expectedVersion: 3,
    name,
    actorType: 'user',
    actorUserId,
  };
}

function createHarness(
  options: {
    department?: DepartmentCode;
    conversationState?: ConversationState;
    actorDepartments?: readonly string[];
    actorPermissionCodes?: readonly string[];
    actorIsAdministrator?: boolean;
    actorIsActive?: boolean;
    assignedToUserId?: string | null;
    pendingTransferDepartment?: DepartmentCode | null;
  } = {},
) {
  const timestamp = new Date('2026-09-01T12:00:00.000Z');
  let conversation = {
    id: ids.conversation,
    companyId: ids.company,
    channelId: ids.channel,
    contactId: ids.contact,
    threadId: ids.thread,
    department: options.department ?? DepartmentCode.COMMERCIAL,
    conversationState:
      options.conversationState ?? ConversationState.HUMAN_ACTIVE,
    flowStep: FlowStep.HUMAN_SERVICE,
    requestStatus: RequestStatus.UNDER_REVIEW,
    resumeState: ConversationState.BOT_ACTIVE,
    resumeFlowStep: FlowStep.COMMERCIAL_FOLLOW_UP_MENU,
    departmentContactOption: null,
    assignedToUserId:
      options.assignedToUserId === undefined
        ? ids.responsible
        : options.assignedToUserId,
    assignedTo:
      options.assignedToUserId === null
        ? null
        : ({
            id: options.assignedToUserId ?? ids.responsible,
            name: 'Atendente responsável',
          } as { id: string; name: string } | null),
    pendingTransferDepartment: options.pendingTransferDepartment ?? null,
    pendingTransferReason:
      options.pendingTransferDepartment == null
        ? null
        : 'Cliente solicitou apoio do departamento de destino.',
    pendingTransferRequestedAt:
      options.pendingTransferDepartment == null ? null : timestamp,
    pendingTransferRequestedByUserId:
      options.pendingTransferDepartment == null ? null : ids.responsible,
    pendingTransferRequestedBy:
      options.pendingTransferDepartment == null
        ? null
        : { id: ids.responsible, name: 'Atendente responsável' },
    unreadCount: 0,
    version: 3,
    mainMenuPresentedAt: null,
    followUpMenuPresentedAt: null,
    contextualFollowUpAt: null,
    lastInboundAt: timestamp,
    lastOutboundAt: null,
    lastMessagePreview: 'Preciso de ajuda',
    closedAt: null,
    archivedAt: null,
    archiveReason: null,
    archiveExemptedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    channel: {
      id: ids.channel,
      name: 'Canal principal',
      phoneNumber: '5534999999999',
    },
    contact: {
      id: ids.contact,
      phoneNormalized: '5534988888888',
      phoneDisplay: '(34) 98888-8888',
      displayName: 'Contato',
      profilePictureUrl: null,
    },
    quoteRequests: [],
    _count: { quoteRequests: 0 },
  };

  const serviceSession = {
    id: ids.session,
    companyId: ids.company,
    threadId: ids.thread,
    sourceChannelId: ids.channel,
    currentDepartmentId: ids.department,
    responsibleUserId: conversation.assignedToUserId,
    queueId: null,
    relatedServiceSessionId: null,
    status: ServiceSessionStatus.OPEN,
    controlMode: ServiceSessionControlMode.HUMAN,
    priority: ServiceSessionPriority.NORMAL,
    priorityReason: null,
    prioritySource: ServiceSessionPrioritySource.HUMAN_USER,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const updateMany = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      const { version, ...values } = data;
      const nextConversation = { ...conversation };
      Object.assign(nextConversation, values);
      if (version && typeof version === 'object' && 'increment' in version) {
        nextConversation.version += Number(version.increment);
      }
      nextConversation.assignedTo = nextConversation.assignedToUserId
        ? {
            id: nextConversation.assignedToUserId,
            name:
              nextConversation.assignedToUserId === ids.responsible
                ? 'Atendente responsável'
                : 'Outro atendente',
          }
        : null;
      conversation = nextConversation;
      return { count: 1 };
    },
  );
  const createTransition = vi.fn(async () => undefined);
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: ids.otherAttendant }]),
    whatsAppConversationTransition: {
      findUnique: vi.fn(async () => null),
      create: createTransition,
    },
    whatsAppConversation: {
      findUnique: vi.fn(async () => conversation),
      findUniqueOrThrow: vi.fn(async () => conversation),
      updateMany,
    },
    whatsAppThread: {
      upsert: vi.fn(async () => ({ id: ids.thread })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    serviceSession: {
      findFirst: vi.fn(async () => serviceSession),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const { version, ...values } = data;
        Object.assign(serviceSession, values);
        if (version && typeof version === 'object' && 'increment' in version) {
          serviceSession.version += Number(version.increment);
        }
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => serviceSession),
    },
    serviceSessionEvent: { create: vi.fn(async () => undefined) },
    tenantDepartment: {
      findUnique: vi.fn(async () => ({ id: ids.department })),
    },
    quoteRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
    quoteProposalDocument: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id_companyId: { id: string } } }) => ({
          id: where.id_companyId.id,
          name:
            where.id_companyId.id === ids.responsible
              ? 'Atendente responsável'
              : 'Outro atendente',
          isActive: options.actorIsActive ?? true,
          status: UserAccountStatus.ACTIVE,
          deletedAt: null,
          isAdministrator: options.actorIsAdministrator ?? false,
          permissionCodes: options.actorPermissionCodes ?? [
            'whatsapp-conversations:attend',
          ],
          departments:
            where.id_companyId.id === ids.otherAttendant
              ? (options.actorDepartments ?? ['commercial'])
              : ['commercial'],
        }),
      ),
    },
    whatsAppMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: ids.message,
        occurredAt: timestamp,
        ...data,
      })),
    },
    whatsAppMessageAttempt: {
      create: vi.fn(async () => ({ id: ids.attempt })),
    },
    integrationOutbox: {
      aggregate: vi.fn(async () => ({ _max: { aggregateSequence: null } })),
      create: vi.fn(async () => undefined),
    },
    tenantAuditLog: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };

  return {
    repository: new PrismaWhatsAppRepository(
      prisma as unknown as PrismaService,
      new ConfigService({}),
    ),
    createTransition,
    updateMany,
  };
}

describe('PrismaWhatsAppRepository return-to-bot authorization', () => {
  it('permite que outro atendente autorizado devolva ao bot com histórico do responsável anterior', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition(returnToBotCommand()),
    ).resolves.toMatchObject({
      conversationState: 'bot-active',
      assignedTo: null,
      version: 4,
    });
    expect(harness.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            assignment: {
              previousAssignedToUserId: ids.responsible,
              resultingAssignedToUserId: null,
              changedByUserId: ids.otherAttendant,
              cause: 'return-to-bot',
            },
          }),
        }),
      }),
    );
  });

  it('bloqueia um usuário sem capacidade individual de atendimento', async () => {
    const harness = createHarness({ actorPermissionCodes: [] });

    await expect(
      harness.repository.transition(returnToBotCommand()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('bloqueia a devolução por usuário fora do departamento responsável', async () => {
    const harness = createHarness({ actorDepartments: ['operations'] });

    await expect(
      harness.repository.transition(returnToBotCommand()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('permite que o atendente responsável devolva a conversa ao bot', async () => {
    const harness = createHarness({
      pendingTransferDepartment: DepartmentCode.OPERATIONS,
    });

    await expect(
      harness.repository.transition(returnToBotCommand(ids.responsible)),
    ).resolves.toMatchObject({
      conversationState: 'bot-active',
      assignedTo: null,
      version: 4,
    });
    expect(harness.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            transfer: expect.objectContaining({
              status: 'cancelled',
              sourceDepartment: 'commercial',
              targetDepartment: 'operations',
              cancellationCause: 'return-to-bot',
            }),
          }),
        }),
      }),
    );
  });
});

describe('PrismaWhatsAppRepository transfer acceptance authorization', () => {
  it('impede aceite por usuário fora do departamento de destino', async () => {
    const harness = createHarness({
      department: DepartmentCode.COMMERCIAL,
      conversationState: ConversationState.HUMAN_ACTIVE,
      actorDepartments: ['commercial'],
      pendingTransferDepartment: DepartmentCode.OPERATIONS,
    });

    await expect(
      harness.repository.transition(acceptTransferCommand()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('permite aceite pelo usuário do departamento de destino', async () => {
    const harness = createHarness({
      department: DepartmentCode.COMMERCIAL,
      conversationState: ConversationState.HUMAN_ACTIVE,
      actorDepartments: ['operations'],
      pendingTransferDepartment: DepartmentCode.OPERATIONS,
    });

    await expect(
      harness.repository.transition(acceptTransferCommand()),
    ).resolves.toMatchObject({
      department: 'operations',
      conversationState: 'human-active',
      version: 4,
    });
    expect(harness.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedToUserId: ids.otherAttendant,
          pendingTransferDepartment: null,
          pendingTransferRequestedByUserId: null,
        }),
      }),
    );
    expect(harness.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            transfer: expect.objectContaining({
              status: 'accepted',
              sourceDepartment: 'commercial',
              targetDepartment: 'operations',
            }),
          }),
        }),
      }),
    );
  });
});

describe('PrismaWhatsAppRepository take-over authorization', () => {
  it('impede que usuário de outro departamento assuma a conversa por ID direto', async () => {
    const harness = createHarness({
      department: DepartmentCode.OPERATIONS,
      conversationState: ConversationState.SENT_TO_HUMAN,
      assignedToUserId: null,
      actorDepartments: ['commercial'],
    });

    await expect(
      harness.repository.transition(takeOverCommand()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('permite substituir outro atendente autorizado e registra a troca', async () => {
    const harness = createHarness({ actorDepartments: ['commercial'] });

    await expect(
      harness.repository.transition(takeOverCommand()),
    ).resolves.toMatchObject({
      assignedTo: { id: ids.otherAttendant },
      version: 4,
    });
    expect(harness.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            assignment: {
              previousAssignedToUserId: ids.responsible,
              resultingAssignedToUserId: ids.otherAttendant,
              changedByUserId: ids.otherAttendant,
              cause: 'take-over',
            },
          }),
        }),
      }),
    );
  });
});

describe('PrismaWhatsAppRepository generic panel action authorization', () => {
  it.each(['archive', 'unarchive', 'mark-read'] as const)(
    'impede %s por usuário de outro departamento',
    async (name) => {
      const harness = createHarness({
        department: DepartmentCode.OPERATIONS,
        actorDepartments: ['commercial'],
      });

      await expect(
        harness.repository.transition(genericUserCommand(name)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(harness.updateMany).not.toHaveBeenCalled();
      expect(harness.createTransition).not.toHaveBeenCalled();
    },
  );

  it('permite que outro atendente autorizado encerre a conversa atribuída', async () => {
    const harness = createHarness({ actorDepartments: ['commercial'] });

    await expect(
      harness.repository.transition(genericUserCommand('close')),
    ).resolves.toMatchObject({ conversationState: 'closed', version: 4 });
    expect(harness.createTransition).toHaveBeenCalled();
  });
});

describe('PrismaWhatsAppRepository transfer request invariants', () => {
  it('rejects a user transfer without an auditable reason', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition(transferCommand('request-transfer')),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('bloqueia solicitação por usuário fora do departamento responsável', async () => {
    const harness = createHarness({ actorDepartments: ['operations'] });

    await expect(
      harness.repository.transition(
        transferCommand(
          'request-transfer',
          { reason: 'Cliente solicitou apoio do Financeiro.' },
          ids.otherAttendant,
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('bloqueia Empresa cliente como fila mesmo para encaminhamento sistêmico', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition({
        companyId: ids.company,
        conversationId: ids.conversation,
        commandId: ids.command,
        expectedVersion: 3,
        name: 'forward',
        targetDepartment: 'client-company',
        actorType: 'system',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('keeps the source department and assignee while registering a pending transfer', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition(
        transferCommand('request-transfer', {
          reason: 'Cliente solicitou apoio sobre a cobrança.',
        }),
      ),
    ).resolves.toMatchObject({
      department: 'commercial',
      conversationState: 'human-active',
      assignedTo: { id: ids.responsible },
      pendingTransfer: {
        targetDepartment: 'financial',
        reason: 'Cliente solicitou apoio sobre a cobrança.',
      },
      version: 4,
    });
    expect(harness.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedToUserId: ids.responsible,
          department: DepartmentCode.COMMERCIAL,
          pendingTransferDepartment: DepartmentCode.FINANCIAL,
          pendingTransferReason: 'Cliente solicitou apoio sobre a cobrança.',
          pendingTransferRequestedByUserId: ids.responsible,
        }),
      }),
    );
    expect(harness.createTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            transfer: expect.objectContaining({
              status: 'requested',
              sourceDepartment: 'commercial',
              targetDepartment: 'financial',
              reason: 'Cliente solicitou apoio sobre a cobrança.',
            }),
          }),
        }),
      }),
    );
  });

  it('prevents direct department changes while a human attendant owns the conversation', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.transition(
        transferCommand('change-department', {
          reason: 'Correção solicitada pelo atendimento.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('prevents an outsider from reclassifying an unassigned conversation by ID', async () => {
    const harness = createHarness({
      assignedToUserId: null,
      actorDepartments: ['operations'],
      conversationState: ConversationState.SENT_TO_HUMAN,
    });

    await expect(
      harness.repository.transition(
        transferCommand(
          'change-department',
          { reason: 'Correção solicitada pelo atendimento.' },
          ids.otherAttendant,
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });

  it('fails closed for an inconsistent human-active conversation without an assignee', async () => {
    const harness = createHarness({ assignedToUserId: null });

    await expect(
      harness.repository.transition(
        transferCommand('change-department', {
          reason: 'Correção solicitada pelo atendimento.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.createTransition).not.toHaveBeenCalled();
  });
});
