import type {
  AgentRuntimeCandidate,
  AgentRuntimeExecutionSnapshot,
  VersionedAgentPromptConfiguration,
} from './agent-execution.repository';
import type { AgentModelUsage } from './agent-model.gateway';
import type { LumeAgentType } from '../../domain/agents/agent-runtime';
import type {
  MediaInterpretationState,
  PlatformMediaType,
} from '../../domain/whatsapp/media-interpretation-policy';
import type { ServiceControlMode } from '../../domain/whatsapp/service-session';
import type { MediaInterpretationGatewayResult } from './media-interpretation.gateway';

export type MediaInterpretationRequestMode = 'automatic' | 'manual';

export type MediaInterpretationValidationStatus =
  'NOT_REQUIRED' | 'HUMAN_REQUIRED';

export interface MediaInterpretationConfiguration {
  readonly agent: {
    readonly id: string;
    readonly companyId: string;
    readonly type: LumeAgentType;
  };
  readonly prompt: VersionedAgentPromptConfiguration;
  readonly primaryRuntime: AgentRuntimeCandidate;
  readonly fallbackRuntimes: readonly AgentRuntimeCandidate[];
  readonly processDuringHumanControl: boolean;
}

export interface MediaInterpretationCandidate {
  readonly agentsEnabled?: boolean;
  readonly companyId: string;
  readonly mediaAssetId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly serviceSessionId: string;
  readonly controlMode: ServiceControlMode;
  readonly mediaType: PlatformMediaType;
  readonly storageKey: string | null;
  readonly mimeType: string | null;
  readonly originalName: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly durationSeconds: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly state: MediaInterpretationState;
  readonly configuration: MediaInterpretationConfiguration | null;
}

export interface MediaInterpretationView {
  readonly mediaAssetId: string;
  readonly interpretationId: string | null;
  readonly status:
    'not-requested' | 'pending' | 'succeeded' | 'failed' | 'unsupported';
  readonly validationStatus: MediaInterpretationValidationStatus | null;
  readonly transcription: string | null;
  readonly detectedLanguage: string | null;
  readonly extractedText: string | null;
  readonly summary: string | null;
  readonly documentType: string | null;
  readonly structuredData: Readonly<Record<string, unknown>> | null;
  readonly confidence: number | null;
  readonly durationSeconds: number | null;
  readonly provenance: Readonly<Record<string, unknown>> | null;
  readonly chunks: readonly {
    readonly id: string;
    readonly ordinal: number;
    readonly pageNumber: number | null;
    readonly content: string;
    readonly contentHash: string;
    readonly provenance: Readonly<Record<string, unknown>>;
  }[];
  readonly errorCode: string | null;
  readonly correction: {
    readonly correction: string;
    readonly feedback: string | null;
    readonly correctedByUserId: string;
    readonly createdAt: string;
  } | null;
  readonly effectiveContext: {
    readonly value: string | null;
    readonly source: 'human' | 'machine' | 'none';
  };
  readonly completedAt: string | null;
}

export interface ClaimMediaInterpretationInput {
  readonly companyId: string;
  readonly mediaAssetId: string;
  readonly messageId: string;
  readonly serviceSessionId: string;
  readonly commandId: string;
  readonly requestMode: MediaInterpretationRequestMode;
  readonly requestedByUserId: string | null;
  readonly agentId: string;
  readonly agentType: LumeAgentType;
  readonly runtime: AgentRuntimeExecutionSnapshot;
  readonly platformPromptVersionId: string;
  readonly tenantPromptVersionId: string | null;
  readonly promptSnapshot: Readonly<Record<string, unknown>>;
  readonly startedAt: Date;
}

export type ClaimMediaInterpretationResult =
  | {
      readonly claimed: true;
      readonly interpretationId: string;
      readonly executionId: string;
    }
  | {
      readonly claimed: false;
      readonly interpretation: MediaInterpretationView;
    };

export interface RecordMediaInterpretationAttemptInput {
  readonly companyId: string;
  readonly executionId: string;
  readonly attempt: number;
  readonly runtime: AgentRuntimeExecutionSnapshot;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly inputSha256: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly usage: AgentModelUsage | null;
  readonly errorCode: string | null;
}

export abstract class MediaInterpretationRepository {
  abstract listAutomaticCandidates(limit: number): Promise<
    readonly {
      readonly companyId: string;
      readonly mediaAssetId: string;
    }[]
  >;

  abstract findAssetForMessage(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
  }): Promise<string | null>;

  abstract loadCandidate(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
  }): Promise<MediaInterpretationCandidate | null>;

  abstract claim(
    input: ClaimMediaInterpretationInput,
  ): Promise<ClaimMediaInterpretationResult>;

  abstract markUnsupported(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
    readonly requestMode: MediaInterpretationRequestMode;
    readonly requestedByUserId: string | null;
    readonly reason: string;
    readonly occurredAt: Date;
  }): Promise<MediaInterpretationView>;

  abstract recordAttempt(
    input: RecordMediaInterpretationAttemptInput,
  ): Promise<void>;

  abstract complete(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
    readonly interpretationId: string;
    readonly executionId: string;
    readonly successfulAttempt: number;
    readonly requestMode: MediaInterpretationRequestMode;
    readonly runtime: AgentRuntimeExecutionSnapshot;
    readonly result: MediaInterpretationGatewayResult;
    readonly assetSha256: string | null;
    readonly completedAt: Date;
  }): Promise<MediaInterpretationView>;

  abstract fail(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
    readonly interpretationId: string;
    readonly executionId: string;
    readonly attemptedRuntimeCount: number;
    readonly errorCode: string;
    readonly failedAt: Date;
  }): Promise<MediaInterpretationView>;

  abstract getForMessage(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
  }): Promise<MediaInterpretationView>;

  abstract correct(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly correctedByUserId: string;
    readonly correction: string;
    readonly feedback: string | null;
    readonly occurredAt: Date;
  }): Promise<MediaInterpretationView>;
}
