export interface PersistWhatsAppMediaInput {
  readonly storageKey: string;
  readonly content: Buffer;
}

export interface PersistWhatsAppMediaResult {
  /** `false` means the exact immutable content was already stored. */
  readonly created: boolean;
}

/**
 * Armazenamento binário controlado pela aplicação. A chave é opaca para as
 * camadas HTTP e nunca deve ser exposta ao navegador.
 */
export abstract class WhatsAppMediaStorage {
  abstract write(
    input: PersistWhatsAppMediaInput,
  ): Promise<PersistWhatsAppMediaResult>;
  abstract read(storageKey: string): Promise<Buffer>;
  abstract delete(storageKey: string): Promise<void>;
}
