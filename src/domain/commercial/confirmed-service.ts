import { forbidden, validationError } from '../../core/errors/app-error';

export const LEGACY_PRIMARY_SERVICE_ITEM_KEY = 'legacy-primary' as const;
export const COMMERCIAL_SERVICE_REQUIREMENT_KINDS = [
  'financial',
  'operational',
] as const;

export type CommercialServiceRequirementKind =
  (typeof COMMERCIAL_SERVICE_REQUIREMENT_KINDS)[number];

export function assertCanConfirmCommercialService(authority: {
  readonly departments: readonly string[];
  readonly permissions: readonly string[];
}): void {
  if (
    !authority.departments.includes('commercial') ||
    !authority.permissions.includes('commercial:manage')
  ) {
    throw forbidden(
      'Somente o Comercial com permissão de gestão pode confirmar um serviço.',
    );
  }
}

export function normalizeCommercialServiceRequirementKind(
  value: string,
): CommercialServiceRequirementKind {
  if (
    !COMMERCIAL_SERVICE_REQUIREMENT_KINDS.includes(
      value as CommercialServiceRequirementKind,
    )
  ) {
    throw validationError('O requisito deve ser financeiro ou operacional.');
  }
  return value as CommercialServiceRequirementKind;
}

export function assertCanAttestCommercialServiceRequirement(
  authority: {
    readonly departments: readonly string[];
    readonly permissions: readonly string[];
  },
  kind: CommercialServiceRequirementKind,
): void {
  const allowed =
    kind === 'financial'
      ? authority.departments.includes('financial') &&
        authority.permissions.includes('financial:approve')
      : authority.departments.includes('operations') &&
        authority.permissions.includes('operations:manage');
  if (!allowed) {
    throw forbidden(
      kind === 'financial'
        ? 'Somente o Financeiro com permissão de aprovação pode confirmar o requisito financeiro.'
        : 'Somente o Operacional com permissão de gestão pode validar o requisito operacional.',
    );
  }
}

export function assertCanViewCommercialServiceReadiness(authority: {
  readonly departments: readonly string[];
  readonly permissions: readonly string[];
}): void {
  const allowed = [
    ['commercial', 'commercial:view'],
    ['commercial', 'commercial:manage'],
    ['financial', 'financial:view'],
    ['financial', 'financial:approve'],
    ['operations', 'operations:view'],
    ['operations', 'operations:manage'],
  ].some(
    ([department, permission]) =>
      authority.departments.includes(department) &&
      authority.permissions.includes(permission),
  );
  if (!allowed) {
    throw forbidden(
      'Somente as áreas Comercial, Financeira ou Operacional autorizadas podem consultar a confirmação.',
    );
  }
}

export function normalizeConfirmationBasis(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw validationError(
      'Informe o fundamento da confirmação, entre 3 e 500 caracteres.',
    );
  }
  return normalized;
}

export function normalizeCommercialServiceRequirementEvidence(
  value: string,
): string {
  const evidence = value.trim().replace(/\s+/g, ' ');
  if (evidence.length < 3 || evidence.length > 500) {
    throw validationError(
      'Informe a evidência do requisito, entre 3 e 500 caracteres.',
    );
  }
  return evidence;
}

export function assertExpectedAcceptedQuoteVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError('expectedVersion deve ser maior ou igual a um.');
  }
}
