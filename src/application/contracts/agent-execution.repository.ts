import type { AgentModelUsage } from './agent-model.gateway';
import type {
  AgentPromptLayers,
  AgentRuntimeConfig,
  LumeAgentContext,
  LumeAgentType,
} from '../../domain/agents/agent-runtime';
import type { KnowledgeSourceSnapshot } from '../../domain/knowledge/knowledge-policy';
import type { ExecutedAgentFunctionToolCall } from './agent-function-tool.executor';

export interface VersionedAgentPromptConfiguration {
  readonly layers: AgentPromptLayers;
  readonly systemPromptVersion: number;
  readonly runtimeContextVersion: number;
  readonly platformPromptVersionId: string;
  readonly tenantInstructionsVersionId: string | null;
}

export interface AgentKnowledgeContextItem {
  readonly content: string;
  readonly source: KnowledgeSourceSnapshot;
}

export interface AgentRuntimeCandidate {
  readonly runtimeId: string;
  readonly agentId: string;
  readonly companyId: string;
  readonly version: number;
  readonly runtime: AgentRuntimeConfig;
}

export interface AgentExecutionConfiguration {
  readonly agent: {
    readonly id: string;
    readonly companyId: string;
    readonly type: LumeAgentType;
    readonly status: 'active' | 'inactive';
  };
  readonly session: {
    readonly id: string;
    readonly companyId: string;
    readonly departmentId: string | null;
    readonly customerFacing: boolean;
    readonly source: LumeAgentContext;
  };
  readonly prompt: VersionedAgentPromptConfiguration;
  readonly primaryRuntime: AgentRuntimeCandidate;
  readonly fallbackRuntimes: readonly AgentRuntimeCandidate[];
  readonly knowledge: readonly AgentKnowledgeContextItem[];
}

export abstract class AgentConfigurationRepository {
  abstract loadActiveForSession(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentId: string;
  }): Promise<AgentExecutionConfiguration | null>;
}

export interface AgentPromptExecutionSnapshot {
  readonly systemPromptVersion: number;
  readonly platformPromptVersion: number;
  readonly tenantInstructionsVersion: number | null;
  readonly runtimeContextVersion: number;
  readonly systemPromptSha256: string;
  readonly platformPromptSha256: string;
  readonly tenantInstructionsSha256: string | null;
  readonly runtimeContextSha256: string;
  readonly compiledInstructionsSha256: string;
}

export interface AgentKnowledgeExecutionSnapshot extends KnowledgeSourceSnapshot {
  readonly contentSha256: string;
}

export interface AgentToolExecutionSnapshot {
  readonly toolId: string;
  readonly functionName: string;
  readonly policyVersion: number;
  readonly schemaSha256: string;
}

export interface AgentMediaInterpretationReference {
  readonly interpretationId: string;
  readonly effectiveSource: 'machine' | 'human';
}

/** Deliberately excludes credentialRef and all secret material. */
export interface AgentRuntimeExecutionSnapshot {
  readonly runtimeId: string;
  readonly runtimeConfigVersion: number;
  readonly provider: string;
  readonly model: string;
  readonly credentialIdentifier: string;
  readonly temperature: number | null;
  readonly maxOutputTokens: number | null;
}

export interface CreateAgentExecutionPersistenceInput {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly agentId: string;
  readonly parentExecutionId?: string | null;
  readonly commandId: string;
  readonly agentType: LumeAgentType;
  readonly customerFacing: boolean;
  readonly source: LumeAgentContext;
  readonly initialRuntime: AgentRuntimeExecutionSnapshot;
  readonly platformPromptVersionId: string;
  readonly tenantPromptVersionId: string | null;
  /** Exact interpretations whose effective context is included in model input. */
  readonly mediaInterpretations?: readonly AgentMediaInterpretationReference[];
  readonly createdAt: Date;
}

export interface RecordAgentExecutionAttemptInput {
  readonly companyId: string;
  readonly executionId: string;
  readonly attempt: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly runtime: AgentRuntimeExecutionSnapshot;
  readonly prompt: AgentPromptExecutionSnapshot;
  readonly knowledge: readonly AgentKnowledgeExecutionSnapshot[];
  readonly tools: readonly AgentToolExecutionSnapshot[];
  readonly modelInputSha256: string;
  readonly continuationModelInputSha256: string | null;
  readonly outcome: 'succeeded' | 'failed';
  readonly usage: AgentModelUsage | null;
  readonly errorCode: string | null;
  readonly errorReason: string | null;
}

export interface CompleteAgentExecutionPersistenceInput {
  readonly companyId: string;
  readonly executionId: string;
  readonly successfulAttempt: number;
  readonly providerResponseId: string;
  readonly provider: string;
  readonly model: string;
  readonly outputText: string | null;
  readonly toolCalls: readonly ExecutedAgentFunctionToolCall[];
  readonly usage: AgentModelUsage | null;
  readonly completedAt: Date;
}

export interface FailAgentExecutionPersistenceInput {
  readonly companyId: string;
  readonly executionId: string;
  readonly attemptedRuntimeCount: number;
  readonly errorCode: string;
  readonly errorReason: string | null;
  readonly failedAt: Date;
}

export abstract class AgentExecutionRepository {
  abstract create(input: CreateAgentExecutionPersistenceInput): Promise<{
    readonly executionId: string;
    /** False means the command was already registered and must not be run again. */
    readonly created: boolean;
  }>;

  abstract recordAttempt(
    input: RecordAgentExecutionAttemptInput,
  ): Promise<void>;

  abstract complete(
    input: CompleteAgentExecutionPersistenceInput,
  ): Promise<void>;

  abstract fail(input: FailAgentExecutionPersistenceInput): Promise<void>;
}
