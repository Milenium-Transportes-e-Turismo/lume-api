export const AGENT_MODEL_GATEWAY_ERROR_REASONS = [
  'invalid-request',
  'unauthorized',
  'rate-limited',
  'timeout',
  'provider-unavailable',
  'provider-error',
  'invalid-response',
] as const;

export type AgentModelGatewayErrorReason =
  (typeof AGENT_MODEL_GATEWAY_ERROR_REASONS)[number];

export const AGENT_MODEL_GATEWAY_ERROR_CODE =
  'AGENT_MODEL_REQUEST_FAILED' as const;

const SAFE_MESSAGES: Readonly<Record<AgentModelGatewayErrorReason, string>> = {
  'invalid-request': 'A solicitação do agente para o modelo é inválida.',
  unauthorized: 'A credencial do provider deste agente foi recusada.',
  'rate-limited':
    'O limite de requisições do provider deste agente foi atingido.',
  timeout: 'O provider de IA não respondeu dentro do tempo limite.',
  'provider-unavailable': 'O provider de IA está temporariamente indisponível.',
  'provider-error':
    'O provider de IA não conseguiu concluir a solicitação do agente.',
  'invalid-response': 'O provider de IA retornou uma resposta inválida.',
};

export class AgentModelGatewayError extends Error {
  readonly code = AGENT_MODEL_GATEWAY_ERROR_CODE;

  constructor(
    readonly reason: AgentModelGatewayErrorReason,
    readonly providerStatus: number | null = null,
  ) {
    super(SAFE_MESSAGES[reason]);
    this.name = 'AgentModelGatewayError';
  }

  toJSON(): Readonly<{
    code: typeof AGENT_MODEL_GATEWAY_ERROR_CODE;
    reason: AgentModelGatewayErrorReason;
    message: string;
    providerStatus: number | null;
  }> {
    return {
      code: this.code,
      reason: this.reason,
      message: this.message,
      providerStatus: this.providerStatus,
    };
  }
}
