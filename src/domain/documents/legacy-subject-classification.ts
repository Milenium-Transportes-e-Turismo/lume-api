import { validationError } from '../../core/errors/app-error';
import { isValidCpf } from '../../shared/utils/brazilian-documents';
import { normalizeCpf } from '../../shared/utils/normalization';
import {
  DOCUMENT_REQUEST_CONTEXTS,
  type DocumentRequestContext,
} from './document-workflow';

export interface LegacyPersonSubjectRule {
  readonly documentTypeCode: string;
  readonly requestContexts: readonly DocumentRequestContext[];
}

const PERSON_DOCUMENT_CONTEXTS = [
  'admission',
  'document-update',
  'document-renewal',
  'regularization',
  'offboarding',
] as const satisfies readonly DocumentRequestContext[];

/**
 * Lista branca deliberadamente curta. Tipos familiares, comprovantes e
 * certidões ficam fora porque podem pertencer a outra pessoa ou entidade.
 */
export const LEGACY_PERSON_SUBJECT_WHITELIST = [
  { documentTypeCode: 'cpf', requestContexts: PERSON_DOCUMENT_CONTEXTS },
  { documentTypeCode: 'rg', requestContexts: PERSON_DOCUMENT_CONTEXTS },
  { documentTypeCode: 'cnh', requestContexts: PERSON_DOCUMENT_CONTEXTS },
  { documentTypeCode: 'ctps', requestContexts: PERSON_DOCUMENT_CONTEXTS },
  { documentTypeCode: 'pis-card', requestContexts: PERSON_DOCUMENT_CONTEXTS },
  {
    documentTypeCode: 'voter-registration',
    requestContexts: PERSON_DOCUMENT_CONTEXTS,
  },
] as const satisfies readonly LegacyPersonSubjectRule[];

export type LegacyPersonAssociationStatus =
  'confirmed' | 'provisional' | 'missing' | 'conflict';

export interface LegacyPersonAssociation {
  readonly status: LegacyPersonAssociationStatus;
  readonly personRegistrationId?: string | null;
  readonly personCpf?: string | null;
}

export interface LegacySubjectClassificationInput {
  readonly documentTypeCode: string;
  readonly requestContext: DocumentRequestContext;
  readonly personAssociation: LegacyPersonAssociation;
  readonly documentCpf?: string | null;
  readonly repeatableByDependent: boolean | 'unknown';
  readonly hasMultiplePotentialSubjects: boolean | 'unknown';
}

export type LegacySubjectUnclassifiedReason =
  | 'document-type-or-context-not-whitelisted'
  | 'subject-ambiguity-not-evaluated'
  | 'repeatable-by-dependent'
  | 'multiple-potential-subjects'
  | 'person-association-not-confirmed'
  | 'person-association-conflict'
  | 'missing-person-registration-id'
  | 'missing-person-cpf-evidence'
  | 'invalid-cpf-evidence'
  | 'cpf-evidence-mismatch';

export type LegacySubjectClassification =
  | {
      readonly classification: 'person';
      readonly personRegistrationId: string;
      readonly rule: 'legacy-person-subject-v1';
    }
  | {
      readonly classification: 'legacy-unclassified';
      readonly reason: LegacySubjectUnclassifiedReason;
    };

function legacyUnclassified(
  reason: LegacySubjectUnclassifiedReason,
): LegacySubjectClassification {
  return { classification: 'legacy-unclassified', reason };
}

function isWhitelisted(
  documentTypeCode: string,
  requestContext: DocumentRequestContext,
): boolean {
  return LEGACY_PERSON_SUBJECT_WHITELIST.some(
    (rule) =>
      rule.documentTypeCode === documentTypeCode &&
      rule.requestContexts.some((context) => context === requestContext),
  );
}

/**
 * Classifica apenas o subconjunto do legado cuja titularidade é inequívoca.
 * Ausência, conflito ou sinal contraditório preserva o documento para revisão.
 */
export function classifyLegacyDocumentSubject(
  input: LegacySubjectClassificationInput,
): LegacySubjectClassification {
  if (
    !DOCUMENT_REQUEST_CONTEXTS.some((value) => value === input.requestContext)
  ) {
    throw validationError('Informe um contexto documental válido.');
  }

  const documentTypeCode = input.documentTypeCode.trim();
  if (!isWhitelisted(documentTypeCode, input.requestContext)) {
    return legacyUnclassified('document-type-or-context-not-whitelisted');
  }
  if (
    input.repeatableByDependent === 'unknown' ||
    input.hasMultiplePotentialSubjects === 'unknown'
  ) {
    return legacyUnclassified('subject-ambiguity-not-evaluated');
  }
  if (input.repeatableByDependent) {
    return legacyUnclassified('repeatable-by-dependent');
  }
  if (input.hasMultiplePotentialSubjects === true) {
    return legacyUnclassified('multiple-potential-subjects');
  }
  if (input.personAssociation.status === 'conflict') {
    return legacyUnclassified('person-association-conflict');
  }
  if (input.personAssociation.status !== 'confirmed') {
    return legacyUnclassified('person-association-not-confirmed');
  }

  const personRegistrationId =
    input.personAssociation.personRegistrationId?.trim() ?? '';
  if (!personRegistrationId) {
    return legacyUnclassified('missing-person-registration-id');
  }

  const personCpf = normalizeCpf(input.personAssociation.personCpf);
  if (!personCpf) {
    return legacyUnclassified('missing-person-cpf-evidence');
  }
  const documentCpf = normalizeCpf(input.documentCpf);
  if (!isValidCpf(personCpf) || (documentCpf && !isValidCpf(documentCpf))) {
    return legacyUnclassified('invalid-cpf-evidence');
  }
  if (documentCpf && personCpf && documentCpf !== personCpf) {
    return legacyUnclassified('cpf-evidence-mismatch');
  }

  return {
    classification: 'person',
    personRegistrationId,
    rule: 'legacy-person-subject-v1',
  };
}
