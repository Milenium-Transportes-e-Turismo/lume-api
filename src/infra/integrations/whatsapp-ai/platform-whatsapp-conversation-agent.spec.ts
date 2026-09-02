import { describe, expect, it, vi } from 'vitest';

import type { RunAgentExecutionUseCase } from '../../../application/use-cases/agents/run-agent-execution.use-case';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { PlatformWhatsAppConversationAgent } from './platform-whatsapp-conversation-agent';

const input = {
  sourceEventId: 'evolution:event-1',
  correlationId: 'evolution:event-1',
  companyId: '00000000-0000-4000-8000-000000000001',
  conversationId: '00000000-0000-4000-8000-000000000002',
  serviceSessionId: '00000000-0000-4000-8000-000000000003',
  aiMode: 'natural-service' as const,
  userMessage: 'Preciso atualizar meu cadastro.',
  mediaInterpretations: [
    {
      interpretationId: '00000000-0000-4000-8000-000000000099',
      effectiveSource: 'human' as const,
    },
  ],
  currentConversation: null,
};

const continuityInput = {
  sourceEventId: 'evolution:event-continuity-1',
  companyId: input.companyId,
  conversationId: input.conversationId,
  serviceSessionId: input.serviceSessionId,
  currentDepartmentId: '00000000-0000-4000-8000-000000000011',
  previousMessages: [
    {
      direction: 'inbound' as const,
      text: 'Preciso atualizar meu cadastro.',
      occurredAt: '2026-08-29T10:00:00.000Z',
    },
  ],
  userMessage: 'Agora preciso de uma cotação de viagem.',
  allowedTargetDepartments: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      code: 'client-company',
      name: 'Empresa cliente',
    },
    {
      id: '00000000-0000-4000-8000-000000000012',
      code: 'commercial',
      name: 'Comercial',
    },
  ],
};

const completed = {
  status: 'completed' as const,
  customerFacing: false,
  successfulAttempt: 1,
  provider: 'openai',
  model: 'gpt-5.6-terra',
  toolCalls: [],
  usage: null,
};

function customerJson(message = 'Como posso ajudar?') {
  return JSON.stringify({
    message,
    collectionStatus: 'collecting',
    extractedDataPatch: {},
    missingFields: [],
    summaryPresented: false,
    customerDecision: 'undecided',
  });
}

function createSubject(
  execute: ReturnType<typeof vi.fn>,
  agents = [
    { id: 'agent-orchestrator', code: 'orchestrator' },
    { id: 'agent-registration', code: 'registration-specialist' },
    { id: 'agent-service', code: 'customer-service' },
  ],
) {
  const prisma = {
    lumeAgent: {
      findMany: vi.fn().mockResolvedValue(agents),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    agentExecution: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    subject: new PlatformWhatsAppConversationAgent(
      prisma as unknown as PrismaService,
      { execute } as unknown as RunAgentExecutionUseCase,
    ),
    prisma,
  };
}

describe('PlatformWhatsAppConversationAgent', () => {
  it('uses only the tenant continuity classifier and validates its routed decision', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      model: 'gpt-5.6-luna',
      executionId: 'execution-continuity',
      outputText: JSON.stringify({
        classification: 'NEW_SUBJECT',
        confidence: 0.94,
        reason: 'A nova solicitação não depende do cadastro anterior.',
        targetDepartmentCode: 'commercial',
      }),
    });
    const { subject, prisma } = createSubject(execute);
    prisma.lumeAgent.findFirst.mockResolvedValueOnce({
      id: 'agent-continuity',
    });

    await expect(subject.classifyContinuity(continuityInput)).resolves.toEqual({
      classification: 'new-subject',
      confidence: 0.94,
      reason: 'A nova solicitação não depende do cadastro anterior.',
      targetDepartmentId: '00000000-0000-4000-8000-000000000012',
      agentId: 'agent-continuity',
      agentExecutionId: 'execution-continuity',
    });
    expect(prisma.lumeAgent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: continuityInput.companyId,
          code: 'continuity-classifier',
          customerFacing: false,
        }),
      }),
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: continuityInput.companyId,
        serviceSessionId: continuityInput.serviceSessionId,
        agentId: 'agent-continuity',
        commandId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      }),
    );
  });

  it('rejects an invalid continuity payload instead of guessing', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      executionId: 'execution-continuity',
      outputText: JSON.stringify({
        classification: 'NEW_SUBJECT',
        confidence: 2,
        reason: '',
      }),
    });
    const { subject, prisma } = createSubject(execute);
    prisma.lumeAgent.findFirst.mockResolvedValueOnce({
      id: 'agent-continuity',
    });

    await expect(
      subject.classifyContinuity(continuityInput),
    ).rejects.toMatchObject({
      name: 'WhatsAppContinuityClassificationError',
      agentId: 'agent-continuity',
      agentExecutionId: 'execution-continuity',
    });
  });

  it('preserves the failed classifier execution for the safe fallback audit', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('runtime unavailable'));
    const { subject, prisma } = createSubject(execute);
    prisma.lumeAgent.findFirst.mockResolvedValueOnce({
      id: 'agent-continuity',
    });
    prisma.agentExecution.findFirst.mockResolvedValueOnce({
      id: 'execution-continuity-failed',
      status: 'FAILED',
      result: { attemptedRuntimeCount: 1 },
    });

    await expect(
      subject.classifyContinuity(continuityInput),
    ).rejects.toMatchObject({
      name: 'WhatsAppContinuityClassificationError',
      agentId: 'agent-continuity',
      agentExecutionId: 'execution-continuity-failed',
    });
    expect(prisma.agentExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: continuityInput.companyId,
          agentId: 'agent-continuity',
          serviceSessionId: continuityInput.serviceSessionId,
          structuredDecision: expect.objectContaining({
            path: ['request', 'commandId'],
          }),
        }),
      }),
    );
  });

  it('orchestrates silently, delegates and attributes the customer-facing execution', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ...completed,
        executionId: 'execution-orchestrator',
        outputText: JSON.stringify({
          intent: 'registration-update',
          priority: 'normal',
          specialistCode: 'registration-specialist',
          humanRequested: false,
          confidence: 0.95,
          reason: 'cliente solicitou cadastro',
        }),
      })
      .mockResolvedValueOnce({
        ...completed,
        executionId: 'execution-registration',
        outputText: JSON.stringify({ nextStep: 'collect-confirmation' }),
      })
      .mockResolvedValueOnce({
        ...completed,
        customerFacing: true,
        executionId: 'execution-service',
        outputText: customerJson('Posso ajudar com a atualização.'),
      });
    const { subject } = createSubject(execute);

    const result = await subject.complete(input);

    expect(result).toMatchObject({
      agentId: 'agent-service',
      agentExecutionId: 'execution-service',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      output: {
        message: 'Posso ajudar com a atualização.',
        priority: 'normal',
        priorityReason: 'cliente solicitou cadastro',
      },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.map(([call]) => call.agentId)).toEqual([
      'agent-orchestrator',
      'agent-registration',
      'agent-service',
    ]);
    expect(
      new Set(execute.mock.calls.map(([call]) => call.commandId)).size,
    ).toBe(3);
    expect(
      execute.mock.calls.every(
        ([call]) =>
          call.serviceSessionId === input.serviceSessionId &&
          call.mediaInterpretations === input.mediaInterpretations &&
          /^[a-f0-9]{48}$/.test(call.safetyIdentifier),
      ),
    ).toBe(true);
    expect(execute.mock.calls[0]?.[0].parentExecutionId).toBeUndefined();
    expect(execute.mock.calls[1]?.[0].parentExecutionId).toBe(
      'execution-orchestrator',
    );
    expect(execute.mock.calls[2]?.[0].parentExecutionId).toBe(
      'execution-orchestrator',
    );
  });

  it('isolates an orchestrator credential failure without borrowing the customer key', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('credential unavailable'))
      .mockResolvedValueOnce({
        ...completed,
        customerFacing: true,
        executionId: 'execution-service',
        outputText: customerJson(),
      });
    const { subject } = createSubject(execute);

    const result = await subject.complete(input);

    expect(result.output.message).toBe('Como posso ajudar?');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([call]) => call.agentId)).toEqual([
      'agent-orchestrator',
      'agent-service',
    ]);
  });

  it('honors a silent human-request decision even if the service output is generic', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ...completed,
        executionId: 'execution-orchestrator',
        outputText: JSON.stringify({
          intent: 'human-service',
          priority: 'normal',
          specialistCode: null,
          humanRequested: true,
          confidence: 1,
          reason: 'pedido explícito',
        }),
      })
      .mockResolvedValueOnce({
        ...completed,
        customerFacing: true,
        executionId: 'execution-service',
        outputText: customerJson('Vou encaminhar seu atendimento.'),
      });
    const { subject } = createSubject(execute);

    const result = await subject.complete(input);

    expect(result.output).toMatchObject({
      collectionStatus: 'human-handoff',
      customerDecision: 'human-requested',
      priority: 'normal',
      priorityReason: 'pedido explícito',
    });
  });

  it('fails closed when the customer-facing agent returns an invalid schema', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      customerFacing: true,
      executionId: 'execution-service',
      outputText: 'resposta sem schema',
    });
    const { subject } = createSubject(execute, [
      { id: 'agent-service', code: 'customer-service' },
    ]);

    await expect(subject.complete(input)).rejects.toMatchObject({
      code: 'EXTERNAL_SERVICE_UNAVAILABLE',
    });
  });
});
