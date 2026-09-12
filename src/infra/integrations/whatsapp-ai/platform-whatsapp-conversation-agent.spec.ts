import type { TourismIntakeReviewService } from './tourism-intake-review.service';
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
    whatsAppMessage: { findMany: vi.fn().mockResolvedValue([]) },
    lumeAgent: {
      findMany: vi.fn().mockResolvedValue(agents),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    agentExecution: { findFirst: vi.fn().mockResolvedValue(null) },
    quoteRequest: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    subject: new PlatformWhatsAppConversationAgent(
      prisma as unknown as PrismaService,
      { execute } as unknown as RunAgentExecutionUseCase,
      {
        fleetContext: vi.fn().mockResolvedValue({
          maximumPassengers: 46,
          source: 'default',
          capacities: [],
        }),
        prompt: vi.fn().mockReturnValue('Validar turismo antes de encaminhar.'),
        review: vi.fn().mockImplementation(async (_input, output) => output),
      } as unknown as TourismIntakeReviewService,
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
          JSON.stringify(call.mediaInterpretations) ===
            JSON.stringify(input.mediaInterpretations) &&
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
          targetDepartment: 'financial',
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
      targetDepartment: 'financial',
      priority: 'normal',
      priorityReason: 'pedido explícito',
      message:
        'Vou encaminhar seu atendimento para nossa equipe dar continuidade.',
    });
  });

  it.each([undefined, 'commercial'])(
    'routes a quote from Financeiro when only the service agent requests a human (initial target %s)',
    async (initialTarget) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'orchestrator',
          outputText: JSON.stringify({
            intent: 'quote_discussion',
            humanRequested: false,
            priority: 'normal',
            reason: 'Cliente quer tratar do orçamento em andamento.',
            targetDepartment: initialTarget,
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'service',
          outputText: JSON.stringify({
            ...JSON.parse(
              customerJson(
                'Vou encaminhar sua solicitação ao time responsável.',
              ),
            ),
            collectionStatus: 'completed',
            customerDecision: 'human-requested',
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'routing',
          outputText: JSON.stringify({
            targetDepartment: 'commercial',
          }),
        });
      const { subject } = createSubject(execute);
      const result = await subject.complete({
        ...input,
        userMessage: 'Eu quero falar sobre meu orçamento.',
        currentConversation: {
          id: input.conversationId,
          department: 'financial',
          version: 17,
          conversationState: 'bot-active',
          flowStep: 'main-menu',
          requestStatus: 'rejected',
          resumeState: null,
        },
      });
      expect(result.output.targetDepartment).toBe('commercial');
      expect(result.output.customerDecision).toBe('human-requested');
      expect(execute).toHaveBeenCalledTimes(initialTarget ? 2 : 3);
      if (!initialTarget) {
        expect(execute.mock.calls[2][0]).toMatchObject({
          agentId: 'agent-orchestrator',
          parentExecutionId: 'orchestrator',
          input: expect.stringContaining('Eu quero falar sobre meu orçamento.'),
        });
      }
    },
  );

  it.each([undefined, 'unknown-department'])(
    'does not confirm a handoff or fall back to the origin when routing returns %s',
    async (targetDepartment) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'orchestrator',
          outputText: '{}',
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'service',
          outputText: JSON.stringify({
            ...JSON.parse(customerJson()),
            customerDecision: 'human-requested',
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'routing',
          outputText: JSON.stringify({ targetDepartment }),
        });
      const { subject } = createSubject(execute);
      await expect(subject.complete(input)).rejects.toThrow(
        'departamento válido',
      );
    },
  );

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

describe('histórico multimodal do atendimento', () => {
  it('preserva dados do áudio e complemento para todos os agentes, com correção humana e isolamento da sessão', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      executionId: 'history-test',
      outputText: customerJson('Qual sua preferência de veículo?'),
    });
    const { subject, prisma } = createSubject(execute);
    prisma.whatsAppMessage.findMany.mockResolvedValue([
      {
        direction: 'INBOUND',
        text: 'Ida e volta, saída 9h, retorno 10/10 às 21h',
        occurredAt: new Date('2026-09-06T12:07:00Z'),
        mediaAsset: null,
      },
      {
        direction: 'INBOUND',
        text: null,
        occurredAt: new Date('2026-09-06T12:05:00Z'),
        mediaAsset: {
          interpretation: {
            id: 'audio-interpretation',
            status: 'SUCCEEDED',
            transcription: 'transcrição antiga',
            extractedText: null,
            summary: null,
            correction: {
              correction:
                'Uberlândia para Goiânia em 08/10/2026, 15 passageiros',
            },
          },
        },
      },
    ]);
    await subject.complete({
      ...input,
      userMessage: 'Mais eu já informei',
      contextThrough: '2026-09-06T12:10:00Z',
    });
    expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: input.companyId,
          conversationId: input.conversationId,
          serviceSessionId: input.serviceSessionId,
          occurredAt: { lte: new Date('2026-09-06T12:10:00Z') },
        }),
        take: 50,
      }),
    );
    for (const [request] of execute.mock.calls) {
      expect(request.input).toContain(
        'Uberlândia para Goiânia em 08/10/2026, 15 passageiros',
      );
      expect(request.input).toContain('retorno 10/10 às 21h');
      expect(request.input).not.toContain('transcrição antiga');
      expect(request.mediaInterpretations).toContainEqual({
        interpretationId: 'audio-interpretation',
        effectiveSource: 'human',
      });
    }
  });
});

it('envia o resumo anterior e a confirmação curta aos agentes sem reiniciar o contexto', async () => {
  const execute = vi.fn().mockResolvedValue({
    ...completed,
    executionId: 'short-confirmation',
    outputText: customerJson('Dados confirmados.'),
  });
  const { subject, prisma } = createSubject(execute);
  prisma.whatsAppMessage.findMany.mockResolvedValue([
    {
      direction: 'INBOUND',
      text: 'está',
      occurredAt: new Date('2026-09-07T22:00:29Z'),
      mediaAsset: null,
    },
    {
      direction: 'OUTBOUND',
      text: 'Uberlândia para Goiânia, saída 20/09/2026, retorno 22/09/2026, 10 passageiros. Está correto?',
      occurredAt: new Date('2026-09-07T21:57:47Z'),
      mediaAsset: null,
    },
  ]);
  await subject.complete({
    ...input,
    userMessage: 'está',
    contextThrough: '2026-09-07T22:00:29Z',
  });
  for (const [request] of execute.mock.calls) {
    expect(request.input).toContain('Está correto?');
    expect(request.input).toContain('10 passageiros');
    expect(request.input).toContain('está');
    expect(String(request.input).indexOf('Está correto?')).toBeLessThan(
      String(request.input).indexOf('"text":"está"'),
    );
  }
  expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        companyId: input.companyId,
        conversationId: input.conversationId,
        serviceSessionId: input.serviceSessionId,
        OR: expect.arrayContaining([
          expect.objectContaining({
            direction: 'OUTBOUND',
            deliveryStatus: { in: ['SENT', 'DELIVERED', 'READ'] },
          }),
        ]),
      }),
    }),
  );
});

it('runs classifier and orchestrator silently and never invokes Milena or specialists under human control', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      ...completed,
      executionId: 'continuity-execution',
      outputText: JSON.stringify({
        classification: 'NEW_SUBJECT',
        confidence: 0.95,
        reason: 'Novo orçamento solicitado',
        targetDepartmentCode: 'commercial',
      }),
    })
    .mockResolvedValueOnce({
      ...completed,
      executionId: 'orchestrator-execution',
      outputText: JSON.stringify({
        intent: 'new-quote',
        priority: 'normal',
        targetDepartment: 'commercial',
        reason: 'Pedido de nova coleta',
      }),
    });
  const { subject, prisma } = createSubject(execute);
  prisma.lumeAgent.findFirst
    .mockResolvedValueOnce({ id: 'agent-continuity' })
    .mockResolvedValueOnce({ id: 'agent-orchestrator' });
  const result = await subject.observeHumanConversation(continuityInput);
  expect(result.continuity.classification).toBe('new-subject');
  expect(execute).toHaveBeenCalledTimes(2);
  for (const [command] of execute.mock.calls) {
    expect(command.observationOnly).toBe(true);
    expect(['agent-continuity', 'agent-orchestrator']).toContain(
      command.agentId,
    );
  }
});

describe('financial handoff regression after a pending quote', () => {
  const message =
    'Não consigo consultar as parcelas pendentes por aqui. Vou encaminhar sua solicitação ao time responsável para verificarem o pagamento da sua última viagem.';
  it.each(['under-review', 'approved', 'rejected'] as const)(
    'routes the actual completed/undecided reply without inheriting the %s quote department',
    async (status) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'classification',
          outputText: JSON.stringify({
            intent: 'payment_installment_inquiry',
            priority: 'normal',
            humanRequested: false,
            reason: 'Dúvida financeira sobre parcelas de viagem.',
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'service',
          outputText: JSON.stringify({
            ...JSON.parse(customerJson(message)),
            collectionStatus: 'completed',
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'routing',
          outputText: JSON.stringify({ targetDepartment: 'financial' }),
        });
      const { subject } = createSubject(execute);
      const quote = {
        id: 'existing-quote',
        version: 3,
        sequence: 1,
        status,
        origin: 'Uberlândia',
        destination: 'Jataí',
      };
      const result = await subject.complete({
        ...input,
        userMessage: 'Quantas parcelas faltam para pagar minha última viagem?',
        currentConversation: {
          id: input.conversationId,
          department: 'commercial',
          version: 9,
          conversationState: 'bot-active',
          flowStep: 'main-menu',
          requestStatus: status,
          resumeState: null,
          currentQuoteRequest: quote,
        },
      });
      expect(result.output).toMatchObject({
        message,
        collectionStatus: 'human-handoff',
        customerDecision: 'human-requested',
        targetDepartment: 'financial',
        priority: 'normal',
      });
      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[2][0]).toMatchObject({
        agentId: 'agent-orchestrator',
        parentExecutionId: 'classification',
        input: expect.stringContaining('Quantas parcelas faltam'),
      });
    },
  );
  it.each([undefined, 'unknown-department'])(
    'rejects an unstructured promise if routing has no valid destination: %s',
    async (targetDepartment) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'classification',
          outputText: '{}',
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'service',
          outputText: JSON.stringify({
            ...JSON.parse(customerJson(message)),
            collectionStatus: 'completed',
          }),
        })
        .mockResolvedValueOnce({
          ...completed,
          executionId: 'routing',
          outputText: JSON.stringify({ targetDepartment }),
        });
      await expect(
        createSubject(execute).subject.complete(input),
      ).rejects.toThrow('departamento válido');
    },
  );
});

describe('continuing a new quote without restarting the relationship', () => {
  const currentConversation = {
    id: input.conversationId,
    department: 'commercial' as const,
    version: 12,
    conversationState: 'bot-active' as const,
    flowStep: 'quote-data-collection' as const,
    requestStatus: 'collecting-information' as const,
    resumeState: null,
    currentQuoteRequest: {
      id: 'new-quote',
      sequence: 2,
      version: 1,
      status: 'collecting-information' as const,
      contactName: null as string | null,
      structuredData: { intakeStartedAt: '2026-09-11T06:22:21Z' },
    },
  };
  it.each([null, 'Taiane'])(
    'uses known responsibility without exposing a prior trip (stored name %s)',
    async (contactName) => {
      const execute = vi.fn().mockResolvedValue({
        ...completed,
        executionId: 'continuation',
        outputText: JSON.stringify({
          ...JSON.parse(
            customerJson(
              'Vamos preparar outro orçamento. Para qual data será a viagem?',
            ),
          ),
          missingFields: ['contactName', 'departureAt'],
        }),
      });
      const { subject, prisma } = createSubject(execute);
      prisma.quoteRequest.findFirst.mockResolvedValue({
        contactName: 'Taiane',
      });
      const result = await subject.complete({
        ...input,
        aiMode: 'eventual-quote',
        userMessage: 'Quero outro orçamento',
        currentConversation: {
          ...currentConversation,
          currentQuoteRequest: {
            ...currentConversation.currentQuoteRequest,
            contactName,
          },
        },
      });
      const serviceCall = execute.mock.calls.find(
        ([call]) => call.agentId === 'agent-service',
      )![0];
      expect(serviceCall.input).toContain('Não é primeiro contato');
      expect(serviceCall.input).toContain('não pergunte novamente o nome');
      expect(serviceCall.input).toContain('"contactName":"Taiane"');
      expect(result.output.missingFields).not.toContain('contactName');
      if (contactName)
        expect(prisma.quoteRequest.findFirst).not.toHaveBeenCalled();
      else {
        expect(result.output.extractedDataPatch.contactName).toBe('Taiane');
        expect(prisma.quoteRequest.findFirst).toHaveBeenCalledWith({
          where: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            sequence: { lt: 2 },
            contactName: { not: null },
          },
          orderBy: { sequence: 'desc' },
          select: { contactName: true },
        });
      }
      expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: input.companyId,
            conversationId: input.conversationId,
            serviceSessionId: input.serviceSessionId,
            occurredAt: { gte: new Date('2026-09-11T06:22:21Z') },
          }),
        }),
      );
    },
  );
  it('does not invent a responsible name or treat a first quote as a return', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      executionId: 'first-quote',
      outputText: customerJson(),
    });
    const { subject, prisma } = createSubject(execute);
    const result = await subject.complete({
      ...input,
      aiMode: 'eventual-quote',
      currentConversation: {
        ...currentConversation,
        currentQuoteRequest: {
          ...currentConversation.currentQuoteRequest,
          sequence: 1,
        },
      },
    });
    expect(prisma.quoteRequest.findFirst).not.toHaveBeenCalled();
    expect(result.output.extractedDataPatch.contactName).toBeUndefined();
    expect(
      execute.mock.calls.find(([call]) => call.agentId === 'agent-service')![0]
        .input,
    ).not.toContain('Não é primeiro contato');
  });
  it('does not restart collection while discussing another subject after a second quote', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      executionId: 'financial-topic',
      outputText: customerJson(),
    });
    const { subject, prisma } = createSubject(execute);
    await subject.complete({
      ...input,
      aiMode: 'natural-service',
      userMessage: 'Tenho uma dúvida financeira',
      currentConversation: {
        ...currentConversation,
        currentQuoteRequest: {
          ...currentConversation.currentQuoteRequest,
          status: 'under-review',
        },
      },
    });
    expect(prisma.quoteRequest.findFirst).not.toHaveBeenCalled();
    expect(
      execute.mock.calls.find(([call]) => call.agentId === 'agent-service')![0]
        .input,
    ).not.toContain('Não é primeiro contato');
  });
  it('preserves an explicit change of responsible person', async () => {
    const execute = vi.fn().mockResolvedValue({
      ...completed,
      executionId: 'new-responsible',
      outputText: JSON.stringify({
        ...JSON.parse(customerJson()),
        extractedDataPatch: { contactName: 'Marina' },
      }),
    });
    const { subject, prisma } = createSubject(execute);
    prisma.quoteRequest.findFirst.mockResolvedValue({ contactName: 'Taiane' });
    const result = await subject.complete({
      ...input,
      aiMode: 'eventual-quote',
      userMessage: 'Meu nome é Marina, sou a nova responsável.',
      currentConversation,
    });
    expect(result.output.extractedDataPatch.contactName).toBe('Marina');
  });
});
