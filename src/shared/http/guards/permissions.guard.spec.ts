import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../../application/presenters/user.presenter';
import { PermissionsGuard } from './permissions.guard';

function principal(
  permissions: AuthenticatedPrincipal['permissions'],
  isAdministrator = false,
): AuthenticatedPrincipal {
  return {
    companyId: '00000000-0000-4000-8000-000000000010',
    tokenVersion: 1,
    id: '00000000-0000-4000-8000-000000000011',
    routingCompanyId: null,
    name: 'Usuário',
    username: 'usuario',
    email: 'usuario@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator,
    jobTitle: null,
    maritalStatus: null,
    militaryDocumentStatus: 'not-applicable',
    dependents: [],
    departments: [],
    permissionCodes: permissions,
    permissions,
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-08-29T12:00:00.000Z',
  };
}

function context(user: AuthenticatedPrincipal): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('não transforma status de administrador em acesso operacional implícito', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['service:view']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(context(principal([], true)))).toThrow(
      ForbiddenException,
    );
  });

  it('autoriza qualquer usuário que possua uma das permissões efetivas', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValue(['service:view', 'service:respond']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(context(principal(['service:respond'])))).toBe(
      true,
    );
  });

  it('mantém rotas sem metadado de permissão disponíveis ao próximo guard', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(context(principal([])))).toBe(true);
  });
});
