export interface PersistKnowledgeOriginalInput {
  readonly storageKey: string;
  readonly content: Buffer;
}

/** Binary originals are server-only; storage keys never cross the HTTP API. */
export abstract class KnowledgeOriginalStorage {
  abstract write(input: PersistKnowledgeOriginalInput): Promise<void>;
  abstract read(storageKey: string): Promise<Buffer>;
  abstract delete(storageKey: string): Promise<void>;
}
