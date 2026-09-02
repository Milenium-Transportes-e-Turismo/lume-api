export const AGENT_CREDENTIAL_RESOLUTION_REASONS = [
  'invalid-reference',
  'unsupported-scheme',
  'missing',
  'invalid-secret',
  'unsafe-path',
  'invalid-docker-secrets-root',
] as const;

export type AgentCredentialResolutionReason =
  (typeof AGENT_CREDENTIAL_RESOLUTION_REASONS)[number];
export const AGENT_CREDENTIAL_RESOLUTION_ERROR_CODE =
  'AGENT_CREDENTIAL_RESOLUTION_FAILED' as const;

const SAFE_MESSAGES: Readonly<Record<AgentCredentialResolutionReason, string>> =
  {
    'invalid-reference':
      'A referência da credencial OpenAI do agente é inválida.',
    'unsupported-scheme':
      'O esquema da credencial OpenAI não está configurado neste servidor. Use env:// ou docker-secret://.',
    missing: 'A credencial OpenAI do agente não está disponível no servidor.',
    'invalid-secret': 'A credencial OpenAI do agente é inválida.',
    'unsafe-path':
      'A referência docker-secret da credencial OpenAI é insegura.',
    'invalid-docker-secrets-root':
      'O diretório de Docker secrets não está configurado com segurança.',
  };

export class AgentCredentialResolutionError extends Error {
  readonly code = AGENT_CREDENTIAL_RESOLUTION_ERROR_CODE;

  constructor(readonly reason: AgentCredentialResolutionReason) {
    super(SAFE_MESSAGES[reason]);
    this.name = 'AgentCredentialResolutionError';
  }

  toJSON(): Readonly<{
    code: typeof AGENT_CREDENTIAL_RESOLUTION_ERROR_CODE;
    reason: AgentCredentialResolutionReason;
    message: string;
  }> {
    return {
      code: this.code,
      reason: this.reason,
      message: this.message,
    };
  }
}
