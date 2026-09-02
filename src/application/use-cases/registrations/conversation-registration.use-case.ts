import { randomUUID } from 'node:crypto';

import {
  CONVERSATION_RELATIONSHIP_TYPES,
  ConversationIdentityResolver,
  ConversationRegistrationRepository,
  type ConversationRegistrationPatch,
  type PersonalDivergenceDecision,
  type RegistrationDataReviewStatus,
} from '../../contracts/conversation-registration.repository';
import { validationError } from '../../../core/errors/app-error';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TEXT = 200;

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) throw validationError(`${label} é inválido.`);
  return normalized;
}

function version(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${label} deve ser uma versão positiva.`);
  }
  return value;
}

function text(
  value: string | null | undefined,
  label: string,
  nullable = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    if (nullable) return null;
    throw validationError(`${label} não pode ser nulo.`);
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > MAX_TEXT) {
    throw validationError(`${label} é inválido.`);
  }
  return normalized;
}

function source<T extends object>(
  input: T & {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
  },
): T & {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly whatsappContactId: string;
  readonly agentExecutionId: string | null;
} {
  return {
    ...input,
    companyId: identifier(input.companyId, 'O tenant'),
    serviceSessionId: identifier(
      input.serviceSessionId,
      'A sessão de atendimento',
    ),
    whatsappContactId: identifier(
      input.whatsappContactId,
      'O contato do WhatsApp',
    ),
    agentExecutionId: input.agentExecutionId
      ? identifier(input.agentExecutionId, 'A execução do agente')
      : null,
  };
}

function patch(
  input: ConversationRegistrationPatch,
): ConversationRegistrationPatch {
  if (!input.person && !input.company && !input.relationship) {
    throw validationError('Informe ao menos um campo do draft para atualizar.');
  }
  const relationshipType = input.relationship?.type;
  if (
    relationshipType &&
    !CONVERSATION_RELATIONSHIP_TYPES.includes(relationshipType)
  ) {
    throw validationError('O tipo de vínculo informado é inválido.');
  }
  return {
    ...(input.person
      ? {
          person: {
            ...(input.person.name !== undefined
              ? { name: text(input.person.name, 'O nome')! }
              : {}),
            ...(input.person.cpf !== undefined
              ? { cpf: text(input.person.cpf, 'O CPF')! }
              : {}),
            ...(input.person.email !== undefined
              ? {
                  email: text(input.person.email, 'O e-mail', true) as
                    string | null,
                }
              : {}),
            ...(input.person.phone !== undefined
              ? { phone: text(input.person.phone, 'O telefone')! }
              : {}),
          },
        }
      : {}),
    ...(input.company
      ? {
          company: {
            ...(input.company.legalName !== undefined
              ? { legalName: text(input.company.legalName, 'A razão social')! }
              : {}),
            ...(input.company.cnpj !== undefined
              ? { cnpj: text(input.company.cnpj, 'O CNPJ')! }
              : {}),
          },
        }
      : {}),
    ...(input.relationship
      ? {
          relationship: {
            ...(relationshipType ? { type: relationshipType } : {}),
            ...(input.relationship.jobTitle !== undefined
              ? {
                  jobTitle: text(
                    input.relationship.jobTitle,
                    'O cargo',
                    true,
                  ) as string | null,
                }
              : {}),
            ...(input.relationship.department !== undefined
              ? {
                  department: text(
                    input.relationship.department,
                    'O departamento',
                    true,
                  ) as string | null,
                }
              : {}),
          },
        }
      : {}),
  };
}

export class IdentifyConversationParticipantUseCase extends ConversationIdentityResolver {
  constructor(private readonly repository: ConversationRegistrationRepository) {
    super();
  }

  resolveBeforeResponse(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }) {
    return this.repository.resolveIdentity({
      companyId: identifier(input.companyId, 'O tenant'),
      serviceSessionId: identifier(
        input.serviceSessionId,
        'A sessão de atendimento',
      ),
    });
  }
}

export class ConversationRegistrationUseCase {
  constructor(
    private readonly repository: ConversationRegistrationRepository,
  ) {}

  start(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly commandId: string;
    readonly kind: 'personal' | 'company';
  }) {
    return this.repository.startDraft({
      ...source(input),
      commandId: identifier(input.commandId, 'O comando'),
      kind: input.kind,
    });
  }

  update(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly commandId: string;
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly patch: ConversationRegistrationPatch;
  }) {
    return this.repository.updateDraft({
      ...source(input),
      commandId: identifier(input.commandId, 'O comando'),
      draftId: identifier(input.draftId, 'O draft'),
      expectedDraftVersion: version(input.expectedDraftVersion, 'O draft')!,
      patch: patch(input.patch),
    });
  }

  read(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly draftId: string;
  }) {
    return this.repository.readDraftState({
      ...source(input),
      draftId: identifier(input.draftId, 'O draft'),
    });
  }

  preview(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly draftId: string;
  }) {
    return this.repository.previewDraft({
      ...source(input),
      draftId: identifier(input.draftId, 'O draft'),
    });
  }

  confirm(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly commandId: string;
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly customerConfirmedFinalSummary: boolean;
    readonly fieldDecisions?: Readonly<
      Partial<Record<'name' | 'email' | 'phone', PersonalDivergenceDecision>>
    >;
  }) {
    if (!input.customerConfirmedFinalSummary) {
      throw validationError(
        'A confirmação final explícita do cliente é obrigatória.',
      );
    }
    return this.repository.confirmDraft({
      ...source(input),
      commandId: identifier(input.commandId, 'O comando'),
      draftId: identifier(input.draftId, 'O draft'),
      expectedDraftVersion: version(input.expectedDraftVersion, 'O draft')!,
      customerConfirmedFinalSummary: true,
      fieldDecisions: input.fieldDecisions ?? {},
    });
  }

  abandon(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly whatsappContactId: string;
    readonly agentExecutionId?: string | null;
    readonly commandId: string;
    readonly draftId?: string | null;
    readonly expectedDraftVersion?: number | null;
  }) {
    return this.repository.abandonDraft({
      ...source(input),
      commandId: identifier(input.commandId, 'O comando'),
      draftId: input.draftId ? identifier(input.draftId, 'O draft') : null,
      expectedDraftVersion: version(
        input.expectedDraftVersion ?? null,
        'O draft',
      ),
    });
  }

  /** A refusal is a valid outcome and must never gate quote continuation. */
  declineWithoutDraft() {
    return {
      draftId: null,
      status: 'declined' as const,
      incompleteRegistrationPersisted: false as const,
      registrationRequiredForQuote: false as const,
      continueOriginalDemand: true as const,
    };
  }
}

export class RegistrationDataReviewUseCase {
  constructor(
    private readonly repository: ConversationRegistrationRepository,
  ) {}

  list(companyId: string, status?: RegistrationDataReviewStatus) {
    return this.repository.listDataReviews({
      companyId: identifier(companyId, 'O tenant'),
      ...(status ? { status } : {}),
    });
  }

  decide(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly reviewId: string;
    readonly decision: 'approved' | 'rejected';
    readonly reason?: string | null;
  }) {
    return this.repository.decideDataReview({
      companyId: identifier(input.companyId, 'O tenant'),
      actorUserId: identifier(input.actorUserId, 'O usuário'),
      commandId: identifier(input.commandId, 'O comando'),
      reviewId: identifier(input.reviewId, 'A revisão'),
      decision: input.decision,
      reason:
        input.reason === undefined || input.reason === null
          ? null
          : (text(input.reason, 'O motivo', true) ?? null),
    });
  }
}

/** Stable command ids for server-owned tool executors that need one. */
export function newRegistrationConversationCommandId(): string {
  return randomUUID();
}
