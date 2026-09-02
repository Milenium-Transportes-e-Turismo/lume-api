import { forbidden } from '../../core/errors/app-error';
import {
  canExercisePermission,
  hasTenantWideAuthority,
} from '../access/tenant-authority';

export const PRE_ADMISSION_DEFAULT_VALIDITY_DAYS = 30;

export type PreAdmissionAccessStatus = 'active' | 'expired' | 'revoked';

export const PRE_ADMISSION_MANAGEMENT_DEPARTMENTS = [
  'human-resources',
  'personnel-department',
] as const;

type PreAdmissionManagementAuthority = {
  readonly isAdministrator: boolean;
  readonly departments: readonly string[];
  readonly permissionCodes?: readonly string[];
  readonly permissions: readonly string[];
  readonly documentAccessMode?: string;
};

export function canManagePreAdmission(
  authority: PreAdmissionManagementAuthority,
): boolean {
  if (
    hasTenantWideAuthority(authority) &&
    canExercisePermission(authority, 'documents:manage') &&
    (authority.isAdministrator || authority.departments.includes('directorate'))
  ) {
    return true;
  }
  return (
    PRE_ADMISSION_MANAGEMENT_DEPARTMENTS.some((department) =>
      authority.departments.includes(department),
    ) && canExercisePermission(authority, 'documents:manage')
  );
}

export function assertCanManagePreAdmission(
  authority: PreAdmissionManagementAuthority,
): void {
  if (!canManagePreAdmission(authority)) {
    throw forbidden(
      'A pré-admissão exige RH ou Departamento Pessoal com gestão documental, ou autoridade ampla no tenant.',
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
