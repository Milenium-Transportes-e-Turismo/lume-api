export type EvolutionInstanceConnectionState =
  'connected' | 'connecting' | 'disconnected' | 'error';

export interface EvolutionQrCode {
  readonly code: string | null;
  readonly base64: string;
}

export interface CreateEvolutionInstanceInput {
  readonly instanceName: string;
  readonly phoneNumber?: string;
  readonly webhookUrl: string;
}

export interface EvolutionInstanceSnapshot {
  readonly instanceName: string;
  readonly instanceId: string | null;
  readonly connectionState: EvolutionInstanceConnectionState;
  readonly qrCode: EvolutionQrCode | null;
}

export const EVOLUTION_INSTANCE_ERROR_REASONS = [
  'invalid-configuration',
  'invalid-request',
  'already-exists',
  'not-found',
  'provider-rejected',
  'provider-unavailable',
  'timeout',
  'invalid-response',
] as const;

export type EvolutionInstanceErrorReason =
  (typeof EVOLUTION_INSTANCE_ERROR_REASONS)[number];

const SAFE_MESSAGES: Readonly<Record<EvolutionInstanceErrorReason, string>> = {
  'invalid-configuration':
    'A integração Evolution não está configurada para gerenciar canais.',
  'invalid-request': 'Os dados do canal não são válidos para a Evolution.',
  'already-exists': 'A instância técnica já existe na Evolution.',
  'not-found': 'A instância técnica não foi encontrada na Evolution.',
  'provider-rejected': 'A Evolution recusou a operação solicitada.',
  'provider-unavailable': 'A Evolution está temporariamente indisponível.',
  timeout: 'A Evolution não respondeu dentro do tempo limite.',
  'invalid-response': 'A Evolution retornou uma resposta inválida.',
};

export class EvolutionInstanceManagementError extends Error {
  constructor(
    readonly reason: EvolutionInstanceErrorReason,
    readonly providerStatus: number | null = null,
  ) {
    super(SAFE_MESSAGES[reason]);
    this.name = 'EvolutionInstanceManagementError';
  }
}

export abstract class EvolutionInstanceManagementGateway {
  abstract create(
    input: CreateEvolutionInstanceInput,
  ): Promise<EvolutionInstanceSnapshot>;

  abstract connect(instanceName: string): Promise<EvolutionInstanceSnapshot>;

  abstract getConnectionState(
    instanceName: string,
  ): Promise<EvolutionInstanceConnectionState>;

  abstract restart(instanceName: string): Promise<void>;

  /** Logs out the WhatsApp session but never deletes the Lume channel. */
  abstract disconnect(instanceName: string): Promise<void>;

  /** External cleanup allowed only after the Lume setup is already CANCELLED. */
  abstract removeCancelledSetup(instanceName: string): Promise<void>;
}
