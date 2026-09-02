import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { AgentCredentialResolver } from '../../application/contracts/agent-credential-resolver';
import {
  AgentModelGateway,
  type AgentFunctionTool,
  type AgentModelRequest,
} from '../../application/contracts/agent-model.gateway';
import { AgentModelGatewayError } from '../../application/errors/agent-model-gateway.error';
import type { OpenAiAgentRuntimeConfig } from '../../domain/agents/agent-runtime';
import { AgentsFoundationModule } from '../../modules/agents/agents-foundation.module';
import { AgentModelGatewayRegistry } from './agent-model-gateway.registry';
import { HttpOpenAiResponsesGateway } from './http-openai-responses.gateway';
import { ServerSideAgentCredentialResolver } from './server-side-agent-credential.resolver';

const AGENT_A_KEY = 'sk-proj-agent-a-abcdefghijklmnopqrstuv123456';
const AGENT_B_KEY = 'sk-proj-agent-b-abcdefghijklmnopqrstuv654321';

const lookupCustomer: AgentFunctionTool = {
  name: 'lookup_customer',
  description: 'Consulta um cliente autorizado pelo identificador interno.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerId: { type: 'string' },
    },
    required: ['customerId'],
  },
};

function runtime(
  agent: 'a' | 'b',
  overrides: Partial<OpenAiAgentRuntimeConfig> = {},
): OpenAiAgentRuntimeConfig {
  return {
    provider: 'openai',
    model: `gpt-test-agent-${agent}`,
    credentialRef: `env://LUME_AGENT_${agent.toUpperCase()}_OPENAI_KEY`,
    credentialIdentifier: `agent-${agent}-v1`,
    temperature: 0.2,
    maxOutputTokens: agent === 'a' ? 512 : 768,
    status: 'active',
    ...overrides,
  };
}

function request(
  agent: 'a' | 'b',
  overrides: Partial<AgentModelRequest> = {},
): AgentModelRequest {
  return {
    agentId: `agent-${agent}`,
    runtime: runtime(agent),
    instructions: `Instruções seguras do agente ${agent}.`,
    input: `Entrada do agente ${agent}.`,
    safetyIdentifier: `opaque-hash-agent-${agent}`,
    tools: [lookupCustomer],
    ...overrides,
  };
}

function providerResponse(
  id: string,
  model: string,
  outputText = 'Resposta segura.',
): Response {
  return new Response(
    JSON.stringify({
      id,
      object: 'response',
      status: 'completed',
      model,
      output_text: outputText,
      output: [],
      usage: {
        input_tokens: 17,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 11,
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 28,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function gateway(fetcher: typeof fetch, timeoutMs = 1_000) {
  const config = new ConfigService({
    LUME_AGENT_A_OPENAI_KEY: AGENT_A_KEY,
    LUME_AGENT_B_OPENAI_KEY: AGENT_B_KEY,
    AGENT_OPENAI_RESPONSES_TIMEOUT_MS: timeoutMs,
  });
  const resolver = new ServerSideAgentCredentialResolver(config);
  return new HttpOpenAiResponsesGateway(resolver, config, fetcher);
}

function authorization(call: readonly unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get('Authorization');
}

function payload(call: readonly unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  expect(typeof init?.body).toBe('string');
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

async function captureFailure(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('A operação deveria ter falhado.');
}

describe('HttpOpenAiResponsesGateway', () => {
  it('keeps two agents, runtimes and credentials isolated without secrets in payloads', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        providerResponse('resp-agent-a', 'gpt-test-agent-a-2026-08-01'),
      )
      .mockResolvedValueOnce(
        providerResponse('resp-agent-b', 'gpt-test-agent-b-2026-08-02'),
      );
    const subject = gateway(fetcher);

    const resultA = await subject.generate(request('a'));
    const resultB = await subject.generate(request('b'));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(authorization(fetcher.mock.calls[0] ?? [])).toBe(
      `Bearer ${AGENT_A_KEY}`,
    );
    expect(authorization(fetcher.mock.calls[1] ?? [])).toBe(
      `Bearer ${AGENT_B_KEY}`,
    );

    const bodyA = payload(fetcher.mock.calls[0] ?? []);
    const bodyB = payload(fetcher.mock.calls[1] ?? []);
    expect(bodyA).toMatchObject({
      model: 'gpt-test-agent-a',
      instructions: 'Instruções seguras do agente a.',
      input: 'Entrada do agente a.',
      max_output_tokens: 512,
      store: false,
      safety_identifier: 'opaque-hash-agent-a',
      parallel_tool_calls: false,
      temperature: 0.2,
      tools: [
        {
          type: 'function',
          name: 'lookup_customer',
          strict: true,
        },
      ],
    });
    expect(bodyB).toMatchObject({
      model: 'gpt-test-agent-b',
      max_output_tokens: 768,
      safety_identifier: 'opaque-hash-agent-b',
    });
    for (const body of [bodyA, bodyB]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(AGENT_A_KEY);
      expect(serialized).not.toContain(AGENT_B_KEY);
      expect(serialized).not.toContain('web_search');
      expect(serialized).not.toContain('file_search');
    }
    expect(resultA).toMatchObject({
      responseId: 'resp-agent-a',
      provider: 'openai',
      model: 'gpt-test-agent-a-2026-08-01',
      outputText: 'Resposta segura.',
    });
    expect(resultB.responseId).toBe('resp-agent-b');
  });

  it('parses message output, strict function calls and token usage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp-tool-call',
          status: 'completed',
          model: 'gpt-test-agent-a-2026-08-03',
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'Vou consultar o cliente.' },
              ],
            },
            {
              type: 'function_call',
              id: 'fc_123',
              call_id: 'call_123',
              name: 'lookup_customer',
              arguments: '{"customerId":"customer-42"}',
              status: 'completed',
            },
          ],
          usage: {
            input_tokens: 20,
            input_tokens_details: { cached_tokens: 4 },
            output_tokens: 8,
            output_tokens_details: { reasoning_tokens: 1 },
            total_tokens: 28,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await gateway(fetcher).generate(request('a'));

    expect(result.outputText).toBe('Vou consultar o cliente.');
    expect(result.toolCalls).toEqual([
      {
        id: 'fc_123',
        callId: 'call_123',
        name: 'lookup_customer',
        arguments: { customerId: 'customer-42' },
      },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 20,
      cachedInputTokens: 4,
      outputTokens: 8,
      reasoningTokens: 1,
      totalTokens: 28,
    });
  });

  it('isolates a 401 to its exact agent and never echoes the refused key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: `Invalid Authorization: Bearer ${AGENT_A_KEY}` },
          }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        providerResponse('resp-agent-b', 'gpt-test-agent-b'),
      );
    const subject = gateway(fetcher);

    const failure = await captureFailure(() => subject.generate(request('a')));
    expect(failure).toBeInstanceOf(AgentModelGatewayError);
    expect(failure).toMatchObject({
      reason: 'unauthorized',
      providerStatus: 401,
    });
    expect(String(failure)).not.toContain(AGENT_A_KEY);
    expect(JSON.stringify(failure)).not.toContain(AGENT_A_KEY);

    await expect(subject.generate(request('b'))).resolves.toMatchObject({
      responseId: 'resp-agent-b',
    });
    expect(authorization(fetcher.mock.calls[1] ?? [])).toBe(
      `Bearer ${AGENT_B_KEY}`,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts the provider request and returns a safe timeout error', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () =>
            reject(
              new DOMException(`Timeout using ${AGENT_A_KEY}`, 'AbortError'),
            ),
          { once: true },
        );
      });
    });

    const failure = await captureFailure(() =>
      gateway(fetcher, 5).generate(request('a')),
    );

    expect(failure).toBeInstanceOf(AgentModelGatewayError);
    expect(failure).toMatchObject({
      reason: 'timeout',
    });
    expect(String(failure)).not.toContain(AGENT_A_KEY);
    expect(JSON.stringify(failure)).not.toContain(AGENT_A_KEY);
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(
      true,
    );
  });

  it('redacts a provider error body that attempts to echo the API key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'bad_request',
            message: `The supplied api_key=${AGENT_A_KEY} is invalid`,
          },
        }),
        { status: 400 },
      ),
    );

    const failure = await captureFailure(() =>
      gateway(fetcher).generate(request('a')),
    );

    expect(failure).toBeInstanceOf(AgentModelGatewayError);
    expect(failure).toMatchObject({
      reason: 'provider-error',
      providerStatus: 400,
    });
    expect(String(failure)).not.toContain(AGENT_A_KEY);
    expect(JSON.stringify(failure)).not.toContain(AGENT_A_KEY);
  });

  it('rejects non-strict schemas before resolving credentials or calling OpenAI', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const resolve = vi.fn<AgentCredentialResolver['resolve']>();
    const credentialResolver = {
      resolve,
    } as unknown as AgentCredentialResolver;
    const subject = new HttpOpenAiResponsesGateway(
      credentialResolver,
      new ConfigService({ AGENT_OPENAI_RESPONSES_TIMEOUT_MS: 1_000 }),
      fetcher,
    );

    await expect(
      subject.generate(
        request('a', {
          tools: [
            {
              name: 'unsafe_schema',
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: [],
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      reason: 'invalid-request',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('AgentsFoundationModule model gateway', () => {
  it('registers both application contracts with server-side implementations', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        AgentsFoundationModule,
      ],
    }).compile();

    expect(testingModule.get(AgentCredentialResolver)).toBeInstanceOf(
      ServerSideAgentCredentialResolver,
    );
    expect(testingModule.get(AgentModelGateway)).toBeInstanceOf(
      AgentModelGatewayRegistry,
    );
    expect(testingModule.get(HttpOpenAiResponsesGateway)).toBeInstanceOf(
      HttpOpenAiResponsesGateway,
    );
    await testingModule.close();
  });
});
