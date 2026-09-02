import type { AgentJsonObject } from './agent-model.gateway';

export interface ExecuteAgentFunctionToolInput {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly sequence: number;
  readonly providerResponseId: string;
  readonly providerItemId: string;
  readonly providerCallId: string;
  readonly toolId: string;
  readonly functionName: string;
  readonly arguments: AgentJsonObject;
}

/**
 * Deliberately contains no raw arguments or domain PII. `modelResult` is the
 * bounded, server-produced value that may be returned to the same model as
 * untrusted data and is also safe to persist as an audit summary.
 */
export interface ExecutedAgentFunctionToolCall {
  readonly providerItemId: string;
  readonly providerCallId: string;
  readonly toolId: string;
  readonly functionName: string;
  readonly sequence: number;
  readonly argumentsFingerprint: string;
  readonly authorizationId: string;
  readonly authorizationStatus: 'authorized-and-executed';
  readonly modelResult: AgentJsonObject;
}

/**
 * The implementation owns argument-aware reauthorization, the executable
 * allow-list, tenant/control checks, idempotency and AgentToolCall auditing.
 */
export abstract class AgentFunctionToolExecutor {
  abstract execute(
    input: ExecuteAgentFunctionToolInput,
  ): Promise<ExecutedAgentFunctionToolCall>;
}
