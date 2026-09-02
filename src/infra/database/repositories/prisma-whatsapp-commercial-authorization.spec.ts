import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { UserAccountStatus } from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaWhatsAppRepository } from './prisma-whatsapp.repository';

const ids = {
  company: '00000000-0000-4000-8000-000000000001',
  actor: '00000000-0000-4000-8000-000000000002',
  command: '00000000-0000-4000-8000-000000000003',
  conversation: '00000000-0000-4000-8000-000000000004',
};

function proposalInput() {
  return {
    companyId: ids.company,
    conversationId: ids.conversation,
    actorUserId: ids.actor,
    commandId: ids.command,
    expectedVersion: 1,
    contactName: 'Cliente Teste',
    serviceType: 'Fretamento eventual',
    origin: 'Uberlândia/MG',
    destination: 'São Paulo/SP',
    departureDate: new Date('2026-10-10T00:00:00.000Z'),
    passengerCount: 20,
    vehicleAtDisposal: false,
    localTransfers: false,
  };
}

function createHarness(options: {
  isAdministrator?: boolean;
  departments?: string[];
  permissionCodes?: string[];
}) {
  const transaction = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: ids.actor }]),
    user: {
      findUnique: vi.fn(async () => ({
        isActive: true,
        status: UserAccountStatus.ACTIVE,
        deletedAt: null,
        isAdministrator: options.isAdministrator ?? false,
        departments: options.departments ?? [],
        permissionCodes: options.permissionCodes ?? [],
      })),
    },
    integrationInbox: {
      findUnique: vi.fn(async () => null),
    },
    whatsAppConversation: {
      findUnique: vi.fn(async () => null),
    },
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
    transaction,
  };
}

describe('PrismaWhatsAppRepository commercial mutation authorization', () => {
  it('revalidates the individual Commercial capability under a user row lock', async () => {
    const harness = createHarness({
      departments: ['commercial'],
      permissionCodes: ['commercial:manage'],
    });

    await expect(
      harness.repository.createQuoteProposal(proposalInput()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(harness.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(harness.transaction.integrationInbox.findUnique).toHaveBeenCalled();
    expect(
      harness.transaction.whatsAppConversation.findUnique,
    ).toHaveBeenCalled();
  });

  it('rejects a revoked capability before reading or mutating the proposal', async () => {
    const harness = createHarness({
      departments: ['commercial'],
      permissionCodes: [],
    });

    await expect(
      harness.repository.createQuoteProposal(proposalInput()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(
      harness.transaction.integrationInbox.findUnique,
    ).not.toHaveBeenCalled();
    expect(
      harness.transaction.whatsAppConversation.findUnique,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'Administrador sem departamentos',
      isAdministrator: true,
      departments: [],
      permissionCodes: [],
      expectedCode: 'NOT_FOUND',
    },
    {
      label: 'Diretoria com tenant:manage',
      isAdministrator: false,
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
      expectedCode: 'NOT_FOUND',
    },
    {
      label: 'Diretoria sem tenant:manage',
      isAdministrator: false,
      departments: ['directorate'],
      permissionCodes: ['commercial:manage'],
      expectedCode: 'FORBIDDEN',
    },
  ])('aplica a política autoritativa para $label', async (scenario) => {
    const harness = createHarness(scenario);

    await expect(
      harness.repository.createQuoteProposal(proposalInput()),
    ).rejects.toMatchObject({ code: scenario.expectedCode });
  });
});
