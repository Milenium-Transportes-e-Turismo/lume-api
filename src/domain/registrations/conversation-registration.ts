import { validationError } from '../../core/errors/app-error';
import {
  isValidCnpj,
  isValidCpf,
} from '../../shared/utils/brazilian-documents';
import {
  normalizeEmail,
  normalizeTaxId,
  onlyDigits,
} from '../../shared/utils/normalization';

export type ConversationRegistrationKind = 'personal' | 'company';
export type RegistrationIdentityResolution =
  | { readonly status: 'unknown'; readonly registrationId: null }
  | { readonly status: 'resolved'; readonly registrationId: string }
  | { readonly status: 'ambiguous'; readonly registrationId: null };

export interface RegistrationIdentityCandidate {
  readonly registrationId: string;
  readonly confidence: number;
  readonly contextConfirmed: boolean;
}

export interface ConversationRegistrationDraft {
  readonly kind: ConversationRegistrationKind;
  readonly person: {
    readonly name: string;
    readonly cpf: string;
    readonly email?: string;
    readonly phone: string;
  };
  readonly company?: {
    readonly legalName: string;
    readonly cnpj: string;
  };
  readonly relationship?: {
    readonly type: string;
    readonly jobTitle?: string;
    readonly department?: string;
  };
  readonly confirmedByCustomer: boolean;
  readonly abandoned: boolean;
}

export type RegistrationConversationPersistenceDecision =
  | { readonly action: 'discard-draft'; readonly reason: string }
  | {
      readonly action: 'await-confirmation';
      readonly summary: readonly string[];
    }
  | {
      readonly action: 'persist-person';
      readonly normalized: Readonly<Record<string, string>>;
    }
  | {
      readonly action: 'persist-person-company-relationship';
      readonly normalized: Readonly<Record<string, string>>;
    };

export function resolveRegistrationIdentity(
  candidates: readonly RegistrationIdentityCandidate[],
): RegistrationIdentityResolution {
  const confirmed = candidates.filter(
    (candidate) => candidate.contextConfirmed,
  );
  if (confirmed.length === 1) {
    return { status: 'resolved', registrationId: confirmed[0].registrationId };
  }
  if (confirmed.length > 1)
    return { status: 'ambiguous', registrationId: null };
  if (candidates.length === 0)
    return { status: 'unknown', registrationId: null };

  const ordered = [...candidates].sort(
    (first, second) => second.confidence - first.confidence,
  );
  const [first, second] = ordered;
  if (
    first &&
    first.confidence >= 0.95 &&
    (!second || first.confidence - second.confidence >= 0.15)
  ) {
    return { status: 'resolved', registrationId: first.registrationId };
  }
  return { status: 'ambiguous', registrationId: null };
}

function normalizeDraft(
  draft: ConversationRegistrationDraft,
): Readonly<Record<string, string>> {
  const personName = draft.person.name.trim();
  const cpf = onlyDigits(draft.person.cpf);
  const phone = onlyDigits(draft.person.phone);
  if (personName.length < 2 || !isValidCpf(cpf)) {
    throw validationError(
      'Nome e CPF válidos são necessários para confirmar o cadastro pessoal.',
    );
  }
  if (phone.length < 10)
    throw validationError('Informe um telefone válido para o cadastro.');

  const normalized: Record<string, string> = {
    personName,
    cpf,
    phone,
  };
  if (draft.person.email?.trim())
    normalized.email = normalizeEmail(draft.person.email);

  if (draft.kind === 'company') {
    const company = draft.company;
    const relationship = draft.relationship;
    if (!company || !relationship) {
      throw validationError(
        'Cadastro empresarial exige empresa e vínculo da pessoa.',
      );
    }
    const cnpj = normalizeTaxId(company.cnpj);
    if (!isValidCnpj(cnpj) || company.legalName.trim().length < 2) {
      throw validationError(
        'Razão social e CNPJ válidos são necessários para a empresa.',
      );
    }
    if (!relationship.type.trim())
      throw validationError('Informe o vínculo com a empresa.');
    normalized.companyLegalName = company.legalName.trim();
    normalized.cnpj = cnpj;
    normalized.relationshipType = relationship.type.trim();
    if (relationship.jobTitle?.trim())
      normalized.jobTitle = relationship.jobTitle.trim();
    if (relationship.department?.trim()) {
      normalized.relationshipDepartment = relationship.department.trim();
    }
  }
  return normalized;
}

function customerSummary(
  normalized: Readonly<Record<string, string>>,
): readonly string[] {
  return [
    `Nome: ${normalized.personName}`,
    `CPF: ${normalized.cpf}`,
    ...(normalized.email ? [`E-mail: ${normalized.email}`] : []),
    `Telefone: ${normalized.phone}`,
    ...(normalized.companyLegalName
      ? [`Empresa: ${normalized.companyLegalName}`]
      : []),
    ...(normalized.cnpj ? [`CNPJ: ${normalized.cnpj}`] : []),
    ...(normalized.relationshipType
      ? [`Vínculo: ${normalized.relationshipType}`]
      : []),
  ];
}

export function decideConversationRegistrationPersistence(
  draft: ConversationRegistrationDraft,
): RegistrationConversationPersistenceDecision {
  if (draft.abandoned) {
    return {
      action: 'discard-draft',
      reason: 'O cliente desistiu; nenhum cadastro incompleto será persistido.',
    };
  }
  const normalized = normalizeDraft(draft);
  if (!draft.confirmedByCustomer) {
    return {
      action: 'await-confirmation',
      summary: customerSummary(normalized),
    };
  }
  return draft.kind === 'personal'
    ? { action: 'persist-person', normalized }
    : { action: 'persist-person-company-relationship', normalized };
}

export type RegistrationDivergenceDecision =
  | { readonly action: 'reject-immutable-change'; readonly field: string }
  | {
      readonly action: 'ask-explicit-confirmation';
      readonly field: string;
      readonly message: string;
    }
  | { readonly action: 'create-data-review'; readonly field: string }
  | { readonly action: 'no-change'; readonly field: string };

const ORGANIZATION_REVIEW_FIELDS = new Set([
  'cnpj',
  'legalName',
  'tradeName',
  'legalAddress',
  'legalRepresentative',
]);

export function decideRegistrationDivergence(input: {
  readonly registrationKind: ConversationRegistrationKind;
  readonly field: string;
  readonly existingValue: string | null;
  readonly proposedValue: string;
}): RegistrationDivergenceDecision {
  const proposed = input.proposedValue.trim();
  if (!proposed) throw validationError('O novo valor informado está vazio.');
  if ((input.existingValue ?? '').trim() === proposed) {
    return { action: 'no-change', field: input.field };
  }
  if (input.field === 'cpf') {
    return { action: 'reject-immutable-change', field: input.field };
  }
  if (
    input.registrationKind === 'company' &&
    ORGANIZATION_REVIEW_FIELDS.has(input.field)
  ) {
    return { action: 'create-data-review', field: input.field };
  }
  const label = input.field === 'email' ? 'e-mail' : input.field;
  return {
    action: 'ask-explicit-confirmation',
    field: input.field,
    message: `Encontrei uma divergência no ${label}. Posso substituir pelo novo valor informado?`,
  };
}

export function relationshipGrantsAuthorization(): false {
  return false;
}
