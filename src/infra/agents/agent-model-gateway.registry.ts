import { Inject, Injectable } from '@nestjs/common';

import {
  AgentModelGateway,
  type AgentModelProviderAdapter,
  type AgentModelRequest,
  type AgentModelResponse,
} from '../../application/contracts/agent-model.gateway';
import { AgentModelGatewayError } from '../../application/errors/agent-model-gateway.error';
import { AGENT_MODEL_PROVIDER_ADAPTERS } from './openai-responses.tokens';

@Injectable()
export class AgentModelGatewayRegistry extends AgentModelGateway {
  private readonly adapters: ReadonlyMap<string, AgentModelProviderAdapter>;

  constructor(
    @Inject(AGENT_MODEL_PROVIDER_ADAPTERS)
    registeredAdapters: readonly AgentModelProviderAdapter[],
  ) {
    super();
    this.adapters = new Map(
      registeredAdapters.map((adapter) => [adapter.provider, adapter]),
    );
    if (this.adapters.size !== registeredAdapters.length) {
      throw new Error(
        'Há providers de modelo duplicados no registry de agentes.',
      );
    }
  }

  generate(input: AgentModelRequest): Promise<AgentModelResponse> {
    const adapter = this.adapters.get(input.runtime.provider);
    if (!adapter) throw new AgentModelGatewayError('invalid-request');
    return adapter.generate(input);
  }
}
