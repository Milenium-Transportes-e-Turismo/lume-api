import { describe, expect, it, vi } from 'vitest';

import type { CreateAgentExecutionPersistenceInput } from '../../../application/contracts/agent-execution.repository';

import {
  AgentExecutionStatus,
  AgentPromptKind,
  AgentVersionStatus,
  KnowledgeScope,
  KnowledgeVersionStatus,
  KnowledgeVisibility,
  LumeAgentType,
  ServiceSessionControlMode,
  ServiceSessionStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaAgentExecutionRepository } from './prisma-agent-execution.repository';

function configurationPrisma(overrides?: {
  credentialIdentifier?: string | null;
  provider?: string;
}) {
  const now = new Date('2026-08-29T12:00:00.000Z');
  return {
    lumeAgent: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'agent-a',
        companyId: 'tenant-a',
        type: LumeAgentType.CUSTOMER_SERVICE,
        customerFacing: true,
      }),
    },
    serviceSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'session-a',
        companyId: 'tenant-a',
        currentDepartmentId: 'department-a',
        status: ServiceSessionStatus.OPEN,
        controlMode: ServiceSessionControlMode.AI,
        version: 7,
      }),
    },
    agentPromptVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'platform-prompt-v4',
          kind: AgentPromptKind.PLATFORM,
          version: 4,
          content: 'Platform policy',
        },
        {
          id: 'tenant-prompt-v2',
          kind: AgentPromptKind.TENANT_INSTRUCTIONS,
          version: 2,
          content: 'Tenant instructions',
        },
      ]),
    },
    agentRuntimeConfigVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'runtime-v3',
          companyId: 'tenant-a',
          agentId: 'agent-a',
          version: 3,
          provider: overrides?.provider ?? 'openai',
          model: 'gpt-5-mini',
          credentialRef: 'env://AGENT_A_OPENAI_KEY',
          credentialIdentifier:
            overrides?.credentialIdentifier === undefined
              ? 'agent-a-primary'
              : overrides.credentialIdentifier,
          parameters: { temperature: 0.2, maxOutputTokens: 900 },
          status: AgentVersionStatus.ACTIVE,
        },
        {
          id: 'runtime-v2',
          companyId: 'tenant-a',
          agentId: 'agent-a',
          version: 2,
          provider: 'openai',
          model: 'gpt-4.1-mini',
          credentialRef: 'docker-secret://agent-a-fallback',
          credentialIdentifier: 'agent-a-fallback',
          parameters: {},
          status: AgentVersionStatus.SUPERSEDED,
        },
      ]),
    },
    knowledgeDocumentVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'knowledge-v2',
          companyId: 'tenant-a',
          documentId: 'document-a',
          version: 2,
          status: KnowledgeVersionStatus.PUBLISHED,
          content: null,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveUntil: null,
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: now,
          document: {
            scope: KnowledgeScope.DEPARTMENT,
            visibility: KnowledgeVisibility.CUSTOMER_SAFE,
            departments: [{ departmentId: 'department-a' }],
          },
          chunks: [
            {
              id: 'chunk-a',
              ordinal: 1,
              pageNumber: 3,
              content: 'Published answer',
            },
          ],
        },
        {
          id: 'knowledge-v1',
          companyId: 'tenant-a',
          documentId: 'document-a',
          version: 1,
          status: KnowledgeVersionStatus.PUBLISHED,
          content: 'Old answer',
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveUntil: null,
          publishedAt: new Date('2025-01-01T00:00:00.000Z'),
          createdAt: now,
          document: {
            scope: KnowledgeScope.TENANT,
            visibility: KnowledgeVisibility.CUSTOMER_SAFE,
            departments: [],
          },
          chunks: [],
        },
        {
          id: 'internal-v1',
          companyId: 'tenant-a',
          documentId: 'document-internal',
          version: 1,
          status: KnowledgeVersionStatus.PUBLISHED,
          content: 'Internal secret',
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveUntil: null,
          publishedAt: new Date('2025-01-01T00:00:00.000Z'),
          createdAt: now,
          document: {
            scope: KnowledgeScope.TENANT,
            visibility: KnowledgeVisibility.INTERNAL,
            departments: [],
          },
          chunks: [],
        },
      ]),
    },
  };
}

function mediaExecutionInput(
  companyId = 'tenant-a',
): CreateAgentExecutionPersistenceInput {
  return {
    companyId,
    serviceSessionId: 'session-a',
    agentId: 'agent-a',
    commandId: 'command-media-a',
    agentType: 'customer-service',
    customerFacing: true,
    source: 'whatsapp',
    initialRuntime: {
      runtimeId: 'runtime-a',
      runtimeConfigVersion: 3,
      provider: 'openai',
      model: 'gpt-5-mini',
      credentialIdentifier: 'agent-a-primary',
      temperature: 0.2,
      maxOutputTokens: 900,
    },
    platformPromptVersionId: 'platform-prompt-v4',
    tenantPromptVersionId: 'tenant-prompt-v2',
    mediaInterpretations: [
      {
        interpretationId: '00000000-0000-4000-8000-000000000091',
        effectiveSource: 'machine',
      },
      {
        interpretationId: '00000000-0000-4000-8000-000000000092',
        effectiveSource: 'human',
      },
    ],
    createdAt: new Date('2026-08-29T12:00:00.000Z'),
  };
}

describe('PrismaAgentExecutionRepository', () => {
  it('loads exact-tenant active config, same-agent fallback and only effective published knowledge', async () => {
    const prisma = configurationPrisma();
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );

    const configuration = await repository.loadActiveForSession({
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
    });

    expect(configuration).toMatchObject({
      agent: {
        id: 'agent-a',
        companyId: 'tenant-a',
        type: 'customer-service',
        status: 'active',
      },
      session: {
        id: 'session-a',
        companyId: 'tenant-a',
        departmentId: 'department-a',
        customerFacing: true,
        source: 'whatsapp',
      },
      prompt: {
        platformPromptVersionId: 'platform-prompt-v4',
        tenantInstructionsVersionId: 'tenant-prompt-v2',
        systemPromptVersion: 1,
        runtimeContextVersion: 7,
      },
      primaryRuntime: {
        runtimeId: 'runtime-v3',
        agentId: 'agent-a',
        companyId: 'tenant-a',
        version: 3,
        runtime: {
          provider: 'openai',
          model: 'gpt-5-mini',
          credentialIdentifier: 'agent-a-primary',
          status: 'active',
        },
      },
      fallbackRuntimes: [
        {
          runtimeId: 'runtime-v2',
          agentId: 'agent-a',
          companyId: 'tenant-a',
          version: 2,
          runtime: { status: 'superseded' },
        },
      ],
      knowledge: [
        {
          content: 'Published answer',
          source: {
            documentId: 'document-a',
            versionId: 'knowledge-v2',
            version: 2,
            chunkId: 'chunk-a',
            page: 3,
            visibility: 'customer-safe',
          },
        },
      ],
    });
    expect(prisma.lumeAgent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'tenant-a',
          id: 'agent-a',
        }),
      }),
    );
    expect(prisma.serviceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'tenant-a',
          id: 'session-a',
        }),
      }),
    );
  });

  it('denies cross-tenant/absent session and does not fall back to another tenant', async () => {
    const prisma = configurationPrisma();
    prisma.serviceSession.findFirst.mockResolvedValue(null);
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.loadActiveForSession({
        companyId: 'tenant-b',
        serviceSessionId: 'session-a',
        agentId: 'agent-a',
      }),
    ).resolves.toBeNull();
    expect(prisma.agentPromptVersion.findMany).not.toHaveBeenCalled();
    expect(prisma.serviceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'tenant-b' }),
      }),
    );
  });

  it('treats a missing safe credential identifier as incomplete configuration', async () => {
    const prisma = configurationPrisma({ credentialIdentifier: null });
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.loadActiveForSession({
        companyId: 'tenant-a',
        serviceSessionId: 'session-a',
        agentId: 'agent-a',
      }),
    ).resolves.toBeNull();
  });

  it('loads a future provider configuration for routing by the adapter registry', async () => {
    const prisma = configurationPrisma({ provider: 'future-provider' });
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );

    const configuration = await repository.loadActiveForSession({
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
    });

    expect(configuration?.primaryRuntime.runtime.provider).toBe(
      'future-provider',
    );
  });

  it('persists exact safe snapshots and redacts attempted secret echoes', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      agentExecution: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'execution-a',
            structuredDecision: {
              request: { commandId: 'command-a', fingerprint: 'fingerprint' },
              attemptSnapshots: [],
            },
          })
          .mockResolvedValueOnce({
            id: 'execution-a',
            startedAt: new Date('2026-08-29T12:00:00.000Z'),
            status: AgentExecutionStatus.RUNNING,
          }),
        create: vi.fn().mockResolvedValue({ id: 'execution-a' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      agentExecutionAttempt: { upsert: vi.fn().mockResolvedValue({}) },
      agentExecutionKnowledgeSource: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      agentToolCall: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );
    const runtime = {
      runtimeId: 'runtime-a',
      runtimeConfigVersion: 3,
      provider: 'openai' as const,
      model: 'gpt-5-mini',
      credentialIdentifier: 'agent-a-primary',
      temperature: 0.2,
      maxOutputTokens: 900,
    };

    await repository.create({
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
      commandId: 'command-a',
      agentType: 'customer-service',
      customerFacing: true,
      source: 'whatsapp',
      initialRuntime: runtime,
      platformPromptVersionId: 'platform-prompt-v4',
      tenantPromptVersionId: 'tenant-prompt-v2',
      createdAt: new Date('2026-08-29T12:00:00.000Z'),
    });
    await repository.recordAttempt({
      companyId: 'tenant-a',
      executionId: 'execution-a',
      attempt: 1,
      startedAt: new Date('2026-08-29T12:00:00.000Z'),
      completedAt: new Date('2026-08-29T12:00:01.000Z'),
      runtime,
      prompt: {
        systemPromptVersion: 1,
        platformPromptVersion: 4,
        tenantInstructionsVersion: 2,
        runtimeContextVersion: 7,
        systemPromptSha256: 'a'.repeat(64),
        platformPromptSha256: 'b'.repeat(64),
        tenantInstructionsSha256: 'c'.repeat(64),
        runtimeContextSha256: 'd'.repeat(64),
        compiledInstructionsSha256: 'e'.repeat(64),
      },
      knowledge: [
        {
          documentId: 'document-a',
          versionId: 'knowledge-v2',
          version: 2,
          chunkId: 'chunk-a',
          page: 3,
          retrievedAt: new Date('2026-08-29T12:00:00.000Z'),
          visibility: 'customer-safe',
          contentSha256: 'f'.repeat(64),
        },
      ],
      tools: [
        {
          toolId: 'tool-a',
          functionName: 'registration_read',
          policyVersion: 1,
          schemaSha256: '1'.repeat(64),
        },
      ],
      modelInputSha256: '2'.repeat(64),
      continuationModelInputSha256: null,
      outcome: 'succeeded',
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
        reasoningTokens: 1,
        totalTokens: 14,
      },
      errorCode: null,
      errorReason: null,
    });
    await repository.complete({
      companyId: 'tenant-a',
      executionId: 'execution-a',
      successfulAttempt: 1,
      providerResponseId: 'response-a',
      provider: 'openai',
      model: 'gpt-5-mini',
      outputText: 'Do not leak sk-supersecret12345 or env://AGENT_A_OPENAI_KEY',
      toolCalls: [],
      usage: null,
      completedAt: new Date('2026-08-29T12:00:02.000Z'),
    });

    const serializedCalls = JSON.stringify({
      create: transaction.agentExecution.create.mock.calls,
      attempt: transaction.agentExecutionAttempt.upsert.mock.calls,
      updates: transaction.agentExecution.updateMany.mock.calls,
    });
    expect(serializedCalls).not.toContain('credentialRef');
    expect(serializedCalls).not.toContain('sk-supersecret12345');
    expect(serializedCalls).not.toContain('env://AGENT_A_OPENAI_KEY');
    expect(transaction.agentExecutionAttempt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          runtimeConfigVersionId: 'runtime-a',
          attemptNumber: 1,
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          errorMessage: null,
        }),
      }),
    );
    expect(
      transaction.agentExecutionKnowledgeSource.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            companyId: 'tenant-a',
            executionId: 'execution-a',
            documentVersionId: 'knowledge-v2',
            chunkId: 'chunk-a',
            documentVersionNumber: 2,
          }),
        ],
      }),
    );
  });

  it('persiste provenance machine/human tenant-scoped e preserva replay idempotente', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mediaInterpretation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000091',
            correction: null,
          },
          {
            id: '00000000-0000-4000-8000-000000000092',
            correction: { id: 'correction-a' },
          },
        ]),
      },
      agentExecution: {
        findFirst: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({ id: 'execution-media-a' }),
      },
      agentExecutionMediaSource: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );
    const input = mediaExecutionInput();

    await expect(repository.create(input)).resolves.toEqual({
      executionId: 'execution-media-a',
      created: true,
    });
    const persistedExecution = transaction.agentExecution.create.mock
      .calls[0]?.[0] as {
      data: { structuredDecision: Record<string, unknown> };
    };
    transaction.agentExecution.findFirst.mockResolvedValueOnce({
      id: 'execution-media-a',
      structuredDecision: persistedExecution.data.structuredDecision,
    });

    await expect(repository.create(input)).resolves.toEqual({
      executionId: 'execution-media-a',
      created: false,
    });

    expect(transaction.mediaInterpretation.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'tenant-a',
        id: {
          in: [
            '00000000-0000-4000-8000-000000000091',
            '00000000-0000-4000-8000-000000000092',
          ],
        },
        status: 'SUCCEEDED',
      },
      select: { id: true, correction: { select: { id: true } } },
    });
    expect(transaction.agentExecution.create).toHaveBeenCalledTimes(1);
    expect(
      transaction.agentExecutionMediaSource.createMany,
    ).toHaveBeenCalledTimes(2);
    expect(
      transaction.agentExecutionMediaSource.createMany.mock.calls[0]?.[0],
    ).toEqual({
      data: [
        {
          companyId: 'tenant-a',
          executionId: 'execution-media-a',
          interpretationId: '00000000-0000-4000-8000-000000000091',
          attachedAt: input.createdAt,
        },
        {
          companyId: 'tenant-a',
          executionId: 'execution-media-a',
          interpretationId: '00000000-0000-4000-8000-000000000092',
          attachedAt: input.createdAt,
        },
      ],
      skipDuplicates: true,
    });
    expect(persistedExecution.data.structuredDecision).toMatchObject({
      request: {
        mediaSources: [
          {
            interpretationId: '00000000-0000-4000-8000-000000000091',
            effectiveSource: 'machine',
          },
          {
            interpretationId: '00000000-0000-4000-8000-000000000092',
            effectiveSource: 'human',
          },
        ],
      },
    });
  });

  it('recusa interpretação de outro tenant antes de criar a execução', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mediaInterpretation: { findMany: vi.fn().mockResolvedValue([]) },
      agentExecution: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      agentExecutionMediaSource: { createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const repository = new PrismaAgentExecutionRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.create(mediaExecutionInput('tenant-b')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transaction.mediaInterpretation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'tenant-b' }),
      }),
    );
    expect(transaction.agentExecution.findFirst).not.toHaveBeenCalled();
    expect(transaction.agentExecution.create).not.toHaveBeenCalled();
    expect(
      transaction.agentExecutionMediaSource.createMany,
    ).not.toHaveBeenCalled();
  });
});
