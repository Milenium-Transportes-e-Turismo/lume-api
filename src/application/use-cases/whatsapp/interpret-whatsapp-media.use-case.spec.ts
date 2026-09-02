import { describe, expect, it, vi } from 'vitest';

import type {
  ClaimMediaInterpretationResult,
  MediaInterpretationCandidate,
  MediaInterpretationView,
} from '../../contracts/media-interpretation.repository';
import { AgentModelGatewayError } from '../../errors/agent-model-gateway.error';
import { InterpretWhatsAppMediaUseCase } from './interpret-whatsapp-media.use-case';

const companyId = '00000000-0000-4000-8000-000000000001';
const conversationId = '00000000-0000-4000-8000-000000000002';
const messageId = '00000000-0000-4000-8000-000000000003';
const mediaAssetId = '00000000-0000-4000-8000-000000000004';
const sessionId = '00000000-0000-4000-8000-000000000005';
const agentId = '00000000-0000-4000-8000-000000000006';
const runtimeId = '00000000-0000-4000-8000-000000000007';
const promptId = '00000000-0000-4000-8000-000000000008';
const now = new Date('2026-08-29T12:00:00.000Z');

function interpretation(
  status: MediaInterpretationView['status'] = 'succeeded',
): MediaInterpretationView {
  return {
    mediaAssetId,
    interpretationId: '00000000-0000-4000-8000-000000000009',
    status,
    validationStatus: status === 'succeeded' ? 'HUMAN_REQUIRED' : null,
    transcription: null,
    detectedLanguage: null,
    extractedText: 'conteúdo extraído',
    summary: 'resumo',
    documentType: null,
    structuredData: {},
    confidence: 0.9,
    durationSeconds: null,
    provenance: { source: 'media-specialist' },
    chunks:
      status === 'succeeded'
        ? [
            {
              id: '00000000-0000-4000-8000-000000000012',
              ordinal: 1,
              pageNumber: 1,
              content: 'conteúdo extraído',
              contentHash: 'a'.repeat(64),
              provenance: { source: 'media-specialist' },
            },
          ]
        : [],
    errorCode: null,
    correction: null,
    effectiveContext: { value: 'resumo', source: 'machine' },
    completedAt: now.toISOString(),
  };
}

function candidate(
  overrides: Partial<MediaInterpretationCandidate> = {},
): MediaInterpretationCandidate {
  const content = Buffer.from('image-content');
  return {
    companyId,
    mediaAssetId,
    messageId,
    conversationId,
    serviceSessionId: sessionId,
    controlMode: 'ai',
    mediaType: 'image',
    storageKey: `v1/${companyId}/${conversationId}/${messageId}/sha`,
    mimeType: 'image/png',
    originalName: 'evidencia.png',
    sizeBytes: content.byteLength,
    sha256: 'd2dfc251c1a7245d4eb7d95e5f815472c6dbcf7ee6690bbd7c1912f477b6c22a',
    durationSeconds: null,
    metadata: { source: 'evolution-whatsapp-direct' },
    state: {
      mediaType: 'image',
      interpretationStatus: null,
      interpretationId: null,
      humanCorrection: null,
    },
    configuration: {
      agent: { id: agentId, companyId, type: 'specialist' },
      prompt: {
        systemPromptVersion: 1,
        runtimeContextVersion: 1,
        platformPromptVersionId: promptId,
        tenantInstructionsVersionId: null,
        layers: {
          systemPrompt: 'Política segura.',
          platformAgentPrompt: 'Interprete a mídia.',
          tenantInstructions: null,
          runtimeContext: '{"source":"media"}',
          platformPromptVersion: 1,
          tenantInstructionsVersion: null,
        },
      },
      primaryRuntime: {
        runtimeId,
        agentId,
        companyId,
        version: 1,
        runtime: {
          provider: 'openai',
          model: 'gpt-5-mini',
          credentialRef: 'env://LUME_AGENT_MEDIA_OPENAI_API_KEY',
          credentialIdentifier: 'media-specialist-v1',
          status: 'active',
        },
      },
      fallbackRuntimes: [],
      processDuringHumanControl: false,
    },
    ...overrides,
  };
}

function subject(candidateValue = candidate()) {
  const completed = interpretation();
  const repository = {
    findAssetForMessage: vi.fn(async () => mediaAssetId),
    loadCandidate: vi.fn(async () => candidateValue),
    claim: vi.fn(async (): Promise<ClaimMediaInterpretationResult> => ({
      claimed: true,
      interpretationId: '00000000-0000-4000-8000-000000000009',
      executionId: '00000000-0000-4000-8000-000000000010',
    })),
    recordAttempt: vi.fn(async () => undefined),
    complete: vi.fn(async () => completed),
    fail: vi.fn(async () => interpretation('failed')),
    markUnsupported: vi.fn(async () => interpretation('unsupported')),
    getForMessage: vi.fn(async () => completed),
    correct: vi.fn(async () => completed),
    listAutomaticCandidates: vi.fn(async () => []),
  };
  const gateway = {
    interpret: vi.fn(async () => ({
      responseId: 'resp_1',
      provider: 'openai',
      model: 'gpt-5-mini',
      transcription: null,
      detectedLanguage: 'pt',
      extractedText: 'conteúdo extraído',
      summary: 'resumo',
      documentType: null,
      structuredData: {},
      confidence: 0.9,
      durationSeconds: null,
      pageCount: 1,
      chunks: [{ ordinal: 1, pageNumber: 1, content: 'conteúdo' }],
      businessValidationRequired: true,
      usage: null,
    })),
  };
  const storage = {
    read: vi.fn(async () => Buffer.from('image-content')),
    write: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  return {
    useCase: new InterpretWhatsAppMediaUseCase(
      repository,
      gateway,
      storage,
      () => now,
    ),
    repository,
    gateway,
    storage,
  };
}

describe('InterpretWhatsAppMediaUseCase', () => {
  it('usa somente a configuração e a credencial do media-specialist', async () => {
    const { useCase, repository, gateway, storage } = subject();

    await expect(
      useCase.analyzeMessage({
        companyId,
        conversationId,
        messageId,
        actorUserId: '00000000-0000-4000-8000-000000000011',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });

    expect(storage.read).toHaveBeenCalledOnce();
    expect(gateway.interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        runtime: expect.objectContaining({
          provider: 'openai',
          credentialRef: 'env://LUME_AGENT_MEDIA_OPENAI_API_KEY',
          credentialIdentifier: 'media-specialist-v1',
        }),
        mediaType: 'image',
      }),
    );
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it('não processa automaticamente durante controle humano quando o tenant desabilitou', async () => {
    const { useCase, repository, gateway } = subject(
      candidate({ controlMode: 'human' }),
    );

    await expect(
      useCase.analyzeAutomatically({ companyId, mediaAssetId }),
    ).resolves.toEqual({
      mediaAssetId,
      status: 'deferred',
      reason: 'human-control-disabled',
    });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(gateway.interpret).not.toHaveBeenCalled();
  });

  it('permite ação manual no controle humano sem alterar a sessão', async () => {
    const { useCase, repository } = subject(
      candidate({ controlMode: 'human' }),
    );

    await useCase.analyzeMessage({
      companyId,
      conversationId,
      messageId,
      actorUserId: '00000000-0000-4000-8000-000000000011',
    });

    expect(repository.claim).toHaveBeenCalledWith(
      expect.objectContaining({ requestMode: 'manual' }),
    );
  });

  it('preserva vídeo como unsupported sem chamar gateway nem ler binário', async () => {
    const video = candidate({
      mediaType: 'video',
      storageKey: null,
      mimeType: 'video/mp4',
      originalName: 'video.mp4',
      state: {
        mediaType: 'video',
        interpretationStatus: null,
        interpretationId: null,
        humanCorrection: null,
      },
    });
    const { useCase, repository, gateway, storage } = subject(video);

    await expect(
      useCase.analyzeAutomatically({ companyId, mediaAssetId }),
    ).resolves.toMatchObject({ status: 'unsupported' });
    expect(repository.markUnsupported).toHaveBeenCalledOnce();
    expect(gateway.interpret).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('registra falha terminal sem propagar erro para o atendimento', async () => {
    const { useCase, repository, gateway } = subject();
    gateway.interpret.mockRejectedValueOnce(
      new AgentModelGatewayError('provider-unavailable'),
    );

    await expect(
      useCase.analyzeAutomatically({ companyId, mediaAssetId }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(repository.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        errorCode: 'AGENT_MODEL_REQUEST_FAILED',
      }),
    );
    expect(repository.fail).toHaveBeenCalledOnce();
  });

  it('trata claim concorrente como replay e nunca executa uma segunda interpretação', async () => {
    const { useCase, repository, gateway } = subject();
    repository.claim.mockResolvedValueOnce({
      claimed: false,
      interpretation: interpretation('pending'),
    });

    await expect(
      useCase.analyzeAutomatically({ companyId, mediaAssetId }),
    ).resolves.toMatchObject({ status: 'pending', mediaAssetId });
    expect(gateway.interpret).not.toHaveBeenCalled();
    expect(repository.recordAttempt).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
