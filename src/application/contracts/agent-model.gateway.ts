import type { AgentRuntimeConfig } from '../../domain/agents/agent-runtime';

export type AgentJsonObject = Readonly<Record<string, unknown>>;

/**
 * A function made available by the already-authorized agent tool policy.
 * Provider-specific tool types are intentionally not accepted here.
 */
export interface AgentFunctionTool {
  readonly name: string;
  readonly description?: string;
  readonly parameters: AgentJsonObject;
}

export interface AgentModelRequest {
  readonly agentId: string;
  readonly runtime: AgentRuntimeConfig;
  readonly instructions: string;
  readonly input: string;
  /** Stable, opaque identifier prepared by the caller. Never put PII here. */
  readonly safetyIdentifier: string;
  /** Functions already filtered by the application tool policy. */
  readonly tools: readonly AgentFunctionTool[];
}

export interface AgentModelFunctionCall {
  readonly id: string;
  readonly callId: string;
  readonly name: string;
  readonly arguments: AgentJsonObject;
}

export interface AgentModelUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export interface AgentModelResponse {
  readonly responseId: string;
  readonly provider: string;
  readonly model: string;
  readonly status: 'completed' | 'incomplete';
  readonly outputText: string | null;
  readonly toolCalls: readonly AgentModelFunctionCall[];
  readonly usage: AgentModelUsage | null;
}

export abstract class AgentModelGateway {
  abstract generate(input: AgentModelRequest): Promise<AgentModelResponse>;
}

/**
 * Provider adapter registered behind AgentModelGateway. OpenAI is the only
 * adapter enabled today; this boundary avoids baking its HTTP implementation
 * into application wiring when another provider is deliberately introduced.
 */
export abstract class AgentModelProviderAdapter extends AgentModelGateway {
  abstract readonly provider: string;
}
