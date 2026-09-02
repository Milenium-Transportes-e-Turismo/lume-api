import { describe, expect, it, vi } from 'vitest';

import { AgentFunctionToolCatalog } from '../../application/contracts/agent-function-tool.catalog';
import type { ExecuteAgentFunctionToolInput } from '../../application/contracts/agent-function-tool.executor';
import type { RegistrationDraftPublicState } from '../../application/contracts/conversation-registration.repository';
import { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import { ConversationRegistrationUseCase } from '../../application/use-cases/registrations/conversation-registration.use-case';
import { fingerprintAgentToolArguments } from '../../domain/agents/agent-tool-authorization';
import {
  AgentExecutionStatus,
  AgentToolCallStatus,
  MessageDirection,
  ServiceCaseStatus,
  ServiceSessionControlMode,
  ServiceSessionStatus,
} from '../database/prisma/generated/client';
import { PrismaService } from '../database/prisma/prisma.service';
import { ServerSideAgentFunctionToolExecutor } from './server-side-agent-function-tool.executor';

const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const AGENT_ID = '30000000-0000-4000-8000-000000000003';
const EXECUTION_ID = '40000000-0000-4000-8000-000000000004';
const TOOL_ID = '50000000-0000-4000-8000-000000000005';
const CONTACT_ID = '60000000-0000-4000-8000-000000000006';
const DRAFT_ID = '70000000-0000-4000-8000-000000000007';
const MESSAGE_ID = '80000000-0000-4000-8000-000000000008';

function input(
  functionName: string,
  args: Readonly<Record<string, unknown>>,
): ExecuteAgentFunctionToolInput {
  return {
    companyId: COMPANY_ID,
    serviceSessionId: SESSION_ID,
    agentId: AGENT_ID,
    executionId: EXECUTION_ID,
    sequence: 1,
    providerResponseId: 'response-safe-id',
    providerItemId: 'function-safe-id',
    providerCallId: 'call-safe-id',
    toolId: TOOL_ID,
    functionName,
    arguments: args,
  };
}

function harness() {
  const events: string[] = [];
  const agentExecutionFindFirst = vi.fn(
    async (): Promise<{
      id: string;
      status: AgentExecutionStatus;
    } | null> => {
      events.push('execution');
      return { id: EXECUTION_ID, status: AgentExecutionStatus.RUNNING };
    },
  );
  const serviceSessionFindFirst = vi.fn(
    async (): Promise<{
      status: ServiceSessionStatus;
      controlMode: ServiceSessionControlMode;
      thread: { contactId: string };
    } | null> => {
      events.push('control');
      return {
        status: ServiceSessionStatus.OPEN,
        controlMode: ServiceSessionControlMode.AI,
        thread: { contactId: CONTACT_ID },
      };
    },
  );
  const toolCallUpsert = vi.fn(
    async (query: {
      create: {
        toolId: string;
        inputHash: string;
        requestMetadata: Readonly<Record<string, unknown>>;
      };
    }): Promise<{
      toolId: string;
      inputHash: string;
      status: AgentToolCallStatus;
      requestMetadata: Readonly<Record<string, unknown>>;
      resultSummary: Readonly<Record<string, unknown>> | null;
    }> => {
      events.push('requested');
      return {
        toolId: query.create.toolId,
        inputHash: query.create.inputHash,
        status: AgentToolCallStatus.REQUESTED,
        requestMetadata: query.create.requestMetadata,
        resultSummary: null,
      };
    },
  );
  const toolCallUpdateMany = vi.fn(async (query) => {
    const status = query.data.status as AgentToolCallStatus;
    events.push(status.toLowerCase());
    return { count: 1 };
  });
  const whatsAppMessageFindFirst = vi.fn(
    async (): Promise<{
      text: string | null;
      occurredAt: Date;
      direction?: MessageDirection;
    } | null> => ({
      text: 'Sim, os dados estão corretos.',
      occurredAt: new Date('2026-08-29T12:01:00.000Z'),
      direction: MessageDirection.INBOUND,
    }),
  );
  const whatsAppMessageFindMany = vi.fn(async () => {
    events.push('knowledge-evidence');
    return [{ id: MESSAGE_ID }];
  });
  const serviceCaseFindFirst = vi.fn(async () => ({
    status: ServiceCaseStatus.OPEN,
    updatedAt: new Date('2026-08-29T12:00:00.000Z'),
  }));
  const prisma = {
    agentExecution: { findFirst: agentExecutionFindFirst },
    serviceSession: { findFirst: serviceSessionFindFirst },
    agentToolCall: {
      upsert: toolCallUpsert,
      updateMany: toolCallUpdateMany,
    },
    whatsAppMessage: {
      findFirst: whatsAppMessageFindFirst,
      findMany: whatsAppMessageFindMany,
    },
    serviceCase: { findFirst: serviceCaseFindFirst },
  };
  const reauthorizeReturnedCall = vi.fn(async (request) => {
    events.push('reauthorize');
    return {
      authorizationId: 'a'.repeat(64),
      argumentsFingerprint: fingerprintAgentToolArguments(request.arguments),
      authorizationSource: 'server-policy' as const,
    };
  });
  const resolveBeforeResponse = vi.fn(async () => {
    events.push('identity-handler');
    return {
      status: 'ambiguous' as const,
      registrationId: null,
      modelContext: 'never-return-this-context',
      requiresDisambiguation: true,
      candidateCount: 2,
    };
  });
  const preview = vi.fn(async () => {
    events.push('registration-read-handler');
    return {
      draftId: DRAFT_ID,
      draftVersion: 3,
      kind: 'personal' as const,
      status: 'awaiting-confirmation' as const,
      providedFields: ['person.name', 'person.cpf'],
      missingFields: [],
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
      customerProvidedSummary: ['CPF: 12345678900'],
      requiredFieldDecisions: [
        { field: 'name' as const, message: 'mensagem interna' },
      ],
      organizationReviewsToCreate: [],
    };
  });
  const read = vi.fn(async (): Promise<RegistrationDraftPublicState> => ({
    draftId: DRAFT_ID,
    draftVersion: 3,
    kind: 'personal',
    status: 'awaiting-confirmation',
    providedFields: ['person.name', 'person.cpf'],
    missingFields: [],
    registrationRequiredForQuote: false,
    continueOriginalDemand: true,
  }));
  const start = vi.fn(async () => {
    events.push('registration-start-handler');
    return {
      draftId: DRAFT_ID,
      draftVersion: 1,
      kind: 'personal' as const,
      status: 'draft' as const,
      providedFields: [],
      missingFields: ['person.name', 'person.cpf', 'person.phone'],
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
    };
  });
  const update = vi.fn(async () => {
    events.push('registration-patch-handler');
    return {
      draftId: DRAFT_ID,
      draftVersion: 2,
      kind: 'personal' as const,
      status: 'draft' as const,
      providedFields: ['person.name', 'person.email'],
      missingFields: ['person.cpf', 'person.phone'],
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
    };
  });
  const confirm = vi.fn(async () => {
    events.push('registration-update-handler');
    return {
      draftId: DRAFT_ID,
      draftVersion: 4,
      status: 'confirmed' as const,
      personRegistrationId: '90000000-0000-4000-8000-000000000009',
      companyRegistrationId: null,
      relationshipId: null,
      reviewIds: ['a0000000-0000-4000-8000-00000000000a'],
      confirmedByCustomer: true as const,
      relationshipGrantsAuthorization: false as const,
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
    };
  });
  const abandon = vi.fn(async () => {
    events.push('registration-abandon-handler');
    return {
      draftId: DRAFT_ID,
      status: 'abandoned' as const,
      incompleteRegistrationPersisted: false as const,
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
    };
  });
  const suggestFromRuntime = vi.fn(async () => {
    events.push('profile-handler');
    return {
      suggestionId: 'b0000000-0000-4000-8000-00000000000b',
      status: 'pending' as const,
      createdAt: '2026-08-29T12:00:00.000Z',
    };
  });
  const observeRuntimeGap = vi.fn(async () => {
    events.push('knowledge-gap-handler');
    return {
      gapId: 'c0000000-0000-4000-8000-00000000000c',
      topicNormalized: 'transporte de animais',
      status: 'open' as const,
      occurrenceCount: 1,
      observedAt: '2026-08-29T12:00:00.000Z',
      automaticPublication: false as const,
    };
  });
  const createRuntimeSuggestion = vi.fn(async () => {
    events.push('knowledge-suggestion-handler');
    return {
      suggestionId: 'd0000000-0000-4000-8000-00000000000d',
      status: 'pending' as const,
      createdAt: '2026-08-29T12:00:00.000Z',
      automaticPublication: false as const,
    };
  });
  const subject = new ServerSideAgentFunctionToolExecutor(
    prisma as unknown as PrismaService,
    { reauthorizeReturnedCall } as unknown as AgentFunctionToolCatalog,
    { resolveBeforeResponse },
    {
      start,
      update,
      read,
      preview,
      confirm,
      abandon,
    } as unknown as ConversationRegistrationUseCase,
    { suggestFromRuntime } as unknown as CustomerContextUseCase,
    {
      observeRuntimeGap,
      createRuntimeSuggestion,
    } as unknown as KnowledgeManagementUseCase,
  );
  return {
    subject,
    events,
    prisma,
    reauthorizeReturnedCall,
    resolveBeforeResponse,
    preview,
    start,
    update,
    read,
    confirm,
    abandon,
    suggestFromRuntime,
    observeRuntimeGap,
    createRuntimeSuggestion,
  };
}

describe('ServerSideAgentFunctionToolExecutor', () => {
  it('reauthorizes real arguments before an allow-listed profile suggestion and persists only a redacted result', async () => {
    const test = harness();
    const call = input('customer-profile_suggest', {
      profileKey: 'language',
      suggestedValue: 'Português',
      rationale: 'O cliente escreveu isso.',
      evidenceMessageId: null,
    });

    const result = await test.subject.execute(call);

    expect(test.events).toEqual([
      'execution',
      'requested',
      'control',
      'reauthorize',
      'allowed',
      'control',
      'profile-handler',
      'succeeded',
    ]);
    expect(test.reauthorizeReturnedCall).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      agentId: AGENT_ID,
      toolId: TOOL_ID,
      arguments: call.arguments,
    });
    expect(test.suggestFromRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
        profileKey: 'language',
      }),
    );
    expect(JSON.stringify(test.suggestFromRuntime.mock.calls)).not.toContain(
      'serviceIdentityId',
    );
    expect(result.modelResult).toEqual({
      suggestionId: 'b0000000-0000-4000-8000-00000000000b',
      status: 'pending',
    });
    const auditWrites = JSON.stringify({
      upsert: test.prisma.agentToolCall.upsert.mock.calls,
      update: test.prisma.agentToolCall.updateMany.mock.calls,
    });
    expect(auditWrites).not.toContain('Português');
    expect(auditWrites).not.toContain('O cliente escreveu isso');
  });

  it('derives tenant/session/contact for registration.read and does not return draft PII', async () => {
    const test = harness();

    const result = await test.subject.execute(
      input('registration_read', { draftId: DRAFT_ID }),
    );

    expect(test.preview).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: EXECUTION_ID,
      draftId: DRAFT_ID,
    });
    expect(test.read).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: EXECUTION_ID,
      draftId: DRAFT_ID,
    });
    expect(JSON.stringify(result.modelResult)).not.toContain('12345678900');
    expect(result.modelResult).toEqual({
      status: 'draft-state',
      result: expect.objectContaining({
        draftVersion: 3,
        providedFields: ['person.name', 'person.cpf'],
        requiredFieldDecisions: ['name'],
      }),
    });
  });

  it('reauthorizes a structured knowledge gap and derives bounded evidence from the same session', async () => {
    const test = harness();
    const call = input('knowledge_gap_observe', {
      topic: 'Transporte de animais',
    });

    const result = await test.subject.execute(call);

    expect(test.events).toEqual([
      'execution',
      'requested',
      'control',
      'reauthorize',
      'allowed',
      'control',
      'knowledge-evidence',
      'knowledge-gap-handler',
      'succeeded',
    ]);
    expect(test.prisma.whatsAppMessage.findMany).toHaveBeenCalledWith({
      where: {
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        contactId: CONTACT_ID,
        direction: MessageDirection.INBOUND,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { id: true },
    });
    expect(test.observeRuntimeGap).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
        topic: 'Transporte de animais',
        evidenceMessageIds: [MESSAGE_ID],
      }),
    );
    expect(JSON.stringify(test.observeRuntimeGap.mock.calls)).not.toContain(
      'serviceIdentityId',
    );
    expect(result.modelResult).toEqual({
      gapId: 'c0000000-0000-4000-8000-00000000000c',
      status: 'open',
      occurrenceCount: 1,
      automaticPublication: false,
    });
  });

  it('creates a knowledge suggestion only as pending and returns no proposed content', async () => {
    const test = harness();

    const result = await test.subject.execute(
      input('knowledge_suggestion_create', {
        title: 'Política de bagagem especial',
        proposedContent: 'Definir a regra institucional após revisão humana.',
      }),
    );

    expect(test.createRuntimeSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        agentExecutionId: EXECUTION_ID,
        evidenceMessageIds: [MESSAGE_ID],
      }),
    );
    expect(result.modelResult).toEqual({
      suggestionId: 'd0000000-0000-4000-8000-00000000000d',
      status: 'pending',
      reviewRequired: true,
      automaticPublication: false,
    });
    expect(JSON.stringify(result.modelResult)).not.toContain(
      'Definir a regra institucional',
    );
  });

  it('denies a knowledge tool when server-side reauthorization rejects the returned arguments', async () => {
    const test = harness();
    test.reauthorizeReturnedCall.mockRejectedValueOnce(
      new Error('grant de outro agente'),
    );

    await expect(
      test.subject.execute(
        input('knowledge_gap_observe', { topic: 'Política inexistente' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(test.observeRuntimeGap).not.toHaveBeenCalled();
    expect(test.events).toContain('denied');
    expect(test.events).not.toContain('knowledge-gap-handler');
  });

  it('reads a partial draft state without forcing preview or returning collected values', async () => {
    const test = harness();
    test.read.mockResolvedValueOnce({
      draftId: DRAFT_ID,
      draftVersion: 2,
      kind: 'company',
      status: 'draft',
      providedFields: ['person.name'],
      missingFields: ['person.cpf', 'person.phone', 'company.legalName'],
      registrationRequiredForQuote: false,
      continueOriginalDemand: true,
    });

    const result = await test.subject.execute(
      input('registration_read', { draftId: DRAFT_ID }),
    );

    expect(test.preview).not.toHaveBeenCalled();
    expect(result.modelResult).toMatchObject({
      status: 'draft-state',
      result: {
        draftId: DRAFT_ID,
        draftVersion: 2,
        status: 'draft',
        providedFields: ['person.name'],
        missingFields: ['person.cpf', 'person.phone', 'company.legalName'],
        requiredFieldDecisions: [],
        organizationReviewCount: 0,
      },
    });
  });

  it('starts a draft without accepting tenant/session/contact in model arguments', async () => {
    const test = harness();

    const result = await test.subject.execute(
      input('registration_draft_start', { kind: 'personal' }),
    );

    expect(test.start).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: EXECUTION_ID,
        kind: 'personal',
      }),
    );
    expect(result.modelResult).toEqual({
      draftId: DRAFT_ID,
      draftVersion: 1,
      kind: 'personal',
      status: 'draft',
      missingFields: ['person.name', 'person.cpf', 'person.phone'],
    });
  });

  it('applies a unique-field, versioned draft patch without confirming a Registration', async () => {
    const test = harness();

    const result = await test.subject.execute(
      input('registration_draft_patch', {
        draftId: DRAFT_ID,
        expectedDraftVersion: 1,
        changes: [
          { field: 'person.name', operation: 'set', value: 'Cliente Novo' },
          { field: 'person.email', operation: 'clear', value: null },
        ],
      }),
    );

    expect(test.update).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: EXECUTION_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 1,
        patch: {
          person: { name: 'Cliente Novo', email: null },
        },
      }),
    );
    expect(test.confirm).not.toHaveBeenCalled();
    expect(result.modelResult).toMatchObject({
      draftVersion: 2,
      status: 'draft',
      missingFields: ['person.cpf', 'person.phone'],
    });
  });

  it('rejects duplicate fields in a draft patch and audits the failed execution', async () => {
    const test = harness();

    await expect(
      test.subject.execute(
        input('registration_draft_patch', {
          draftId: DRAFT_ID,
          expectedDraftVersion: 1,
          changes: [
            { field: 'person.name', operation: 'set', value: 'A' },
            { field: 'person.name', operation: 'set', value: 'B' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(test.update).not.toHaveBeenCalled();
    expect(test.events).toContain('failed');
    expect(test.events).not.toContain('succeeded');
  });

  it('confirms a versioned draft only with explicit, same-session inbound evidence and no decorative token', async () => {
    const test = harness();
    const call = input('registration_update', {
      draftId: DRAFT_ID,
      expectedDraftVersion: 3,
      customerConfirmedFinalSummary: true,
      confirmationMessageId: MESSAGE_ID,
      fieldDecisions: {
        name: 'keep-existing',
        email: null,
        phone: null,
      },
    });

    const result = await test.subject.execute(call);

    expect(test.prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
      where: {
        id: MESSAGE_ID,
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        contactId: CONTACT_ID,
        direction: MessageDirection.INBOUND,
      },
      select: { text: true, occurredAt: true },
    });
    expect(test.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: EXECUTION_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 3,
        customerConfirmedFinalSummary: true,
        fieldDecisions: { name: 'keep-existing' },
      }),
    );
    expect(JSON.stringify(test.confirm.mock.calls)).not.toContain(
      'confirmationToken',
    );
    expect(result.modelResult).toEqual({
      status: 'confirmed',
      draftVersion: 4,
      reviewCount: 1,
    });
    expect(JSON.stringify(result.modelResult)).not.toContain(
      '90000000-0000-4000-8000-000000000009',
    );
  });

  it('fails and audits a non-explicit confirmation without presenting success', async () => {
    const test = harness();
    test.prisma.whatsAppMessage.findFirst.mockResolvedValueOnce({
      text: 'Não confirmo, precisa corrigir.',
      occurredAt: new Date('2026-08-29T12:01:00.000Z'),
      direction: MessageDirection.INBOUND,
    });

    await expect(
      test.subject.execute(
        input('registration_update', {
          draftId: DRAFT_ID,
          expectedDraftVersion: 3,
          customerConfirmedFinalSummary: true,
          confirmationMessageId: MESSAGE_ID,
          fieldDecisions: { name: null, email: null, phone: null },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.events).toContain('failed');
    expect(test.events).not.toContain('succeeded');
    const failedWrite = test.prisma.agentToolCall.updateMany.mock.calls.find(
      ([query]) => query.data.status === AgentToolCallStatus.FAILED,
    )?.[0];
    expect(failedWrite).toMatchObject({
      data: {
        resultSummary: { status: 'failed' },
        errorMessage: null,
      },
    });
    expect(JSON.stringify(failedWrite)).not.toContain('Não confirmo');
  });

  it('abandons and scrubs a draft only after explicit inbound refusal, without persisting an incomplete Registration', async () => {
    const test = harness();
    test.prisma.whatsAppMessage.findFirst.mockResolvedValueOnce({
      text: 'Prefiro não fazer o cadastro, deixa pra lá.',
      occurredAt: new Date('2026-08-29T12:01:00.000Z'),
      direction: MessageDirection.INBOUND,
    });

    const result = await test.subject.execute(
      input('registration_draft_abandon', {
        draftId: DRAFT_ID,
        expectedDraftVersion: 3,
        abandonmentMessageId: MESSAGE_ID,
      }),
    );

    expect(test.abandon).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        agentExecutionId: EXECUTION_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 3,
      }),
    );
    expect(result.modelResult).toEqual({
      status: 'abandoned',
      incompleteRegistrationPersisted: false,
      continueOriginalDemand: true,
    });
  });

  it('denies a control-mode race before reauthorization and records no model-supplied values', async () => {
    const test = harness();
    test.prisma.serviceSession.findFirst.mockResolvedValueOnce({
      status: ServiceSessionStatus.OPEN,
      controlMode: ServiceSessionControlMode.HUMAN,
      thread: { contactId: CONTACT_ID },
    });

    await expect(
      test.subject.execute(
        input('customer-profile_suggest', {
          profileKey: 'language',
          suggestedValue: 'segredo indevido',
          rationale: null,
          evidenceMessageId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(test.reauthorizeReturnedCall).not.toHaveBeenCalled();
    expect(test.suggestFromRuntime).not.toHaveBeenCalled();
    expect(test.events).toContain('denied');
    expect(
      JSON.stringify(test.prisma.agentToolCall.upsert.mock.calls),
    ).not.toContain('segredo indevido');
  });

  it('replays an already-succeeded call idempotently without reauthorizing or executing the mutation again', async () => {
    const test = harness();
    const call = input('customer-profile_suggest', {
      profileKey: 'language',
      suggestedValue: 'Português',
      rationale: null,
      evidenceMessageId: null,
    });
    test.prisma.agentToolCall.upsert.mockResolvedValueOnce({
      toolId: TOOL_ID,
      inputHash: fingerprintAgentToolArguments(call.arguments),
      status: AgentToolCallStatus.SUCCEEDED,
      requestMetadata: {
        providerResponseId: call.providerResponseId,
        providerItemId: call.providerItemId,
        providerCallId: call.providerCallId,
        functionName: call.functionName,
      },
      resultSummary: {
        suggestionId: 'b0000000-0000-4000-8000-00000000000b',
        status: 'pending',
      },
    });

    const result = await test.subject.execute(call);

    expect(result.authorizationId).toBe('idempotent-replay');
    expect(test.reauthorizeReturnedCall).not.toHaveBeenCalled();
    expect(test.suggestFromRuntime).not.toHaveBeenCalled();
    expect(test.prisma.agentToolCall.upsert).toHaveBeenCalledTimes(1);
    expect(test.prisma.agentToolCall.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant knowledge execution provenance before creating an audit row', async () => {
    const test = harness();
    test.prisma.agentExecution.findFirst.mockResolvedValueOnce(null);

    await expect(
      test.subject.execute(
        input('knowledge_gap_observe', { topic: 'Política inexistente' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(test.prisma.agentToolCall.upsert).not.toHaveBeenCalled();
    expect(test.reauthorizeReturnedCall).not.toHaveBeenCalled();
    expect(test.observeRuntimeGap).not.toHaveBeenCalled();
  });
});
