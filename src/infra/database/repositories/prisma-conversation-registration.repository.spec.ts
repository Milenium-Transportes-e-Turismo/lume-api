import { describe, expect, it, vi } from 'vitest';

import { PrismaConversationRegistrationRepository } from './prisma-conversation-registration.repository';
import type { PrismaService } from '../prisma/prisma.service';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DRAFT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COMMAND_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function session(contactId = CONTACT_ID) {
  return {
    id: SESSION_ID,
    thread: {
      contact: {
        id: contactId,
        phoneNormalized: '5534999990000',
      },
    },
  };
}

function storedDraft(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'conversation-registration-draft',
    schemaVersion: 1,
    registrationKind: 'personal',
    draftVersion: 1,
    person: {
      name: 'Ana Souza',
      cpf: '529.982.247-25',
      email: 'novo@example.com',
      phone: '(34) 99999-0000',
    },
    company: {},
    relationship: {},
    source: {
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
    },
    ...overrides,
  };
}

function repositoryWithTransaction(transaction: object) {
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: object) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaService;
  return new PrismaConversationRegistrationRepository(prisma);
}

describe('PrismaConversationRegistrationRepository identity', () => {
  it('treats a shared phone as ambiguous without leaking candidate data', async () => {
    const createParticipant = vi.fn(async () => ({ id: 'participant' }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      serviceSession: { findFirst: vi.fn(async () => session()) },
      registrationPhone: {
        findMany: vi.fn(async () => [
          { registrationId: 'registration-a', whatsappContactId: null },
          { registrationId: 'registration-b', whatsappContactId: null },
        ]),
      },
      conversationParticipant: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: createParticipant,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.resolveIdentity({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
    });

    expect(result).toEqual({
      status: 'ambiguous',
      registrationId: null,
      modelContext: expect.stringContaining('Não assuma uma identidade'),
      requiresDisambiguation: true,
      candidateCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain('registration-a');
    expect(JSON.stringify(result)).not.toContain('registration-b');
    expect(createParticipant).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        registrationId: null,
        metadata: {
          sharedPhoneCandidateCount: 2,
          authorizationGranted: false,
        },
      }),
    });
    expect(transaction.registrationPhone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      }),
    );
  });

  it('denies a cross-contact source before reading or mutating a draft', async () => {
    const serviceCaseFind = vi.fn();
    const transaction = {
      serviceSession: {
        findFirst: vi.fn(async () => session('other-contact')),
      },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: { findFirst: serviceCaseFind },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.previewDraft({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: null,
        draftId: DRAFT_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(serviceCaseFind).not.toHaveBeenCalled();
  });
});

describe('PrismaConversationRegistrationRepository draft safety', () => {
  it('replays the same start command idempotently without creating another draft', async () => {
    let auditMetadata: unknown = null;
    const serviceCaseCreate = vi.fn(async () => ({ id: DRAFT_ID }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: {
        findFirst: vi.fn(async () =>
          auditMetadata ? { metadata: auditMetadata } : null,
        ),
        create: vi.fn(async ({ data }: { data: { metadata: unknown } }) => {
          auditMetadata = data.metadata;
          return { id: 'audit' };
        }),
      },
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => null),
        create: serviceCaseCreate,
      },
      serviceSessionCase: { create: vi.fn(async () => ({ id: 'link' })) },
    };
    const repository = repositoryWithTransaction(transaction);
    const input = {
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      commandId: COMMAND_ID,
      kind: 'personal' as const,
    };

    const first = await repository.startDraft(input);
    const replay = await repository.startDraft(input);

    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({
      draftId: first.draftId,
      draftVersion: 1,
      idempotent: true,
    });
    expect(serviceCaseCreate).toHaveBeenCalledTimes(1);
  });

  it('uses optimistic draftVersion and never writes stale concurrent patches', async () => {
    let metadata: unknown = storedDraft();
    const audits = new Map<string, unknown>();
    const updateMany = vi.fn(
      async ({ data }: { data: { metadata: unknown } }) => {
        metadata = data.metadata;
        return { count: 1 };
      },
    );
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: {
        findFirst: vi.fn(
          async ({ where }: { where: { metadata: { equals: string } } }) => {
            const value = audits.get(where.metadata.equals);
            return value ? { metadata: value } : null;
          },
        ),
        create: vi.fn(
          async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
            audits.set(String(data.metadata.commandId), data.metadata);
            return { id: 'audit' };
          },
        ),
      },
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => ({
          id: DRAFT_ID,
          status: 'OPEN',
          metadata,
        })),
        updateMany,
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const base = {
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      draftId: DRAFT_ID,
      expectedDraftVersion: 1,
    };

    await repository.updateDraft({
      ...base,
      commandId: COMMAND_ID,
      patch: { person: { name: 'Ana Confirmada' } },
    });
    await expect(
      repository.updateDraft({
        ...base,
        commandId: '22222222-2222-4222-8222-222222222222',
        patch: { person: { name: 'Escrita concorrente' } },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audits.get(COMMAND_ID))).not.toContain(
      'Ana Confirmada',
    );
  });

  it('reads a partial draft as field names and version without returning collected PII', async () => {
    const transaction = {
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => ({
          id: DRAFT_ID,
          status: 'OPEN',
          metadata: storedDraft({
            draftVersion: 2,
            person: { name: 'Ana Souza' },
          }),
        })),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.readDraftState({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      draftId: DRAFT_ID,
    });

    expect(result).toEqual({
      draftId: DRAFT_ID,
      draftVersion: 2,
      kind: 'personal',
      status: 'draft',
      providedFields: ['person.name'],
      missingFields: ['person.cpf', 'person.phone'],
      registrationRequiredForQuote: false,
      continueOriginalDemand: true,
    });
    expect(JSON.stringify(result)).not.toContain('Ana Souza');
  });

  it('previews only customer-provided values and generic divergence prompts', async () => {
    const previousEmail = 'valor-salvo-secreto@example.com';
    const transaction = {
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => ({
          id: DRAFT_ID,
          status: 'OPEN',
          metadata: storedDraft(),
        })),
      },
      routingCompany: {
        findFirst: vi.fn(async () => ({
          id: 'person',
          legalName: 'Nome Salvo Não Revelar',
          individualEmail: previousEmail,
          individualWhatsapp: '5534888880000',
        })),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.previewDraft({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      draftId: DRAFT_ID,
    });

    expect(result.customerProvidedSummary).toContain('Nome: Ana Souza');
    expect(result.requiredFieldDecisions.map((item) => item.field)).toEqual([
      'name',
      'email',
      'phone',
    ]);
    expect(JSON.stringify(result)).not.toContain(previousEmail);
    expect(JSON.stringify(result)).not.toContain('Nome Salvo Não Revelar');
    expect(JSON.stringify(result)).not.toContain('5534888880000');
  });

  it('scrubs PII on abandonment and never creates a partial Registration', async () => {
    let terminalMetadata: unknown;
    const routingCreate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'audit' })),
      },
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => ({
          id: DRAFT_ID,
          status: 'OPEN',
          metadata: storedDraft(),
        })),
        updateMany: vi.fn(async ({ data }: { data: { metadata: unknown } }) => {
          terminalMetadata = data.metadata;
          return { count: 1 };
        }),
      },
      routingCompany: { create: routingCreate },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.abandonDraft({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      commandId: COMMAND_ID,
      draftId: DRAFT_ID,
      expectedDraftVersion: 1,
    });

    expect(result).toMatchObject({
      status: 'abandoned',
      incompleteRegistrationPersisted: false,
      continueOriginalDemand: true,
    });
    expect(routingCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(terminalMetadata)).not.toContain('Ana Souza');
    expect(JSON.stringify(terminalMetadata)).not.toContain('529.982.247-25');
    expect(terminalMetadata).toMatchObject({ piiScrubbed: true });
  });

  it('creates PF, PJ and Relationship only inside the final confirmation transaction', async () => {
    const registrations = new Map<string, Record<string, unknown>>();
    const registrationCreate = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        registrations.set(String(data.id), {
          id: data.id,
          clientType: data.clientType,
          taxId: data.taxId,
          legalName: data.legalName,
          tradeName: data.tradeName ?? null,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          individualName: data.individualName ?? null,
          cpf: data.cpf ?? null,
          individualEmail: data.individualEmail ?? null,
          individualWhatsapp: data.individualWhatsapp ?? null,
          cnpj: data.cnpj ?? null,
          legalEmail: data.legalEmail ?? null,
          legalWhatsapp: data.legalWhatsapp ?? null,
          status: data.status,
          version: 1,
        });
        return { id: data.id };
      },
    );
    let terminalMetadata: unknown;
    const relationshipUpsert = vi.fn(async () => ({ id: 'relationship-1' }));
    const participantCreate = vi.fn(async () => ({ id: 'participant-1' }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'audit' })),
      },
      serviceSession: { findFirst: vi.fn(async () => session()) },
      agentExecution: { findFirst: vi.fn() },
      serviceCase: {
        findFirst: vi.fn(async () => ({
          id: DRAFT_ID,
          status: 'OPEN',
          metadata: storedDraft({
            registrationKind: 'company',
            company: {
              legalName: 'Empresa Exemplo Ltda',
              cnpj: '11.222.333/0001-81',
            },
            relationship: {
              type: 'employee',
              jobTitle: 'Assistente',
              department: 'Operações',
            },
          }),
        })),
        updateMany: vi.fn(async ({ data }: { data: { metadata: unknown } }) => {
          terminalMetadata = data.metadata;
          return { count: 1 };
        }),
      },
      conversationParticipant: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: participantCreate,
      },
      routingCompany: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (typeof where.id === 'string') {
              return registrations.get(where.id) ?? null;
            }
            if (where.cpf || where.cnpj) return null;
            return null;
          },
        ),
        create: registrationCreate,
      },
      whatsAppContact: {
        findFirst: vi.fn(async () => ({ phoneNormalized: '5534999990000' })),
      },
      registrationPhone: { create: vi.fn(async () => ({ id: 'phone' })) },
      registrationEmail: { create: vi.fn(async () => ({ id: 'email' })) },
      registrationRole: {
        upsert: vi.fn(async () => ({ id: 'client-role' })),
      },
      registrationRoleAssignment: {
        upsert: vi.fn(async () => ({ id: 'assignment' })),
      },
      routingCompanyHistory: {
        create: vi.fn(async () => ({ id: 'history' })),
      },
      registrationDataReview: { create: vi.fn() },
      registrationRelationship: { upsert: relationshipUpsert },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.confirmDraft({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      commandId: COMMAND_ID,
      draftId: DRAFT_ID,
      expectedDraftVersion: 1,
      customerConfirmedFinalSummary: true,
      fieldDecisions: {},
    });

    expect(result).toMatchObject({
      status: 'confirmed',
      companyRegistrationId: expect.any(String),
      relationshipId: 'relationship-1',
      confirmedByCustomer: true,
      relationshipGrantsAuthorization: false,
      continueOriginalDemand: true,
    });
    expect(registrationCreate).toHaveBeenCalledTimes(2);
    expect(relationshipUpsert).toHaveBeenCalledWith({
      where: expect.any(Object),
      create: expect.objectContaining({
        companyId: COMPANY_ID,
        type: 'employee',
        jobTitle: 'Assistente',
        department: 'Operações',
      }),
      update: expect.objectContaining({ active: true }),
      select: { id: true },
    });
    expect(participantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        registrationId: result.personRegistrationId,
        metadata: {
          authorizationGranted: false,
          relationshipId: 'relationship-1',
        },
      }),
    });
    expect(JSON.stringify(terminalMetadata)).not.toContain('Ana Souza');
    expect(terminalMetadata).toMatchObject({ piiScrubbed: true });
  });
});

describe('PrismaConversationRegistrationRepository human data review', () => {
  it('applies an organizational proposal only after an audited human decision', async () => {
    const reviewId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const registrationId = '33333333-3333-4333-8333-333333333333';
    let registrationRead = 0;
    const registration = (version: number, legalName: string) => ({
      id: registrationId,
      clientType: 'PJ',
      taxId: '11222333000181',
      legalName,
      tradeName: null,
      firstName: null,
      lastName: null,
      individualName: null,
      cpf: null,
      individualEmail: null,
      individualWhatsapp: null,
      cnpj: '11222333000181',
      legalEmail: null,
      legalWhatsapp: null,
      status: 'ACTIVE',
      version,
    });
    const routingUpdate = vi.fn(async () => ({ count: 1 }));
    const reviewUpdate = vi.fn(async () => ({ count: 1 }));
    const historyCreate = vi.fn(async () => ({ id: 'history' }));
    const auditCreate = vi.fn(async () => ({ id: 'audit' }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: auditCreate,
      },
      user: { findFirst: vi.fn(async () => ({ id: userId })) },
      registrationDataReview: {
        findFirst: vi.fn(async () => ({
          id: reviewId,
          registrationId,
          field: 'legalName',
          currentValue: { value: 'Empresa Antiga', registrationVersion: 1 },
          proposedValue: { value: 'Empresa Confirmada Ltda' },
        })),
        updateMany: reviewUpdate,
      },
      routingCompany: {
        findFirst: vi.fn(async () => {
          registrationRead += 1;
          return registration(
            registrationRead === 1 ? 1 : 2,
            registrationRead === 1
              ? 'Empresa Antiga'
              : 'Empresa Confirmada Ltda',
          );
        }),
        updateMany: routingUpdate,
      },
      routingCompanyHistory: { create: historyCreate },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.decideDataReview({
      companyId: COMPANY_ID,
      actorUserId: userId,
      commandId: COMMAND_ID,
      reviewId,
      decision: 'approved',
      reason: 'Conferido em documento oficial.',
    });

    expect(result).toMatchObject({
      reviewId,
      registrationId,
      status: 'approved',
      reviewedByUserId: userId,
      idempotent: false,
    });
    expect(routingUpdate).toHaveBeenCalledWith({
      where: {
        id: registrationId,
        companyId: COMPANY_ID,
        version: 1,
      },
      data: {
        legalName: 'Empresa Confirmada Ltda',
        version: { increment: 1 },
      },
    });
    expect(reviewUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: reviewId,
        companyId: COMPANY_ID,
        status: 'PENDING',
      }),
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedByUserId: userId,
        reviewReason: 'Conferido em documento oficial.',
      }),
    });
    expect(historyCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: userId,
        action: 'registration.data-review.decide',
      }),
    });
  });

  it('requires a human rejection reason and leaves the Registration untouched', async () => {
    const routingUpdate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
      tenantAuditLog: { findFirst: vi.fn(async () => null) },
      user: { findFirst: vi.fn(async () => ({ id: 'user' })) },
      registrationDataReview: { findFirst: vi.fn() },
      routingCompany: { updateMany: routingUpdate },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.decideDataReview({
        companyId: COMPANY_ID,
        actorUserId: '22222222-2222-4222-8222-222222222222',
        commandId: COMMAND_ID,
        reviewId: '11111111-1111-4111-8111-111111111111',
        decision: 'rejected',
        reason: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(routingUpdate).not.toHaveBeenCalled();
  });
});
