import { forbidden } from '../../core/errors/app-error';

export const PRE_ADMISSION_DEFAULT_VALIDITY_DAYS = 30;

export type PreAdmissionAccessStatus = 'active' | 'expired' | 'revoked';

export function assertCanManagePreAdmission(authority: {
  readonly departments: readonly string[];
  readonly permissions: readonly string[];
}): void {
  if (
    !authority.departments.includes('human-resources') ||
    !authority.permissions.includes('documents:manage')
  ) {
    throw forbidden(
      'Somente o RH com permissão específica de gestão documental pode administrar acessos de pré-admissão.',
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
