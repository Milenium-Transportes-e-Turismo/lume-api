import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { UsersController } from './users.controller';

function permissionsFor(method: keyof UsersController): readonly string[] {
  const handler = Object.getOwnPropertyDescriptor(
    UsersController.prototype,
    method,
  )?.value as object;
  return Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as string[];
}

describe('UsersController permissions', () => {
  it('separates user creation, access editing and status management', () => {
    expect(permissionsFor('create')).toEqual(['users:create']);
    expect(permissionsFor('update')).toEqual(['users:update', 'users:create']);
    expect(permissionsFor('resetPassword')).toEqual(['users:update']);
    expect(permissionsFor('status')).toEqual(['users:manage']);
    expect(permissionsFor('delete')).toEqual(['users:manage']);
  });

  it('does not expose the unsupported users:delete permission', () => {
    for (const method of [
      'create',
      'list',
      'get',
      'update',
      'status',
      'resetPassword',
      'delete',
    ] as const) {
      expect(permissionsFor(method)).not.toContain('users:delete');
    }
  });
});

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    companyId: '00000000-0000-4000-8000-000000000002',
    routingCompanyId: null,
    name: 'Gestora de usuários',
    username: 'gestora',
    email: 'gestora@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    documentAccessMode: 'standard',
    jobTitle: null,
    maritalStatus: null,
    militaryDocumentStatus: 'not-informed',
    dependents: [],
    departments: ['information-technology'],
    permissionCodes: ['users:view'],
    permissions: ['users:view'],
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    tokenVersion: 1,
    ...overrides,
  };
}

function controllerWithList(execute: ReturnType<typeof vi.fn>) {
  return new UsersController(
    {} as never,
    { execute } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('UsersController privileged target visibility', () => {
  it.each([
    ['information-technology'],
    ['human-resources'],
    ['personnel-department'],
    ['management'],
  ] as const)(
    'excludes Admin and tenant-wide Directorate for a non-Admin catalog actor in %s',
    (departments) => {
      const execute = vi.fn();
      const controller = controllerWithList(execute);

      void controller.list(principal({ departments: [...departments] }), {
        page: 1,
        pageSize: 20,
      });

      expect(execute).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000002',
        expect.objectContaining({ excludePrivilegedUsers: true }),
      );
    },
  );

  it('does not hide privileged targets from an Administrator', () => {
    const execute = vi.fn();
    const controller = controllerWithList(execute);

    void controller.list(
      principal({
        isAdministrator: true,
        departments: [],
        permissionCodes: [],
        permissions: ['users:view'],
      }),
      { page: 1, pageSize: 20 },
    );

    expect(execute).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.not.objectContaining({ excludePrivilegedUsers: true }),
    );
  });
});
