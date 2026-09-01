import { validationError } from '../../core/errors/app-error';
import { isValidCpf } from '../../shared/utils/brazilian-documents';
import { normalizeCpf, normalizeEmail } from '../../shared/utils/normalization';

export const LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING =
  'legacy-access-scope-not-person-association' as const;

export interface UserPersonMatchSubject {
  readonly userId: string;
  readonly companyId: string;
  readonly cpf: string | null;
  readonly email: string | null;
}

export interface UserPersonMatchCandidate {
  readonly registrationId: string;
  readonly companyId: string;
  readonly type: 'pf' | 'pj';
  readonly cpf: string | null;
  readonly emails: readonly string[];
}

export interface UserPersonEmailSuggestion {
  readonly registrationId: string;
  readonly rule: 'exact-email';
}

interface UserPersonMatchDecisionBase {
  readonly emailSuggestions: readonly UserPersonEmailSuggestion[];
}

export type UserPersonMatchDecision =
  | (UserPersonMatchDecisionBase & {
      readonly decision: 'automatic';
      readonly personRegistrationId: string;
      readonly rule: 'unique-exact-cpf';
    })
  | (UserPersonMatchDecisionBase & {
      readonly decision: 'provisional';
      readonly reason:
        'cpf-not-informed' | 'invalid-cpf' | 'no-exact-cpf-match';
    })
  | (UserPersonMatchDecisionBase & {
      readonly decision: 'conflict';
      readonly reason:
        'multiple-exact-cpf-matches' | 'cpf-associated-with-non-person';
      readonly conflictingRegistrationIds: readonly string[];
    });

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`Informe ${label}.`);
  return normalized;
}

function uniqueCandidates(
  values: readonly UserPersonMatchCandidate[],
): UserPersonMatchCandidate[] {
  const byId = new Map<string, UserPersonMatchCandidate>();
  for (const candidate of values) {
    const registrationId = requiredId(
      candidate.registrationId,
      'o identificador do Cadastro candidato',
    );
    const existing = byId.get(registrationId);
    if (
      existing &&
      (existing.companyId !== candidate.companyId ||
        existing.type !== candidate.type ||
        normalizeCpf(existing.cpf) !== normalizeCpf(candidate.cpf))
    ) {
      throw validationError(
        'O mesmo Cadastro candidato foi informado com identidades diferentes.',
      );
    }
    byId.set(registrationId, { ...candidate, registrationId });
  }
  return [...byId.values()];
}

function emailSuggestions(
  subject: UserPersonMatchSubject,
  candidates: readonly UserPersonMatchCandidate[],
): UserPersonEmailSuggestion[] {
  const email = subject.email ? normalizeEmail(subject.email) : '';
  if (!email) return [];

  return candidates
    .filter(
      (candidate) =>
        candidate.companyId === subject.companyId &&
        candidate.type === 'pf' &&
        candidate.emails.some(
          (candidateEmail) => normalizeEmail(candidateEmail) === email,
        ),
    )
    .map((candidate) => ({
      registrationId: candidate.registrationId,
      rule: 'exact-email' as const,
    }))
    .sort((left, right) =>
      left.registrationId.localeCompare(right.registrationId),
    );
}

/**
 * Decide somente se um Usuário pode ser associado automaticamente a uma
 * Pessoa. E-mail permanece evidência para revisão e nunca promove associação.
 */
export function decideUserPersonMatch(input: {
  readonly subject: UserPersonMatchSubject;
  readonly candidates: readonly UserPersonMatchCandidate[];
}): UserPersonMatchDecision {
  requiredId(input.subject.userId, 'o identificador do Usuário');
  requiredId(input.subject.companyId, 'o identificador do tenant');

  const candidates = uniqueCandidates(input.candidates).filter(
    (candidate) => candidate.companyId === input.subject.companyId,
  );
  const suggestions = emailSuggestions(input.subject, candidates);
  const cpf = normalizeCpf(input.subject.cpf);

  if (!cpf) {
    return {
      decision: 'provisional',
      reason: 'cpf-not-informed',
      emailSuggestions: suggestions,
    };
  }
  if (!isValidCpf(cpf)) {
    return {
      decision: 'provisional',
      reason: 'invalid-cpf',
      emailSuggestions: suggestions,
    };
  }

  const exactCpfMatches = candidates.filter((candidate) => {
    const candidateCpf = normalizeCpf(candidate.cpf);
    return candidateCpf === cpf && isValidCpf(candidateCpf);
  });
  const nonPersonMatches = exactCpfMatches.filter(
    (candidate) => candidate.type !== 'pf',
  );
  if (nonPersonMatches.length > 0) {
    return {
      decision: 'conflict',
      reason: 'cpf-associated-with-non-person',
      conflictingRegistrationIds: exactCpfMatches
        .map((candidate) => candidate.registrationId)
        .sort(),
      emailSuggestions: suggestions,
    };
  }

  if (exactCpfMatches.length > 1) {
    return {
      decision: 'conflict',
      reason: 'multiple-exact-cpf-matches',
      conflictingRegistrationIds: exactCpfMatches
        .map((candidate) => candidate.registrationId)
        .sort(),
      emailSuggestions: suggestions,
    };
  }
  if (exactCpfMatches.length === 1) {
    return {
      decision: 'automatic',
      personRegistrationId: exactCpfMatches[0].registrationId,
      rule: 'unique-exact-cpf',
      emailSuggestions: suggestions,
    };
  }

  return {
    decision: 'provisional',
    reason: 'no-exact-cpf-match',
    emailSuggestions: suggestions,
  };
}
