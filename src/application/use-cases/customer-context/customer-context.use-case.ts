import {
  CUSTOMER_PROFILE_KEYS,
  CustomerContextRepository,
  CustomerContextResolver,
  type CustomerContextAudience,
  type CustomerContextDetailSection,
  type CustomerProfileKey,
  type CustomerProfileSuggestionStatus,
} from '../../contracts/customer-context.repository';
import { validationError } from '../../../core/errors/app-error';
import {
  buildBoundedCustomerModelContext,
  normalizeCustomerProfileSuggestion,
} from '../../../domain/customer-context/customer-context-policy';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DETAIL_SECTIONS = [
  'relationships',
  'profile',
  'services',
  'quotes',
  'pending',
] as const;
const SUGGESTION_STATUSES = ['pending', 'approved', 'ignored'] as const;

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) throw validationError(`${label} é inválido.`);
  return normalized;
}

function optionalIdentifier(
  value: string | null | undefined,
  label: string,
): string | null {
  return value ? identifier(value, label) : null;
}

function command(value: string): string {
  return identifier(value, 'O comando');
}

function limit(value: number | undefined, maximum = 50): number {
  const normalized = value ?? 20;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw validationError(`O limite deve estar entre 1 e ${maximum}.`);
  }
  return normalized;
}

function profileKey(value: CustomerProfileKey): CustomerProfileKey {
  if (!CUSTOMER_PROFILE_KEYS.includes(value)) {
    throw validationError('A chave de perfil sugerida não é permitida.');
  }
  return value;
}

function section(value: CustomerContextDetailSection) {
  if (!DETAIL_SECTIONS.includes(value)) {
    throw validationError('A seção de contexto solicitada é inválida.');
  }
  return value;
}

function status(value?: CustomerProfileSuggestionStatus) {
  if (value && !SUGGESTION_STATUSES.includes(value)) {
    throw validationError('O status de sugestão é inválido.');
  }
  return value;
}

function reviewDate(value: string): Date {
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.valueOf()) ||
    !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)
  ) {
    throw validationError('expectedUpdatedAt deve ser um instante com fuso.');
  }
  return parsed;
}

export class CustomerContextUseCase extends CustomerContextResolver {
  constructor(private readonly repository: CustomerContextRepository) {
    super();
  }

  async resolveForAgent(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }) {
    const summary = await this.repository.loadSummary({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      audience: 'agent',
    });
    const bounded = buildBoundedCustomerModelContext(summary);
    return {
      ...bounded,
      approvedProfileItemCount: summary.approvedProfile.length,
    };
  }

  summary(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: CustomerContextAudience;
  }) {
    return this.repository.loadSummary({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      audience: input.audience,
    });
  }

  details(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: CustomerContextAudience;
    readonly section: CustomerContextDetailSection;
    readonly limit?: number;
  }) {
    return this.repository.loadDetails({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      audience: input.audience,
      section: section(input.section),
      limit: limit(input.limit),
    });
  }

  suggestFromAgent(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentExecutionId: string;
    readonly serviceIdentityId: string;
    readonly commandId: string;
    readonly profileKey: CustomerProfileKey;
    readonly suggestedValue: string;
    readonly rationale?: string | null;
    readonly evidenceMessageId?: string | null;
  }) {
    const suggestion = normalizeCustomerProfileSuggestion({
      profileKey: profileKey(input.profileKey),
      suggestedValue: input.suggestedValue,
      rationale: input.rationale,
    });
    return this.repository.createSuggestion({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      commandId: command(input.commandId),
      actor: {
        type: 'agent',
        agentExecutionId: identifier(
          input.agentExecutionId,
          'A execução do agente',
        ),
        serviceIdentityId: identifier(
          input.serviceIdentityId,
          'A identidade de serviço',
        ),
      },
      ...suggestion,
      evidenceMessageId: optionalIdentifier(
        input.evidenceMessageId,
        'A mensagem de evidência',
      ),
    });
  }

  /** In-process path used only by the audited AgentFunctionToolExecutor. */
  suggestFromRuntime(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly agentExecutionId: string;
    readonly commandId: string;
    readonly profileKey: CustomerProfileKey;
    readonly suggestedValue: string;
    readonly rationale?: string | null;
    readonly evidenceMessageId?: string | null;
  }) {
    const suggestion = normalizeCustomerProfileSuggestion({
      profileKey: profileKey(input.profileKey),
      suggestedValue: input.suggestedValue,
      rationale: input.rationale,
    });
    return this.repository.createSuggestion({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      commandId: command(input.commandId),
      actor: {
        type: 'agent-runtime',
        agentExecutionId: identifier(
          input.agentExecutionId,
          'A execução do agente',
        ),
      },
      ...suggestion,
      evidenceMessageId: optionalIdentifier(
        input.evidenceMessageId,
        'A mensagem de evidência',
      ),
    });
  }

  suggestFromHuman(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly profileKey: CustomerProfileKey;
    readonly suggestedValue: string;
    readonly rationale?: string | null;
    readonly evidenceMessageId?: string | null;
  }) {
    const suggestion = normalizeCustomerProfileSuggestion({
      profileKey: profileKey(input.profileKey),
      suggestedValue: input.suggestedValue,
      rationale: input.rationale,
    });
    return this.repository.createSuggestion({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
      commandId: command(input.commandId),
      actor: {
        type: 'human',
        userId: identifier(input.actorUserId, 'O usuário'),
      },
      ...suggestion,
      evidenceMessageId: optionalIdentifier(
        input.evidenceMessageId,
        'A mensagem de evidência',
      ),
    });
  }

  listSuggestions(input: {
    readonly companyId: string;
    readonly status?: CustomerProfileSuggestionStatus;
    readonly serviceSessionId?: string;
    readonly limit?: number;
  }) {
    return this.repository.listSuggestions({
      companyId: identifier(input.companyId, 'O tenant'),
      ...(status(input.status) ? { status: input.status } : {}),
      ...(input.serviceSessionId
        ? {
            serviceSessionId: identifier(
              input.serviceSessionId,
              'A sessão de atendimento',
            ),
          }
        : {}),
      limit: limit(input.limit, 100),
    });
  }

  decide(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly suggestionId: string;
    readonly expectedUpdatedAt: string;
    readonly decision: 'approved' | 'ignored';
    readonly reason?: string | null;
  }) {
    const reason = input.reason?.replace(/\s+/gu, ' ').trim() || null;
    if (reason && reason.length > 500) {
      throw validationError('O motivo da decisão excede 500 caracteres.');
    }
    if (input.decision === 'ignored' && !reason) {
      throw validationError('Informe o motivo para ignorar a sugestão.');
    }
    return this.repository.decideSuggestion({
      companyId: identifier(input.companyId, 'O tenant'),
      actorUserId: identifier(input.actorUserId, 'O usuário'),
      commandId: command(input.commandId),
      suggestionId: identifier(input.suggestionId, 'A sugestão'),
      expectedUpdatedAt: reviewDate(input.expectedUpdatedAt),
      decision: input.decision,
      reason,
    });
  }
}
