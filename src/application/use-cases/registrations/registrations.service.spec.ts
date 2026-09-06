import { Prisma } from '../../../infra/database/prisma/generated/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../infra/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { RegistrationsService } from './registrations.service';

vi.mock('../../../infra/database/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const companyId = '00000000-0000-4000-8000-000000000001';
const registrationId = '00000000-0000-4000-8000-000000000002';
const actorUserId = '00000000-0000-4000-8000-000000000003';
const responsibleUserId = '00000000-0000-4000-8000-000000000004';
const cpf = '52998224725';
const phone = '5534999990000';

const current = {
  id: actorUserId,
  companyId,
  routingCompanyId: null,
  isAdministrator: true,
  departments: [],
  permissions: [],
} as AuthenticatedPrincipal;

const now = new Date('2026-08-30T12:00:00.000Z');
const roles = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    companyId,
    code: 'client',
    name: 'Cliente',
    isSystem: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    companyId,
    code: 'driver',
    name: 'Motorista',
    isSystem: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
];

function temporaryDriver() {
  return {
    id: registrationId,
    companyId,
    taxId: cpf,
    legalName: 'Maria Motorista',
    tradeName: null,
    costCenter: null,
    clientType: 'PF',
    firstName: 'Maria',
    lastName: 'Motorista',
    individualName: 'Maria Motorista',
    cpf,
    individualEmail: null,
    individualWhatsapp: phone,
    individualPhones: [],
    cnpj: null,
    legalEmail: null,
    legalWhatsapp: null,
    legalPhones: [],
    status: 'ACTIVE',
    avicExternalId: null,
    avicLastSyncedAt: null,
    isTemporary: true,
    temporaryReason: 'Substituição emergencial.',
    regularizationDueAt: new Date('2026-09-06T12:00:00.000Z'),
    regularizedAt: null,
    regularizationRequirements: ['driver-license-before-assignment'],
    temporaryResponsibleUserId: responsibleUserId,
    temporaryResponsible: { id: responsibleUserId, name: 'Responsável' },
    version: 1,
    createdByUserId: actorUserId,
    createdAt: now,
    updatedAt: now,
    roleAssignments: [{ role: roles[1] }],
    tagAssignments: [],
    registrationPhones: [
      {
        id: '00000000-0000-4000-8000-000000000020',
        companyId,
        registrationId,
        originalValue: phone,
        normalizedValue: phone,
        countryCode: '55',
        areaCode: '34',
        number: '999990000',
        type: 'mobile',
        isPrimary: true,
        hasWhatsApp: false,
        whatsappContactId: null,
        activeFrom: new Date('2026-08-30T00:00:00.000Z'),
        activeUntil: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    registrationEmails: [],
    externalReferences: [],
    outgoingRegistrationRelationships: [],
    incomingRegistrationRelationships: [],
  };
}

function createHarness() {
  let state = temporaryDriver();
  let nextTransactionError: (Error & { code: string }) | undefined;
  const historyByCommand = new Map<string, Record<string, unknown>>();
  const findHistory = async ({
    where,
  }: {
    where: { companyId_commandId: { commandId: string } };
  }) => historyByCommand.get(where.companyId_commandId.commandId) ?? null;
  const transaction = {
    routingCompanyHistory: {
      findUnique: vi.fn(findHistory),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        historyByCommand.set(String(data.commandId), { ...data });
        return data;
      }),
    },
    routingCompany: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(async () => state),
      create: vi.fn(async () => state),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { version: number };
          data: object;
        }) => {
          if (where.version !== state.version) return { count: 0 };
          const columns = { ...data } as Record<string, unknown>;
          delete columns.version;
          if (columns.documentProfile === Prisma.DbNull)
            columns.documentProfile = null;
          state = {
            ...state,
            ...columns,
            version: state.version + 1,
            updatedAt: new Date(state.updatedAt.getTime() + 1),
          };
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: vi.fn(async () => state),
    },
    registrationRole: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn(
        async ({ where }: { where: { code: { in: string[] } } }) =>
          roles.filter((role) => where.code.in.includes(role.code)),
      ),
    },
    registrationTag: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    registrationRoleAssignment: {
      deleteMany: vi.fn(async () => {
        state = { ...state, roleAssignments: [] };
        return { count: 1 };
      }),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ roleId: string }> }) => {
          state = {
            ...state,
            roleAssignments: data.map(({ roleId }) => ({
              role: roles.find((role) => role.id === roleId)!,
            })),
          };
          return { count: data.length };
        },
      ),
    },
    registrationTagAssignment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    registrationEmail: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    registrationExternalReference: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    registrationPhone: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    routingCompanyHistory: {
      findUnique: vi.fn(findHistory),
    },
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) => {
        if (nextTransactionError) {
          const error = nextTransactionError;
          nextTransactionError = undefined;
          throw error;
        }
        return operation(transaction);
      },
    ),
  } as unknown as PrismaService;

  return {
    service: new RegistrationsService(prisma),
    historyByCommand,
    failNextTransactionWithCode: (code: string) => {
      nextTransactionError = Object.assign(new Error('Prisma conflict'), {
        code,
      });
    },
  };
}

function mutation(
  expectedVersion: number,
  commandId: string,
  roleCodes: string[],
) {
  return {
    type: 'pf' as const,
    firstName: 'Maria',
    lastName: 'Motorista',
    cpf,
    roleCodes,
    phones: [{ number: phone }],
    expectedVersion,
    commandId,
  };
}

describe('RegistrationsService regularization requirements', () => {
  it('replays a concurrent create and rejects another payload for its command', async () => {
    const { service, failNextTransactionWithCode } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000100';
    const command = {
      type: 'pf' as const,
      firstName: 'Maria',
      lastName: 'Motorista',
      cpf,
      roleCodes: ['driver'],
      phones: [{ number: phone }],
      commandId,
    };
    const original = await service.create(current, command);
    failNextTransactionWithCode('P2002');

    await expect(service.create(current, command)).resolves.toEqual(original);
    await expect(
      service.create(current, { ...command, lastName: 'Outro Sobrenome' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('replays a concurrent create when duplicate detection observes the winner first', async () => {
    const { service, failNextTransactionWithCode } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000107';
    const command = {
      type: 'pf' as const,
      firstName: 'Maria',
      lastName: 'Motorista',
      cpf,
      roleCodes: ['driver'],
      phones: [{ number: phone }],
      commandId,
    };
    const original = await service.create(current, command);
    failNextTransactionWithCode('CONFLICT');

    await expect(service.create(current, command)).resolves.toEqual(original);
  });

  it('replays the original regularization result after a later edit', async () => {
    const { service } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000101';
    const command = mutation(1, commandId, ['driver']);

    const regularized = await service.regularize(
      current,
      registrationId,
      command,
    );
    await service.update(current, registrationId, {
      ...mutation(2, '00000000-0000-4000-8000-000000000102', ['driver']),
      lastName: 'Motorista Editada',
    });

    await expect(
      service.regularize(current, registrationId, command),
    ).resolves.toEqual(regularized);
  });

  it('rejects a reused regularization command with a different payload', async () => {
    const { service } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000103';

    await service.regularize(
      current,
      registrationId,
      mutation(1, commandId, ['driver']),
    );

    await expect(
      service.regularize(current, registrationId, {
        ...mutation(1, commandId, ['driver']),
        lastName: 'Outro Sobrenome',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a reused regularization command for another target or actor', async () => {
    const { service } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000104';
    const command = mutation(1, commandId, ['driver']);

    await service.regularize(current, registrationId, command);

    await expect(
      service.regularize(
        current,
        '00000000-0000-4000-8000-000000000099',
        command,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.regularize(
        {
          ...current,
          id: '00000000-0000-4000-8000-000000000098',
        },
        registrationId,
        command,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('fails closed when replaying legacy history without a fingerprint', async () => {
    const { service, historyByCommand } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000105';
    historyByCommand.set(commandId, {
      routingCompanyId: registrationId,
      actorUserId,
      commandId,
      commandFingerprint: null,
      action: 'REGISTRATION_REGULARIZED',
      afterSnapshot: { id: registrationId, version: 2 },
    });

    await expect(
      service.regularize(
        current,
        registrationId,
        mutation(1, commandId, ['driver']),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('recovers the original result after a concurrent unique command conflict', async () => {
    const { service, failNextTransactionWithCode } = createHarness();
    const commandId = '00000000-0000-4000-8000-000000000106';
    const command = mutation(1, commandId, ['driver']);
    const original = await service.regularize(current, registrationId, command);
    failNextTransactionWithCode('P2002');

    await expect(
      service.regularize(current, registrationId, command),
    ).resolves.toEqual(original);
  });

  it('preserves an operational requirement after regularization and a common edit', async () => {
    const { service } = createHarness();

    await service.regularize(
      current,
      registrationId,
      mutation(1, '10000000-0000-4000-8000-000000000001', ['driver']),
    );
    const edited = await service.update(
      current,
      registrationId,
      mutation(2, '10000000-0000-4000-8000-000000000002', ['driver']),
    );

    expect(edited).toMatchObject({
      isTemporary: false,
      regularizationRequirements: ['driver-license-before-assignment'],
    });
  });

  it('regenerates an operational requirement when a role is reintroduced', async () => {
    const { service } = createHarness();

    await service.regularize(
      current,
      registrationId,
      mutation(1, '20000000-0000-4000-8000-000000000001', ['driver']),
    );
    const withoutDriver = await service.update(
      current,
      registrationId,
      mutation(2, '20000000-0000-4000-8000-000000000002', ['client']),
    );
    const withDriverAgain = await service.update(
      current,
      registrationId,
      mutation(3, '20000000-0000-4000-8000-000000000003', ['client', 'driver']),
    );

    expect(withoutDriver).toMatchObject({
      regularizationRequirements: [],
    });
    expect(withDriverAgain).toMatchObject({
      regularizationRequirements: ['driver-license-before-assignment'],
    });
  });
});

describe('RegistrationsService promotion graph', () => {
  it('lets the parent registration supply companyId to nested promotion records', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      registrationRole: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'role-client', code: 'client' }]),
      },
      registrationTag: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'tag-operations', code: 'operations', name: 'Operacional' },
          ]),
      },
      routingCompany: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
        findMany: vi.fn().mockResolvedValue([]),
      },
      registrationRelationship: { create: vi.fn() },
      routingCompanyHistory: { create: vi.fn() },
    };
    const service = new RegistrationsService(transaction as never);
    const current = {
      id: 'user-1',
      companyId: 'company-1',
      routingCompanyId: null,
    } as AuthenticatedPrincipal;

    await service.createPromotionGraph(
      transaction as never,
      current,
      {
        type: 'pf',
        firstName: 'ANA',
        roleCodes: ['client'],
        tagCodes: ['operations'],
        phones: [{ number: '(34) 99999-0000' }],
        emails: [{ address: 'ana@example.com' }],
      },
      { commandId: 'command-1', candidateId: 'candidate-1' },
    );

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data.companyId).toBe('company-1');
    expect(data.roleAssignments.create[0]).not.toHaveProperty('companyId');
    expect(data.tagAssignments.create[0]).not.toHaveProperty('companyId');
    expect(data.registrationPhones.create[0]).not.toHaveProperty('companyId');
    expect(data.registrationEmails.create[0]).not.toHaveProperty('companyId');
  });
});
