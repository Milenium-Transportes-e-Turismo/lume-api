import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type { PrismaService } from '../../infra/database/prisma/prisma.service';
import { NavigationFavoritesService } from './navigation-favorites.service';

function principal(
  patch: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    id: 'user-a',
    companyId: 'company-a',
    tokenVersion: 1,
    routingCompanyId: null,
    name: 'User A',
    username: 'user-a',
    email: 'user-a@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    documentAccessMode: 'standard',
    jobTitle: null,
    maritalStatus: null,
    militaryDocumentStatus: 'not-applicable',
    dependents: [],
    departments: ['operations'],
    permissionCodes: ['route-planner:view'],
    permissions: ['route-planner:view'],
    clientCategory: null,
    isActive: true,
    version: 1,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('NavigationFavoritesService', () => {
  it('lists favorites in insertion order within the authenticated tenant and user', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a',
        navigationKey: 'dashboard',
        createdAt: new Date('2026-01-01'),
      },
    ]);
    const service = new NavigationFavoritesService({
      userNavigationFavorite: { findMany },
    } as unknown as PrismaService);

    await service.list('company-a', 'user-a');

    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-a', userId: 'user-a' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, navigationKey: true, createdAt: true },
    });
  });

  it('rejects groups and unknown navigation keys', async () => {
    const service = new NavigationFavoritesService({} as PrismaService);

    await expect(service.add(principal(), 'operations')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('does not persist a favorite when the authenticated principal cannot access its screen', async () => {
    const upsert = vi.fn();
    const service = new NavigationFavoritesService({
      userNavigationFavorite: { upsert },
    } as unknown as PrismaService);

    await expect(
      service.add(principal(), 'company.users'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(upsert).not.toHaveBeenCalled();
  });

  it('persists an allowed favorite with the authenticated tenant and user only', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: 'favorite-a',
      navigationKey: 'operations.routing',
      createdAt: new Date('2026-01-01'),
    });
    const service = new NavigationFavoritesService({
      userNavigationFavorite: { upsert },
    } as unknown as PrismaService);

    await service.add(principal(), 'operations.routing');

    expect(upsert).toHaveBeenCalledWith({
      where: {
        companyId_userId_navigationKey: {
          companyId: 'company-a',
          userId: 'user-a',
          navigationKey: 'operations.routing',
        },
      },
      create: {
        companyId: 'company-a',
        userId: 'user-a',
        navigationKey: 'operations.routing',
      },
      update: {},
      select: { id: true, navigationKey: true, createdAt: true },
    });
  });

  it('keeps document-portal users limited to the document screen', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: 'favorite-a',
      navigationKey: 'company.documents',
      createdAt: new Date('2026-01-01'),
    });
    const service = new NavigationFavoritesService({
      userNavigationFavorite: { upsert },
    } as unknown as PrismaService);
    const documentPortal = principal({
      type: 'candidate',
      documentAccessMode: 'document-portal',
      departments: [],
      permissionCodes: [],
      permissions: ['documents:view'],
    });

    await expect(
      service.add(documentPortal, 'operations.routing'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.add(documentPortal, 'company.documents'),
    ).resolves.toMatchObject({ navigationKey: 'company.documents' });
  });
});
