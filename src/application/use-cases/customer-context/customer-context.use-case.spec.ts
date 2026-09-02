import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerContextSummary,
  CreateCustomerProfileSuggestionInput,
} from '../../contracts/customer-context.repository';
import { CustomerContextUseCase } from './customer-context.use-case';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXECUTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SERVICE_IDENTITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

function summary(): CustomerContextSummary {
  return {
    serviceSessionId: SESSION_ID,
    whatsappContactId: 'contact-opaque',
    identity: {
      registrationId: 'registration-opaque',
      kind: 'personal',
      displayName: 'Ana Souza',
      confirmedAt: '2026-08-29T12:00:00.000Z',
    },
    relatedCompanies: [],
    approvedProfile: [
      {
        suggestionId: 'suggestion-approved',
        key: 'preferred-contact-channel',
        value: 'Prefere contato por WhatsApp no período da tarde.',
        approvedAt: '2026-08-29T12:10:00.000Z',
      },
    ],
    recentServices: [],
    recentQuotes: [],
    pending: [
      {
        kind: 'service',
        id: SESSION_ID,
        status: 'open',
        updatedAt: '2026-08-29T12:15:00.000Z',
      },
    ],
    limits: {
      relatedCompanies: 5,
      approvedProfile: 12,
      recentServices: 5,
      recentQuotes: 5,
      pending: 10,
    },
  };
}

function setup() {
  const repository = {
    loadSummary: vi.fn().mockResolvedValue(summary()),
    loadDetails: vi.fn().mockResolvedValue({
      section: 'services',
      items: [],
      limit: 20,
      hasMore: false,
    }),
    createSuggestion: vi.fn().mockResolvedValue({
      suggestionId: SUGGESTION_ID,
      status: 'pending',
      createdAt: '2026-08-29T12:20:00.000Z',
    }),
    listSuggestions: vi.fn().mockResolvedValue([]),
    decideSuggestion: vi.fn().mockResolvedValue({
      suggestionId: SUGGESTION_ID,
      status: 'approved',
      reviewedByUserId: USER_ID,
      reviewedAt: '2026-08-29T12:30:00.000Z',
    }),
  };
  return {
    repository,
    subject: new CustomerContextUseCase(repository),
  };
}

describe('CustomerContextUseCase', () => {
  it('resolves a bounded approved-only context for the agent', async () => {
    const { repository, subject } = setup();

    const result = await subject.resolveForAgent({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
    });

    expect(repository.loadSummary).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      audience: 'agent',
    });
    expect(result.approvedProfileItemCount).toBe(1);
    expect(result.modelContext).toContain('approved-profile-only="true"');
    expect(result.modelContext).toContain('Prefere contato por WhatsApp');
    expect(result.modelContextSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it('allows agent and human origins to create only pending suggestions', async () => {
    const { repository, subject } = setup();
    const base = {
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      commandId: COMMAND_ID,
      profileKey: 'service-preference' as const,
      suggestedValue: 'Prefere janela de retirada no período da manhã.',
      rationale: 'Preferência informada nesta conversa.',
    };

    await expect(
      subject.suggestFromAgent({
        ...base,
        agentExecutionId: EXECUTION_ID,
        serviceIdentityId: SERVICE_IDENTITY_ID,
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      subject.suggestFromHuman({ ...base, actorUserId: USER_ID }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      subject.suggestFromRuntime({
        ...base,
        agentExecutionId: EXECUTION_ID,
      }),
    ).resolves.toMatchObject({ status: 'pending' });

    const calls = repository.createSuggestion.mock.calls.map(
      ([input]) => input as CreateCustomerProfileSuggestionInput,
    );
    expect(calls[0]?.actor).toEqual({
      type: 'agent',
      agentExecutionId: EXECUTION_ID,
      serviceIdentityId: SERVICE_IDENTITY_ID,
    });
    expect(calls[1]?.actor).toEqual({ type: 'human', userId: USER_ID });
    expect(calls[2]?.actor).toEqual({
      type: 'agent-runtime',
      agentExecutionId: EXECUTION_ID,
    });
    expect(JSON.stringify(calls)).not.toContain('approved');
  });

  it('requires a human decision reason for ignore and optimistic timestamp for review', async () => {
    const { repository, subject } = setup();

    expect(() =>
      subject.decide({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        commandId: COMMAND_ID,
        suggestionId: SUGGESTION_ID,
        expectedUpdatedAt: '2026-08-29T12:20:00.000Z',
        decision: 'ignored',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    await subject.decide({
      companyId: COMPANY_ID,
      actorUserId: USER_ID,
      commandId: COMMAND_ID,
      suggestionId: SUGGESTION_ID,
      expectedUpdatedAt: '2026-08-29T12:20:00.000Z',
      decision: 'approved',
      reason: 'Confirmado pelo atendente.',
    });

    expect(repository.decideSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: USER_ID,
        suggestionId: SUGGESTION_ID,
        expectedUpdatedAt: new Date('2026-08-29T12:20:00.000Z'),
        decision: 'approved',
      }),
    );
  });

  it('rejects direct PII before persistence', () => {
    const { repository, subject } = setup();

    expect(() =>
      subject.suggestFromHuman({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        actorUserId: USER_ID,
        commandId: COMMAND_ID,
        profileKey: 'other-confirmed-preference',
        suggestedValue: 'Contato alternativo: pessoa@example.com',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(repository.createSuggestion).not.toHaveBeenCalled();
  });
});
