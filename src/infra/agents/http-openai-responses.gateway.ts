import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentCredentialResolver } from '../../application/contracts/agent-credential-resolver';
import {
  AgentModelProviderAdapter,
  type AgentFunctionTool,
  type AgentJsonObject,
  type AgentModelFunctionCall,
  type AgentModelRequest,
  type AgentModelResponse,
  type AgentModelUsage,
} from '../../application/contracts/agent-model.gateway';
import { AgentModelGatewayError } from '../../application/errors/agent-model-gateway.error';
import {
  OPENAI_PROVIDER,
  validateOpenAiRuntimeConfig,
  type OpenAiAgentRuntimeConfig,
} from '../../domain/agents/agent-runtime';
import {
  AGENT_OPENAI_RESPONSES_FETCHER,
  type AgentOpenAiResponsesFetcher,
} from './openai-responses.tokens';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const MAXIMUM_TIMEOUT_MS = 300_000;
const MAXIMUM_PROMPT_BYTES = 1_048_576;
const MAXIMUM_SCHEMA_DEPTH = 32;
const MAXIMUM_SCHEMA_VALUES = 10_000;
const FUNCTION_NAME = /^[a-z0-9_-]{1,64}$/iu;
const SAFETY_IDENTIFIER = /^[a-z0-9_-]{8,64}$/iu;
const FORBIDDEN_PROVIDER_TOOL_OUTPUTS = new Set([
  'code_interpreter_call',
  'computer_call',
  'file_search_call',
  'image_generation_call',
  'mcp_call',
  'web_search_call',
]);

interface PreparedRequest {
  readonly agentId: string;
  readonly runtime: OpenAiAgentRuntimeConfig;
  readonly instructions: string;
  readonly input: string;
  readonly safetyIdentifier: string;
  readonly tools: readonly PreparedFunctionTool[];
}

interface PreparedFunctionTool {
  readonly type: 'function';
  readonly name: string;
  readonly description?: string;
  readonly parameters: AgentJsonObject;
  readonly strict: true;
}

interface HttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function configuredTimeout(config: ConfigService): number {
  const configured = config.get<unknown>('AGENT_OPENAI_RESPONSES_TIMEOUT_MS');
  if (configured === undefined || configured === null || configured === '') {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAXIMUM_TIMEOUT_MS) {
    throw new Error(
      'AGENT_OPENAI_RESPONSES_TIMEOUT_MS deve ser um inteiro entre 1 e 300000.',
    );
  }
  return parsed;
}

function invalidRequest(): never {
  throw new AgentModelGatewayError('invalid-request');
}

function invalidResponse(): never {
  throw new AgentModelGatewayError('invalid-response');
}

function cloneJsonValue(
  value: unknown,
  state: { count: number },
  depth = 0,
): unknown {
  state.count += 1;
  if (depth > MAXIMUM_SCHEMA_DEPTH || state.count > MAXIMUM_SCHEMA_VALUES) {
    invalidRequest();
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidRequest();
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry, state, depth + 1));
  }
  const record = asRecord(value);
  if (!record) invalidRequest();
  const prototype = Object.getPrototypeOf(record) as unknown;
  if (prototype !== Object.prototype && prototype !== null) invalidRequest();

  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      invalidRequest();
    }
    copy[key] = cloneJsonValue(entry, state, depth + 1);
  }
  return copy;
}

function assertStrictObjectSchemas(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjectSchemas);
    return;
  }
  const schema = asRecord(value);
  if (!schema) return;

  if (schema.type === 'object' || schema.properties !== undefined) {
    if (schema.type !== 'object' || schema.additionalProperties !== false) {
      invalidRequest();
    }
    const properties = asRecord(schema.properties);
    if (!properties) invalidRequest();
    if (!Array.isArray(schema.required)) invalidRequest();
    const required = schema.required;
    if (required.some((name) => typeof name !== 'string')) invalidRequest();
    const propertyNames = Object.keys(properties).sort();
    const requiredNames = [...new Set(required as string[])].sort();
    if (
      propertyNames.length !== requiredNames.length ||
      propertyNames.some((name, index) => name !== requiredNames[index])
    ) {
      invalidRequest();
    }
  }

  Object.values(schema).forEach(assertStrictObjectSchemas);
}

function prepareTool(tool: AgentFunctionTool): PreparedFunctionTool {
  const name = tool.name.trim();
  if (!FUNCTION_NAME.test(name)) invalidRequest();
  const description = tool.description?.trim();
  if (
    description !== undefined &&
    (!description || description.length > 1_024)
  ) {
    invalidRequest();
  }
  const parameters = cloneJsonValue(tool.parameters, {
    count: 0,
  }) as AgentJsonObject;
  if (parameters.type !== 'object') invalidRequest();
  assertStrictObjectSchemas(parameters);
  return {
    type: 'function',
    name,
    ...(description ? { description } : {}),
    parameters,
    strict: true,
  };
}

function prepareRequest(input: AgentModelRequest): PreparedRequest {
  let runtime: OpenAiAgentRuntimeConfig;
  try {
    runtime = validateOpenAiRuntimeConfig(input.runtime);
  } catch {
    invalidRequest();
  }
  const agentId = input.agentId.trim();
  const instructions = input.instructions.trim();
  const modelInput = input.input.trim();
  const safetyIdentifier = input.safetyIdentifier.trim();
  if (
    !['active', 'superseded'].includes(runtime.status) ||
    !agentId ||
    agentId.length > 120 ||
    !instructions ||
    !modelInput ||
    !SAFETY_IDENTIFIER.test(safetyIdentifier) ||
    Buffer.byteLength(instructions, 'utf8') > MAXIMUM_PROMPT_BYTES ||
    Buffer.byteLength(modelInput, 'utf8') > MAXIMUM_PROMPT_BYTES ||
    input.tools.length > 128
  ) {
    invalidRequest();
  }
  const tools = input.tools.map(prepareTool);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    invalidRequest();
  }
  return {
    agentId,
    runtime,
    instructions,
    input: modelInput,
    safetyIdentifier,
    tools,
  };
}

function parseJsonBody(body: string): Record<string, unknown> {
  if (!body.trim()) invalidResponse();
  try {
    const parsed = asRecord(JSON.parse(body) as unknown);
    if (!parsed) invalidResponse();
    return parsed;
  } catch (error) {
    if (error instanceof AgentModelGatewayError) throw error;
    invalidResponse();
  }
}

function parseFunctionArguments(value: unknown): AgentJsonObject {
  if (typeof value !== 'string' || !value.trim()) invalidResponse();
  try {
    const parsed = asRecord(JSON.parse(value) as unknown);
    if (!parsed) invalidResponse();
    return cloneJsonValue(parsed, { count: 0 }) as AgentJsonObject;
  } catch (error) {
    if (error instanceof AgentModelGatewayError) throw error;
    invalidResponse();
  }
}

function outputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (!Array.isArray(response.output)) return null;
  const fragments: string[] = [];
  for (const itemValue of response.output) {
    const item = asRecord(itemValue);
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const contentValue of item.content) {
      const content = asRecord(contentValue);
      if (
        content?.type === 'output_text' &&
        typeof content.text === 'string' &&
        content.text.trim()
      ) {
        fragments.push(content.text.trim());
      }
    }
  }
  return fragments.length > 0 ? fragments.join('\n') : null;
}

function functionCalls(
  response: Record<string, unknown>,
  allowedNames: ReadonlySet<string>,
): readonly AgentModelFunctionCall[] {
  if (!Array.isArray(response.output)) invalidResponse();
  const result: AgentModelFunctionCall[] = [];
  const callIds = new Set<string>();
  for (const itemValue of response.output) {
    const item = asRecord(itemValue);
    if (!item || typeof item.type !== 'string') invalidResponse();
    if (FORBIDDEN_PROVIDER_TOOL_OUTPUTS.has(item.type)) invalidResponse();
    if (item.type !== 'function_call') continue;

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const callId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (
      !id ||
      id.length > 200 ||
      !callId ||
      callId.length > 200 ||
      !FUNCTION_NAME.test(name) ||
      !allowedNames.has(name) ||
      callIds.has(callId)
    ) {
      invalidResponse();
    }
    callIds.add(callId);
    result.push({
      id,
      callId,
      name,
      arguments: parseFunctionArguments(item.arguments),
    });
  }
  return result;
}

function parseUsage(value: unknown): AgentModelUsage | null {
  if (value === undefined || value === null) return null;
  const usage = asRecord(value);
  if (!usage) invalidResponse();
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    invalidResponse();
  }
  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  const cachedInputTokens =
    inputDetails?.cached_tokens === undefined
      ? 0
      : nonNegativeInteger(inputDetails.cached_tokens);
  const reasoningTokens =
    outputDetails?.reasoning_tokens === undefined
      ? 0
      : nonNegativeInteger(outputDetails.reasoning_tokens);
  if (cachedInputTokens === null || reasoningTokens === null) {
    invalidResponse();
  }
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function responseError(status: number): AgentModelGatewayError {
  if (status === 401 || status === 403) {
    return new AgentModelGatewayError('unauthorized', status);
  }
  if (status === 429) {
    return new AgentModelGatewayError('rate-limited', status);
  }
  if (status >= 500) {
    return new AgentModelGatewayError('provider-unavailable', status);
  }
  return new AgentModelGatewayError('provider-error', status);
}

@Injectable()
export class HttpOpenAiResponsesGateway extends AgentModelProviderAdapter {
  readonly provider = OPENAI_PROVIDER;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentialResolver: AgentCredentialResolver,
    config: ConfigService,
    @Inject(AGENT_OPENAI_RESPONSES_FETCHER)
    private readonly fetcher: AgentOpenAiResponsesFetcher,
  ) {
    super();
    this.timeoutMs = configuredTimeout(config);
  }

  async generate(input: AgentModelRequest): Promise<AgentModelResponse> {
    const request = prepareRequest(input);
    const credential = await this.credentialResolver.resolve({
      agentId: request.agentId,
      credentialRef: request.runtime.credentialRef,
      credentialIdentifier: request.runtime.credentialIdentifier,
    });
    if (
      credential.provider !== OPENAI_PROVIDER ||
      credential.credentialIdentifier !== request.runtime.credentialIdentifier
    ) {
      throw new AgentModelGatewayError('invalid-request');
    }

    const payload = JSON.stringify({
      model: request.runtime.model,
      instructions: request.instructions,
      input: request.input,
      max_output_tokens:
        request.runtime.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      store: false,
      safety_identifier: request.safetyIdentifier,
      tools: request.tools,
      parallel_tool_calls: false,
      ...(request.runtime.temperature === undefined
        ? {}
        : { temperature: request.runtime.temperature }),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let httpResult: HttpResult;
    try {
      httpResult = await credential.use(async (secret) => {
        const response = await this.fetcher(OPENAI_RESPONSES_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: payload,
          signal: controller.signal,
        });
        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      });
    } catch {
      if (controller.signal.aborted) {
        throw new AgentModelGatewayError('timeout');
      }
      throw new AgentModelGatewayError('provider-unavailable');
    } finally {
      clearTimeout(timer);
    }

    if (!httpResult.ok) throw responseError(httpResult.status);
    const providerResponse = parseJsonBody(httpResult.body);
    if (providerResponse.error) {
      throw new AgentModelGatewayError('provider-error', httpResult.status);
    }
    if (
      providerResponse.status !== 'completed' &&
      providerResponse.status !== 'incomplete'
    ) {
      invalidResponse();
    }
    const responseId =
      typeof providerResponse.id === 'string' ? providerResponse.id.trim() : '';
    const model =
      typeof providerResponse.model === 'string'
        ? providerResponse.model.trim()
        : '';
    if (
      !responseId ||
      responseId.length > 200 ||
      !model ||
      model.length > 120
    ) {
      invalidResponse();
    }
    const calls = functionCalls(
      providerResponse,
      new Set(request.tools.map((tool) => tool.name)),
    );
    const text = outputText(providerResponse);
    if (
      providerResponse.status === 'completed' &&
      !text &&
      calls.length === 0
    ) {
      invalidResponse();
    }
    return {
      responseId,
      provider: OPENAI_PROVIDER,
      model,
      status: providerResponse.status,
      outputText: text,
      toolCalls: calls,
      usage: parseUsage(providerResponse.usage),
    };
  }
}
