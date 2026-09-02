import type { PermissionCode } from '../../domain/access/access.constants';
import type { AgentToolExecutionTarget } from '../../domain/agents/agent-tool-authorization';
import type { AgentAutonomyLevel } from '../../domain/agents/agent-runtime';

export interface RegisteredAgentToolPolicy {
  readonly version: number;
  readonly requiredCapability: AgentAutonomyLevel;
  readonly requiredPermission: PermissionCode;
  readonly executionTarget: AgentToolExecutionTarget;
  readonly allowedDepartmentIds: readonly string[];
}

/**
 * Server-owned allow-list. Database assignments can narrow this registry but
 * cannot create executable powers by themselves. Unknown, internet and MCP
 * tool codes are therefore never exposed to a model.
 */
export const AGENT_TOOL_SERVER_POLICIES: Readonly<
  Record<string, RegisteredAgentToolPolicy>
> = {
  'registration.draft.start': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'clients:update',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'registration.draft.patch': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'clients:update',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'registration.read': {
    version: 2,
    requiredCapability: 'read',
    requiredPermission: 'clients:view',
    executionTarget: 'internal-service',
    allowedDepartmentIds: [],
  },
  'registration.update': {
    version: 2,
    requiredCapability: 'safe-write',
    requiredPermission: 'clients:update',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'customer-profile.suggest': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'service:respond',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'knowledge.gap.observe': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'service:respond',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'knowledge.suggestion.create': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'service:respond',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
  'registration.draft.abandon': {
    version: 1,
    requiredCapability: 'safe-write',
    requiredPermission: 'clients:update',
    executionTarget: 'transactional-database',
    allowedDepartmentIds: [],
  },
};
