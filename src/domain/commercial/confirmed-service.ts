import { forbidden, validationError } from '../../core/errors/app-error';
import type { PermissionCode } from '../access/access.constants';
import {
  canExercisePermission,
  hasTenantWideAuthority,
} from '../access/tenant-authority';

export const LEGACY_PRIMARY_SERVICE_ITEM_KEY = 'legacy-primary' as const;
export const COMMERCIAL_SERVICE_REQUIREMENT_KINDS = [
  'financial',
  'operational',
] as const;
export const COMMERCIAL_SERVICE_REQUIREMENT_OUTCOMES = [
  'SATISFIED',
  'NOT_APPLICABLE',
] as const;

export type CommercialServiceRequirementKind =
  (typeof COMMERCIAL_SERVICE_REQUIREMENT_KINDS)[number];
export type CommercialServiceRequirementOutcome =
  (typeof COMMERCIAL_SERVICE_REQUIREMENT_OUTCOMES)[number];

interface CommercialServiceAuthority {
  readonly isAdministrator?: boolean;
  readonly departments: readonly string[];
  readonly permissionCodes?: readonly string[];
  readonly permissions: readonly string[];
  readonly documentAccessMode?: string;
}

function normalizedAuthorityDepartments(
  authority: CommercialServiceAuthority,
): readonly string[] {
  return authority.departments.map((department) =>
    department.toLowerCase().replaceAll('_', '-'),
  );
}

function hasElevatedTenantAuthority(
  authority: CommercialServiceAuthority,
): boolean {
  const departments = normalizedAuthorityDepartments(authority);
  const isAdministrator = authority.isAdministrator === true;
  return (
    isAdministrator ||
    (departments.includes('directorate') &&
      hasTenantWideAuthority({
        ...authority,
        departments,
        isAdministrator: false,
      }))
  );
}

function canExerciseCommercialPermission(
  authority: CommercialServiceAuthority,
  permission: PermissionCode,
): boolean {
  return canExercisePermission(
    {
      ...authority,
      isAdministrator: authority.isAdministrator === true,
      departments: normalizedAuthorityDepartments(authority),
    },
    permission,
  );
}

export function assertCanConfirmCommercialService(
  authority: CommercialServiceAuthority,
): void {
  if (hasElevatedTenantAuthority(authority)) return;
  const departments = normalizedAuthorityDepartments(authority);
  if (
    !departments.includes('commercial') ||
    !canExerciseCommercialPermission(authority, 'commercial:manage')
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
  authority: CommercialServiceAuthority,
  kind: CommercialServiceRequirementKind,
): void {
  if (hasElevatedTenantAuthority(authority)) return;
  const departments = normalizedAuthorityDepartments(authority);
  const allowed =
    kind === 'financial'
      ? departments.includes('financial') &&
        canExerciseCommercialPermission(authority, 'financial:approve')
      : departments.includes('operations') &&
        canExerciseCommercialPermission(authority, 'operations:manage');
  if (!allowed) {
    throw forbidden(
      kind === 'financial'
        ? 'Somente o Financeiro com permissão de aprovação pode confirmar o requisito financeiro.'
        : 'Somente o Operacional com permissão de gestão pode validar o requisito operacional.',
    );
  }
}

export function assertCanMarkCommercialServiceRequirementNotApplicable(
  authority: CommercialServiceAuthority & { readonly isAdministrator: boolean },
): void {
  if (authority.isAdministrator || hasElevatedTenantAuthority(authority)) {
    return;
  }
  const departments = normalizedAuthorityDepartments(authority);
  if (
    !departments.includes('management') ||
    !canExerciseCommercialPermission(authority, 'service-confirmations:approve')
  ) {
    throw forbidden(
      'Somente Gerência autorizada, Diretoria com autoridade ampla ou Administração pode marcar um requisito como não aplicável.',
    );
  }
}

export function assertCanViewCommercialServiceReadiness(
  authority: CommercialServiceAuthority,
): void {
  if (hasElevatedTenantAuthority(authority)) return;
  const departments = normalizedAuthorityDepartments(authority);
  const allowed = (
    [
      ['commercial', 'commercial:view'],
      ['commercial', 'commercial:manage'],
      ['financial', 'financial:view'],
      ['financial', 'financial:approve'],
      ['operations', 'operations:view'],
      ['operations', 'operations:manage'],
    ] as const
  ).some(
    ([department, permission]) =>
      departments.includes(department) &&
      canExerciseCommercialPermission(authority, permission),
  );
  if (
    !allowed &&
    !canExerciseCommercialPermission(authority, 'service-confirmations:approve')
  ) {
    throw forbidden(
      'Somente as áreas Comercial, Financeira, Operacional ou autoridades da confirmação podem consultar a prontidão.',
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

export function normalizeCommercialServiceRequirementReason(
  value: string,
): string {
  const reason = value.trim().replace(/\s+/g, ' ');
  if (reason.length < 3 || reason.length > 500) {
    throw validationError(
      'Informe o motivo do requisito não aplicável, entre 3 e 500 caracteres.',
    );
  }
  return reason;
}

export function assertExpectedAcceptedQuoteVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError('expectedVersion deve ser maior ou igual a um.');
  }
}
