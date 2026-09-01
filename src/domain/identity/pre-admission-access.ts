import { forbidden } from '../../core/errors/app-error';

export const PRE_ADMISSION_DEFAULT_VALIDITY_DAYS = 30;

export type PreAdmissionAccessStatus = 'active' | 'expired' | 'revoked';

export const PRE_ADMISSION_MANAGEMENT_DEPARTMENTS = [
  'human-resources',
  'personnel-department',
] as const;

type PreAdmissionManagementAuthority = {
  readonly departments: readonly string[];
  readonly permissions: readonly string[];
};

export function canManagePreAdmission(
  authority: PreAdmissionManagementAuthority,
): boolean {
  return (
    PRE_ADMISSION_MANAGEMENT_DEPARTMENTS.some((department) =>
      authority.departments.includes(department),
    ) && authority.permissions.includes('documents:manage')
  );
}

export function assertCanManagePreAdmission(
  authority: PreAdmissionManagementAuthority,
): void {
  if (!canManagePreAdmission(authority)) {
    throw forbidden(
      'Somente RH ou Departamento Pessoal com permissão específica de gestão documental pode administrar acessos de pré-admissão.',
    );
  }
}

export function preAdmissionExpiresAt(now: Date): Date {
  return new Date(
    now.getTime() + PRE_ADMISSION_DEFAULT_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function preAdmissionStatus(input: {
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly now: Date;
}): PreAdmissionAccessStatus {
  if (input.revokedAt) return 'revoked';
  if (input.expiresAt.getTime() <= input.now.getTime()) return 'expired';
  return 'active';
}
