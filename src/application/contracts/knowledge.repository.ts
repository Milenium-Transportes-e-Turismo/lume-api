export type KnowledgeDocumentScope =
  'tenant' | 'department' | 'multi-department';
export type KnowledgeDocumentVisibility = 'customer-safe' | 'internal';
export type KnowledgeDocumentSource = 'article' | 'file';
export type KnowledgeDocumentVersionStatus =
  'draft' | 'published' | 'superseded' | 'archived';
export type KnowledgeSuggestionReview = 'approved' | 'rejected';
export type KnowledgeSuggestionStatus =
  'pending' | 'approved' | 'rejected' | 'published';
export type KnowledgeGapReview = 'acknowledged' | 'resolved' | 'dismissed';
export type KnowledgeGapStatus =
  'open' | 'acknowledged' | 'resolved' | 'dismissed';

export interface KnowledgeScopeDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface KnowledgeChunkDraft {
  readonly ordinal: number;
  readonly pageNumber: number | null;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenCount: number | null;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface KnowledgeVersionPayload {
  readonly content: string | null;
  readonly storageKey: string | null;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly effectiveFrom: Date | null;
  readonly effectiveUntil: Date | null;
  readonly chunks: readonly KnowledgeChunkDraft[];
}

export interface KnowledgeMutationIdentity {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly commandId: string;
}

export interface AgentKnowledgeMutationIdentity {
  readonly companyId: string;
  readonly commandId: string;
  readonly serviceSessionId: string;
  readonly agentExecutionId: string;
  readonly actor:
    | {
        /** Authenticated HTTP caller used by the internal observations API. */
        readonly type: 'service-identity';
        readonly serviceIdentityId: string;
      }
    | {
        /** Trusted in-process runtime; this variant is never accepted by a DTO. */
        readonly type: 'agent-runtime';
      };
}

export interface CreateAgentKnowledgeSuggestionInput extends AgentKnowledgeMutationIdentity {
  readonly suggestionId: string;
  readonly title: string;
  readonly proposedContent: string;
  readonly evidenceMessageIds: readonly string[];
}

export interface ObserveAgentKnowledgeGapInput extends AgentKnowledgeMutationIdentity {
  readonly gapId: string;
  readonly topic: string;
  readonly topicNormalized: string;
  readonly evidenceMessageIds: readonly string[];
}

export interface AgentKnowledgeSuggestionCreationResult {
  readonly suggestionId: string;
  readonly status: 'pending';
  readonly createdAt: string;
  readonly automaticPublication: false;
  readonly idempotent?: boolean;
}

export interface AgentKnowledgeGapObservationResult {
  readonly gapId: string;
  readonly topicNormalized: string;
  readonly status: KnowledgeGapStatus;
  readonly occurrenceCount: number;
  readonly observedAt: string;
  readonly automaticPublication: false;
  readonly idempotent?: boolean;
}

export interface CreateKnowledgeBaseInput extends KnowledgeMutationIdentity {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface CreateKnowledgeDocumentDraftInput extends KnowledgeMutationIdentity {
  readonly documentId: string;
  readonly versionId: string;
  readonly knowledgeBaseId: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceType: KnowledgeDocumentSource;
  readonly scope: KnowledgeDocumentScope;
  readonly visibility: KnowledgeDocumentVisibility;
  readonly departmentIds: readonly string[];
  readonly payload: KnowledgeVersionPayload;
}

export interface CreateNextKnowledgeDraftInput extends KnowledgeMutationIdentity {
  readonly documentId: string;
  readonly versionId: string;
  readonly expectedVersion: number;
  readonly content: string | null;
  readonly effectiveFrom: Date | null;
  readonly effectiveUntil: Date | null;
  readonly chunks: readonly KnowledgeChunkDraft[];
}

export interface UpdateKnowledgeDraftInput extends KnowledgeMutationIdentity {
  readonly documentId: string;
  readonly versionId: string;
  readonly expectedVersion: number;
  readonly expectedContentHash: string;
  readonly content: string;
  readonly effectiveFrom: Date | null;
  readonly effectiveUntil: Date | null;
  readonly chunks: readonly KnowledgeChunkDraft[];
}

export interface VersionedKnowledgeMutationInput extends KnowledgeMutationIdentity {
  readonly documentId: string;
  readonly versionId: string;
  readonly expectedVersion: number;
}

export interface ArchiveKnowledgeDocumentInput extends KnowledgeMutationIdentity {
  readonly documentId: string;
  readonly expectedVersion: number;
}

export abstract class KnowledgeRepository {
  abstract listScopeDepartments(
    companyId: string,
  ): Promise<readonly KnowledgeScopeDepartment[]>;
  abstract listBases(companyId: string): Promise<readonly unknown[]>;
  abstract createBase(input: CreateKnowledgeBaseInput): Promise<unknown>;
  abstract listDocuments(input: {
    readonly companyId: string;
    readonly knowledgeBaseId?: string;
  }): Promise<readonly unknown[]>;
  abstract getDocument(companyId: string, documentId: string): Promise<unknown>;
  abstract createDocumentDraft(
    input: CreateKnowledgeDocumentDraftInput,
  ): Promise<unknown>;
  abstract createNextDraft(
    input: CreateNextKnowledgeDraftInput,
  ): Promise<unknown>;
  abstract updateDraft(input: UpdateKnowledgeDraftInput): Promise<unknown>;
  abstract publishVersion(
    input: VersionedKnowledgeMutationInput,
  ): Promise<unknown>;
  abstract archiveVersion(
    input: VersionedKnowledgeMutationInput,
  ): Promise<unknown>;
  abstract archiveDocument(
    input: ArchiveKnowledgeDocumentInput,
  ): Promise<unknown>;
  abstract findOriginal(input: {
    readonly companyId: string;
    readonly documentId: string;
    readonly versionId: string;
  }): Promise<{
    readonly storageKey: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null>;
  abstract listSuggestions(input: {
    readonly companyId: string;
    readonly status?: KnowledgeSuggestionStatus;
  }): Promise<readonly unknown[]>;
  abstract createAgentSuggestion(
    input: CreateAgentKnowledgeSuggestionInput,
  ): Promise<AgentKnowledgeSuggestionCreationResult>;
  abstract reviewSuggestion(
    input: KnowledgeMutationIdentity & {
      readonly suggestionId: string;
      readonly decision: KnowledgeSuggestionReview;
    },
  ): Promise<unknown>;
  abstract listGaps(input: {
    readonly companyId: string;
    readonly status?: KnowledgeGapStatus;
  }): Promise<readonly unknown[]>;
  abstract observeAgentGap(
    input: ObserveAgentKnowledgeGapInput,
  ): Promise<AgentKnowledgeGapObservationResult>;
  abstract reviewGap(
    input: KnowledgeMutationIdentity & {
      readonly gapId: string;
      readonly decision: KnowledgeGapReview;
    },
  ): Promise<unknown>;
}
