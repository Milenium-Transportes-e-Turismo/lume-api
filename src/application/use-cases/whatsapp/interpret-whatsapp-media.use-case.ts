import { createHash } from 'node:crypto';

import { AgentCredentialResolutionError } from '../../errors/agent-credential-resolution.error';
import { AgentModelGatewayError } from '../../errors/agent-model-gateway.error';
import {
  MediaInterpretationGateway,
  type MediaInterpretationGatewayResult,
} from '../../contracts/media-interpretation.gateway';
import {
  MediaInterpretationRepository,
  type MediaInterpretationCandidate,
  type MediaInterpretationRequestMode,
  type MediaInterpretationView,
} from '../../contracts/media-interpretation.repository';
import { WhatsAppMediaStorage } from '../../contracts/whatsapp-media.storage';
import {
  AppError,
  conflict,
  externalServiceUnavailable,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  buildAgentPrompt,
  createExecutionAttemptAudit,
} from '../../../domain/agents/agent-runtime';
import { decideMediaInterpretation } from '../../../domain/whatsapp/media-interpretation-policy';

export interface DeferredMediaInterpretationResult {
  readonly mediaAssetId: string;
  readonly status: 'deferred';
  readonly reason:
    'human-control-disabled' | 'media-agent-unavailable' | 'binary-not-stored';
}

export type InterpretWhatsAppMediaResult =
  MediaInterpretationView | DeferredMediaInterpretationResult;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function runtimeSnapshot(
  candidate: NonNullable<
    MediaInterpretationCandidate['configuration']
  >['primaryRuntime'],
  attempt: number,
  outcome: 'succeeded' | 'failed',
  errorCode?: string,
) {
  const audit = createExecutionAttemptAudit({
    attempt,
    runtime: candidate.runtime,
    runtimeConfigVersion: candidate.version,
    outcome,
    errorCode,
  });
  return {
    runtimeId: candidate.runtimeId,
    runtimeConfigVersion: audit.runtimeConfigVersion,
    provider: audit.provider,
    model: audit.model,
    credentialIdentifier: audit.credentialIdentifier,
    temperature: candidate.runtime.temperature ?? null,
    maxOutputTokens: candidate.runtime.maxOutputTokens ?? null,
  };
}

function promptSnapshot(candidate: MediaInterpretationCandidate) {
  const prompt = candidate.configuration?.prompt;
  if (!prompt) throw notFound('Configuração do agente de mídia');
  return {
    systemPromptVersion: prompt.systemPromptVersion,
    platformPromptVersion: prompt.layers.platformPromptVersion,
    tenantInstructionsVersion: prompt.layers.tenantInstructionsVersion,
    runtimeContextVersion: prompt.runtimeContextVersion,
    systemPromptSha256: sha256(prompt.layers.systemPrompt.trim()),
    platformPromptSha256: sha256(prompt.layers.platformAgentPrompt.trim()),
    tenantInstructionsSha256: prompt.layers.tenantInstructions?.trim()
      ? sha256(prompt.layers.tenantInstructions.trim())
      : null,
    runtimeContextSha256: sha256(prompt.layers.runtimeContext.trim()),
  };
}

function failureCode(error: unknown): string {
  if (error instanceof AgentCredentialResolutionError) return error.code;
  if (error instanceof AgentModelGatewayError) return error.code;
  if (error instanceof AppError) return error.code;
  return 'MEDIA_INTERPRETATION_ATTEMPT_FAILED';
}

function binaryRequired(candidate: MediaInterpretationCandidate): boolean {
  return ['audio', 'image', 'document', 'spreadsheet'].includes(
    candidate.mediaType,
  );
}

export class InterpretWhatsAppMediaUseCase {
  constructor(
    private readonly repository: MediaInterpretationRepository,
    private readonly gateway: MediaInterpretationGateway,
    private readonly storage: WhatsAppMediaStorage,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async analyzeMessage(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly actorUserId: string;
  }): Promise<InterpretWhatsAppMediaResult> {
    const mediaAssetId = await this.repository.findAssetForMessage(input);
    if (!mediaAssetId) throw notFound('Mídia da mensagem');
    return this.analyzeAsset({
      companyId: input.companyId,
      mediaAssetId,
      requestMode: 'manual',
      requestedByUserId: input.actorUserId,
    });
  }

  getMessage(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
  }): Promise<MediaInterpretationView> {
    return this.repository.getForMessage(input);
  }

  async correctMessage(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly actorUserId: string;
    readonly correction: string;
    readonly feedback?: string | null;
  }): Promise<MediaInterpretationView> {
    const correction = input.correction.trim();
    const feedback = input.feedback?.trim() || null;
    if (!correction) throw validationError('Informe a correção humana.');
    return this.repository.correct({
      companyId: input.companyId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      correctedByUserId: input.actorUserId,
      correction,
      feedback,
      occurredAt: this.clock(),
    });
  }

  listAutomaticCandidates(limit: number) {
    return this.repository.listAutomaticCandidates(limit);
  }

  analyzeAutomatically(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
  }): Promise<InterpretWhatsAppMediaResult> {
    return this.analyzeAsset({
      ...input,
      requestMode: 'automatic',
      requestedByUserId: null,
    });
  }

  private async analyzeAsset(input: {
    readonly companyId: string;
    readonly mediaAssetId: string;
    readonly requestMode: MediaInterpretationRequestMode;
    readonly requestedByUserId: string | null;
  }): Promise<InterpretWhatsAppMediaResult> {
    const candidate = await this.repository.loadCandidate(input);
    if (!candidate) throw notFound('Mídia individual');
    if (candidate.agentsEnabled === false) {
      return this.repository.getForMessage({
        companyId: candidate.companyId,
        conversationId: candidate.conversationId,
        messageId: candidate.messageId,
      });
    }

    const decision = decideMediaInterpretation({
      state: candidate.state,
      controlMode: candidate.controlMode,
      processDuringHumanControl:
        candidate.configuration?.processDuringHumanControl ?? false,
      requestedManually: input.requestMode === 'manual',
    });
    if (decision.action === 'use-existing') {
      return this.repository.getForMessage({
        companyId: candidate.companyId,
        conversationId: candidate.conversationId,
        messageId: candidate.messageId,
      });
    }
    if (decision.action === 'preserve-only') {
      return this.repository.markUnsupported({
        companyId: candidate.companyId,
        mediaAssetId: candidate.mediaAssetId,
        requestMode: input.requestMode,
        requestedByUserId: input.requestedByUserId,
        reason: decision.reason,
        occurredAt: this.clock(),
      });
    }
    if (decision.action === 'skip-during-human-control') {
      return {
        mediaAssetId: candidate.mediaAssetId,
        status: 'deferred',
        reason: 'human-control-disabled',
      };
    }
    const configuration = candidate.configuration;
    if (!configuration) {
      if (input.requestMode === 'manual') {
        throw externalServiceUnavailable(
          'O agente de mídia do tenant não está configurado.',
        );
      }
      return {
        mediaAssetId: candidate.mediaAssetId,
        status: 'deferred',
        reason: 'media-agent-unavailable',
      };
    }

    let binary: {
      readonly content: Buffer;
      readonly fileName: string;
      readonly mimeType: string;
    } | null = null;
    if (binaryRequired(candidate)) {
      if (
        !candidate.storageKey ||
        !candidate.originalName ||
        !candidate.mimeType
      ) {
        if (input.requestMode === 'manual') {
          throw conflict('A mídia ainda não possui uma cópia binária durável.');
        }
        return {
          mediaAssetId: candidate.mediaAssetId,
          status: 'deferred',
          reason: 'binary-not-stored',
        };
      }
      let content: Buffer;
      try {
        content = await this.storage.read(candidate.storageKey);
      } catch {
        if (input.requestMode === 'manual') {
          throw notFound('Conteúdo durável da mídia');
        }
        return {
          mediaAssetId: candidate.mediaAssetId,
          status: 'deferred',
          reason: 'binary-not-stored',
        };
      }
      if (
        content.length < 1 ||
        (candidate.sizeBytes !== null &&
          content.length !== candidate.sizeBytes) ||
        (candidate.sha256 !== null && sha256(content) !== candidate.sha256)
      ) {
        throw validationError('A integridade da mídia armazenada é inválida.');
      }
      binary = {
        content,
        fileName: candidate.originalName,
        mimeType: candidate.mimeType,
      };
    }

    const instructions = buildAgentPrompt(configuration.prompt.layers);
    const runtimes = [
      configuration.primaryRuntime,
      ...configuration.fallbackRuntimes,
    ];
    const initialRuntime = runtimeSnapshot(runtimes[0], 1, 'succeeded');
    const startedAt = this.clock();
    const claimed = await this.repository.claim({
      companyId: candidate.companyId,
      mediaAssetId: candidate.mediaAssetId,
      messageId: candidate.messageId,
      serviceSessionId: candidate.serviceSessionId,
      commandId: `media-interpretation:${candidate.mediaAssetId}`,
      requestMode: input.requestMode,
      requestedByUserId: input.requestedByUserId,
      agentId: configuration.agent.id,
      agentType: configuration.agent.type,
      runtime: initialRuntime,
      platformPromptVersionId: configuration.prompt.platformPromptVersionId,
      tenantPromptVersionId: configuration.prompt.tenantInstructionsVersionId,
      promptSnapshot: {
        ...promptSnapshot(candidate),
        compiledInstructionsSha256: sha256(instructions),
      },
      startedAt,
    });
    if (!claimed.claimed) return claimed.interpretation;

    const metadata = {
      mediaAssetId: candidate.mediaAssetId,
      mediaType: candidate.mediaType,
      mimeType: candidate.mimeType,
      originalName: candidate.originalName,
      sizeBytes: candidate.sizeBytes,
      durationSeconds: candidate.durationSeconds,
      ...candidate.metadata,
    };
    const inputSha256 = sha256(
      JSON.stringify({
        instructionsSha256: sha256(instructions),
        assetSha256:
          candidate.sha256 ??
          (binary ? sha256(binary.content) : sha256(JSON.stringify(metadata))),
        mediaType: candidate.mediaType,
      }),
    );
    let lastErrorCode = 'MEDIA_INTERPRETATION_ATTEMPT_FAILED';
    for (const [index, runtime] of runtimes.entries()) {
      const attempt = index + 1;
      const attemptStartedAt = this.clock();
      let result: MediaInterpretationGatewayResult;
      try {
        result = await this.gateway.interpret({
          agentId: configuration.agent.id,
          runtime: runtime.runtime,
          instructions,
          safetyIdentifier: `media_${sha256(
            `${candidate.companyId}:${candidate.mediaAssetId}`,
          ).slice(0, 32)}`,
          mediaType: candidate.mediaType,
          binary,
          metadata,
        });
      } catch (error) {
        lastErrorCode = failureCode(error);
        await this.repository.recordAttempt({
          companyId: candidate.companyId,
          executionId: claimed.executionId,
          attempt,
          runtime: runtimeSnapshot(runtime, attempt, 'failed', lastErrorCode),
          startedAt: attemptStartedAt,
          completedAt: this.clock(),
          inputSha256,
          outcome: 'failed',
          usage: null,
          errorCode: lastErrorCode,
        });
        continue;
      }
      const successfulRuntime = runtimeSnapshot(runtime, attempt, 'succeeded');
      await this.repository.recordAttempt({
        companyId: candidate.companyId,
        executionId: claimed.executionId,
        attempt,
        runtime: successfulRuntime,
        startedAt: attemptStartedAt,
        completedAt: this.clock(),
        inputSha256,
        outcome: 'succeeded',
        usage: result.usage,
        errorCode: null,
      });
      return this.repository.complete({
        companyId: candidate.companyId,
        mediaAssetId: candidate.mediaAssetId,
        interpretationId: claimed.interpretationId,
        executionId: claimed.executionId,
        successfulAttempt: attempt,
        requestMode: input.requestMode,
        runtime: successfulRuntime,
        result,
        assetSha256: candidate.sha256,
        completedAt: this.clock(),
      });
    }
    return this.repository.fail({
      companyId: candidate.companyId,
      mediaAssetId: candidate.mediaAssetId,
      interpretationId: claimed.interpretationId,
      executionId: claimed.executionId,
      attemptedRuntimeCount: runtimes.length,
      errorCode: lastErrorCode,
      failedAt: this.clock(),
    });
  }
}
