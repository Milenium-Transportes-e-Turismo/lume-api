import { createHash } from 'node:crypto';

import { KnowledgeOriginalStorage } from '../../contracts/knowledge-original.storage';
import { KnowledgeDocumentExtractor } from '../../contracts/knowledge-document.extractor';
import {
  KnowledgeRepository,
  type KnowledgeChunkDraft,
  type KnowledgeDocumentScope,
  type KnowledgeDocumentVisibility,
  type KnowledgeGapStatus,
  type KnowledgeGapReview,
  type KnowledgeSuggestionStatus,
  type KnowledgeSuggestionReview,
} from '../../contracts/knowledge.repository';
import { validationError } from '../../../core/errors/app-error';
import {
  normalizeKnowledgeEvidenceMessageIds,
  normalizeKnowledgeGapTopic,
  normalizeKnowledgeSuggestionObservation,
} from '../../../domain/knowledge/knowledge-observation-policy';

const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const CHUNK_CHARACTERS = 4_000;
const MAX_CHUNKS = 500;
const HASH = /^[a-f0-9]{64}$/u;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function required(value: string, label: string, maximum = 240): string {
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maximum) {
    throw validationError(`${label} é inválido.`);
  }
  return normalized;
}

function optional(
  value: string | null | undefined,
  maximum: number,
): string | null {
  const normalized = value?.normalize('NFC').trim() ?? '';
  if (normalized.length > maximum)
    throw validationError('O texto excede o limite permitido.');
  return normalized || null;
}

function articleContent(value: string): string {
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized ||
    Buffer.byteLength(normalized, 'utf8') > MAX_ARTICLE_BYTES
  ) {
    throw validationError('O artigo deve possuir entre 1 byte e 2 MiB.');
  }
  return normalized;
}

function validateEffectiveWindow(
  effectiveFrom: Date | null,
  effectiveUntil: Date | null,
): void {
  for (const value of [effectiveFrom, effectiveUntil]) {
    if (value && !Number.isFinite(value.valueOf())) {
      throw validationError('A vigência de knowledge é inválida.');
    }
  }
  if (effectiveFrom && effectiveUntil && effectiveUntil <= effectiveFrom) {
    throw validationError('effectiveUntil deve ser posterior a effectiveFrom.');
  }
}

function validateScope(
  scope: KnowledgeDocumentScope,
  departmentIds: readonly string[],
): readonly string[] {
  const ids = [
    ...new Set(departmentIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (
    (scope === 'tenant' && ids.length !== 0) ||
    (scope === 'department' && ids.length !== 1) ||
    (scope === 'multi-department' && ids.length < 2)
  ) {
    throw validationError(
      'Os departamentos não correspondem ao scope informado.',
    );
  }
  return ids.sort();
}

function chunks(content: string, source: string): KnowledgeChunkDraft[] {
  const result: KnowledgeChunkDraft[] = [];
  for (let offset = 0; offset < content.length; offset += CHUNK_CHARACTERS) {
    const part = content.slice(offset, offset + CHUNK_CHARACTERS).trim();
    if (!part) continue;
    if (result.length >= MAX_CHUNKS) {
      throw validationError(
        `O artigo excede o limite seguro de ${MAX_CHUNKS} chunks.`,
      );
    }
    result.push({
      ordinal: result.length + 1,
      pageNumber: null,
      content: part,
      contentHash: sha256(part),
      tokenCount: Math.ceil(part.length / 4),
      provenance: { source },
    });
  }
  return result;
}

export interface KnowledgeActorInput {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly commandId: string;
}

export interface AgentKnowledgeActorInput {
  readonly companyId: string;
  readonly serviceIdentityId: string;
  readonly commandId: string;
  readonly serviceSessionId: string;
  readonly agentExecutionId: string;
}

interface RuntimeKnowledgeActorInput {
  readonly companyId: string;
  readonly commandId: string;
  readonly serviceSessionId: string;
  readonly agentExecutionId: string;
}

export class KnowledgeManagementUseCase {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly storage: KnowledgeOriginalStorage,
    private readonly extractor: KnowledgeDocumentExtractor,
  ) {}

  listScopeDepartments(companyId: string) {
    return this.repository.listScopeDepartments(
      required(companyId, 'O tenant', 120),
    );
  }

  listBases(companyId: string) {
    return this.repository.listBases(required(companyId, 'O tenant', 120));
  }

  createBase(
    input: KnowledgeActorInput & { name: string; description?: string | null },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    return this.repository.createBase({
      companyId,
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId,
      id: deterministicUuid(`${companyId}:${commandId}:knowledge-base`),
      name: required(input.name, 'O nome da base', 120),
      description: optional(input.description, 4_000),
    });
  }

  listDocuments(input: { companyId: string; knowledgeBaseId?: string }) {
    return this.repository.listDocuments({
      companyId: required(input.companyId, 'O tenant', 120),
      ...(input.knowledgeBaseId
        ? { knowledgeBaseId: required(input.knowledgeBaseId, 'A base', 120) }
        : {}),
    });
  }

  detail(companyId: string, documentId: string) {
    return this.repository.getDocument(
      required(companyId, 'O tenant', 120),
      required(documentId, 'O documento', 120),
    );
  }

  createArticle(
    input: KnowledgeActorInput & {
      knowledgeBaseId: string;
      title: string;
      description?: string | null;
      scope: KnowledgeDocumentScope;
      visibility: KnowledgeDocumentVisibility;
      departmentIds: readonly string[];
      content: string;
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    const content = articleContent(input.content);
    validateEffectiveWindow(input.effectiveFrom, input.effectiveUntil);
    const departmentIds = validateScope(input.scope, input.departmentIds);
    return this.repository.createDocumentDraft({
      companyId,
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId,
      documentId: deterministicUuid(`${companyId}:${commandId}:article`),
      versionId: deterministicUuid(`${companyId}:${commandId}:article:v1`),
      knowledgeBaseId: required(input.knowledgeBaseId, 'A base', 120),
      title: required(input.title, 'O título'),
      description: optional(input.description, 4_000),
      sourceType: 'article',
      scope: input.scope,
      visibility: input.visibility,
      departmentIds,
      payload: {
        content,
        storageKey: null,
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        sha256: sha256(content),
        provenance: { source: 'article', extractionStatus: 'completed' },
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        chunks: chunks(content, 'article'),
      },
    });
  }

  async uploadOriginal(
    input: KnowledgeActorInput & {
      knowledgeBaseId: string;
      title: string;
      description?: string | null;
      scope: KnowledgeDocumentScope;
      visibility: KnowledgeDocumentVisibility;
      departmentIds: readonly string[];
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      content: Buffer;
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    if (input.sizeBytes !== input.content.length) {
      throw validationError('O tamanho declarado do original é inconsistente.');
    }
    validateEffectiveWindow(input.effectiveFrom, input.effectiveUntil);
    const departmentIds = validateScope(input.scope, input.departmentIds);
    const extracted = await this.extractor.extract({
      fileName: input.fileName,
      mimeType: input.mimeType,
      content: input.content,
    });
    const documentId = deterministicUuid(`${companyId}:${commandId}:file`);
    const versionId = deterministicUuid(`${companyId}:${commandId}:file:v1`);
    const originalHash = sha256(input.content);
    const storageKey = `v1/${companyId}/${documentId}/${versionId}/${originalHash}`;
    await this.storage.write({ storageKey, content: input.content });
    const stored = await this.repository.createDocumentDraft({
      companyId,
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId,
      documentId,
      versionId,
      knowledgeBaseId: required(input.knowledgeBaseId, 'A base', 120),
      title: required(input.title, 'O título'),
      description: optional(input.description, 4_000),
      sourceType: 'file',
      scope: input.scope,
      visibility: input.visibility,
      departmentIds,
      payload: {
        content: extracted.content,
        storageKey,
        fileName: required(input.fileName, 'O nome do arquivo', 255),
        mimeType: required(input.mimeType, 'O MIME type', 160),
        sizeBytes: input.sizeBytes,
        sha256: originalHash,
        provenance: {
          source: 'uploaded-original',
          originalSha256: originalHash,
          originalPreserved: true,
          format: extracted.format,
          limitation: extracted.limitation,
          ...extracted.provenance,
        },
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        chunks: extracted.chunks,
      },
    });
    return { stored, extraction: extracted };
  }

  createNextDraft(
    input: KnowledgeActorInput & {
      documentId: string;
      expectedVersion: number;
      content?: string | null;
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
    },
  ) {
    const content = input.content ? articleContent(input.content) : null;
    validateEffectiveWindow(input.effectiveFrom, input.effectiveUntil);
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    return this.repository.createNextDraft({
      companyId,
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId,
      documentId: required(input.documentId, 'O documento', 120),
      versionId: deterministicUuid(`${companyId}:${commandId}:article-draft`),
      expectedVersion: input.expectedVersion,
      content,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      chunks: content ? chunks(content, 'article') : [],
    });
  }

  updateDraft(
    input: KnowledgeActorInput & {
      documentId: string;
      versionId: string;
      expectedVersion: number;
      expectedContentHash: string;
      content: string;
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
    },
  ) {
    const content = articleContent(input.content);
    if (!HASH.test(input.expectedContentHash)) {
      throw validationError('expectedContentHash é inválido.');
    }
    validateEffectiveWindow(input.effectiveFrom, input.effectiveUntil);
    return this.repository.updateDraft({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      documentId: required(input.documentId, 'O documento', 120),
      versionId: required(input.versionId, 'A versão', 120),
      expectedVersion: input.expectedVersion,
      expectedContentHash: input.expectedContentHash,
      content,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      chunks: chunks(content, 'article'),
    });
  }

  publish(
    input: KnowledgeActorInput & {
      documentId: string;
      versionId: string;
      expectedVersion: number;
    },
  ) {
    return this.repository.publishVersion({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      expectedVersion: input.expectedVersion,
      documentId: required(input.documentId, 'O documento', 120),
      versionId: required(input.versionId, 'A versão', 120),
    });
  }

  archiveVersion(
    input: KnowledgeActorInput & {
      documentId: string;
      versionId: string;
      expectedVersion: number;
    },
  ) {
    return this.repository.archiveVersion({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      expectedVersion: input.expectedVersion,
      documentId: required(input.documentId, 'O documento', 120),
      versionId: required(input.versionId, 'A versão', 120),
    });
  }

  archiveDocument(
    input: KnowledgeActorInput & {
      documentId: string;
      expectedVersion: number;
    },
  ) {
    return this.repository.archiveDocument({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      expectedVersion: input.expectedVersion,
      documentId: required(input.documentId, 'O documento', 120),
    });
  }

  async original(companyId: string, documentId: string, versionId: string) {
    const metadata = await this.repository.findOriginal({
      companyId: required(companyId, 'O tenant', 120),
      documentId: required(documentId, 'O documento', 120),
      versionId: required(versionId, 'A versão', 120),
    });
    if (!metadata)
      throw validationError('A versão não possui original armazenado.');
    const { storageKey, ...publicMetadata } = metadata;
    const content = await this.storage.read(storageKey);
    if (
      content.length !== metadata.sizeBytes ||
      sha256(content) !== metadata.sha256
    ) {
      throw new Error(
        'O original armazenado falhou na verificação de integridade.',
      );
    }
    return { ...publicMetadata, content };
  }

  listSuggestions(companyId: string, status?: KnowledgeSuggestionStatus) {
    return this.repository.listSuggestions({
      companyId: required(companyId, 'O tenant', 120),
      status,
    });
  }

  createAgentSuggestion(
    input: AgentKnowledgeActorInput & {
      readonly title: string;
      readonly proposedContent: string;
      readonly evidenceMessageIds: readonly string[];
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    const suggestion = normalizeKnowledgeSuggestionObservation(input);
    return this.repository.createAgentSuggestion({
      companyId,
      commandId,
      serviceSessionId: required(
        input.serviceSessionId,
        'A sessão de atendimento',
        120,
      ),
      agentExecutionId: required(
        input.agentExecutionId,
        'A execução do agente',
        120,
      ),
      actor: {
        type: 'service-identity',
        serviceIdentityId: required(
          input.serviceIdentityId,
          'A identidade de serviço',
          120,
        ),
      },
      suggestionId: deterministicUuid(
        `${companyId}:${commandId}:knowledge-suggestion`,
      ),
      ...suggestion,
      evidenceMessageIds: normalizeKnowledgeEvidenceMessageIds(
        input.evidenceMessageIds,
      ),
    });
  }

  /** Trusted in-process path used only after AgentToolCall reauthorization. */
  createRuntimeSuggestion(
    input: RuntimeKnowledgeActorInput & {
      readonly title: string;
      readonly proposedContent: string;
      readonly evidenceMessageIds: readonly string[];
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    const suggestion = normalizeKnowledgeSuggestionObservation(input);
    return this.repository.createAgentSuggestion({
      companyId,
      commandId,
      serviceSessionId: required(
        input.serviceSessionId,
        'A sessão de atendimento',
        120,
      ),
      agentExecutionId: required(
        input.agentExecutionId,
        'A execução do agente',
        120,
      ),
      actor: { type: 'agent-runtime' },
      suggestionId: deterministicUuid(
        `${companyId}:${commandId}:knowledge-suggestion`,
      ),
      ...suggestion,
      evidenceMessageIds: normalizeKnowledgeEvidenceMessageIds(
        input.evidenceMessageIds,
      ),
    });
  }

  reviewSuggestion(
    input: KnowledgeActorInput & {
      suggestionId: string;
      decision: KnowledgeSuggestionReview;
    },
  ) {
    return this.repository.reviewSuggestion({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      suggestionId: required(input.suggestionId, 'A sugestão', 120),
      decision: input.decision,
    });
  }

  listGaps(companyId: string, status?: KnowledgeGapStatus) {
    return this.repository.listGaps({
      companyId: required(companyId, 'O tenant', 120),
      status,
    });
  }

  observeAgentGap(
    input: AgentKnowledgeActorInput & {
      readonly topic: string;
      readonly evidenceMessageIds: readonly string[];
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    const topic = normalizeKnowledgeGapTopic(input.topic);
    return this.repository.observeAgentGap({
      companyId,
      commandId,
      serviceSessionId: required(
        input.serviceSessionId,
        'A sessão de atendimento',
        120,
      ),
      agentExecutionId: required(
        input.agentExecutionId,
        'A execução do agente',
        120,
      ),
      actor: {
        type: 'service-identity',
        serviceIdentityId: required(
          input.serviceIdentityId,
          'A identidade de serviço',
          120,
        ),
      },
      gapId: deterministicUuid(
        `${companyId}:knowledge-gap:${topic.topicNormalized}`,
      ),
      ...topic,
      evidenceMessageIds: normalizeKnowledgeEvidenceMessageIds(
        input.evidenceMessageIds,
      ),
    });
  }

  /** Trusted in-process path used only after AgentToolCall reauthorization. */
  observeRuntimeGap(
    input: RuntimeKnowledgeActorInput & {
      readonly topic: string;
      readonly evidenceMessageIds: readonly string[];
    },
  ) {
    const companyId = required(input.companyId, 'O tenant', 120);
    const commandId = required(input.commandId, 'O comando', 120);
    const topic = normalizeKnowledgeGapTopic(input.topic);
    return this.repository.observeAgentGap({
      companyId,
      commandId,
      serviceSessionId: required(
        input.serviceSessionId,
        'A sessão de atendimento',
        120,
      ),
      agentExecutionId: required(
        input.agentExecutionId,
        'A execução do agente',
        120,
      ),
      actor: { type: 'agent-runtime' },
      gapId: deterministicUuid(
        `${companyId}:knowledge-gap:${topic.topicNormalized}`,
      ),
      ...topic,
      evidenceMessageIds: normalizeKnowledgeEvidenceMessageIds(
        input.evidenceMessageIds,
      ),
    });
  }

  reviewGap(
    input: KnowledgeActorInput & {
      gapId: string;
      decision: KnowledgeGapReview;
    },
  ) {
    return this.repository.reviewGap({
      companyId: required(input.companyId, 'O tenant', 120),
      actorUserId: required(input.actorUserId, 'O usuário', 120),
      commandId: required(input.commandId, 'O comando', 120),
      gapId: required(input.gapId, 'O gap', 120),
      decision: input.decision,
    });
  }
}
