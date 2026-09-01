import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { PermissionCode } from '../../../domain/access/access.constants';
import { PermissionsGuard } from './permissions.guard';

function setup(required?: PermissionCode[]) {
  const reflector = {
    getAllAndOverride: vi.fn(() => required),
  };
  const guard = new PermissionsGuard(reflector as unknown as Reflector);

  return { guard, reflector };
}

function contextWith(
  user?: Readonly<{
    isAdministrator: boolean;
    permissions: readonly PermissionCode[];
  }>,
): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: vi.fn(() => ({
      getRequest: vi.fn(() => ({ user })),
    })),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows a route without required permissions', () => {
    const { guard } = setup();

    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('rejects a request without an authenticated principal', () => {
    const { guard } = setup(['commercial:view']);

    expect(() => guard.canActivate(contextWith())).toThrow(ForbiddenException);
  });

  it('allows a principal with the required permission', () => {
    const { guard } = setup(['commercial:view']);

    expect(
      guard.canActivate(
        contextWith({
          isAdministrator: false,
          permissions: ['commercial:view'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects a principal without any required permission', () => {
    const { guard } = setup(['commercial:manage']);

    expect(() =>
      guard.canActivate(
        contextWith({
          isAdministrator: false,
          permissions: ['commercial:view'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('uses any-permission semantics when multiple permissions are required', () => {
    const { guard } = setup(['commercial:manage', 'users:view']);

    expect(
      guard.canActivate(
        contextWith({
          isAdministrator: false,
          permissions: ['users:view'],
        }),
      ),
    ).toBe(true);
  });

  it('preserves the administrator bypass', () => {
    const { guard } = setup(['commercial:manage']);

    expect(
      guard.canActivate(
        contextWith({ isAdministrator: true, permissions: [] }),
      ),
    ).toBe(true);
  });
});
