import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  MediaAssetType,
  MediaInterpretationStatus,
  MediaInterpretationValidationStatus,
} from '../prisma/generated/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaMediaInterpretationRepository } from './prisma-media-interpretation.repository';

const companyId = '00000000-0000-4000-8000-000000000001';
const mediaAssetId = '00000000-0000-4000-8000-000000000002';
const interpretationId = '00000000-0000-4000-8000-000000000003';
const executionId = '00000000-0000-4000-8000-000000000004';
const conversationId = '00000000-0000-4000-8000-000000000005';
const messageId = '00000000-0000-4000-8000-000000000006';
const userId = '00000000-0000-4000-8000-000000000007';
const chunkId = '00000000-0000-4000-8000-000000000008';
const completedAt = new Date('2026-08-29T12:00:00.000Z');

function row(
  correction: {
    correction: string;
    feedback: string | null;
    correctedByUserId: string;
    createdAt: Date;
  } | null = null,
) {
  return {
    id: interpretationId,
    status: MediaInterpretationStatus.SUCCEEDED,
    validationStatus: MediaInterpretationValidationStatus.HUMAN_REQUIRED,
    transcription: null,
    detectedLanguage: 'pt',
    extractedText: 'Total original: R$ 100,00',
    summary: 'Resumo produzido pelo modelo',
    documentType: 'invoice',
    structuredData: {
      invoiceNumber: 'NF-42',
      validationStatus: 'HUMAN_REQUIRED',
      chunks: [
        { ordinal: 1, pageNumber: 2, content: 'Total original: R$ 100,00' },
      ],
    },
    confidence: null,
    durationSeconds: null,
    provenance: { source: 'media-specialist' },
    errorCode: null,
    completedAt,
    chunks: [
      {
        id: chunkId,
        ordinal: 1,
        pageNumber: 2,
        content: 'Total original: R$ 100,00',
        contentHash: createHash('sha256')
          .update('Total original: R$ 100,00', 'utf8')
          .digest('hex'),
        provenance: {
          schemaVersion: 1,
          source: 'media-specialist',
          providerResponseId: 'resp_42',
        },
      },
    ],
    correction,
  };
}

function repositoryWithTransaction<T>(transaction: T) {
  const prisma = {
    $transaction: vi.fn(async (operation: (client: T) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
  return {
    repository: new PrismaMediaInterpretationRepository(
      prisma as unknown as PrismaService,
    ),
    prisma,
  };
}

describe('PrismaMediaInterpretationRepository', () => {
  it('adquire o advisory lock sem desserializar o retorno void do PostgreSQL', async () => {
    const executeRaw = vi.fn(async () => 1);
    const transaction = {
      $executeRaw: executeRaw,
      mediaAsset: {
        findFirst: vi.fn().mockResolvedValue({
          id: mediaAssetId,
          messages: [{ id: messageId }],
          groupMessages: [],
          interpretation: row(),
        }),
      },
    };
    const { repository } = repositoryWithTransaction(transaction);

    const result = await repository.claim({
      companyId,
      mediaAssetId,
      messageId,
      serviceSessionId: '00000000-0000-4000-8000-000000000010',
      commandId: 'media-interpretation:test',
      requestMode: 'automatic',
      requestedByUserId: null,
      agentId: '00000000-0000-4000-8000-000000000011',
      agentType: 'specialist',
      runtime: {
        runtimeId: '00000000-0000-4000-8000-000000000012',
        runtimeConfigVersion: 1,
        provider: 'openai',
        model: 'gpt-5-mini',
        credentialIdentifier: 'media-specialist-v1',
        temperature: null,
        maxOutputTokens: null,
      },
      platformPromptVersionId: '00000000-0000-4000-8000-000000000013',
      tenantPromptVersionId: null,
      promptSnapshot: {},
      startedAt: completedAt,
    });

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      claimed: false,
      interpretation: { interpretationId },
    });
  });

  it('faz dual-write do status e dos chunks sem remover o JSON compatível', async () => {
    const transaction = {
      mediaAsset: {
        findFirst: vi.fn().mockResolvedValue({
          id: mediaAssetId,
          type: MediaAssetType.DOCUMENT,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      mediaInterpretation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue(row()),
      },
      mediaInterpretationChunk: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      agentExecution: { update: vi.fn().mockResolvedValue({}) },
    };
    const { repository } = repositoryWithTransaction(transaction);

    const result = await repository.complete({
      companyId,
      mediaAssetId,
      interpretationId,
      executionId,
      successfulAttempt: 1,
      requestMode: 'automatic',
      runtime: {
        runtimeId: '00000000-0000-4000-8000-000000000009',
        runtimeConfigVersion: 3,
        provider: 'openai',
        model: 'gpt-5-mini',
        credentialIdentifier: 'media-specialist-v3',
        temperature: null,
        maxOutputTokens: null,
      },
      result: {
        responseId: 'resp_42',
        provider: 'openai',
        model: 'gpt-5-mini',
        transcription: null,
        detectedLanguage: 'pt',
        extractedText: 'Total original: R$ 100,00',
        summary: 'Resumo produzido pelo modelo',
        documentType: 'invoice',
        structuredData: { invoiceNumber: 'NF-42' },
        confidence: 0.91,
        durationSeconds: null,
        pageCount: 2,
        chunks: [
          {
            ordinal: 1,
            pageNumber: 2,
            content: 'Total original: R$ 100,00',
          },
        ],
        businessValidationRequired: true,
        usage: null,
      },
      assetSha256: 'b'.repeat(64),
      completedAt,
    });

    expect(transaction.mediaInterpretation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId, mediaAssetId }),
        data: expect.objectContaining({
          validationStatus: MediaInterpretationValidationStatus.HUMAN_REQUIRED,
          structuredData: {
            invoiceNumber: 'NF-42',
            validationStatus: 'HUMAN_REQUIRED',
            chunks: [
              {
                ordinal: 1,
                pageNumber: 2,
                content: 'Total original: R$ 100,00',
              },
            ],
          },
        }),
      }),
    );
    expect(
      transaction.mediaInterpretationChunk.createMany,
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          companyId,
          interpretationId,
          ordinal: 1,
          pageNumber: 2,
          content: 'Total original: R$ 100,00',
          contentHash: createHash('sha256')
            .update('Total original: R$ 100,00', 'utf8')
            .digest('hex'),
          provenance: expect.objectContaining({
            schemaVersion: 1,
            source: 'media-specialist',
            providerResponseId: 'resp_42',
          }),
        }),
      ],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({
      validationStatus: 'HUMAN_REQUIRED',
      chunks: [
        {
          id: chunkId,
          ordinal: 1,
          pageNumber: 2,
          provenance: { providerResponseId: 'resp_42' },
        },
      ],
    });
  });

  it('faz leitura tenant-scoped e prioriza a correção humana no contexto efetivo', async () => {
    const prisma = {
      whatsAppMessage: {
        findFirst: vi.fn().mockResolvedValue({
          mediaAsset: {
            id: mediaAssetId,
            interpretation: row({
              correction: 'Total corrigido: R$ 120,00',
              feedback: 'O valor estava ilegível.',
              correctedByUserId: userId,
              createdAt: completedAt,
            }),
          },
        }),
      },
    };
    const repository = new PrismaMediaInterpretationRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.getForMessage({
      companyId,
      conversationId,
      messageId,
    });

    expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: messageId, companyId, conversationId },
      }),
    );
    expect(result.effectiveContext).toEqual({
      value: 'Total corrigido: R$ 120,00',
      source: 'human',
    });
    expect(result.chunks[0]).toMatchObject({
      id: chunkId,
      pageNumber: 2,
      content: 'Total original: R$ 100,00',
    });
  });

  it('rejeita índices de chunk duplicados antes de qualquer escrita terminal', async () => {
    const transaction = {
      mediaAsset: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: mediaAssetId, type: MediaAssetType.IMAGE }),
      },
      mediaInterpretation: { updateMany: vi.fn() },
      mediaInterpretationChunk: { createMany: vi.fn() },
    };
    const { repository } = repositoryWithTransaction(transaction);

    await expect(
      repository.complete({
        companyId,
        mediaAssetId,
        interpretationId,
        executionId,
        successfulAttempt: 1,
        requestMode: 'manual',
        runtime: {
          runtimeId: '00000000-0000-4000-8000-000000000009',
          runtimeConfigVersion: 3,
          provider: 'openai',
          model: 'gpt-5-mini',
          credentialIdentifier: 'media-specialist-v3',
          temperature: null,
          maxOutputTokens: null,
        },
        result: {
          responseId: 'resp_invalid',
          provider: 'openai',
          model: 'gpt-5-mini',
          transcription: null,
          detectedLanguage: 'pt',
          extractedText: 'texto',
          summary: 'resumo',
          documentType: null,
          structuredData: {},
          confidence: 0.8,
          durationSeconds: null,
          pageCount: 1,
          chunks: [
            { ordinal: 1, pageNumber: 1, content: 'primeiro' },
            { ordinal: 1, pageNumber: 1, content: 'duplicado' },
          ],
          businessValidationRequired: false,
          usage: null,
        },
        assetSha256: null,
        completedAt,
      }),
    ).rejects.toHaveProperty('code', 'VALIDATION_ERROR');
    expect(transaction.mediaInterpretation.updateMany).not.toHaveBeenCalled();
    expect(
      transaction.mediaInterpretationChunk.createMany,
    ).not.toHaveBeenCalled();
  });
});
