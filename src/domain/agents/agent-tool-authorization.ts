import { createHash } from 'node:crypto';

import { forbidden, validationError } from '../../core/errors/app-error';
import type { AgentAutonomyLevel } from './agent-runtime';

export const AGENT_TOOL_EXECUTION_TARGETS = [
  'internal-service',
  'transactional-database',
] as const;

export type AgentToolExecutionTarget =
  (typeof AGENT_TOOL_EXECUTION_TARGETS)[number];

export interface AgentToolAuthorizationPolicy {
  readonly toolId: string;
  readonly requiredCapability: AgentAutonomyLevel;
  readonly requiredPermission: string;
  readonly executionTarget: AgentToolExecutionTarget;
  readonly allowedDepartmentIds: readonly string[];
}

export interface SensitiveToolConfirmation {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly toolId: string;
  readonly argumentsFingerprint: string;
  readonly confirmedByUserId: string;
  readonly confirmedAt: Date;
  readonly expiresAt: Date;
}

export interface AgentToolAuthorizationContext {
  readonly companyId: string;
  readonly serviceSessionCompanyId: string;
  readonly serviceSessionId: string;
  readonly currentDepartmentId: string;
  readonly assignedToolIds: readonly string[];
  readonly grantedCapabilities: readonly AgentAutonomyLevel[];
  /** Permissions resolved server-side from the authenticated principal. */
  readonly serverGrantedPermissions: readonly string[];
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly confirmation?: SensitiveToolConfirmation;
  readonly now: Date;
}

export interface AuthorizedAgentToolInvocation {
  readonly toolId: string;
  readonly argumentsFingerprint: string;
  readonly authorizationSource: 'server-policy';
  readonly confirmedByUserId: string | null;
}

function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError(
        'Os argumentos da ferramenta devem ser JSON válido.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw validationError('Os argumentos da ferramenta devem ser JSON válido.');
  }
  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError(
      'Os argumentos da ferramenta devem ser um objeto simples.',
    );
  }
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function fingerprintAgentToolArguments(
  value: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

/**
 * This boundary is called before a tool schema or protected data is exposed to
 * the model and again immediately before executing a returned tool call.
 * Prompts and customer content are deliberately absent from the context: they
 * can never grant permissions.
 */
export function authorizeAgentToolInvocation(
  policy: AgentToolAuthorizationPolicy,
  context: AgentToolAuthorizationContext,
): AuthorizedAgentToolInvocation {
  const toolId = policy.toolId.trim();
  if (!toolId || !policy.requiredPermission.trim()) {
    throw validationError('A política da ferramenta está incompleta.');
  }
  if (context.companyId !== context.serviceSessionCompanyId) {
    throw forbidden('Ferramenta indisponível para este atendimento.');
  }
  if (!context.assignedToolIds.includes(toolId)) {
    throw forbidden('Ferramenta indisponível para este agente.');
  }
  if (!context.grantedCapabilities.includes(policy.requiredCapability)) {
    throw forbidden('A autonomia do agente não permite esta operação.');
  }
  if (!context.serverGrantedPermissions.includes(policy.requiredPermission)) {
    throw forbidden('Ferramenta indisponível para este atendimento.');
  }
  if (
    policy.allowedDepartmentIds.length > 0 &&
    !policy.allowedDepartmentIds.includes(context.currentDepartmentId)
  ) {
    throw forbidden('Ferramenta indisponível para este departamento.');
  }

  const argumentsFingerprint = fingerprintAgentToolArguments(context.arguments);
  if (policy.requiredCapability !== 'sensitive-write') {
    return {
      toolId,
      argumentsFingerprint,
      authorizationSource: 'server-policy',
      confirmedByUserId: null,
    };
  }

  const confirmation = context.confirmation;
  const validConfirmation =
    confirmation !== undefined &&
    confirmation.companyId === context.companyId &&
    confirmation.serviceSessionId === context.serviceSessionId &&
    confirmation.toolId === toolId &&
    confirmation.argumentsFingerprint === argumentsFingerprint &&
    confirmation.confirmedByUserId.trim().length > 0 &&
    confirmation.confirmedAt.valueOf() <= context.now.valueOf() &&
    confirmation.expiresAt.valueOf() > context.now.valueOf();
  if (!validConfirmation) {
    throw forbidden('Esta ação sensível exige confirmação humana específica.');
  }

  return {
    toolId,
    argumentsFingerprint,
    authorizationSource: 'server-policy',
    confirmedByUserId: confirmation.confirmedByUserId,
  };
}

export function isInternetToolTarget(value: string): boolean {
  return !AGENT_TOOL_EXECUTION_TARGETS.includes(
    value as AgentToolExecutionTarget,
  );
}
