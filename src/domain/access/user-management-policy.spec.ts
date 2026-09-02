import { describe, expect, it } from 'vitest';

import {
  assertCanAccessUserTarget,
  assertCanManageUserTarget,
  isPrivilegedUserManagementTarget,
  resolveUserManagementRole,
} from './user-management-policy';

const commonUser = {
  id: 'common-user',
  isAdministrator: false,
  departments: ['commercial'],
} as const;

describe('user management policy', () => {
  it('recognizes administrator, TI, people operations and ordinary users', () => {
    expect(
      resolveUserManagementRole({
        ...commonUser,
        isAdministrator: true,
      }),
    ).toBe('administrator');
    expect(
      resolveUserManagementRole({
        ...commonUser,
        departments: ['information-technology'],
      }),
    ).toBe('information-technology');
    expect(
      resolveUserManagementRole({
        ...commonUser,
        departments: ['personnel-department'],
      }),
    ).toBe('people-operations');
    expect(resolveUserManagementRole(commonUser)).toBe('none');
  });

  it('allows TI to manage another ordinary user', () => {
    const ti = {
      id: 'ti-user',
      isAdministrator: false,
      departments: ['information-technology'],
    } as const;

    expect(assertCanManageUserTarget(ti, commonUser)).toBe(
      'information-technology',
    );
  });

  it('blocks TI from self-management and administrator accounts', () => {
    const ti = {
      id: 'ti-user',
      isAdministrator: false,
      departments: ['information-technology'],
    } as const;

    expect(() => assertCanAccessUserTarget(ti, ti)).toThrow();
    expect(() =>
      assertCanAccessUserTarget(ti, {
        ...commonUser,
        id: 'administrator',
        isAdministrator: true,
      }),
    ).toThrow();
  });

  it('keeps HR and DP out of lifecycle management', () => {
    expect(() =>
      assertCanManageUserTarget(
        {
          id: 'dp-user',
          isAdministrator: false,
          departments: ['personnel-department'],
        },
        commonUser,
      ),
    ).toThrow();
  });

  it('does not turn tenant-wide Directorate authority into platform user administration', () => {
    const director = {
      id: 'director-user',
      isAdministrator: false,
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    } as const;

    expect(resolveUserManagementRole(director)).toBe('none');
    expect(() => assertCanAccessUserTarget(director, commonUser)).toThrow();
  });

  it('protects a tenant-wide Director from any non-administrator user manager', () => {
    const director = {
      id: 'director-user',
      isAdministrator: false,
      departments: ['directorate'],
      permissionCodes: ['tenant:manage'],
    } as const;

    for (const actor of [
      {
        id: 'ti-user',
        isAdministrator: false,
        departments: ['information-technology'],
      },
      {
        id: 'dp-user',
        isAdministrator: false,
        departments: ['personnel-department'],
      },
      {
        id: 'delegated-user',
        isAdministrator: false,
        departments: ['management'],
        permissionCodes: ['users:manage'],
      },
    ] as const) {
      expect(() => assertCanAccessUserTarget(actor, director)).toThrow();
      expect(() => assertCanManageUserTarget(actor, director)).toThrow();
    }
  });

  it('does not preserve privileged business authority on a document-portal target', () => {
    expect(
      isPrivilegedUserManagementTarget({
        id: 'legacy-document-portal-director',
        isAdministrator: false,
        documentAccessMode: 'document-portal',
        departments: ['directorate'],
        permissionCodes: ['tenant:manage'],
      }),
    ).toBe(false);
  });
});
