import type { PermissionCode } from './access.constants';
import {
  DOCUMENT_PORTAL_PERMISSIONS,
  TENANT_BUSINESS_PERMISSION_CODES,
  TENANT_WIDE_PERMISSION,
} from './access.constants';

const tenantBusinessPermissionSet = new Set<PermissionCode>(
  TENANT_BUSINESS_PERMISSION_CODES,
);
const documentPortalPermissionSet = new Set<PermissionCode>(
  DOCUMENT_PORTAL_PERMISSIONS,
);

export interface TenantAuthorityIdentity {
  readonly isAdministrator: boolean;
  readonly departments?: readonly string[];
  readonly permissionCodes?: readonly string[];
  readonly permissions?: readonly string[];
  readonly documentAccessMode?: string;
}

function isDocumentPortalAuthority(
  authority: TenantAuthorityIdentity,
): boolean {
  return (
    authority.documentAccessMode?.toLowerCase().replaceAll('_', '-') ===
    'document-portal'
  );
}

export function hasTenantWidePermission(
  permissionCodes: readonly string[] | undefined,
): boolean {
  return permissionCodes?.includes(TENANT_WIDE_PERMISSION) ?? false;
}

export function hasTenantWideAuthority(
  authority: TenantAuthorityIdentity,
): boolean {
  if (authority.isAdministrator) return true;
  if (isDocumentPortalAuthority(authority)) return false;
  return (
    authority.departments?.includes('directorate') === true &&
    (hasTenantWidePermission(authority.permissionCodes) ||
      hasTenantWidePermission(authority.permissions))
  );
}

export function isTenantBusinessPermission(
  permission: PermissionCode,
): boolean {
  return tenantBusinessPermissionSet.has(permission);
}

export function canExercisePermission(
  authority: TenantAuthorityIdentity,
  permission: PermissionCode,
): boolean {
  if (authority.isAdministrator) return true;
  if (isDocumentPortalAuthority(authority)) {
    return documentPortalPermissionSet.has(permission);
  }
  if (
    hasTenantWideAuthority(authority) &&
    isTenantBusinessPermission(permission)
  ) {
    return true;
  }
  return authority.permissions?.includes(permission) ?? false;
}
