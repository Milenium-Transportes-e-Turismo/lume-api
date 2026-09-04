import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_CODES,
  SERVICE_PERMISSION_CEILING,
} from './access.constants';
import { createLegacyAccessSnapshot } from './legacy-access-snapshot';

describe('createLegacyAccessSnapshot', () => {
  it('projects exactly the effective legacy capabilities without using the department ceiling as grants', () => {
    const snapshot = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'user-1',
      isAdministrator: false,
      departments: ['commercial'],
      permissionCodes: ['commercial:view', 'users:manage'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });

    expect(snapshot.capabilities).toContain('commercial:view');
    expect(snapshot.capabilities).not.toContain('commercial:manage');
    expect(snapshot.capabilities).not.toContain('users:manage');
    expect(snapshot.resolverVersion).toBe('legacy-access-v1');
  });

  it('produces a deterministic fingerprint for equivalent ordered data', () => {
    const first = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'user-1',
      isAdministrator: false,
      departments: ['operations', 'commercial'],
      permissionCodes: ['routes:view', 'commercial:view'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });
    const second = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'user-1',
      isAdministrator: false,
      departments: ['commercial', 'operations'],
      permissionCodes: ['commercial:view', 'routes:view'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.capabilities).toEqual(second.capabilities);
  });

  it('normalizes legacy department aliases before calculating drift', () => {
    const legacy = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'user-1',
      isAdministrator: false,
      departments: ['controlling'],
      permissionCodes: ['financial:view'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });
    const current = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'user-1',
      isAdministrator: false,
      departments: ['controllership'],
      permissionCodes: ['financial:view'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });

    expect(legacy.departments).toEqual(['controllership']);
    expect(legacy.fingerprint).toBe(current.fingerprint);
  });

  it('projects the complete current catalog for an administrator', () => {
    const snapshot = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'admin-1',
      isAdministrator: true,
      departments: [],
      permissionCodes: [],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });

    expect(snapshot.capabilities).toEqual([...ALL_PERMISSION_CODES].sort());
    expect(snapshot.capabilities).toEqual(
      expect.arrayContaining([...SERVICE_PERMISSION_CEILING]),
    );
    expect(snapshot.departments.length).toBeGreaterThan(0);
    expect(snapshot.departments).toContain('management');
    expect(snapshot.isAdministrator).toBe(true);
  });

  it('does not depend on materialized service grants for an administrator', () => {
    const withoutMaterializedGrant = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'admin-1',
      isAdministrator: true,
      departments: [],
      permissionCodes: [],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });
    const withMaterializedGrant = createLegacyAccessSnapshot({
      companyId: 'company-1',
      userId: 'admin-1',
      isAdministrator: true,
      departments: [],
      permissionCodes: ['service:view'],
      documentAccessMode: 'standard',
      routingCompanyId: null,
    });

    expect(withoutMaterializedGrant.capabilities).toEqual(
      withMaterializedGrant.capabilities,
    );
    expect(withoutMaterializedGrant.fingerprint).toBe(
      withMaterializedGrant.fingerprint,
    );
  });
});
