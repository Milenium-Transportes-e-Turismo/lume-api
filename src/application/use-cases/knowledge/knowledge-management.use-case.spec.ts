import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeRepository } from '../../contracts/knowledge.repository';
import { KnowledgeManagementUseCase } from './knowledge-management.use-case';

const companyId = '00000000-0000-4000-8000-000000000001';
const actorUserId = '00000000-0000-4000-8000-000000000002';
const commandId = '00000000-0000-4000-8000-000000000003';
const knowledgeBaseId = '00000000-0000-4000-8000-000000000004';
const serviceIdentityId = '00000000-0000-4000-8000-000000000005';
const serviceSessionId = '00000000-0000-4000-8000-000000000006';
const agentExecutionId = '00000000-0000-4000-8000-000000000007';
const evidenceMessageId = '00000000-0000-4000-8000-000000000008';

function setup() {
  const repository = {
    listScopeDepartments: vi.fn().mockResolvedValue([]),
    createDocumentDraft: vi.fn().mockResolvedValue({ status: 'draft' }),
    findOriginal: vi.fn(),
    createAgentSuggestion: vi.fn().mockResolvedValue({ status: 'pending' }),
    observeAgentGap: vi.fn().mockResolvedValue({ status: 'open' }),
  };
  const storage = {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const extractor = {
    extract: vi.fn(),
  };
  return {
    repository,
    storage,
    extractor,
    useCase: new KnowledgeManagementUseCase(
      repository as unknown as KnowledgeRepository,
      storage,
      extractor,
    ),
  };
}

describe('KnowledgeManagementUseCase', () => {
  it('deriva a listagem de departamentos do tenant informado', async () => {
    const { repository, useCase } = setup();

    await useCase.listScopeDepartments(companyId);

    expect(repository.listScopeDepartments).toHaveBeenCalledWith(companyId);
  });

  it('gera IDs v4 estáveis e cria artigo apenas como DRAFT', async () => {
    const { repository, useCase } = setup();

    await useCase.createArticle({
      companyId,
      actorUserId,
      commandId,
      knowledgeBaseId,
      title: 'Política de atendimento',
      scope: 'tenant',
      visibility: 'customer-safe',
      departmentIds: [],
      content: 'Resposta revisada.',
      effectiveFrom: new Date('2026-08-29T00:00:00.000Z'),
      effectiveUntil: null,
    });

    expect(repository.createDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        sourceType: 'article',
        documentId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        versionId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        payload: expect.objectContaining({
          provenance: { source: 'article', extractionStatus: 'completed' },
          chunks: [expect.objectContaining({ ordinal: 1 })],
        }),
      }),
    );
  });

  it('preserva PDF unsupported no storage e mantém o draft não publicável explícito', async () => {
    const { extractor, repository, storage, useCase } = setup();
    extractor.extract.mockResolvedValue({
      status: 'unsupported',
      format: 'pdf',
      content: null,
      chunks: [],
      limitation: 'PDF parser não configurado.',
      provenance: {
        extractionStatus: 'unsupported',
        limitationCode: 'PDF_PARSER_NOT_CONFIGURED',
      },
    });
    const original = Buffer.from('%PDF-1.7\nopaque', 'utf8');

    const result = await useCase.uploadOriginal({
      companyId,
      actorUserId,
      commandId,
      knowledgeBaseId,
      title: 'Manual PDF',
      scope: 'tenant',
      visibility: 'internal',
      departmentIds: [],
      effectiveFrom: null,
      effectiveUntil: null,
      fileName: 'manual.pdf',
      mimeType: 'application/pdf',
      sizeBytes: original.length,
      content: original,
    });

    expect(storage.write).toHaveBeenCalledWith({
      storageKey: expect.stringMatching(
        new RegExp(`^v1/${companyId}/[^/]+/[^/]+/[a-f0-9]{64}$`, 'u'),
      ),
      content: original,
    });
    expect(repository.createDocumentDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          content: null,
          chunks: [],
          provenance: expect.objectContaining({
            originalPreserved: true,
            extractionStatus: 'unsupported',
            limitationCode: 'PDF_PARSER_NOT_CONFIGURED',
          }),
        }),
      }),
    );
    expect(result.extraction.status).toBe('unsupported');
  });

  it('verifica integridade e nunca devolve storageKey ao baixar o original', async () => {
    const { repository, storage, useCase } = setup();
    const content = Buffer.from('original', 'utf8');
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(content).digest('hex');
    repository.findOriginal.mockResolvedValue({
      storageKey: `v1/${companyId}/document/version/${digest}`,
      fileName: 'original.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
      sha256: digest,
    });
    storage.read.mockResolvedValue(content);

    const result = await useCase.original(
      companyId,
      crypto.randomUUID(),
      crypto.randomUUID(),
    );

    expect(result).toEqual({
      fileName: 'original.txt',
      mimeType: 'text/plain',
      sizeBytes: content.length,
      sha256: digest,
      content,
    });
    expect(JSON.stringify(result)).not.toContain('storageKey');
  });

  it('não apaga original content-addressed quando a persistência fica ambígua', async () => {
    const { extractor, repository, storage, useCase } = setup();
    extractor.extract.mockResolvedValue({
      status: 'completed',
      format: 'txt',
      content: 'conteúdo',
      chunks: [],
      limitation: null,
      provenance: { extractionStatus: 'completed' },
    });
    repository.createDocumentDraft.mockRejectedValue(
      new Error('resultado transacional incerto'),
    );
    const original = Buffer.from('conteúdo', 'utf8');

    await expect(
      useCase.uploadOriginal({
        companyId,
        actorUserId,
        commandId,
        knowledgeBaseId,
        title: 'Original',
        scope: 'tenant',
        visibility: 'internal',
        departmentIds: [],
        effectiveFrom: null,
        effectiveUntil: null,
        fileName: 'original.txt',
        mimeType: 'text/plain',
        sizeBytes: original.length,
        content: original,
      }),
    ).rejects.toThrow('resultado transacional incerto');
    expect(storage.write).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('recusa janelas de vigência e scopes inconsistentes antes do repositório', () => {
    const { repository, useCase } = setup();

    expect(() =>
      useCase.createArticle({
        companyId,
        actorUserId,
        commandId,
        knowledgeBaseId,
        title: 'Inválido',
        scope: 'department',
        visibility: 'internal',
        departmentIds: [],
        content: 'conteúdo',
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        effectiveUntil: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).toThrow('effectiveUntil');
    expect(repository.createDocumentDraft).not.toHaveBeenCalled();
  });

  it('creates an agent suggestion only through the pending repository contract', async () => {
    const { repository, useCase } = setup();

    await useCase.createAgentSuggestion({
      companyId,
      serviceIdentityId,
      commandId,
      serviceSessionId,
      agentExecutionId,
      title: 'Transporte de animais',
      proposedContent: 'Definir a política institucional aplicável.',
      evidenceMessageIds: [evidenceMessageId],
    });

    expect(repository.createAgentSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        actor: { type: 'service-identity', serviceIdentityId },
        serviceSessionId,
        agentExecutionId,
        suggestionId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        title: 'Transporte de animais',
        evidenceMessageIds: [evidenceMessageId],
      }),
    );
    expect(
      JSON.stringify(repository.createAgentSuggestion.mock.calls),
    ).not.toContain('published');
  });

  it('uses a distinct runtime actor for reauthorized in-process observations', async () => {
    const { repository, useCase } = setup();

    await useCase.createRuntimeSuggestion({
      companyId,
      commandId,
      serviceSessionId,
      agentExecutionId,
      title: 'Política de bagagem especial',
      proposedContent: 'Definir a política após revisão humana.',
      evidenceMessageIds: [evidenceMessageId],
    });
    await useCase.observeRuntimeGap({
      companyId,
      commandId: '00000000-0000-4000-8000-000000000009',
      serviceSessionId,
      agentExecutionId,
      topic: 'Bagagem especial',
      evidenceMessageIds: [evidenceMessageId],
    });

    expect(repository.createAgentSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'agent-runtime' },
        companyId,
        serviceSessionId,
        agentExecutionId,
      }),
    );
    expect(repository.observeAgentGap).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'agent-runtime' },
        companyId,
        serviceSessionId,
        agentExecutionId,
      }),
    );
    const serialized = JSON.stringify({
      suggestions: repository.createAgentSuggestion.mock.calls,
      gaps: repository.observeAgentGap.mock.calls,
    });
    expect(serialized).not.toContain('serviceIdentityId');
  });

  it('maps spelling variants to the same tenant-scoped gap id', async () => {
    const { repository, useCase } = setup();
    const base = {
      companyId,
      serviceIdentityId,
      serviceSessionId,
      agentExecutionId,
      evidenceMessageIds: [evidenceMessageId],
    };

    await useCase.observeAgentGap({
      ...base,
      commandId,
      topic: 'Transporte de ÁNIMAIS!',
    });
    await useCase.observeAgentGap({
      ...base,
      commandId: '00000000-0000-4000-8000-000000000009',
      topic: 'transporte de animais',
    });

    const calls = repository.observeAgentGap.mock.calls;
    expect(calls[0]?.[0]).toMatchObject({
      topicNormalized: 'transporte de animais',
    });
    expect(calls[0]?.[0]?.gapId).toBe(calls[1]?.[0]?.gapId);
  });
});
