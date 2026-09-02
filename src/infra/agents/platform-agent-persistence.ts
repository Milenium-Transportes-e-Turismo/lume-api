import { createHash } from 'node:crypto';

import {
  PLATFORM_AGENT_CATALOG,
  PLATFORM_AGENT_TOOL_DEFINITIONS,
} from '../../domain/agents/platform-agent-catalog';
import {
  AgentAutonomyLevel,
  AgentExecutionSource,
  AgentPromptKind,
  AgentVersionStatus,
  LumeAgentStatus,
  LumeAgentType,
  Prisma,
} from '../database/prisma/generated/client';

const autonomyByCode = {
  read: AgentAutonomyLevel.READ,
  'safe-write': AgentAutonomyLevel.SAFE_WRITE,
  'sensitive-write': AgentAutonomyLevel.SENSITIVE_WRITE,
} as const;

const typeByCode = {
  orchestrator: LumeAgentType.ORCHESTRATOR,
  'customer-service': LumeAgentType.CUSTOMER_SERVICE,
  specialist: LumeAgentType.SPECIALIST,
  'silent-classifier': LumeAgentType.SILENT_CLASSIFIER,
  supervisor: LumeAgentType.SUPERVISOR,
} as const;

const contextByCode = {
  whatsapp: AgentExecutionSource.WHATSAPP,
  internal: AgentExecutionSource.INTERNAL,
  automation: AgentExecutionSource.AUTOMATION,
  'media-interpretation': AgentExecutionSource.MEDIA_INTERPRETATION,
} as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Creates only platform-owned defaults. Existing prompt/runtime versions are
 * never rewritten: subsequent platform changes must create a new audited
 * version instead.
 */
export async function ensurePlatformAgentCatalog(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  const capabilities = new Map<AgentAutonomyLevel, string>();
  for (const autonomy of Object.values(AgentAutonomyLevel)) {
    const row = await transaction.agentCapability.upsert({
      where: {
        companyId_code: { companyId, code: `autonomy.${autonomy}` },
      },
      create: {
        companyId,
        code: `autonomy.${autonomy}`,
        name:
          autonomy === AgentAutonomyLevel.READ
            ? 'Leitura'
            : autonomy === AgentAutonomyLevel.SAFE_WRITE
              ? 'Escrita segura'
              : 'Escrita sensível',
        description:
          'Capability técnica controlada pela plataforma e sempre reautorizada no servidor.',
        autonomyLevel: autonomy,
        customerFacing: false,
        platformManaged: true,
        enabled: true,
      },
      update: {
        platformManaged: true,
        enabled: true,
      },
      select: { id: true, autonomyLevel: true },
    });
    capabilities.set(row.autonomyLevel, row.id);
  }

  const tools = new Map<string, string>();
  for (const definition of PLATFORM_AGENT_TOOL_DEFINITIONS) {
    const row = await transaction.agentTool.upsert({
      where: { companyId_code: { companyId, code: definition.code } },
      create: {
        companyId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        autonomyLevel: autonomyByCode[definition.autonomyLevel],
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        platformManaged: true,
        enabled: true,
      },
      update: {
        name: definition.name,
        description: definition.description,
        autonomyLevel: autonomyByCode[definition.autonomyLevel],
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        platformManaged: true,
        enabled: true,
      },
      select: { id: true },
    });
    tools.set(definition.code, row.id);
  }

  for (const definition of PLATFORM_AGENT_CATALOG) {
    const agent = await transaction.lumeAgent.upsert({
      where: { companyId_code: { companyId, code: definition.code } },
      create: {
        companyId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        type: typeByCode[definition.type],
        status: LumeAgentStatus.ACTIVE,
        contexts: definition.contexts.map((context) => contextByCode[context]),
        customerFacing: definition.customerFacing,
        platformManaged: true,
      },
      update: {
        name: definition.name,
        description: definition.description,
        type: typeByCode[definition.type],
        contexts: definition.contexts.map((context) => contextByCode[context]),
        customerFacing: definition.customerFacing,
        platformManaged: true,
      },
      select: { id: true },
    });

    const existingPlatformPrompt =
      await transaction.agentPromptVersion.findFirst({
        where: {
          companyId,
          agentId: agent.id,
          kind: AgentPromptKind.PLATFORM,
        },
        select: { id: true },
      });
    if (!existingPlatformPrompt) {
      await transaction.agentPromptVersion.create({
        data: {
          companyId,
          agentId: agent.id,
          kind: AgentPromptKind.PLATFORM,
          version: 1,
          status: AgentVersionStatus.ACTIVE,
          content: definition.platformPrompt,
          contentHash: sha256(definition.platformPrompt),
          activatedAt: new Date(),
        },
      });
    }

    const existingRuntime =
      await transaction.agentRuntimeConfigVersion.findFirst({
        where: { companyId, agentId: agent.id },
        select: { id: true },
      });
    if (!existingRuntime) {
      await transaction.agentRuntimeConfigVersion.create({
        data: {
          companyId,
          agentId: agent.id,
          version: 1,
          provider: 'openai',
          model: definition.defaultOpenAiModel,
          credentialRef: `env://${definition.credentialEnvironmentKey}`,
          credentialIdentifier: `${definition.code}-openai-v1`,
          credentialVersion: '1',
          parameters: { maxOutputTokens: 4_096 },
          status: AgentVersionStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
    }

    for (const capability of definition.capabilities) {
      const capabilityId = capabilities.get(autonomyByCode[capability]);
      if (!capabilityId) continue;
      await transaction.lumeAgentCapability.upsert({
        where: {
          companyId_agentId_capabilityId: {
            companyId,
            agentId: agent.id,
            capabilityId,
          },
        },
        create: { companyId, agentId: agent.id, capabilityId, enabled: true },
        update: { enabled: true },
      });
    }

    for (const toolCode of definition.toolCodes) {
      const toolId = tools.get(toolCode);
      if (!toolId) continue;
      await transaction.lumeAgentTool.upsert({
        where: {
          companyId_agentId_toolId: {
            companyId,
            agentId: agent.id,
            toolId,
          },
        },
        create: { companyId, agentId: agent.id, toolId, enabled: true },
        update: { enabled: true },
      });
    }
  }
}
