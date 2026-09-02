import type { AgentRuntimeConfig } from '../../domain/agents/agent-runtime';
import type { PlatformMediaType } from '../../domain/whatsapp/media-interpretation-policy';
import type { AgentModelUsage } from './agent-model.gateway';

export interface MediaInterpretationBinaryInput {
  readonly content: Buffer;
  readonly fileName: string;
  readonly mimeType: string;
}

export interface MediaInterpretationGatewayRequest {
  readonly agentId: string;
  readonly runtime: AgentRuntimeConfig;
  readonly instructions: string;
  readonly safetyIdentifier: string;
  readonly mediaType: PlatformMediaType;
  readonly binary: MediaInterpretationBinaryInput | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MediaInterpretationChunk {
  readonly ordinal: number;
  readonly pageNumber: number | null;
  readonly content: string;
}

export interface MediaInterpretationGatewayResult {
  readonly responseId: string;
  readonly provider: string;
  readonly model: string;
  readonly transcription: string | null;
  readonly detectedLanguage: string | null;
  readonly extractedText: string | null;
  readonly summary: string | null;
  readonly documentType: string | null;
  readonly structuredData: Readonly<Record<string, unknown>>;
  readonly confidence: number | null;
  readonly durationSeconds: number | null;
  readonly pageCount: number | null;
  readonly chunks: readonly MediaInterpretationChunk[];
  readonly businessValidationRequired: boolean;
  readonly usage: AgentModelUsage | null;
}

export abstract class MediaInterpretationGateway {
  abstract interpret(
    input: MediaInterpretationGatewayRequest,
  ): Promise<MediaInterpretationGatewayResult>;
}

/**
 * Provider-specific binary adapter. OpenAI is the only registered adapter
 * today, while this boundary keeps transport details out of the use case.
 */
export abstract class MediaInterpretationProviderAdapter extends MediaInterpretationGateway {
  abstract readonly provider: string;
}
