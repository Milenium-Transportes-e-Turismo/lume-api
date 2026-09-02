import { validationError } from '../../core/errors/app-error';

export const KNOWLEDGE_SCOPES = [
  'tenant',
  'department',
  'multi-department',
] as const;
export const KNOWLEDGE_VISIBILITIES = ['customer-safe', 'internal'] as const;
export const KNOWLEDGE_VERSION_STATUSES = [
  'draft',
  'published',
  'superseded',
  'archived',
] as const;

export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];
export type KnowledgeVersionStatus =
  (typeof KNOWLEDGE_VERSION_STATUSES)[number];

export interface KnowledgeVersionCandidate {
  readonly companyId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly version: number;
  readonly status: KnowledgeVersionStatus;
  readonly scope: KnowledgeScope;
  readonly departmentIds: readonly string[];
  readonly visibility: KnowledgeVisibility;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly publishedAt: Date | null;
}

export interface KnowledgeAccessContext {
  readonly companyId: string;
  readonly departmentId: string | null;
  readonly retrievedAt: Date;
  readonly customerFacing: boolean;
}

export interface KnowledgeSourceSnapshot {
  readonly documentId: string;
  readonly versionId: string;
  readonly version: number;
  readonly chunkId: string | null;
  readonly page: number | null;
  readonly retrievedAt: Date;
  readonly visibility: KnowledgeVisibility;
}

export function canUseKnowledgeVersion(
  candidate: KnowledgeVersionCandidate,
  context: KnowledgeAccessContext,
): boolean {
  if (
    candidate.companyId !== context.companyId ||
    candidate.status !== 'published'
  ) {
    return false;
  }
  if (
    candidate.publishedAt === null ||
    candidate.effectiveFrom > context.retrievedAt
  ) {
    return false;
  }
  if (
    candidate.effectiveUntil !== null &&
    candidate.effectiveUntil <= context.retrievedAt
  ) {
    return false;
  }
  if (context.customerFacing && candidate.visibility !== 'customer-safe') {
    return false;
  }
  if (candidate.scope === 'tenant') return true;
  if (context.departmentId === null) return false;
  return candidate.departmentIds.includes(context.departmentId);
}

export function selectEffectiveKnowledgeVersion(
  candidates: readonly KnowledgeVersionCandidate[],
  context: KnowledgeAccessContext,
): KnowledgeVersionCandidate | null {
  const eligible = candidates.filter((candidate) =>
    canUseKnowledgeVersion(candidate, context),
  );
  if (eligible.length === 0) return null;

  return eligible.reduce((selected, candidate) => {
    if (candidate.version > selected.version) return candidate;
    if (candidate.version < selected.version) return selected;
    return candidate.effectiveFrom > selected.effectiveFrom
      ? candidate
      : selected;
  });
}

export function createKnowledgeSourceSnapshot(input: {
  readonly candidate: KnowledgeVersionCandidate;
  readonly context: KnowledgeAccessContext;
  readonly chunkId?: string;
  readonly page?: number;
}): KnowledgeSourceSnapshot {
  if (!canUseKnowledgeVersion(input.candidate, input.context)) {
    throw validationError(
      'A versão de conhecimento não está autorizada ou vigente.',
    );
  }
  if (
    input.page !== undefined &&
    (!Number.isInteger(input.page) || input.page < 1)
  ) {
    throw validationError('A página da fonte deve ser um inteiro positivo.');
  }
  return {
    documentId: input.candidate.documentId,
    versionId: input.candidate.versionId,
    version: input.candidate.version,
    chunkId: input.chunkId?.trim() || null,
    page: input.page ?? null,
    retrievedAt: input.context.retrievedAt,
    visibility: input.candidate.visibility,
  };
}

export type AuthoritativeAnswerSource =
  | 'transactional-data'
  | 'published-knowledge'
  | 'confirmed-profile'
  | 'current-conversation'
  | 'none';

export function chooseAuthoritativeAnswerSource(input: {
  readonly hasTransactionalData: boolean;
  readonly hasPublishedKnowledge: boolean;
  readonly hasConfirmedProfile: boolean;
  readonly hasCurrentConversationContext: boolean;
}): AuthoritativeAnswerSource {
  if (input.hasTransactionalData) return 'transactional-data';
  if (input.hasPublishedKnowledge) return 'published-knowledge';
  if (input.hasConfirmedProfile) return 'confirmed-profile';
  if (input.hasCurrentConversationContext) return 'current-conversation';
  return 'none';
}

export function knowledgeGapAction(
  source: AuthoritativeAnswerSource,
): 'answer-with-authorized-source' | 'handoff-to-human' {
  return source === 'none'
    ? 'handoff-to-human'
    : 'answer-with-authorized-source';
}

/**
 * Marks retrieved text as untrusted evidence. This boundary is deliberately
 * explicit so document content can never be confused with platform commands.
 */
export function wrapUntrustedKnowledgeContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw validationError('O conteúdo recuperado está vazio.');
  return `<untrusted-tenant-knowledge>\n${normalized}\n</untrusted-tenant-knowledge>`;
}
