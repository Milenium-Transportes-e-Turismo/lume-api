import type { KnowledgeChunkDraft } from './knowledge.repository';

export type KnowledgeExtractionStatus = 'completed' | 'unsupported';

export interface ExtractKnowledgeDocumentInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: Buffer;
}

export interface KnowledgeExtractionResult {
  readonly status: KnowledgeExtractionStatus;
  readonly format: 'txt' | 'csv' | 'xlsx' | 'docx' | 'pdf';
  readonly content: string | null;
  readonly chunks: readonly KnowledgeChunkDraft[];
  readonly limitation: string | null;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export abstract class KnowledgeDocumentExtractor {
  abstract extract(
    input: ExtractKnowledgeDocumentInput,
  ): Promise<KnowledgeExtractionResult>;
}
