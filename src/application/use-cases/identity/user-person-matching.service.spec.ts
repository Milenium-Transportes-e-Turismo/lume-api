import { describe, expect, it, vi } from 'vitest';

import { UserPersonMatchingService } from './user-person-matching.service';

describe('UserPersonMatchingService', () => {
  it('persists an automatic association only for the unique exact CPF candidate', async () => {
    const user = {
      id: 'user-1',
      companyId: 'company-1',
      name: 'Maria da Silva',
      cpfNormalized: '52998224725',
      emailNormalized: 'maria@example.com',
      routingCompanyId: null,
      personRegistrationId: null,
      personAssociationVersion: 1,
      deletedAt: null,
    };
    const person = {
      id: 'person-1',
      companyId: 'company-1',
      clientType: 'PF',
      cpf: '52998224725',
      individualEmail: 'maria@example.com',
      registrationEmails: [],
      individualName: 'Maria da Silva',
      legalName: 'Maria da Silva',
      isTemporary: false,
      regularizationDueAt: null,
    };
    const transaction = {
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      routingCompany: {
        findUnique: vi.fn().mockResolvedValue(person),
      },
      tenantAuditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new UserPersonMatchingService(prisma as never, {
      findCandidates: vi.fn().mockResolvedValue([
        {
          registrationId: 'person-1',
          companyId: 'company-1',
          type: 'pf',
          cpf: '52998224725',
          emails: ['maria@example.com'],
        },
      ]),
    });

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        {
          mode: 'automatic',
          commandId: '00000000-0000-4000-8000-000000000001',
          expectedVersion: 1,
        },
      ),
    ).resolves.toMatchObject({
      userId: 'user-1',
      personRegistrationId: 'person-1',
      associationVersion: 2,
      source: 'unique-exact-cpf',
      needsRegularization: false,
      idempotent: false,
    });
  });

  it('persists an exact e-mail choice only after explicit human confirmation with a reason', async () => {
    const user = {
      id: 'user-1',
      companyId: 'company-1',
      name: 'Maria da Silva',
      cpfNormalized: null,
      emailNormalized: 'maria@example.com',
      routingCompanyId: null,
      personRegistrationId: null,
      personAssociationVersion: 1,
      deletedAt: null,
    };
    const person = {
      id: 'person-2',
      companyId: 'company-1',
      clientType: 'PF',
      cpf: null,
      individualEmail: 'maria@example.com',
      registrationEmails: [],
      individualName: 'Maria da Silva',
      legalName: 'Maria da Silva',
      isTemporary: false,
      regularizationDueAt: null,
    };
    const transaction = {
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      routingCompany: {
        findUnique: vi.fn().mockResolvedValue(person),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new UserPersonMatchingService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        userPersonAssociationHistory: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        $transaction: vi.fn(
          async (work: (value: typeof transaction) => Promise<unknown>) =>
            work(transaction),
        ),
      } as never,
      {
        findCandidates: vi.fn().mockResolvedValue([
          {
            registrationId: 'person-2',
            companyId: 'company-1',
            type: 'pf',
            cpf: null,
            emails: ['maria@example.com'],
          },
        ]),
      },
    );

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        {
          mode: 'confirmed',
          personRegistrationId: 'person-2',
          confirmed: true,
          reason: 'Documento e cadastro conferidos pela Gerência.',
          commandId: '00000000-0000-4000-8000-000000000002',
          expectedVersion: 1,
        },
      ),
    ).resolves.toMatchObject({
      userId: 'user-1',
      personRegistrationId: 'person-2',
      source: 'human-confirmed-email',
      reason: 'Documento e cadastro conferidos pela Gerência.',
      associationVersion: 2,
      idempotent: false,
    });
  });

  it('creates a provisional Pessoa instead of associating an e-mail suggestion automatically', async () => {
    const user = {
      id: 'user-1',
      companyId: 'company-1',
      name: 'Maria da Silva',
      cpfNormalized: null,
      emailNormalized: 'maria@example.com',
      routingCompanyId: 'legacy-access-scope',
      personRegistrationId: null,
      personAssociationVersion: 1,
      deletedAt: null,
    };
    const createdPerson = {
      id: 'provisional-person-1',
      companyId: 'company-1',
      clientType: 'PF',
      cpf: null,
      individualEmail: 'maria@example.com',
      registrationEmails: [{ address: 'maria@example.com' }],
      individualName: 'Maria da Silva',
      legalName: 'Maria da Silva',
      isTemporary: true,
      regularizationDueAt: new Date('2026-09-08T03:00:00.000Z'),
    };
    const transaction = {
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      routingCompany: {
        create: vi.fn().mockResolvedValue(createdPerson),
      },
      routingCompanyHistory: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new UserPersonMatchingService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        userPersonAssociationHistory: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        $transaction: vi.fn(
          async (work: (value: typeof transaction) => Promise<unknown>) =>
            work(transaction),
        ),
      } as never,
      {
        findCandidates: vi.fn().mockResolvedValue([
          {
            registrationId: 'person-by-email',
            companyId: 'company-1',
            type: 'pf',
            cpf: null,
            emails: ['maria@example.com'],
          },
        ]),
      },
    );

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        {
          mode: 'automatic',
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 1,
        },
      ),
    ).resolves.toMatchObject({
      userId: 'user-1',
      personRegistrationId: 'provisional-person-1',
      source: 'provisional',
      needsRegularization: true,
      associationVersion: 2,
      idempotent: false,
    });
    expect(
      transaction.routingCompany.create.mock.calls[0]?.[0]?.data,
    ).not.toHaveProperty('roleAssignments');
  });

  it.each([
    {
      label: 'outro tenant',
      candidate: {
        registrationId: 'person-candidate',
        companyId: 'company-2',
        type: 'pf' as const,
        cpf: null,
        emails: ['maria@example.com'],
      },
    },
    {
      label: 'Empresa',
      candidate: {
        registrationId: 'person-candidate',
        companyId: 'company-1',
        type: 'pj' as const,
        cpf: null,
        emails: ['maria@example.com'],
      },
    },
    {
      label: 'sem evidência idêntica',
      candidate: {
        registrationId: 'person-candidate',
        companyId: 'company-1',
        type: 'pf' as const,
        cpf: null,
        emails: ['outra@example.com'],
      },
    },
  ])('rejects a manual candidate from $label', async ({ candidate }) => {
    const transaction = vi.fn();
    const service = new UserPersonMatchingService(
      {
        userPersonAssociationHistory: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            companyId: 'company-1',
            name: 'Maria',
            cpfNormalized: null,
            emailNormalized: 'maria@example.com',
            routingCompanyId: null,
            personRegistrationId: null,
            personAssociationVersion: 1,
            deletedAt: null,
          }),
        },
        $transaction: transaction,
      } as never,
      { findCandidates: vi.fn().mockResolvedValue([candidate]) },
    );

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        {
          mode: 'confirmed',
          personRegistrationId: 'person-candidate',
          confirmed: true,
          reason: 'Conferência humana registrada.',
          commandId: '00000000-0000-4000-8000-000000000006',
          expectedVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale expectedVersion without writing association history', async () => {
    const historyCreate = vi.fn();
    const transaction = {
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: historyCreate,
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          companyId: 'company-1',
          name: 'Maria',
          cpfNormalized: '52998224725',
          emailNormalized: 'maria@example.com',
          personRegistrationId: null,
          personAssociationVersion: 2,
          deletedAt: null,
        }),
      },
    };
    const service = new UserPersonMatchingService(
      {
        userPersonAssociationHistory: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            companyId: 'company-1',
            name: 'Maria',
            cpfNormalized: '52998224725',
            emailNormalized: 'maria@example.com',
            routingCompanyId: null,
            personRegistrationId: null,
            personAssociationVersion: 1,
            deletedAt: null,
          }),
        },
        $transaction: vi.fn(
          async (work: (value: typeof transaction) => Promise<unknown>) =>
            work(transaction),
        ),
      } as never,
      {
        findCandidates: vi.fn().mockResolvedValue([
          {
            registrationId: 'person-1',
            companyId: 'company-1',
            type: 'pf',
            cpf: '52998224725',
            emails: [],
          },
        ]),
      },
    );

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        {
          mode: 'automatic',
          commandId: '00000000-0000-4000-8000-000000000007',
          expectedVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('returns the association history through the same tenant-scoped seam', async () => {
    const service = new UserPersonMatchingService(
      {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            companyId: 'company-1',
            name: 'Maria',
            cpfNormalized: null,
            emailNormalized: 'maria@example.com',
            routingCompanyId: null,
            personRegistrationId: 'person-1',
            personAssociationVersion: 2,
            deletedAt: null,
          }),
        },
        userPersonAssociationHistory: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'history-1',
              commandId: '00000000-0000-4000-8000-000000000004',
              action: 'USER_PERSON_ASSOCIATED',
              source: 'human-confirmed-email',
              reason: 'Identidade conferida.',
              personRegistrationId: 'person-1',
              expectedVersion: 1,
              resultingVersion: 2,
              needsRegularization: false,
              actor: { id: 'actor-1', name: 'Gestora' },
              occurredAt: new Date('2026-09-01T12:00:00.000Z'),
              createdAt: new Date('2026-09-01T12:00:00.000Z'),
            },
          ]),
        },
      } as never,
      { findCandidates: vi.fn() },
    );

    await expect(
      service.history(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
      ),
    ).resolves.toEqual([
      {
        id: 'history-1',
        commandId: '00000000-0000-4000-8000-000000000004',
        action: 'USER_PERSON_ASSOCIATED',
        source: 'human-confirmed-email',
        reason: 'Identidade conferida.',
        personRegistrationId: 'person-1',
        expectedVersion: 1,
        resultingVersion: 2,
        needsRegularization: false,
        actor: { id: 'actor-1', name: 'Gestora' },
        occurredAt: '2026-09-01T12:00:00.000Z',
        createdAt: '2026-09-01T12:00:00.000Z',
      },
    ]);
  });

  it('replays the same command without applying a second association', async () => {
    const input = {
      mode: 'automatic' as const,
      commandId: '00000000-0000-4000-8000-000000000005',
      expectedVersion: 1,
    };
    const resultSnapshot = {
      userId: 'user-1',
      personRegistrationId: 'person-1',
      associationVersion: 2,
      source: 'unique-exact-cpf',
      reason: null,
      needsRegularization: false,
      associatedAt: '2026-09-01T12:00:00.000Z',
    };
    const transaction = {
      userPersonAssociationHistory: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user-1',
          commandFingerprint:
            '03f12324d709f2371b0447f145bba74ee7c34848b227aa557303382e1a631b80',
          resultSnapshot,
        }),
      },
      user: { updateMany: vi.fn() },
    };
    const user = {
      id: 'user-1',
      companyId: 'company-1',
      name: 'Maria',
      cpfNormalized: '52998224725',
      emailNormalized: 'maria@example.com',
      routingCompanyId: null,
      personRegistrationId: 'person-1',
      personAssociationVersion: 2,
      deletedAt: null,
    };
    const service = new UserPersonMatchingService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        userPersonAssociationHistory: {
          findUnique: vi.fn().mockResolvedValue({
            userId: 'user-1',
            commandFingerprint:
              '03f12324d709f2371b0447f145bba74ee7c34848b227aa557303382e1a631b80',
            resultSnapshot,
          }),
        },
        $transaction: vi.fn(
          async (work: (value: typeof transaction) => Promise<unknown>) =>
            work(transaction),
        ),
      } as never,
      {
        findCandidates: vi.fn().mockResolvedValue([
          {
            registrationId: 'person-1',
            companyId: 'company-1',
            type: 'pf',
            cpf: '52998224725',
            emails: [],
          },
        ]),
      },
    );

    await expect(
      service.associate(
        { id: 'actor-1', companyId: 'company-1' } as never,
        'user-1',
        input,
      ),
    ).resolves.toEqual({ ...resultSnapshot, idempotent: true });
    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a legacy access scope visible and reports a CPF on Empresa as conflict', async () => {
    const findCandidates = vi.fn().mockResolvedValue([
      {
        registrationId: 'registration-pj',
        companyId: 'company-1',
        type: 'pj',
        cpf: '52998224725',
        emails: [],
      },
    ]);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          companyId: 'company-1',
          cpfNormalized: '52998224725',
          emailNormalized: 'pessoa@example.com',
          routingCompanyId: 'legacy-scope-id',
          deletedAt: null,
        }),
      },
    };
    const service = new UserPersonMatchingService(prisma as never, {
      findCandidates,
    });

    await expect(
      service.preview(
        {
          id: 'actor-1',
          companyId: 'company-1',
        } as never,
        'user-1',
      ),
    ).resolves.toMatchObject({
      persisted: false,
      existingContextualRegistrationId: 'legacy-scope-id',
      existingContextualLinkMeaning:
        'legacy-access-scope-not-person-association',
      decision: {
        decision: 'conflict',
        reason: 'cpf-associated-with-non-person',
      },
    });
    expect(findCandidates).toHaveBeenCalledWith({
      companyId: 'company-1',
      cpf: '52998224725',
      email: 'pessoa@example.com',
    });
  });

  it('does not preview a deleted user', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          deletedAt: new Date(),
        }),
      },
    };
    const service = new UserPersonMatchingService(prisma as never, {
      findCandidates: vi.fn(),
    });

    await expect(
      service.preview(
        {
          id: 'actor-1',
          companyId: 'company-1',
        } as never,
        'user-1',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
