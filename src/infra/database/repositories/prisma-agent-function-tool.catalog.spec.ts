import { describe, expect, it, vi } from 'vitest';

import {
  AgentAutonomyLevel,
  DocumentAccessMode,
  ServiceSessionControlMode,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaAgentFunctionToolCatalog } from './prisma-agent-function-tool.catalog';

const strictSchema = {
  type: 'object',
  properties: { registrationId: { type: 'string' } },
  required: ['registrationId'],
  additionalProperties: false,
};

function catalogPrisma() {
  return {
    serviceSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'session-a',
        companyId: 'tenant-a',
        currentDepartmentId: 'department-a',
        controlMode: ServiceSessionControlMode.HUMAN,
        responsibleUser: {
          departments: ['commercial'],
          permissionCodes: ['clients:view', 'clients:update'],
          isAdministrator: false,
          documentAccessMode: DocumentAccessMode.STANDARD,
          isActive: true,
          deletedAt: null,
        },
        assignments: [],
      }),
    },
    lumeAgent: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'agent-a',
        capabilities: [
          { capability: { autonomyLevel: AgentAutonomyLevel.READ } },
          { capability: { autonomyLevel: AgentAutonomyLevel.SAFE_WRITE } },
        ],
        tools: [
          {
            tool: {
              id: 'tool-read',
              code: 'registration.read',
              name: 'Read registration',
              description: 'Reads an authorized registration.',
              autonomyLevel: AgentAutonomyLevel.READ,
              inputSchema: strictSchema,
            },
          },
          {
            tool: {
              id: 'tool-knowledge-gap',
              code: 'knowledge.gap.observe',
              name: 'Observe knowledge gap',
              description: 'Persists a bounded knowledge gap observation.',
              autonomyLevel: AgentAutonomyLevel.SAFE_WRITE,
              inputSchema: strictSchema,
            },
          },
          {
            tool: {
              id: 'tool-knowledge-suggestion',
              code: 'knowledge.suggestion.create',
              name: 'Create pending knowledge suggestion',
              description: 'Creates a pending human-review suggestion.',
              autonomyLevel: AgentAutonomyLevel.SAFE_WRITE,
              inputSchema: strictSchema,
            },
          },
          {
            tool: {
              id: 'tool-update',
              code: 'registration.update',
              name: 'Update registration',
              description: 'Updates an authorized registration.',
              autonomyLevel: AgentAutonomyLevel.SAFE_WRITE,
              inputSchema: strictSchema,
            },
          },
          {
            tool: {
              id: 'tool-web',
              code: 'web.search',
              name: 'Internet search',
              description: 'Forbidden internet tool.',
              autonomyLevel: AgentAutonomyLevel.READ,
              inputSchema: strictSchema,
            },
          },
          {
            tool: {
              id: 'tool-mcp',
              code: 'mcp.call',
              name: 'MCP',
              description: 'Forbidden MCP tool.',
              autonomyLevel: AgentAutonomyLevel.READ,
              inputSchema: strictSchema,
            },
          },
        ],
      }),
    },
  };
}

describe('PrismaAgentFunctionToolCatalog', () => {
  it('offers only assigned registry functions authorized by server permissions', async () => {
    const prisma = catalogPrisma();
    const catalog = new PrismaAgentFunctionToolCatalog(
      prisma as unknown as PrismaService,
    );

    const tools = await catalog.authorizeForModel({
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
    });

    expect(tools).toEqual([
      expect.objectContaining({
        toolId: 'tool-read',
        policyVersion: 2,
        definition: expect.objectContaining({ name: 'registration_read' }),
      }),
      expect.objectContaining({
        toolId: 'tool-update',
        policyVersion: 2,
        definition: expect.objectContaining({ name: 'registration_update' }),
      }),
    ]);
    expect(JSON.stringify(tools)).not.toMatch(/web|mcp/iu);
    expect(prisma.lumeAgent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'tenant-a',
          id: 'agent-a',
        }),
      }),
    );
  });

  it('reauthorizes exact arguments against the same tenant policy', async () => {
    const prisma = catalogPrisma();
    const catalog = new PrismaAgentFunctionToolCatalog(
      prisma as unknown as PrismaService,
    );
    const input = {
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
      toolId: 'tool-update',
      arguments: { registrationId: 'registration-a' },
    };

    const first = await catalog.reauthorizeReturnedCall(input);
    const second = await catalog.reauthorizeReturnedCall(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      authorizationSource: 'server-policy',
      authorizationId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      argumentsFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('uses the restricted service principal while an unassigned session is AI-controlled', async () => {
    const prisma = catalogPrisma();
    prisma.serviceSession.findFirst.mockResolvedValue({
      id: 'session-a',
      companyId: 'tenant-a',
      currentDepartmentId: 'department-a',
      controlMode: ServiceSessionControlMode.AI,
      responsibleUser: null,
      assignments: [],
    });
    const catalog = new PrismaAgentFunctionToolCatalog(
      prisma as unknown as PrismaService,
    );

    const tools = await catalog.authorizeForModel({
      companyId: 'tenant-a',
      serviceSessionId: 'session-a',
      agentId: 'agent-a',
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual([
      'registration_read',
      'knowledge_gap_observe',
      'knowledge_suggestion_create',
      'registration_update',
    ]);
  });

  it('denies a cross-tenant session instead of looking up an unscoped fallback', async () => {
    const prisma = catalogPrisma();
    prisma.serviceSession.findFirst.mockResolvedValue(null);
    const catalog = new PrismaAgentFunctionToolCatalog(
      prisma as unknown as PrismaService,
    );

    await expect(
      catalog.authorizeForModel({
        companyId: 'tenant-b',
        serviceSessionId: 'session-a',
        agentId: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.serviceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-a', companyId: 'tenant-b' },
      }),
    );
  });

  it('filters malformed schemas before provider invocation', async () => {
    const prisma = catalogPrisma();
    prisma.lumeAgent.findFirst.mockResolvedValue({
      id: 'agent-a',
      capabilities: [
        { capability: { autonomyLevel: AgentAutonomyLevel.READ } },
      ],
      tools: [
        {
          tool: {
            id: 'tool-read',
            code: 'registration.read',
            name: 'Read registration',
            description: null,
            autonomyLevel: AgentAutonomyLevel.READ,
            inputSchema: {
              type: 'object',
              properties: { registrationId: { type: 'string' } },
              required: [],
              additionalProperties: true,
            },
          },
        },
      ],
    });
    const catalog = new PrismaAgentFunctionToolCatalog(
      prisma as unknown as PrismaService,
    );

    await expect(
      catalog.authorizeForModel({
        companyId: 'tenant-a',
        serviceSessionId: 'session-a',
        agentId: 'agent-a',
      }),
    ).resolves.toEqual([]);
  });
});
