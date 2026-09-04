import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service';
import {
  AgentExecutionStatus,
  CustomerProfileSuggestionStatus,
  RoutingClientType,
} from '../prisma/generated/client';
import { PrismaCustomerContextRepository } from './prisma-customer-context.repository';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EXECUTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SERVICE_IDENTITY_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = '22222222-2222-4222-8222-222222222222';
const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const UPDATED_AT = new Date('2026-08-29T12:00:00.000Z');

function repositoryWithTransaction(transaction: object) {
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: object) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaService;
  return new PrismaCustomerContextRepository(prisma);
}

function anchor() {
  return { id: SESSION_ID, thread: { contactId: CONTACT_ID } };
}

describe('PrismaCustomerContextRepository context isolation', () => {
  it('returns only confirmed identity and approved allow-listed profile in bounded summary queries', async () => {
    const profileFind = vi.fn(async () => [
      {
        id: 'legacy-unsafe-suggestion',
        profileKey: 'other-confirmed-preference',
        suggestedValue: 'api_key sk-proj-legacy-secret-value',
        reviewedAt: new Date('2026-08-29T11:30:00.000Z'),
      },
      {
        id: SUGGESTION_ID,
        profileKey: 'preferred-contact-channel',
        suggestedValue: 'Prefere contato à tarde.',
        reviewedAt: new Date('2026-08-29T11:00:00.000Z'),
      },
    ]);
    const transaction = {
      serviceSession: {
        findFirst: vi.fn(async () => anchor()),
        findMany: vi.fn(async () => [
          {
            id: SESSION_ID,
            status: 'OPEN',
            controlMode: 'AI',
            currentDepartmentId: null,
            priority: 'NORMAL',
            pendingActions: [{ kind: 'reply' }],
            updatedAt: UPDATED_AT,
          },
        ]),
      },
      conversationParticipant: {
        findFirst: vi.fn(async () => ({
          confirmedAt: new Date('2026-08-29T10:00:00.000Z'),
          registration: {
            id: 'registration-a',
            clientType: RoutingClientType.PF,
            individualName: 'Ana Souza',
            legalName: 'Ana Souza',
          },
        })),
      },
      registrationRelationship: { findMany: vi.fn(async () => []) },
      customerProfileSuggestion: { findMany: profileFind },
      quoteRequest: { findMany: vi.fn(async () => []) },
      serviceCase: { findMany: vi.fn(async () => []) },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.loadSummary({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      audience: 'agent',
    });

    expect(result.identity).toEqual(
      expect.objectContaining({
        registrationId: 'registration-a',
        kind: 'personal',
        displayName: 'Ana Souza',
      }),
    );
    expect(result.approvedProfile).toEqual([
      expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        key: 'preferred-contact-channel',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('sk-proj-legacy');
    expect(result.recentServices[0]?.pendingActionCount).toBe(1);
    expect(profileFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          whatsappContactId: CONTACT_ID,
          status: CustomerProfileSuggestionStatus.APPROVED,
          profileKey: expect.objectContaining({
            in: expect.arrayContaining(['preferred-contact-channel']),
          }),
        }),
        take: 48,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('pending profile value');
  });

  it('denies a cross-tenant session before reading any customer profile', async () => {
    const profileFind = vi.fn();
    const transaction = {
      serviceSession: { findFirst: vi.fn(async () => null) },
      customerProfileSuggestion: { findMany: profileFind },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.loadSummary({
        companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        serviceSessionId: SESSION_ID,
        audience: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transaction.serviceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SESSION_ID,
          companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
      }),
    );
    expect(profileFind).not.toHaveBeenCalled();
  });
});

describe('PrismaCustomerContextRepository suggestions', () => {
  it('persists an agent observation only as PENDING with immutable provenance and redacted audit', async () => {
    const auditCreate = vi.fn(async (_input: unknown) => ({ id: 'audit' }));
    const suggestionCreate = vi.fn(
      async (_input: { data: Record<string, unknown> }) => ({
        id: SUGGESTION_ID,
        createdAt: UPDATED_AT,
      }),
    );
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: auditCreate,
      },
      serviceSession: { findFirst: vi.fn(async () => anchor()) },
      agentExecution: { findFirst: vi.fn(async () => ({ id: EXECUTION_ID })) },
      serviceIdentity: {
        findFirst: vi.fn(async () => ({ id: SERVICE_IDENTITY_ID })),
      },
      conversationParticipant: { findFirst: vi.fn(async () => null) },
      customerProfileSuggestion: {
        findFirst: vi.fn(async () => null),
        create: suggestionCreate,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.createSuggestion({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      commandId: COMMAND_ID,
      actor: {
        type: 'agent',
        agentExecutionId: EXECUTION_ID,
        serviceIdentityId: SERVICE_IDENTITY_ID,
      },
      profileKey: 'service-preference',
      suggestedValue: 'Prefere retirada pela manhã.',
      rationale: 'Informado nesta conversa.',
      evidenceMessageId: null,
    });

    expect(result).toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      idempotent: false,
    });
    expect(suggestionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: EXECUTION_ID,
        status: CustomerProfileSuggestionStatus.PENDING,
      }),
      select: { id: true, createdAt: true },
    });
    const persistedSuggestion = suggestionCreate.mock.calls[0]?.[0];
    expect(persistedSuggestion).toMatchObject({
      data: {
        origin: expect.objectContaining({
          actorType: 'agent',
          commandId: COMMAND_ID,
          agentExecutionId: EXECUTION_ID,
          serviceIdentityId: SERVICE_IDENTITY_ID,
          source: 'conversation-observation',
        }),
      },
    });
    expect(persistedSuggestion?.data).not.toHaveProperty('reviewedByUserId');
    expect(persistedSuggestion?.data).not.toHaveProperty('reviewedAt');
    const serializedAudit = JSON.stringify(auditCreate.mock.calls);
    expect(serializedAudit).not.toContain('Prefere retirada pela manhã.');
    expect(serializedAudit).not.toContain('Informado nesta conversa.');
  });

  it('accepts the in-process runtime only for a RUNNING execution in the exact tenant/session', async () => {
    const executionFind = vi.fn(async () => ({ id: EXECUTION_ID }));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'audit' })),
      },
      serviceSession: { findFirst: vi.fn(async () => anchor()) },
      agentExecution: { findFirst: executionFind },
      conversationParticipant: { findFirst: vi.fn(async () => null) },
      customerProfileSuggestion: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({
          id: SUGGESTION_ID,
          createdAt: UPDATED_AT,
        })),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await repository.createSuggestion({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      commandId: COMMAND_ID,
      actor: { type: 'agent-runtime', agentExecutionId: EXECUTION_ID },
      profileKey: 'language',
      suggestedValue: 'Português.',
      rationale: null,
      evidenceMessageId: null,
    });

    expect(executionFind).toHaveBeenCalledWith({
      where: {
        id: EXECUTION_ID,
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        status: AgentExecutionStatus.RUNNING,
      },
      select: { id: true },
    });
    expect(transaction).not.toHaveProperty('serviceIdentity');
  });

  it('replays the same create command idempotently without another write', async () => {
    let savedAudit: { metadata: Record<string, unknown> } | null = null;
    const suggestionCreate = vi.fn(
      async (_input: { data: Record<string, unknown> }) => ({
        id: SUGGESTION_ID,
        createdAt: UPDATED_AT,
      }),
    );
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      tenantAuditLog: {
        findFirst: vi.fn(async () => savedAudit),
        create: vi.fn(
          async (input: { data: { metadata: Record<string, unknown> } }) => {
            savedAudit = { metadata: input.data.metadata };
            return { id: 'audit' };
          },
        ),
      },
      serviceSession: { findFirst: vi.fn(async () => anchor()) },
      user: { findFirst: vi.fn(async () => ({ id: USER_ID })) },
      conversationParticipant: { findFirst: vi.fn(async () => null) },
      customerProfileSuggestion: {
        findFirst: vi.fn(async () => null),
        create: suggestionCreate,
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const input = {
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      commandId: COMMAND_ID,
      actor: { type: 'human' as const, userId: USER_ID },
      profileKey: 'language' as const,
      suggestedValue: 'Prefere atendimento em português.',
      rationale: null,
      evidenceMessageId: null,
    };

    await repository.createSuggestion(input);
    await expect(repository.createSuggestion(input)).resolves.toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      idempotent: true,
    });
    expect(suggestionCreate).toHaveBeenCalledTimes(1);
  });

  it('allows only an active human in the same tenant to approve with optimistic concurrency', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const auditCreate = vi.fn(async () => ({ id: 'audit' }));
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      tenantAuditLog: {
        findFirst: vi.fn(async () => null),
        create: auditCreate,
      },
      user: { findFirst: vi.fn(async () => ({ id: USER_ID })) },
      customerProfileSuggestion: {
        findFirst: vi.fn(async () => ({
          id: SUGGESTION_ID,
          updatedAt: UPDATED_AT,
        })),
        updateMany,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    const result = await repository.decideSuggestion({
      companyId: COMPANY_ID,
      actorUserId: USER_ID,
      commandId: COMMAND_ID,
      suggestionId: SUGGESTION_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: 'approved',
      reason: 'Preferência confirmada pelo cliente.',
    });

    expect(result).toMatchObject({
      suggestionId: SUGGESTION_ID,
      status: 'approved',
      reviewedByUserId: USER_ID,
    });
    expect(transaction.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER_ID,
          companyId: COMPANY_ID,
          isActive: true,
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SUGGESTION_ID,
          companyId: COMPANY_ID,
          status: CustomerProfileSuggestionStatus.PENDING,
          updatedAt: UPDATED_AT,
        },
        data: expect.objectContaining({
          status: CustomerProfileSuggestionStatus.APPROVED,
          reviewedByUserId: USER_ID,
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        action: 'customer-profile.suggestion.decide',
      }),
    });
  });

  it('rejects stale or cross-tenant decisions without changing the suggestion', async () => {
    const updateMany = vi.fn();
    let actorExists = true;
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      tenantAuditLog: { findFirst: vi.fn(async () => null) },
      user: {
        findFirst: vi.fn(async () => (actorExists ? { id: USER_ID } : null)),
      },
      customerProfileSuggestion: {
        findFirst: vi.fn(async () => ({
          id: SUGGESTION_ID,
          updatedAt: new Date('2026-08-29T12:00:01.000Z'),
        })),
        updateMany,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.decideSuggestion({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        commandId: COMMAND_ID,
        suggestionId: SUGGESTION_ID,
        expectedUpdatedAt: UPDATED_AT,
        decision: 'ignored',
        reason: 'Não é uma preferência permanente.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    actorExists = false;
    await expect(
      repository.decideSuggestion({
        companyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        actorUserId: USER_ID,
        commandId: '44444444-4444-4444-8444-444444444444',
        suggestionId: SUGGESTION_ID,
        expectedUpdatedAt: UPDATED_AT,
        decision: 'approved',
        reason: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
