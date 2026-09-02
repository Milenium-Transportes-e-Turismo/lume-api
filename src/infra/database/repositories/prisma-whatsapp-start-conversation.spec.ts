import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  ConversationState,
  DepartmentCode,
  DocumentAccessMode,
  UserAccountStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  actor: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  channel: '00000000-0000-4000-8000-000000000004',
  contact: '00000000-0000-4000-8000-000000000005',
  conversation: '00000000-0000-4000-8000-000000000006',
};

function input() {
  return {
    companyId: ids.company,
    phoneNormalized: '5534999999999',
    commandId: ids.command,
    actorUserId: ids.actor,
  };
}

function createHarness(
  options: { permissionCodes?: string[]; departments?: string[] } = {},
) {
  const result = {
    id: ids.conversation,
    version: 2,
    conversationState: 'human-active' as const,
    assignedTo: { id: ids.actor, name: 'Atendente' },
    idempotent: false,
  };
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: ids.actor }]),
    user: {
      findUnique: vi.fn(async () => ({
        id: ids.actor,
        name: 'Atendente',
        isActive: true,
        status: UserAccountStatus.ACTIVE,
        deletedAt: null,
        isAdministrator: false,
        documentAccessMode: DocumentAccessMode.STANDARD,
        departments: options.departments ?? ['operations'],
        permissionCodes: options.permissionCodes ?? [
          'whatsapp-conversations:attend',
        ],
      })),
    },
    integrationInbox: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => undefined),
    },
    whatsAppChannel: {
      findFirst: vi.fn(async () => ({ id: ids.channel })),
    },
    whatsAppContact: {
      upsert: vi.fn(async () => ({ id: ids.contact })),
    },
    whatsAppConversation: {
      upsert: vi.fn(async () => ({ id: ids.conversation })),
      findUnique: vi.fn(async () => ({
        id: ids.conversation,
        companyId: ids.company,
        version: 1,
        conversationState: ConversationState.BOT_ACTIVE,
        assignedToUserId: null,
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };
  const repository = new PrismaWhatsAppRepository(
    prisma as unknown as PrismaService,
    new ConfigService({}),
  );
  const transition = vi
    .spyOn(repository, 'transition')
    .mockResolvedValue(result);

  return { repository, transaction, transition, result };
}

describe('PrismaWhatsAppRepository startHumanConversation', () => {
  it('authorizes, creates the canonical records and takes over inside one transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.startHumanConversation(input()),
    ).resolves.toEqual(harness.result);

    expect(harness.transaction.whatsAppContact.upsert).toHaveBeenCalledOnce();
    expect(
      harness.transaction.whatsAppConversation.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          department: DepartmentCode.OPERATIONS,
        }),
      }),
    );
    expect(harness.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: ids.company,
        conversationId: ids.conversation,
        commandId: ids.command,
        expectedVersion: 1,
        name: 'take-over',
        actorUserId: ids.actor,
      }),
      harness.transaction,
    );
    expect(harness.transaction.integrationInbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'panel.start-conversation',
          externalEventId: ids.command,
        }),
      }),
    );
  });

  it('persists neither contact nor conversation when current attendance permission is absent', async () => {
    const harness = createHarness({ permissionCodes: [] });

    await expect(
      harness.repository.startHumanConversation(input()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.transaction.whatsAppContact.upsert).not.toHaveBeenCalled();
    expect(
      harness.transaction.whatsAppConversation.upsert,
    ).not.toHaveBeenCalled();
    expect(harness.transition).not.toHaveBeenCalled();
    expect(harness.transaction.integrationInbox.create).not.toHaveBeenCalled();
  });

  it('requires an explicit queue for a multi-department attendant', async () => {
    const harness = createHarness({
      departments: ['operations', 'financial'],
    });

    await expect(
      harness.repository.startHumanConversation(input()),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(harness.transaction.whatsAppContact.upsert).not.toHaveBeenCalled();
    expect(
      harness.transaction.whatsAppConversation.upsert,
    ).not.toHaveBeenCalled();
  });

  it('starts a multi-department attendant in the explicitly selected assigned queue', async () => {
    const harness = createHarness({
      departments: ['operations', 'financial'],
    });

    await expect(
      harness.repository.startHumanConversation({
        ...input(),
        targetDepartment: 'financial',
      }),
    ).resolves.toEqual(harness.result);

    expect(
      harness.transaction.whatsAppConversation.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          department: DepartmentCode.FINANCIAL,
        }),
      }),
    );
  });

  it('rejects an initial queue outside the attendant departments', async () => {
    const harness = createHarness({ departments: ['operations'] });

    await expect(
      harness.repository.startHumanConversation({
        ...input(),
        targetDepartment: 'financial',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.transaction.whatsAppContact.upsert).not.toHaveBeenCalled();
    expect(
      harness.transaction.whatsAppConversation.upsert,
    ).not.toHaveBeenCalled();
  });

  it('never accepts a client company as the internal initial queue', async () => {
    const harness = createHarness({ departments: ['operations'] });

    await expect(
      harness.repository.startHumanConversation({
        ...input(),
        targetDepartment: 'client-company',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(harness.transaction.whatsAppContact.upsert).not.toHaveBeenCalled();
  });
});
