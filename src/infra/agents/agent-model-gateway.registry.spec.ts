import { describe, expect, it, vi } from 'vitest';

import type {
  AgentModelProviderAdapter,
  AgentModelRequest,
} from '../../application/contracts/agent-model.gateway';
import { AgentModelGatewayError } from '../../application/errors/agent-model-gateway.error';
import { AgentModelGatewayRegistry } from './agent-model-gateway.registry';

const request = {
  agentId: 'agent-a',
  runtime: {
    provider: 'openai',
    model: 'gpt-5-mini',
    credentialRef: 'env://AGENT_A_OPENAI_KEY',
    credentialIdentifier: 'agent-a-primary',
    status: 'active',
  },
  instructions: 'Instructions',
  input: 'Input',
  safetyIdentifier: 'opaque_1234',
  tools: [],
} satisfies AgentModelRequest;

describe('AgentModelGatewayRegistry', () => {
  it('routes through the only explicitly registered provider adapter', async () => {
    const generate = vi.fn().mockResolvedValue({
      responseId: 'response-a',
      provider: 'openai',
      model: 'gpt-5-mini',
      status: 'completed',
      outputText: 'Done',
      toolCalls: [],
      usage: null,
    });
    const adapter = {
      provider: 'openai',
      generate,
    } as AgentModelProviderAdapter;
    const registry = new AgentModelGatewayRegistry([adapter]);

    await expect(registry.generate(request)).resolves.toMatchObject({
      provider: 'openai',
      outputText: 'Done',
    });
    expect(generate).toHaveBeenCalledWith(request);
  });

  it('fails closed for an unregistered provider without a fallback adapter', () => {
    const registry = new AgentModelGatewayRegistry([]);
    const futureRequest = {
      ...request,
      runtime: { ...request.runtime, provider: 'future-provider' },
    } as unknown as AgentModelRequest;

    expect(() => registry.generate(futureRequest)).toThrowError(
      AgentModelGatewayError,
    );
  });

  it('routes a future provider once its adapter is deliberately registered', async () => {
    const generate = vi.fn().mockResolvedValue({
      responseId: 'future-response-a',
      provider: 'future-provider',
      model: 'future-model-1',
      status: 'completed',
      outputText: 'Future adapter response',
      toolCalls: [],
      usage: null,
    });
    const adapter = {
      provider: 'future-provider',
      generate,
    } as AgentModelProviderAdapter;
    const registry = new AgentModelGatewayRegistry([adapter]);
    const futureRequest: AgentModelRequest = {
      ...request,
      runtime: {
        ...request.runtime,
        provider: 'future-provider',
        model: 'future-model-1',
      },
    };

    await expect(registry.generate(futureRequest)).resolves.toMatchObject({
      provider: 'future-provider',
      model: 'future-model-1',
    });
    expect(generate).toHaveBeenCalledWith(futureRequest);
  });
});
