import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import {
  AgentExecutionSource,
  AgentExecutionStatus,
  AgentPromptKind,
  AgentVersionStatus,
  LumeAgentStatus,
  LumeAgentType,
} from '../../infra/database/prisma/generated/client';
import type { PrismaService } from '../../infra/database/prisma/prisma.service';
import { AgentAdministrationService } from './agent-administration.service';

const current = {
  id: 'user-a',
  companyId: 'tenant-a',
} as AuthenticatedPrincipal;

describe('AgentAdministrationService', () => {
  it('lists technical status without returning credentialRef or secret values', async () => {
    const prisma = {
      lumeAgent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'agent-a',
            code: 'customer-service',
            name: 'Customer service',
            description: null,
            type: LumeAgentType.CUSTOMER_SERVICE,
            status: LumeAgentStatus.ACTIVE,
            contexts: [AgentExecutionSource.WHATSAPP],
            customerFacing: true,
            platformManaged: true,
            promptVersions: [
              {
                id: 'platform-v1',
                kind: AgentPromptKind.PLATFORM,
                version: 1,
                status: AgentVersionStatus.ACTIVE,
                contentHash: 'a'.repeat(64),
                activatedAt: new Date('2026-08-29T12:00:00.000Z'),
              },
            ],
            runtimeConfigs: [
              {
                id: 'runtime-v1',
                version: 1,
                provider: 'openai',
                model: 'gpt-5-mini',
                credentialIdentifier: 'customer-service-primary',
                credentialVersion: '2026-08',
                credentialRef: 'env://CUSTOMER_SERVICE_OPENAI_KEY',
                apiKey: 'sk-supersecret12345',
                status: AgentVersionStatus.ACTIVE,
                activatedAt: new Date('2026-08-29T12:00:00.000Z'),
                deactivatedAt: null,
              },
            ],
          },
        ]),
      },
    };
    const service = new AgentAdministrationService(
      prisma as unknown as PrismaService,
    );

    const result = await service.listAgents(current);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject([
      {
        id: 'agent-a',
        type: 'customer-service',
        configurationStatus: 'ready',
        technicalConfigurationMutable: false,
        runtimeConfigs: [
          {
            provider: 'openai',
            model: 'gpt-5-mini',
          },
        ],
      },
    ]);
    expect(serialized).not.toContain('credentialIdentifier');
    expect(serialized).not.toContain('customer-service-primary');
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('credentialIdentifier');
    expect(serialized).not.toContain('agent-a-primary');
    expect(serialized).not.toContain('CUSTOMER_SERVICE_OPENAI_KEY');
    expect(serialized).not.toContain('sk-supersecret12345');
    const query = prisma.lumeAgent.findMany.mock.calls[0]?.[0];
    expect(query.select.runtimeConfigs.select).not.toHaveProperty(
      'credentialRef',
    );
  });

  it('denies cross-tenant execution lookup before loading any audit rows', async () => {
    const prisma = {
      lumeAgent: { findFirst: vi.fn().mockResolvedValue(null) },
      agentExecution: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };
    const service = new AgentAdministrationService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.listExecutions(current, 'agent-from-another-tenant', {
        page: 1,
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.lumeAgent.findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-from-another-tenant', companyId: 'tenant-a' },
      select: { id: true },
    });
    expect(prisma.agentExecution.findMany).not.toHaveBeenCalled();
  });

  it('redacts historical secret echoes in execution JSON', async () => {
    const prisma = {
      lumeAgent: { findFirst: vi.fn().mockResolvedValue({ id: 'agent-a' }) },
      agentExecution: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'execution-a',
            agentId: 'agent-a',
            agentType: LumeAgentType.CUSTOMER_SERVICE,
            serviceSessionId: 'session-a',
            source: AgentExecutionSource.WHATSAPP,
            provider: 'openai',
            model: 'gpt-5-mini',
            credentialIdentifier: 'agent-a-primary',
            status: AgentExecutionStatus.SUCCEEDED,
            latencyMs: 120,
            inputTokens: 10,
            outputTokens: 3,
            totalTokens: 13,
            structuredDecision: {
              credentialRef: 'env://AGENT_A_OPENAI_KEY',
              nested: { apiKey: 'sk-supersecret12345', safe: 'kept' },
            },
            result: {
              outputText:
                'echo sk-supersecret12345 and docker-secret://agent-a-key',
            },
            errorCode: null,
            startedAt: new Date('2026-08-29T12:00:00.000Z'),
            completedAt: new Date('2026-08-29T12:00:01.000Z'),
            createdAt: new Date('2026-08-29T12:00:00.000Z'),
            attempts: [],
            toolCalls: [],
            knowledgeSources: [],
          },
        ]),
      },
    };
    const service = new AgentAdministrationService(
      prisma as unknown as PrismaService,
    );

    const result = await service.listExecutions(current, 'agent-a', {
      page: 1,
      limit: 25,
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('env://AGENT_A_OPENAI_KEY');
    expect(serialized).not.toContain('sk-supersecret12345');
    expect(serialized).not.toContain('docker-secret://agent-a-key');
    expect(serialized).toContain('[REDACTED');
    expect(serialized).toContain('kept');
  });

  it('versions only tenant instructions with optimistic concurrency and audit', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      tenantAuditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a' }) },
      lumeAgent: { findFirst: vi.fn().mockResolvedValue({ id: 'agent-a' }) },
      agentPromptVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'tenant-v2',
          version: 2,
          contentHash: 'a'.repeat(64),
        }),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 2 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          id: 'tenant-v3',
          version: 3,
          contentHash: 'b'.repeat(64),
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const service = new AgentAdministrationService(
      prisma as unknown as PrismaService,
    );

    const result = await service.updateTenantInstructions(current, 'agent-a', {
      commandId: '00000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
      content: 'Use the tenant-approved tone.',
    });

    expect(result).toMatchObject({
      agentId: 'agent-a',
      promptVersionId: 'tenant-v3',
      version: 3,
      idempotent: false,
    });
    expect(transaction.agentPromptVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'tenant-a',
          agentId: 'agent-a',
          kind: AgentPromptKind.TENANT_INSTRUCTIONS,
          status: AgentVersionStatus.ACTIVE,
          version: 3,
          createdByUserId: 'user-a',
        }),
      }),
    );
    const serialized = JSON.stringify(
      transaction.tenantAuditLog.create.mock.calls,
    );
    expect(serialized).not.toContain('Use the tenant-approved tone.');
    expect(serialized).not.toContain('credentialRef');
  });

  it('rejects secrets and credential references inside tenant instructions', async () => {
    const service = new AgentAdministrationService({} as PrismaService);

    await expect(
      service.updateTenantInstructions(current, 'agent-a', {
        commandId: '00000000-0000-4000-8000-000000000002',
        expectedVersion: 0,
        content: 'Use a chave sk-supersecret123456789 para responder.',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.updateTenantInstructions(current, 'agent-a', {
        commandId: '00000000-0000-4000-8000-000000000003',
        expectedVersion: 0,
        content: 'Leia env://LUME_AGENT_CUSTOMER_SERVICE_OPENAI_API_KEY.',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rolls back by creating a new immutable version and auditing the source', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      tenantAuditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a' }) },
      lumeAgent: { findFirst: vi.fn().mockResolvedValue({ id: 'agent-a' }) },
      agentPromptVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'tenant-v3',
            version: 3,
            contentHash: 'c'.repeat(64),
          })
          .mockResolvedValueOnce({
            id: 'tenant-v1',
            version: 1,
            content: 'Tom institucional aprovado.',
            contentHash: 'a'.repeat(64),
          }),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 3 } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          id: 'tenant-v4',
          version: 4,
          contentHash: 'a'.repeat(64),
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const service = new AgentAdministrationService(
      prisma as unknown as PrismaService,
    );

    const result = await service.rollbackTenantInstructions(
      current,
      'agent-a',
      'tenant-v1',
      {
        commandId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 3,
      },
    );

    expect(result).toMatchObject({
      promptVersionId: 'tenant-v4',
      version: 4,
      sourceVersionId: 'tenant-v1',
      idempotent: false,
    });
    expect(transaction.agentPromptVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 4,
          content: 'Tom institucional aprovado.',
          contentHash: 'a'.repeat(64),
          status: AgentVersionStatus.ACTIVE,
        }),
      }),
    );
    expect(transaction.tenantAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'agent.tenant-instructions.rolled-back',
          metadata: expect.objectContaining({
            sourceVersionId: 'tenant-v1',
            sourceVersion: 1,
          }),
        }),
      }),
    );
  });
});
