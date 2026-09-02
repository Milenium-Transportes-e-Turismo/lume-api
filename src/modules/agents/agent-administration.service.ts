import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../core/errors/app-error';
import { redactPotentialSecrets } from '../../domain/agents/agent-runtime';
import {
  AgentPromptKind,
  AgentVersionStatus,
  LumeAgentStatus,
  Prisma,
} from '../../infra/database/prisma/generated/client';
import { PrismaService } from '../../infra/database/prisma/prisma.service';
import type {
  ListAgentExecutionsQueryDto,
  RollbackTenantAgentInstructionsDto,
  UpdateTenantAgentInstructionsDto,
} from './dto/agent-administration.dto';

const MAX_PROMPT_BYTES = 64_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function asRecord(
  value: Prisma.JsonValue | null,
): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function jsonString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function jsonPositiveInteger(
  value: Prisma.JsonValue | undefined,
): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function redactString(value: string): string {
  return redactPotentialSecrets(value).replace(
    /\b(?:env|secret|vault|docker-secret):\/\/[a-z0-9][a-z0-9/_.-]{2,199}\b/giu,
    '[REDACTED_CREDENTIAL_REFERENCE]',
  );
}

function sanitizePublicJson(
  value: Prisma.JsonValue | null | undefined,
): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizePublicJson);
  const result: Prisma.JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      /credential[_-]?ref|api[_-]?key|secret|authorization|bearer/iu.test(key)
    ) {
      continue;
    }
    result[key] = sanitizePublicJson(entry);
  }
  return result;
}

function instructionFingerprint(input: {
  readonly companyId: string;
  readonly agentId: string;
  readonly expectedVersion: number;
  readonly contentHash: string;
}): string {
  return sha256(JSON.stringify(input));
}

function assertSafeTenantInstructions(content: string): void {
  if (
    redactPotentialSecrets(content) !== content ||
    /\b(?:env|secret|vault|docker-secret):\/\/[a-z0-9][a-z0-9/_.-]{2,199}\b/iu.test(
      content,
    )
  ) {
    throw validationError(
      'Instruções do tenant não podem conter API keys, secrets ou referências de credencial.',
    );
  }
}

@Injectable()
export class AgentAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  async listAgents(current: AuthenticatedPrincipal) {
    const agents = await this.prisma.lumeAgent.findMany({
      where: { companyId: current.companyId },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        type: true,
        status: true,
        contexts: true,
        customerFacing: true,
        platformManaged: true,
        promptVersions: {
          where: { status: AgentVersionStatus.ACTIVE },
          orderBy: [{ kind: 'asc' }, { version: 'desc' }],
          select: {
            id: true,
            kind: true,
            version: true,
            status: true,
            contentHash: true,
            activatedAt: true,
          },
        },
        runtimeConfigs: {
          where: {
            status: {
              in: [AgentVersionStatus.ACTIVE, AgentVersionStatus.SUPERSEDED],
            },
          },
          orderBy: [{ status: 'asc' }, { version: 'desc' }],
          select: {
            id: true,
            version: true,
            provider: true,
            model: true,
            credentialIdentifier: true,
            credentialVersion: true,
            status: true,
            activatedAt: true,
            deactivatedAt: true,
          },
        },
      },
    });

    return agents.map((agent) => {
      const hasPlatformPrompt = agent.promptVersions.some(
        (prompt) => prompt.kind === AgentPromptKind.PLATFORM,
      );
      const activeRuntime = agent.runtimeConfigs.find(
        (runtime) => runtime.status === AgentVersionStatus.ACTIVE,
      );
      return {
        id: agent.id,
        code: agent.code,
        name: agent.name,
        description: agent.description,
        type: agent.type.toLowerCase().replaceAll('_', '-'),
        status: agent.status.toLowerCase(),
        contexts: agent.contexts.map((context) =>
          context.toLowerCase().replaceAll('_', '-'),
        ),
        customerFacing: agent.customerFacing,
        platformManaged: agent.platformManaged,
        promptVersions: agent.promptVersions.map((prompt) => ({
          id: prompt.id,
          kind: prompt.kind.toLowerCase().replaceAll('_', '-'),
          version: prompt.version,
          status: prompt.status.toLowerCase(),
          contentHash: prompt.contentHash,
          activatedAt: prompt.activatedAt,
        })),
        runtimeConfigs: agent.runtimeConfigs.map((runtime) => ({
          id: runtime.id,
          version: runtime.version,
          provider: runtime.provider.toLowerCase(),
          model: runtime.model,
          credentialVersion: runtime.credentialVersion,
          status: runtime.status.toLowerCase(),
          activatedAt: runtime.activatedAt,
          deactivatedAt: runtime.deactivatedAt,
        })),
        configurationStatus:
          agent.status === LumeAgentStatus.ACTIVE &&
          hasPlatformPrompt &&
          activeRuntime?.credentialIdentifier?.trim()
            ? 'ready'
            : 'incomplete',
        technicalConfigurationMutable: false,
      };
    });
  }

  async listExecutions(
    current: AuthenticatedPrincipal,
    agentId: string,
    query: ListAgentExecutionsQueryDto,
  ) {
    const agent = await this.prisma.lumeAgent.findFirst({
      where: { id: agentId, companyId: current.companyId },
      select: { id: true },
    });
    if (!agent) throw notFound('Agente');

    const where = { companyId: current.companyId, agentId };
    const [total, rows] = await Promise.all([
      this.prisma.agentExecution.count({ where }),
      this.prisma.agentExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          agentId: true,
          agentType: true,
          serviceSessionId: true,
          source: true,
          provider: true,
          model: true,
          status: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          structuredDecision: true,
          result: true,
          errorCode: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          attempts: {
            orderBy: { attemptNumber: 'asc' },
            select: {
              id: true,
              attemptNumber: true,
              provider: true,
              model: true,
              status: true,
              latencyMs: true,
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
              errorCode: true,
              startedAt: true,
              completedAt: true,
            },
          },
          toolCalls: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              toolId: true,
              sequence: true,
              status: true,
              inputHash: true,
              requestMetadata: true,
              resultSummary: true,
              authorizationReason: true,
              errorCode: true,
              startedAt: true,
              completedAt: true,
              createdAt: true,
            },
          },
          knowledgeSources: {
            orderBy: { retrievalRank: 'asc' },
            select: {
              documentVersionId: true,
              chunkId: true,
              documentVersionNumber: true,
              chunkOrdinal: true,
              pageNumber: true,
              retrievalRank: true,
              confidence: true,
              retrievedAt: true,
            },
          },
        },
      }),
    ]);

    return {
      page: query.page,
      limit: query.limit,
      total,
      items: rows.map((row) => ({
        ...row,
        agentType: row.agentType.toLowerCase().replaceAll('_', '-'),
        source: row.source.toLowerCase().replaceAll('_', '-'),
        provider: row.provider.toLowerCase(),
        status: row.status.toLowerCase(),
        structuredDecision: sanitizePublicJson(row.structuredDecision),
        result: sanitizePublicJson(row.result),
        attempts: row.attempts.map((attempt) => ({
          ...attempt,
          provider: attempt.provider.toLowerCase(),
          status: attempt.status.toLowerCase(),
        })),
        toolCalls: row.toolCalls.map((call) => ({
          ...call,
          status: call.status.toLowerCase(),
          requestMetadata: sanitizePublicJson(call.requestMetadata),
          resultSummary: sanitizePublicJson(call.resultSummary),
        })),
      })),
    };
  }

  async listTenantInstructionVersions(
    current: AuthenticatedPrincipal,
    agentId: string,
  ) {
    const agent = await this.prisma.lumeAgent.findFirst({
      where: { id: agentId, companyId: current.companyId },
      select: { id: true },
    });
    if (!agent) throw notFound('Agente');
    const versions = await this.prisma.agentPromptVersion.findMany({
      where: {
        companyId: current.companyId,
        agentId,
        kind: AgentPromptKind.TENANT_INSTRUCTIONS,
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        content: true,
        contentHash: true,
        activatedAt: true,
        deactivatedAt: true,
        createdAt: true,
      },
    });
    return versions.map((version) => ({
      ...version,
      status: version.status.toLowerCase(),
      content: redactString(version.content),
    }));
  }

  async updateTenantInstructions(
    current: AuthenticatedPrincipal,
    agentId: string,
    input: UpdateTenantAgentInstructionsDto,
  ) {
    const content = input.content.trim();
    if (!content || Buffer.byteLength(content, 'utf8') > MAX_PROMPT_BYTES) {
      throw validationError('As instruções do tenant são inválidas.');
    }
    assertSafeTenantInstructions(content);
    const contentHash = sha256(content);
    const fingerprint = instructionFingerprint({
      companyId: current.companyId,
      agentId,
      expectedVersion: input.expectedVersion,
      contentHash,
    });

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`${current.companyId}:agent-tenant-instructions:${agentId}`})
        )
      `;
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: current.companyId,
          action: 'agent.tenant-instructions.versioned',
          targetType: 'lume-agent',
          targetId: agentId,
          metadata: { path: ['commandId'], equals: input.commandId },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (duplicate) {
        const metadata = asRecord(duplicate.metadata);
        if (metadata.fingerprint !== fingerprint) {
          throw conflict(
            'commandId já foi usado para outras instruções do tenant.',
          );
        }
        const promptVersionId = jsonString(metadata.promptVersionId);
        const version = jsonPositiveInteger(metadata.resultingVersion);
        const duplicateContentHash = jsonString(metadata.contentHash);
        if (!promptVersionId || !version || !duplicateContentHash) {
          throw conflict(
            'A auditoria idempotente das instruções está inválida.',
          );
        }
        return {
          agentId,
          promptVersionId,
          version,
          contentHash: duplicateContentHash,
          idempotent: true,
        };
      }

      const [actor, agent, currentPrompt, maximumVersion] = await Promise.all([
        transaction.user.findFirst({
          where: {
            id: current.id,
            companyId: current.companyId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true },
        }),
        transaction.lumeAgent.findFirst({
          where: {
            id: agentId,
            companyId: current.companyId,
            status: LumeAgentStatus.ACTIVE,
          },
          select: { id: true },
        }),
        transaction.agentPromptVersion.findFirst({
          where: {
            companyId: current.companyId,
            agentId,
            kind: AgentPromptKind.TENANT_INSTRUCTIONS,
            status: AgentVersionStatus.ACTIVE,
          },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, contentHash: true },
        }),
        transaction.agentPromptVersion.aggregate({
          where: {
            companyId: current.companyId,
            agentId,
            kind: AgentPromptKind.TENANT_INSTRUCTIONS,
          },
          _max: { version: true },
        }),
      ]);
      if (!actor)
        throw forbidden('O usuário não pertence ao tenant ou está inativo.');
      if (!agent) throw notFound('Agente ativo');
      const currentVersion = currentPrompt?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw conflict('A versão das instruções do tenant foi alterada.');
      }

      const activatedAt = new Date();
      if (currentPrompt) {
        await transaction.agentPromptVersion.updateMany({
          where: {
            id: currentPrompt.id,
            companyId: current.companyId,
            status: AgentVersionStatus.ACTIVE,
          },
          data: {
            status: AgentVersionStatus.SUPERSEDED,
            deactivatedAt: activatedAt,
          },
        });
      }
      const nextVersion = (maximumVersion._max.version ?? 0) + 1;
      const prompt = await transaction.agentPromptVersion.create({
        data: {
          companyId: current.companyId,
          agentId,
          kind: AgentPromptKind.TENANT_INSTRUCTIONS,
          version: nextVersion,
          status: AgentVersionStatus.ACTIVE,
          content,
          contentHash,
          createdByUserId: current.id,
          activatedAt,
        },
        select: { id: true, version: true, contentHash: true },
      });
      await transaction.tenantAuditLog.create({
        data: {
          companyId: current.companyId,
          actorUserId: current.id,
          action: 'agent.tenant-instructions.versioned',
          targetType: 'lume-agent',
          targetId: agentId,
          metadata: {
            commandId: input.commandId,
            fingerprint,
            expectedVersion: input.expectedVersion,
            resultingVersion: prompt.version,
            promptVersionId: prompt.id,
            previousContentHash: currentPrompt?.contentHash ?? null,
            contentHash: prompt.contentHash,
          },
        },
      });
      return {
        agentId,
        promptVersionId: prompt.id,
        version: prompt.version,
        contentHash: prompt.contentHash,
        idempotent: false,
      };
    });
  }

  async rollbackTenantInstructions(
    current: AuthenticatedPrincipal,
    agentId: string,
    sourceVersionId: string,
    input: RollbackTenantAgentInstructionsDto,
  ) {
    const fingerprint = sha256(
      JSON.stringify({
        companyId: current.companyId,
        agentId,
        sourceVersionId,
        expectedVersion: input.expectedVersion,
      }),
    );
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`${current.companyId}:agent-tenant-instructions:${agentId}`})
        )
      `;
      const duplicate = await transaction.tenantAuditLog.findFirst({
        where: {
          companyId: current.companyId,
          action: 'agent.tenant-instructions.rolled-back',
          targetType: 'lume-agent',
          targetId: agentId,
          metadata: { path: ['commandId'], equals: input.commandId },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (duplicate) {
        const metadata = asRecord(duplicate.metadata);
        if (metadata.fingerprint !== fingerprint) {
          throw conflict('commandId já foi usado para outro rollback.');
        }
        const promptVersionId = jsonString(metadata.promptVersionId);
        const version = jsonPositiveInteger(metadata.resultingVersion);
        const contentHash = jsonString(metadata.contentHash);
        if (!promptVersionId || !version || !contentHash) {
          throw conflict('A auditoria idempotente do rollback está inválida.');
        }
        return {
          agentId,
          promptVersionId,
          version,
          contentHash,
          sourceVersionId,
          idempotent: true,
        };
      }

      const [actor, agent, currentPrompt, sourcePrompt, maximumVersion] =
        await Promise.all([
          transaction.user.findFirst({
            where: {
              id: current.id,
              companyId: current.companyId,
              isActive: true,
              deletedAt: null,
            },
            select: { id: true },
          }),
          transaction.lumeAgent.findFirst({
            where: {
              id: agentId,
              companyId: current.companyId,
              status: LumeAgentStatus.ACTIVE,
            },
            select: { id: true },
          }),
          transaction.agentPromptVersion.findFirst({
            where: {
              companyId: current.companyId,
              agentId,
              kind: AgentPromptKind.TENANT_INSTRUCTIONS,
              status: AgentVersionStatus.ACTIVE,
            },
            orderBy: { version: 'desc' },
            select: { id: true, version: true, contentHash: true },
          }),
          transaction.agentPromptVersion.findFirst({
            where: {
              id: sourceVersionId,
              companyId: current.companyId,
              agentId,
              kind: AgentPromptKind.TENANT_INSTRUCTIONS,
            },
            select: {
              id: true,
              version: true,
              content: true,
              contentHash: true,
            },
          }),
          transaction.agentPromptVersion.aggregate({
            where: {
              companyId: current.companyId,
              agentId,
              kind: AgentPromptKind.TENANT_INSTRUCTIONS,
            },
            _max: { version: true },
          }),
        ]);
      if (!actor)
        throw forbidden('O usuário não pertence ao tenant ou está inativo.');
      if (!agent) throw notFound('Agente ativo');
      if (!sourcePrompt) throw notFound('Versão das instruções do tenant');
      if (!currentPrompt) {
        throw conflict('O agente não possui instruções ativas para rollback.');
      }
      if (currentPrompt.version !== input.expectedVersion) {
        throw conflict('A versão das instruções do tenant foi alterada.');
      }
      if (sourcePrompt.id === currentPrompt.id) {
        throw validationError('Selecione uma versão anterior para rollback.');
      }
      assertSafeTenantInstructions(sourcePrompt.content);

      const activatedAt = new Date();
      const deactivated = await transaction.agentPromptVersion.updateMany({
        where: {
          id: currentPrompt.id,
          companyId: current.companyId,
          status: AgentVersionStatus.ACTIVE,
        },
        data: {
          status: AgentVersionStatus.SUPERSEDED,
          deactivatedAt: activatedAt,
        },
      });
      if (deactivated.count !== 1) {
        throw conflict('A versão das instruções do tenant foi alterada.');
      }
      const nextVersion = (maximumVersion._max.version ?? 0) + 1;
      const prompt = await transaction.agentPromptVersion.create({
        data: {
          companyId: current.companyId,
          agentId,
          kind: AgentPromptKind.TENANT_INSTRUCTIONS,
          version: nextVersion,
          status: AgentVersionStatus.ACTIVE,
          content: sourcePrompt.content,
          contentHash: sourcePrompt.contentHash,
          createdByUserId: current.id,
          activatedAt,
        },
        select: { id: true, version: true, contentHash: true },
      });
      await transaction.tenantAuditLog.create({
        data: {
          companyId: current.companyId,
          actorUserId: current.id,
          action: 'agent.tenant-instructions.rolled-back',
          targetType: 'lume-agent',
          targetId: agentId,
          metadata: {
            commandId: input.commandId,
            fingerprint,
            expectedVersion: input.expectedVersion,
            resultingVersion: prompt.version,
            promptVersionId: prompt.id,
            sourceVersionId,
            sourceVersion: sourcePrompt.version,
            previousContentHash: currentPrompt.contentHash,
            contentHash: prompt.contentHash,
          },
        },
      });
      return {
        agentId,
        promptVersionId: prompt.id,
        version: prompt.version,
        contentHash: prompt.contentHash,
        sourceVersionId,
        idempotent: false,
      };
    });
  }
}
