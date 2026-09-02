import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AgentFunctionToolCatalog,
  type AuthorizedAgentFunctionTool,
  type ReauthorizedAgentToolCall,
  type ReauthorizeReturnedAgentToolCallInput,
} from '../../../application/contracts/agent-function-tool.catalog';
import type { AgentJsonObject } from '../../../application/contracts/agent-model.gateway';
import { forbidden } from '../../../core/errors/app-error';
import {
  isPermissionCode,
  SUPPORTED_USER_DEPARTMENTS,
  type PermissionCode,
  type SupportedUserDepartment,
} from '../../../domain/access/access.constants';
import { resolveEffectivePermissions } from '../../../domain/access/resolve-permissions';
import {
  authorizeAgentToolInvocation,
  isInternetToolTarget,
  type AgentToolAuthorizationContext,
  type AgentToolAuthorizationPolicy,
} from '../../../domain/agents/agent-tool-authorization';
import type { AgentAutonomyLevel as DomainAgentAutonomyLevel } from '../../../domain/agents/agent-runtime';
import { AGENT_TOOL_SERVER_POLICIES } from '../../agents/agent-tool-server-policies';
import {
  AgentAutonomyLevel as PrismaAgentAutonomyLevel,
  LumeAgentStatus,
  Prisma,
  ServiceAssignmentStatus,
  ServiceSessionControlMode,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

interface CatalogContext {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly serviceSessionCompanyId: string;
  readonly currentDepartmentId: string;
  readonly controlMode: ServiceSessionControlMode;
  readonly assignedTools: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly autonomyLevel: PrismaAgentAutonomyLevel;
    readonly inputSchema: Prisma.JsonValue;
  }[];
  readonly grantedCapabilities: readonly DomainAgentAutonomyLevel[];
  readonly serverGrantedPermissions: readonly PermissionCode[];
}

function autonomyLevel(
  value: PrismaAgentAutonomyLevel,
): DomainAgentAutonomyLevel {
  switch (value) {
    case PrismaAgentAutonomyLevel.READ:
      return 'read';
    case PrismaAgentAutonomyLevel.SAFE_WRITE:
      return 'safe-write';
    case PrismaAgentAutonomyLevel.SENSITIVE_WRITE:
      return 'sensitive-write';
  }
}

function supportedDepartments(
  values: readonly string[],
): SupportedUserDepartment[] {
  return values.filter((value): value is SupportedUserDepartment =>
    SUPPORTED_USER_DEPARTMENTS.includes(value as SupportedUserDepartment),
  );
}

function permissionCodes(values: readonly string[]): PermissionCode[] {
  return values.filter(isPermissionCode);
}

function asJsonObject(value: Prisma.JsonValue): AgentJsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function isStrictJsonSchema(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(value)) {
    return value.every((entry) => isStrictJsonSchema(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return true;
  const schema = value as Readonly<Record<string, unknown>>;
  if (schema.type === 'object' || schema.properties !== undefined) {
    if (
      schema.type !== 'object' ||
      schema.additionalProperties !== false ||
      !schema.properties ||
      typeof schema.properties !== 'object' ||
      Array.isArray(schema.properties) ||
      !Array.isArray(schema.required)
    ) {
      return false;
    }
    const propertyNames = Object.keys(schema.properties).sort();
    const required = schema.required;
    if (required.some((name) => typeof name !== 'string')) return false;
    const requiredNames = [...new Set(required as string[])].sort();
    if (
      propertyNames.length !== requiredNames.length ||
      propertyNames.some((name, index) => name !== requiredNames[index])
    ) {
      return false;
    }
  }
  return Object.values(schema).every((entry) =>
    isStrictJsonSchema(entry, depth + 1),
  );
}

function functionName(code: string): string | null {
  const normalized = code.trim().replace(/[^a-z0-9_-]+/giu, '_');
  return /^[a-z0-9_-]{1,64}$/iu.test(normalized) ? normalized : null;
}

function authorizationId(input: {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly agentId: string;
  readonly toolId: string;
  readonly argumentsFingerprint: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.companyId,
        input.serviceSessionId,
        input.agentId,
        input.toolId,
        input.argumentsFingerprint,
      ].join(':'),
      'utf8',
    )
    .digest('hex');
}

@Injectable()
export class PrismaAgentFunctionToolCatalog extends AgentFunctionToolCatalog {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async loadContext(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentId: string;
  }): Promise<CatalogContext> {
    const [session, agent] = await Promise.all([
      this.prisma.serviceSession.findFirst({
        where: { id: input.serviceSessionId, companyId: input.companyId },
        select: {
          id: true,
          companyId: true,
          currentDepartmentId: true,
          controlMode: true,
          responsibleUser: {
            select: {
              departments: true,
              permissionCodes: true,
              isAdministrator: true,
              documentAccessMode: true,
              isActive: true,
              deletedAt: true,
            },
          },
          assignments: {
            where: { status: ServiceAssignmentStatus.ACTIVE },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              assignedUser: {
                select: {
                  departments: true,
                  permissionCodes: true,
                  isAdministrator: true,
                  documentAccessMode: true,
                  isActive: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.lumeAgent.findFirst({
        where: {
          id: input.agentId,
          companyId: input.companyId,
          status: LumeAgentStatus.ACTIVE,
        },
        select: {
          id: true,
          capabilities: {
            where: { enabled: true, capability: { enabled: true } },
            select: { capability: { select: { autonomyLevel: true } } },
          },
          tools: {
            where: { enabled: true, tool: { enabled: true } },
            select: {
              tool: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  description: true,
                  autonomyLevel: true,
                  inputSchema: true,
                },
              },
            },
          },
        },
      }),
    ]);
    if (!session || !agent) {
      throw forbidden('Ferramentas indisponíveis para este atendimento.');
    }
    const principal =
      session.responsibleUser ?? session.assignments[0]?.assignedUser ?? null;
    const principalIsActive =
      principal?.isActive === true && principal.deletedAt === null;
    const permissions = principalIsActive
      ? resolveEffectivePermissions(
          supportedDepartments(principal.departments),
          permissionCodes(principal.permissionCodes),
          principal.isAdministrator,
          principal.documentAccessMode.toLowerCase().replaceAll('_', '-') as
            'standard' | 'document-portal' | 'client',
        )
      : session.controlMode === ServiceSessionControlMode.AI
        ? (['clients:view', 'clients:update', 'service:respond'] as const)
        : [];

    return {
      companyId: input.companyId,
      serviceSessionId: session.id,
      serviceSessionCompanyId: session.companyId,
      currentDepartmentId: session.currentDepartmentId ?? '',
      controlMode: session.controlMode,
      assignedTools: agent.tools.map(({ tool }) => tool),
      grantedCapabilities: Array.from(
        new Set(
          agent.capabilities.map(({ capability }) =>
            autonomyLevel(capability.autonomyLevel),
          ),
        ),
      ),
      serverGrantedPermissions: permissions,
    };
  }

  private policyFor(
    tool: CatalogContext['assignedTools'][number],
  ): AgentToolAuthorizationPolicy | null {
    const registered = AGENT_TOOL_SERVER_POLICIES[tool.code];
    if (
      !registered ||
      isInternetToolTarget(registered.executionTarget) ||
      autonomyLevel(tool.autonomyLevel) !== registered.requiredCapability
    ) {
      return null;
    }
    return {
      toolId: tool.id,
      requiredCapability: registered.requiredCapability,
      requiredPermission: registered.requiredPermission,
      executionTarget: registered.executionTarget,
      allowedDepartmentIds: registered.allowedDepartmentIds,
    };
  }

  private authorizationContext(
    context: CatalogContext,
    args: AgentJsonObject,
  ): AgentToolAuthorizationContext {
    return {
      companyId: context.companyId,
      serviceSessionCompanyId: context.serviceSessionCompanyId,
      serviceSessionId: context.serviceSessionId,
      currentDepartmentId: context.currentDepartmentId,
      assignedToolIds: context.assignedTools.map((tool) => tool.id),
      grantedCapabilities: context.grantedCapabilities,
      serverGrantedPermissions: context.serverGrantedPermissions,
      arguments: args,
      now: new Date(),
    };
  }

  async authorizeForModel(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentId: string;
  }): Promise<readonly AuthorizedAgentFunctionTool[]> {
    const context = await this.loadContext(input);
    const result: AuthorizedAgentFunctionTool[] = [];
    const names = new Set<string>();
    for (const tool of context.assignedTools) {
      const registered = AGENT_TOOL_SERVER_POLICIES[tool.code];
      const policy = this.policyFor(tool);
      const name = functionName(tool.code);
      const parameters = asJsonObject(tool.inputSchema);
      if (
        !registered ||
        !policy ||
        !name ||
        names.has(name) ||
        !parameters ||
        !isStrictJsonSchema(parameters) ||
        policy.requiredCapability === 'sensitive-write'
      ) {
        continue;
      }
      try {
        authorizeAgentToolInvocation(
          policy,
          this.authorizationContext(context, {}),
        );
      } catch {
        continue;
      }
      names.add(name);
      result.push({
        toolId: tool.id,
        policyVersion: registered.version,
        definition: {
          name,
          ...(tool.description?.trim()
            ? { description: tool.description.trim().slice(0, 1_024) }
            : {}),
          parameters,
        },
      });
    }
    return result;
  }

  async reauthorizeReturnedCall(
    input: ReauthorizeReturnedAgentToolCallInput,
  ): Promise<ReauthorizedAgentToolCall> {
    const context = await this.loadContext(input);
    const tool = context.assignedTools.find(
      (candidate) => candidate.id === input.toolId,
    );
    const policy = tool ? this.policyFor(tool) : null;
    if (!tool || !policy) {
      throw forbidden('Ferramenta indisponível para este agente.');
    }
    const authorized = authorizeAgentToolInvocation(
      policy,
      this.authorizationContext(context, input.arguments),
    );
    return {
      authorizationId: authorizationId({
        ...input,
        argumentsFingerprint: authorized.argumentsFingerprint,
      }),
      argumentsFingerprint: authorized.argumentsFingerprint,
      authorizationSource: authorized.authorizationSource,
    };
  }
}
