import { createHash } from 'node:crypto';

import type { DocumentAccessMode } from '../entities/user';
import type {
  PermissionCode,
  SupportedUserDepartment,
} from './access.constants';
import {
  ASSIGNABLE_DEPARTMENTS,
  normalizeUserDepartments,
  presentUserDepartment,
} from './access.constants';
import { resolveEffectivePermissions } from './resolve-permissions';

export const LEGACY_ACCESS_RESOLVER_VERSION = 'legacy-access-v1' as const;

export interface LegacyAccessSource {
  companyId: string;
  userId: string;
  isAdministrator: boolean;
  departments: readonly SupportedUserDepartment[];
  permissionCodes: readonly PermissionCode[];
  documentAccessMode: DocumentAccessMode;
  routingCompanyId: string | null;
}

export interface LegacyAccessSnapshot {
  companyId: string;
  userId: string;
  isAdministrator: boolean;
  departments: SupportedUserDepartment[];
  capabilities: PermissionCode[];
  documentAccessMode: DocumentAccessMode;
  routingCompanyId: string | null;
  resolverVersion: typeof LEGACY_ACCESS_RESOLVER_VERSION;
  fingerprint: string;
}

export function createLegacyAccessSnapshot(
  source: LegacyAccessSource,
): LegacyAccessSnapshot {
  const departments = (
    source.isAdministrator
      ? [...ASSIGNABLE_DEPARTMENTS]
      : normalizeUserDepartments(source.departments).map(presentUserDepartment)
  ).sort();
  const capabilities = resolveEffectivePermissions(
    departments,
    source.permissionCodes,
    source.isAdministrator,
    source.documentAccessMode,
  );
  const stablePayload = {
    companyId: source.companyId,
    userId: source.userId,
    isAdministrator: source.isAdministrator,
    departments,
    capabilities,
    documentAccessMode: source.documentAccessMode,
    routingCompanyId: source.routingCompanyId,
    resolverVersion: LEGACY_ACCESS_RESOLVER_VERSION,
  };

  return {
    ...stablePayload,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(stablePayload))
      .digest('hex'),
  };
}
