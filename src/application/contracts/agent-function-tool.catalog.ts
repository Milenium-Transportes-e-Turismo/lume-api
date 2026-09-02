import type { AgentFunctionTool, AgentJsonObject } from './agent-model.gateway';

export interface AuthorizedAgentFunctionTool {
  readonly toolId: string;
  readonly policyVersion: number;
  readonly definition: AgentFunctionTool;
}

export interface ReauthorizeReturnedAgentToolCallInput {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly agentId: string;
  readonly toolId: string;
  readonly arguments: AgentJsonObject;
}

export interface ReauthorizedAgentToolCall {
  readonly authorizationId: string;
  readonly argumentsFingerprint: string;
  readonly authorizationSource: 'server-policy';
}

/**
 * Implementations resolve assignments, capabilities and authenticated
 * permissions server-side. Prompt or client-provided permission arrays are not
 * part of this contract by design.
 */
export abstract class AgentFunctionToolCatalog {
  abstract authorizeForModel(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentId: string;
  }): Promise<readonly AuthorizedAgentFunctionTool[]>;

  /** Called later by the tool executor, never by model generation. */
  abstract reauthorizeReturnedCall(
    input: ReauthorizeReturnedAgentToolCallInput,
  ): Promise<ReauthorizedAgentToolCall>;
}
