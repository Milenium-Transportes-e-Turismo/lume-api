import { Inject, Injectable } from '@nestjs/common';

import {
  MediaInterpretationGateway,
  type MediaInterpretationGatewayRequest,
  type MediaInterpretationGatewayResult,
  type MediaInterpretationProviderAdapter,
} from '../../application/contracts/media-interpretation.gateway';
import { AgentModelGatewayError } from '../../application/errors/agent-model-gateway.error';
import { MEDIA_INTERPRETATION_PROVIDER_ADAPTERS } from './media-interpretation.tokens';

@Injectable()
export class MediaInterpretationGatewayRegistry extends MediaInterpretationGateway {
  private readonly adapters: ReadonlyMap<
    string,
    MediaInterpretationProviderAdapter
  >;

  constructor(
    @Inject(MEDIA_INTERPRETATION_PROVIDER_ADAPTERS)
    registeredAdapters: readonly MediaInterpretationProviderAdapter[],
  ) {
    super();
    this.adapters = new Map(
      registeredAdapters.map((adapter) => [adapter.provider, adapter]),
    );
    if (this.adapters.size !== registeredAdapters.length) {
      throw new Error(
        'Há providers duplicados no registry de interpretação de mídia.',
      );
    }
  }

  interpret(
    input: MediaInterpretationGatewayRequest,
  ): Promise<MediaInterpretationGatewayResult> {
    const adapter = this.adapters.get(input.runtime.provider);
    if (!adapter) throw new AgentModelGatewayError('invalid-request');
    return adapter.interpret(input);
  }
}
