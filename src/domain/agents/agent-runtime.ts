import { validationError } from '../../core/errors/app-error';

export const LUME_AGENT_TYPES = [
  'orchestrator',
  'customer-service',
  'specialist',
  'silent-classifier',
  'supervisor',
] as const;
export const LUME_AGENT_CONTEXTS = [
  'whatsapp',
  'internal',
  'automation',
  'media-interpretation',
] as const;
export const AGENT_AUTONOMY_LEVELS = [
  'read',
  'safe-write',
  'sensitive-write',
] as const;
export const OPENAI_PROVIDER = 'openai' as const;
export const AGENT_RUNTIME_STATUSES = [
  'draft',
  'active',
  'superseded',
  'archived',
] as const;

export type LumeAgentType = (typeof LUME_AGENT_TYPES)[number];
export type LumeAgentContext = (typeof LUME_AGENT_CONTEXTS)[number];
export type AgentAutonomyLevel = (typeof AGENT_AUTONOMY_LEVELS)[number];
export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number];

export interface AgentRuntimeConfig {
  readonly provider: string;
  readonly model: string;
  readonly credentialRef: string;
  readonly credentialIdentifier: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly status: AgentRuntimeStatus;
}

export interface OpenAiAgentRuntimeConfig extends AgentRuntimeConfig {
  readonly provider: typeof OPENAI_PROVIDER;
}

export interface AgentPromptLayers {
  readonly systemPrompt: string;
  readonly platformAgentPrompt: string;
  readonly tenantInstructions: string | null;
  readonly runtimeContext: string;
  readonly platformPromptVersion: number;
  readonly tenantInstructionsVersion: number | null;
}

export interface AgentToolPolicy {
  readonly code: string;
  readonly autonomy: AgentAutonomyLevel;
  readonly requiresAuthorization: boolean;
}

export interface AgentExecutionAttemptAudit {
  readonly attempt: number;
  readonly provider: string;
  readonly model: string;
  readonly runtimeConfigVersion: number;
  readonly credentialIdentifier: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly errorCode?: string;
}

const CREDENTIAL_REFERENCE =
  /^(env|secret|vault|docker-secret):\/\/[a-z0-9][a-z0-9/_.-]{2,199}$/iu;
const MODEL_IDENTIFIER = /^[a-z0-9][a-z0-9._-]{1,119}$/iu;
const PROVIDER_IDENTIFIER = /^[a-z0-9][a-z0-9._-]{1,79}$/iu;

export function validateAgentRuntimeConfig<T extends AgentRuntimeConfig>(
  config: T,
): T {
  const provider = config.provider.trim().toLowerCase();
  if (!PROVIDER_IDENTIFIER.test(provider)) {
    throw validationError('Informe um identificador de provider válido.');
  }
  const model = config.model.trim();
  if (!MODEL_IDENTIFIER.test(model)) {
    throw validationError('Informe um identificador de modelo válido.');
  }
  const credentialRef = assertSafeCredentialReference(config.credentialRef);
  const credentialIdentifier = config.credentialIdentifier.trim();
  if (!credentialIdentifier || credentialIdentifier.length > 120) {
    throw validationError(
      'Informe o identificador seguro da credencial do agente.',
    );
  }
  if (
    config.temperature !== undefined &&
    (!Number.isFinite(config.temperature) ||
      config.temperature < 0 ||
      config.temperature > 2)
  ) {
    throw validationError('A temperatura do agente deve estar entre 0 e 2.');
  }
  if (
    config.maxOutputTokens !== undefined &&
    (!Number.isInteger(config.maxOutputTokens) ||
      config.maxOutputTokens < 64 ||
      config.maxOutputTokens > 128_000)
  ) {
    throw validationError(
      'O limite de saída do agente deve estar entre 64 e 128000 tokens.',
    );
  }

  return {
    ...config,
    provider,
    model,
    credentialRef,
    credentialIdentifier,
  };
}

export function validateOpenAiRuntimeConfig(
  config: AgentRuntimeConfig,
): OpenAiAgentRuntimeConfig {
  const validated = validateAgentRuntimeConfig(config);
  if (validated.provider !== OPENAI_PROVIDER) {
    throw validationError(
      'Esta configuração não pertence ao adapter OpenAI selecionado.',
    );
  }
  return { ...validated, provider: OPENAI_PROVIDER };
}

export function assertSafeCredentialReference(value: string): string {
  const normalized = value.trim();
  if (
    /^(sk-|sess-|Bearer\s)/iu.test(normalized) ||
    !CREDENTIAL_REFERENCE.test(normalized)
  ) {
    throw validationError(
      'A credencial deve ser uma referência server-side; nunca informe a API key diretamente.',
    );
  }
  return normalized;
}

export function canAgentCommunicateWithCustomer(type: LumeAgentType): boolean {
  return type === 'customer-service';
}

export function buildAgentPrompt(layers: AgentPromptLayers): string {
  const required = [
    ['SYSTEM PROMPT', layers.systemPrompt],
    ['PLATFORM AGENT PROMPT', layers.platformAgentPrompt],
    ['RUNTIME CONTEXT', layers.runtimeContext],
  ] as const;
  for (const [name, value] of required) {
    if (!value.trim()) throw validationError(`${name} não pode estar vazio.`);
  }

  const sections = [
    `<system>\n${layers.systemPrompt.trim()}\n</system>`,
    `<platform-agent version="${layers.platformPromptVersion}">\n${layers.platformAgentPrompt.trim()}\n</platform-agent>`,
  ];
  if (layers.tenantInstructions?.trim()) {
    if (layers.tenantInstructionsVersion === null) {
      throw validationError(
        'Instruções do tenant precisam de uma versão auditável.',
      );
    }
    sections.push(
      `<tenant-instructions version="${layers.tenantInstructionsVersion}">\n${layers.tenantInstructions.trim()}\n</tenant-instructions>`,
    );
  }
  sections.push(
    `<runtime-context>\n${layers.runtimeContext.trim()}\n</runtime-context>`,
  );
  return sections.join('\n\n');
}

export function assertToolInvocationAllowed(input: {
  readonly grantedCapabilities: readonly AgentAutonomyLevel[];
  readonly tool: AgentToolPolicy;
  readonly authorizationGranted: boolean;
  readonly sensitiveConfirmationContext?: string;
}): void {
  if (!input.grantedCapabilities.includes(input.tool.autonomy)) {
    throw validationError(
      `O agente não possui a capability exigida por ${input.tool.code}.`,
    );
  }
  if (input.tool.requiresAuthorization && !input.authorizationGranted) {
    throw validationError(
      'A autorização deve ocorrer antes de dados protegidos chegarem ao modelo.',
    );
  }
  if (input.tool.autonomy === 'sensitive-write') {
    const context = input.sensitiveConfirmationContext?.trim() ?? '';
    if (context.length < 20) {
      throw validationError(
        'A ação sensível exige confirmação contextual clara, não apenas um identificador.',
      );
    }
  }
}

export function createExecutionAttemptAudit(input: {
  readonly attempt: number;
  readonly runtime: AgentRuntimeConfig;
  readonly runtimeConfigVersion: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly errorCode?: string;
}): AgentExecutionAttemptAudit {
  const runtime = validateAgentRuntimeConfig(input.runtime);
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw validationError(
      'A tentativa de execução deve ser um inteiro positivo.',
    );
  }
  if (
    !Number.isInteger(input.runtimeConfigVersion) ||
    input.runtimeConfigVersion < 1
  ) {
    throw validationError(
      'A versão da configuração deve ser um inteiro positivo.',
    );
  }
  return {
    attempt: input.attempt,
    provider: runtime.provider,
    model: runtime.model,
    runtimeConfigVersion: input.runtimeConfigVersion,
    credentialIdentifier: runtime.credentialIdentifier,
    outcome: input.outcome,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

export function redactPotentialSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED_OPENAI_KEY]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/giu, '$1[REDACTED]')
    .replace(
      /(api[_-]?key\s*[:=]\s*)(?!\[REDACTED)[^\s,;]+/giu,
      '$1[REDACTED]',
    );
}
