import { createHash } from 'node:crypto';

import { forbidden } from '../../core/errors/app-error';
import { hasTenantWideAuthority } from './tenant-authority';
export interface UserManagementIdentity {
  readonly id: string;
  readonly isAdministrator: boolean;
  readonly departments: readonly string[];
  readonly permissionCodes?: readonly string[];
  readonly documentAccessMode?: string;
}

export interface UserMutationAuthorizationIdentity extends UserManagementIdentity {
  readonly permissionCodes: readonly string[];
  readonly documentAccessMode: string;
  readonly status: string;
  readonly isActive: boolean;
  readonly companyIsActive: boolean;
}

function normalizeAccessValue(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

export function userMutationAuthorizationFingerprint(
  actor: UserMutationAuthorizationIdentity,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        isAdministrator: actor.isAdministrator,
        documentAccessMode: normalizeAccessValue(actor.documentAccessMode),
        departments: [...new Set(actor.departments)].sort(),
        permissionCodes: [...new Set(actor.permissionCodes)].sort(),
        status: normalizeAccessValue(actor.status),
        isActive: actor.isActive,
        companyIsActive: actor.companyIsActive,
      }),
    )
    .digest('hex');
}

export type UserManagementRole =
  | 'administrator'
  | 'information-technology'
  | 'people-operations'
  | 'delegated'
  | 'none';

export function isPrivilegedUserManagementTarget(
  target: UserManagementIdentity,
): boolean {
  return hasTenantWideAuthority({
    isAdministrator: target.isAdministrator,
    departments: target.departments,
    permissionCodes: target.permissionCodes,
    documentAccessMode: target.documentAccessMode,
  });
}

export function resolveUserManagementRole(
  actor: UserManagementIdentity,
): UserManagementRole {
  if (actor.isAdministrator) return 'administrator';
  if (
    actor.documentAccessMode?.toLowerCase().replaceAll('_', '-') ===
    'document-portal'
  ) {
    return 'none';
  }
  if (actor.departments.includes('information-technology')) {
    return 'information-technology';
  }
  if (
    actor.departments.some((department) =>
      ['human-resources', 'personnel-department'].includes(department),
    )
  ) {
    return 'people-operations';
  }
  if (
    actor.permissionCodes?.some((permission) =>
      ['users:view', 'users:create', 'users:update', 'users:manage'].includes(
        permission,
      ),
    )
  ) {
    return 'delegated';
  }
  return 'none';
}

export function assertCanAccessUserCatalog(
  actor: UserManagementIdentity,
): UserManagementRole {
  const role = resolveUserManagementRole(actor);
  if (role === 'none') {
    throw forbidden(
      'Você não possui permissão para acessar a administração de usuários.',
    );
  }
  return role;
}

export function assertCanAccessUserTarget(
  actor: UserManagementIdentity,
  target: UserManagementIdentity,
): UserManagementRole {
  const role = assertCanAccessUserCatalog(actor);
  if (role !== 'administrator' && isPrivilegedUserManagementTarget(target)) {
    throw forbidden(
      'Somente administradores podem gerenciar uma conta com autoridade ampla no tenant.',
    );
  }
  if (
    ['information-technology', 'delegated'].includes(role) &&
    target.id === actor.id
  ) {
    throw forbidden(
      'A equipe de TI não pode alterar a própria conta pela administração de usuários. Use Meu perfil para seus dados pessoais.',
    );
  }
  return role;
}

export function assertCanManageUserTarget(
  actor: UserManagementIdentity,
  target: UserManagementIdentity,
): UserManagementRole {
  const role = assertCanAccessUserTarget(actor, target);
  if (role === 'people-operations') {
    throw forbidden(
      'RH e Departamento Pessoal podem criar o acesso documental inicial, mas não gerenciar acessos existentes.',
    );
  }
  return role;
}
