import { describe, expect, it, vi } from 'vitest';

import { userMutationAuthorizationFingerprint } from '../../../domain/access/user-management-policy';
import { PrismaUsersRepository } from './prisma-users.repository';

function activeActorState(id: string, updatedAt: Date, version = 1) {
  return {
    id,
    updatedAt,
    version,
    isAdministrator: false,
    documentAccessMode: 'STANDARD',
    departments: ['operations'],
    permissionCodes: ['operations:view'],
    isActive: true,
    status: 'ACTIVE',
    deletedAt: null,
    company: { status: 'ACTIVE' },
  };
}

function authorizationFingerprint(
  actor: ReturnType<typeof activeActorState>,
): string {
  return userMutationAuthorizationFingerprint({
    ...actor,
    companyIsActive: actor.company.status === 'ACTIVE',
  });
}

describe('PrismaUsersRepository privileged target visibility', () => {
  it('excludes both Administrators and tenant-wide Directors from a restricted catalog', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      user: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany,
        count,
      },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);

    await repository.list('00000000-0000-4000-8000-000000000002', {
      page: 1,
      pageSize: 20,
      excludePrivilegedUsers: true,
    });

    const expectedPrivilegeFilter = {
      NOT: {
        OR: [
          { isAdministrator: true },
          {
            AND: [
              { documentAccessMode: { not: 'DOCUMENT_PORTAL' } },
              { departments: { has: 'directorate' } },
              { permissionCodes: { has: 'tenant:manage' } },
            ],
          },
        ],
      },
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(expectedPrivilegeFilter),
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining(expectedPrivilegeFilter),
    });
  });

  it('rejects a stale actor version even when updatedAt has millisecond equality', async () => {
    const targetId = '00000000-0000-4000-8000-000000000001';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const now = new Date('2026-09-01T12:00:00.000Z');
    const currentActor = activeActorState(targetId, now, 2);
    const lock = vi.fn().mockResolvedValue([{ id: targetId }]);
    const findMany = vi.fn().mockResolvedValue([currentActor]);
    const update = vi.fn();
    const transaction = {
      $queryRaw: lock,
      userUpdateHistory: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        findMany,
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          company: { status: 'ACTIVE' },
        }),
        update,
      },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);

    await expect(
      repository.update(companyId, targetId, {
        name: 'Atualização concorrente',
        command: {
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 1,
          requestFingerprint: 'a'.repeat(64),
          actorUserId: targetId,
          changedFields: ['name'],
        },
        mutationSnapshot: {
          actorUserId: targetId,
          actorUpdatedAt: now,
          actorVersion: 1,
          actorAuthorizationFingerprint: authorizationFingerprint(currentActor),
          targetUpdatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(lock).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a changed authorization state even when actor version and updatedAt are unchanged', async () => {
    const targetId = '00000000-0000-4000-8000-000000000001';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const now = new Date('2026-09-01T12:00:00.000Z');
    const currentActor = activeActorState(targetId, now);
    const previousAuthorization = {
      ...currentActor,
      permissionCodes: ['users:update'],
    };
    const update = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: targetId }]),
      userUpdateHistory: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        findMany: vi.fn().mockResolvedValue([currentActor]),
        findUnique: vi.fn().mockResolvedValue({
          isActive: true,
          status: 'ACTIVE',
          deletedAt: null,
          company: { status: 'ACTIVE' },
        }),
        update,
      },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);

    await expect(
      repository.update(companyId, targetId, {
        name: 'Autorização concorrente',
        command: {
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 1,
          requestFingerprint: 'a'.repeat(64),
          actorUserId: targetId,
          changedFields: ['name'],
        },
        mutationSnapshot: {
          actorUserId: targetId,
          actorUpdatedAt: now,
          actorVersion: currentActor.version,
          actorAuthorizationFingerprint: authorizationFingerprint(
            previousAuthorization,
          ),
          targetUpdatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the user update, receipt and audit in the same transaction', async () => {
    const targetId = '00000000-0000-4000-8000-000000000001';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const now = new Date('2026-09-01T12:00:00.000Z');
    const currentActor = activeActorState(targetId, now);
    const row = {
      id: targetId,
      companyId,
      routingCompanyId: null,
      name: 'Usuário',
      username: 'usuario',
      usernameNormalized: 'usuario',
      email: 'usuario@example.test',
      emailNormalized: 'usuario@example.test',
      cpfNormalized: null,
      passwordHash: 'hash',
      mustChangePassword: false,
      profilePictureMime: null,
      isAdministrator: false,
      documentAccessMode: 'STANDARD',
      clientCategory: null,
      jobTitle: null,
      maritalStatus: null,
      militaryDocumentStatus: 'pending-confirmation',
      dependents: [],
      departments: ['operations'],
      permissionCodes: ['operations:view'],
      status: 'ACTIVE',
      suspendedUntil: null,
      suspensionReason: null,
      isActive: true,
      version: 1,
      tokenVersion: 1,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      company: { status: 'ACTIVE' },
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createHistory = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockRejectedValue(new Error('audit failed'));
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: targetId }]),
      userUpdateHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: createHistory,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([currentActor]),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            isActive: true,
            status: 'ACTIVE',
            deletedAt: null,
            company: { status: 'ACTIVE' },
          })
          .mockResolvedValue(row),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...row, name: 'Atualizado', version: 2 }),
        updateMany,
      },
      tenantAuditLog: { create: createAudit },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);

    await expect(
      repository.update(companyId, targetId, {
        name: 'Atualizado',
        command: {
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 1,
          requestFingerprint: 'a'.repeat(64),
          actorUserId: targetId,
          changedFields: ['name'],
        },
        mutationSnapshot: {
          actorUserId: targetId,
          actorUpdatedAt: now,
          actorVersion: currentActor.version,
          actorAuthorizationFingerprint: authorizationFingerprint(currentActor),
          targetUpdatedAt: now,
        },
      }),
    ).rejects.toThrow('audit failed');

    expect(updateMany).toHaveBeenCalledOnce();
    expect(createHistory).toHaveBeenCalledOnce();
    expect(createAudit).toHaveBeenCalledOnce();
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({ changedFields: ['name'] }),
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          changedFields: ['name'],
          requestedFields: ['name'],
        }),
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('revalidates an active actor under lock before returning a replay', async () => {
    const targetId = '00000000-0000-4000-8000-000000000001';
    const actorId = '00000000-0000-4000-8000-000000000004';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const findReplay = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockImplementation((...args: unknown[]) => {
        const serialized = JSON.stringify(args);
        return Promise.resolve([
          { id: serialized.includes(actorId) ? actorId : targetId },
        ]);
      }),
      userUpdateHistory: { findUnique: findReplay },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          isActive: false,
          status: 'INACTIVE',
          deletedAt: null,
          company: { status: 'ACTIVE' },
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);
    const now = new Date('2026-09-01T12:00:00.000Z');

    await expect(
      repository.update(companyId, targetId, {
        name: 'Replay bloqueado',
        command: {
          commandId: '00000000-0000-4000-8000-000000000003',
          expectedVersion: 1,
          requestFingerprint: 'a'.repeat(64),
          actorUserId: actorId,
          changedFields: ['name'],
        },
        mutationSnapshot: {
          actorUserId: actorId,
          actorUpdatedAt: now,
          actorVersion: 1,
          actorAuthorizationFingerprint: 'b'.repeat(64),
          targetUpdatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(findReplay).not.toHaveBeenCalled();
  });

  it('rejects a common status change when the target became an active administrator', async () => {
    const targetId = '00000000-0000-4000-8000-000000000001';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = {
      user: {
        updateMany,
      },
      refreshToken: { updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const repository = new PrismaUsersRepository(prisma as never);

    await expect(
      repository.updateStatus(companyId, targetId, {
        status: 'suspended',
        suspendedUntil: new Date('2026-09-02T12:00:00.000Z'),
        suspensionReason: 'Revisão de acesso',
        changedAt: new Date('2026-09-01T12:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: targetId,
        companyId,
        NOT: {
          isAdministrator: true,
          isActive: true,
          status: 'ACTIVE',
        },
      },
      data: expect.objectContaining({
        status: 'SUSPENDED',
        isActive: false,
      }),
    });
    expect(transaction.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
