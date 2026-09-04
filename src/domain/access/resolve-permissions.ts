import {
  ALL_PERMISSION_CODES,
  DOCUMENT_PORTAL_PERMISSIONS,
  EMPLOYEE_SELF_SERVICE_PERMISSIONS,
  TENANT_BUSINESS_PERMISSION_CODES,
  TENANT_WIDE_PERMISSION,
  allowedPermissionsForDepartments,
  type PermissionCode,
  type SupportedUserDepartment,
} from './access.constants';
import { hasTenantWideAuthority } from './tenant-authority';

export function filterPermissionCodesForDepartments(
  departments: readonly SupportedUserDepartment[],
  permissionCodes: readonly PermissionCode[],
): PermissionCode[] {
  const ceiling = new Set(allowedPermissionsForDepartments(departments));

  return Array.from(
    new Set(permissionCodes.filter((permission) => ceiling.has(permission))),
  ).sort();
}

export function resolveEffectivePermissions(
  departments: readonly SupportedUserDepartment[],
  individualPermissions: readonly PermissionCode[] = [],
  isAdministrator = false,
  documentAccessMode: 'standard' | 'document-portal' | 'client' = 'standard',
): PermissionCode[] {
  if (isAdministrator) {
    return [...ALL_PERMISSION_CODES].sort();
  }

  if (documentAccessMode === 'document-portal') {
    return [...DOCUMENT_PORTAL_PERMISSIONS];
  }

  const permissions = new Set<PermissionCode>(
    EMPLOYEE_SELF_SERVICE_PERMISSIONS,
  );

  if (departments.includes('information-technology')) {
    permissions.add('users:view');
    permissions.add('users:create');
    permissions.add('users:update');
    permissions.add('users:manage');
  }

  const selectedPermissions = filterPermissionCodesForDepartments(
    departments,
    individualPermissions,
  );

  for (const permission of selectedPermissions) {
    permissions.add(permission);
  }

  if (
    hasTenantWideAuthority({
      isAdministrator: false,
      departments,
      permissionCodes: selectedPermissions,
    })
  ) {
    permissions.add(TENANT_WIDE_PERMISSION);
    for (const permission of TENANT_BUSINESS_PERMISSION_CODES) {
      permissions.add(permission);
    }
  }

  return Array.from(permissions).sort();
}
