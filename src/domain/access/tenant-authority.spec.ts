import { describe, expect, it } from 'vitest';

import {
  canExercisePermission,
  hasTenantWideAuthority,
  isTenantBusinessPermission,
} from './tenant-authority';

describe('tenant authority', () => {
  const director = {
    isAdministrator: false,
    departments: ['directorate'],
    permissionCodes: ['tenant:manage'],
    permissions: ['tenant:manage'],
  } as const;

  it('recognizes an individually granted tenant-wide authority', () => {
    expect(hasTenantWideAuthority(director)).toBe(true);
    expect(canExercisePermission(director, 'operations:manage')).toBe(true);
    expect(canExercisePermission(director, 'documents:approve')).toBe(true);
  });

  it('keeps platform administration outside tenant-wide authority', () => {
    for (const permission of [
      'users:manage',
      'settings:manage',
      'license:view',
    ] as const) {
      expect(isTenantBusinessPermission(permission)).toBe(false);
      expect(canExercisePermission(director, permission)).toBe(false);
    }
  });

  it('rejects a tenant-wide code outside the Directorate department', () => {
    const misplacedGrant = {
      ...director,
      departments: ['commercial'],
    };

    expect(hasTenantWideAuthority(misplacedGrant)).toBe(false);
    expect(canExercisePermission(misplacedGrant, 'operations:manage')).toBe(
      false,
    );
  });

  it('keeps document-portal access inside the documentary ceiling', () => {
    const documentPortalDirector = {
      ...director,
      documentAccessMode: 'document-portal',
      permissions: [
        'tenant:manage',
        'operations:manage',
        'documents:view',
        'documents:create',
        'documents:update',
        'profile:view',
        'profile:update',
        'support:view',
        'support:create',
      ],
    } as const;

    expect(hasTenantWideAuthority(documentPortalDirector)).toBe(false);
    expect(
      canExercisePermission(documentPortalDirector, 'operations:manage'),
    ).toBe(false);
    expect(
      canExercisePermission(documentPortalDirector, 'documents:update'),
    ).toBe(true);
  });

  it('keeps explicit administrators authoritative for every permission', () => {
    expect(
      canExercisePermission(
        { isAdministrator: true, permissions: [] },
        'users:manage',
      ),
    ).toBe(true);
  });
});
