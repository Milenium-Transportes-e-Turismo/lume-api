import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service';
import { PrismaPreAdmissionAccessRepository } from './prisma-pre-admission-access.repository';

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const personRegistrationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const documentTypeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const accessId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const commandId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const now = new Date('2026-09-01T12:00:00.000Z');
const expiresAt = new Date('2026-10-01T12:00:00.000Z');
const authorizedActor = {
  isActive: true,
  status: 'ACTIVE',
  deletedAt: null,
  departments: ['human-resources'],
  permissionCodes: ['documents:manage'],
};

const accessRow = {
  id: accessId,
  companyId,
  personRegistrationId,
  tokenGeneration: 1,
  expiresAt,
  revokedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  personRegistration: {
    individualName: 'Candidata Exemplo',
    legalName: 'Candidata Exemplo',
  },
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      documentTypeId,
      position: 1,
      instructions: null,
      configSnapshot: {
        code: 'cpf',
        name: 'CPF',
        acceptedMimeTypes: ['application/pdf'],
        maxFileSizeBytes: 10_000_000,
        minFiles: 1,
        maxFiles: 1,
        requiresFrontBack: false,
      },
    },
  ],
};

function creationInput() {
  return {
    id: accessId,
    companyId,
    actorUserId,
    personRegistrationId,
    documentTypeIds: [documentTypeId],
    commandId,
    expectedVersion: 0 as const,
    requestFingerprint: 'a'.repeat(64),
    tokenHash: 'b'.repeat(64),
    expiresAt,
    now,
  };
}

describe('PrismaPreAdmissionAccessRepository', () => {
  it('revalidates the authorized RH actor inside the transaction', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      preAdmissionAccessHistory: { findUnique: vi.fn() },
      preAdmissionAccess: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transaction.preAdmissionAccess.create).not.toHaveBeenCalled();
  });

  it('creates person-bound scope, history and tenant audit in one transaction', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(
            ({ data }: { data: Readonly<Record<string, unknown>> }) => data,
          ),
      },
      routingCompany: {
        findUnique: vi.fn().mockResolvedValue({
          id: personRegistrationId,
          clientType: 'PF',
          status: 'ACTIVE',
        }),
      },
      documentType: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: documentTypeId,
            code: 'cpf',
            name: 'CPF',
            acceptedMimeTypes: ['application/pdf'],
            maxFileSizeBytes: 10_000_000,
            minFiles: 1,
            maxFiles: 1,
            requiresFrontBack: false,
          },
        ]),
      },
      preAdmissionAccess: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(accessRow),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new PrismaPreAdmissionAccessRepository(prisma).create(
      creationInput(),
    );

    expect(transaction.routingCompany.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_companyId: { id: personRegistrationId, companyId } },
      }),
    );
    expect(transaction.documentType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId,
          id: { in: [documentTypeId] },
          active: true,
        },
      }),
    );
    expect(transaction.preAdmissionAccessHistory.create).toHaveBeenCalled();
    expect(transaction.tenantAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          actorUserId,
          action: 'pre-admission.access.create',
          targetId: accessId,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: false,
        resultVersion: 1,
        access: expect.objectContaining({
          companyId,
          personRegistrationId,
          personName: 'Candidata Exemplo',
        }),
      }),
    );
  });

  it('does not accept an idempotency key with a different fingerprint', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue({
          preAdmissionAccessId: accessId,
          action: 'created',
          requestFingerprint: 'different'.padEnd(64, '0'),
          resultVersion: 1,
          resultTokenGeneration: 1,
          resultExpiresAt: expiresAt,
          resultRevokedAt: null,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('replays the persisted result for the same actor and command', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue({
          preAdmissionAccessId: accessId,
          actorUserId,
          action: 'created',
          requestFingerprint: 'a'.repeat(64),
          resultVersion: 1,
          resultTokenGeneration: 1,
          resultExpiresAt: expiresAt,
          resultRevokedAt: null,
        }),
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(accessRow),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new PrismaPreAdmissionAccessRepository(prisma).create(
      creationInput(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        idempotent: true,
        resultVersion: 1,
        resultTokenGeneration: 1,
      }),
    );
    expect(transaction.preAdmissionAccess.create).not.toHaveBeenCalled();
  });

  it('scopes renewal lookup and optimistic update to the tenant', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(
            ({ data }: { data: Readonly<Record<string, unknown>> }) => data,
          ),
      },
      preAdmissionAccess: {
        findUnique: vi.fn().mockResolvedValue(accessRow),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...accessRow,
          tokenGeneration: 2,
          version: 2,
        }),
      },
      tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    await new PrismaPreAdmissionAccessRepository(prisma).renew({
      companyId,
      actorUserId,
      accessId,
      commandId,
      expectedVersion: 1,
      requestFingerprint: 'a'.repeat(64),
      tokenHash: 'c'.repeat(64),
      tokenGeneration: 2,
      expiresAt,
      now,
    });

    expect(transaction.preAdmissionAccess.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_companyId: { id: accessId, companyId } },
      }),
    );
    expect(transaction.preAdmissionAccess.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: accessId, companyId, version: 1 },
      }),
    );
  });

  it('does not reactivate an old link while another link is open for the person', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      preAdmissionAccess: {
        findUnique: vi.fn().mockResolvedValue({
          ...accessRow,
          revokedAt: new Date('2026-08-31T12:00:00.000Z'),
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
        }),
        updateMany: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).renew({
        companyId,
        actorUserId,
        accessId,
        commandId,
        expectedVersion: 1,
        requestFingerprint: 'a'.repeat(64),
        tokenHash: 'c'.repeat(64),
        tokenGeneration: 2,
        expiresAt,
        now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transaction.preAdmissionAccess.updateMany).not.toHaveBeenCalled();
  });

  it('retries a serializable create conflict and replays the winning command', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue({
          preAdmissionAccessId: accessId,
          actorUserId,
          action: 'created',
          requestFingerprint: 'a'.repeat(64),
          resultVersion: 1,
          resultTokenGeneration: 1,
          resultExpiresAt: expiresAt,
          resultRevokedAt: null,
        }),
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(accessRow),
      },
    };
    const transactionRunner = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).resolves.toMatchObject({ idempotent: true, resultVersion: 1 });
    expect(transactionRunner).toHaveBeenCalledTimes(2);
  });

  it('replays the committed command after a P2002 race', async () => {
    const history = {
      preAdmissionAccessId: accessId,
      actorUserId,
      action: 'created',
      requestFingerprint: 'a'.repeat(64),
      resultVersion: 1,
      resultTokenGeneration: 1,
      resultExpiresAt: expiresAt,
      resultRevokedAt: null,
    };
    const transactionRunner = vi.fn().mockRejectedValue({ code: 'P2002' });
    const persistedHistoryLookup = vi.fn().mockResolvedValue(history);
    const prisma = {
      $transaction: transactionRunner,
      preAdmissionAccessHistory: {
        findUnique: persistedHistoryLookup,
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(accessRow),
      },
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).resolves.toMatchObject({ idempotent: true, resultVersion: 1 });
    expect(transactionRunner).toHaveBeenCalledTimes(1);
    expect(persistedHistoryLookup).toHaveBeenCalledTimes(1);
  });

  it('replays a command committed after the transaction observed a conflict', async () => {
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      routingCompany: {
        findUnique: vi.fn().mockResolvedValue({
          id: personRegistrationId,
          clientType: 'PF',
          status: 'ACTIVE',
        }),
      },
      documentType: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: documentTypeId,
            code: 'cpf',
            name: 'CPF',
            acceptedMimeTypes: ['application/pdf'],
            maxFileSizeBytes: 10_000_000,
            minFiles: 1,
            maxFiles: 1,
            requiresFrontBack: false,
          },
        ]),
      },
      preAdmissionAccess: {
        findFirst: vi.fn().mockResolvedValue({ id: accessId }),
      },
    };
    const persistedHistoryLookup = vi.fn().mockResolvedValue({
      preAdmissionAccessId: accessId,
      actorUserId,
      action: 'created',
      requestFingerprint: 'a'.repeat(64),
      resultVersion: 1,
      resultTokenGeneration: 1,
      resultExpiresAt: expiresAt,
      resultRevokedAt: null,
    });
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
      preAdmissionAccessHistory: {
        findUnique: persistedHistoryLookup,
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(accessRow),
      },
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).resolves.toMatchObject({ idempotent: true, resultVersion: 1 });
    expect(transaction.preAdmissionAccess.findFirst).toHaveBeenCalledTimes(1);
    expect(persistedHistoryLookup).toHaveBeenCalledTimes(1);
  });

  it('limits serializable retries before returning a domain conflict', async () => {
    const transactionRunner = vi.fn().mockRejectedValue({ code: 'P2034' });
    const persistedHistoryLookup = vi.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: transactionRunner,
      preAdmissionAccessHistory: {
        findUnique: persistedHistoryLookup,
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn(),
      },
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).create(creationInput()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactionRunner).toHaveBeenCalledTimes(3);
    expect(persistedHistoryLookup).toHaveBeenCalledTimes(3);
  });

  it('retries a nested transaction write conflict when renewing and replays the winner', async () => {
    const renewedRow = {
      ...accessRow,
      tokenGeneration: 2,
      version: 2,
    };
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(authorizedActor) },
      preAdmissionAccessHistory: {
        findUnique: vi.fn().mockResolvedValue({
          preAdmissionAccessId: accessId,
          actorUserId,
          action: 'renewed',
          requestFingerprint: 'a'.repeat(64),
          resultVersion: 2,
          resultTokenGeneration: 2,
          resultExpiresAt: expiresAt,
          resultRevokedAt: null,
        }),
      },
      preAdmissionAccess: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(renewedRow),
      },
    };
    const transactionRunner = vi
      .fn()
      .mockRejectedValueOnce({
        cause: { kind: 'TransactionWriteConflict' },
      })
      .mockImplementationOnce(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).renew({
        companyId,
        actorUserId,
        accessId,
        commandId,
        expectedVersion: 1,
        requestFingerprint: 'a'.repeat(64),
        tokenHash: 'c'.repeat(64),
        tokenGeneration: 2,
        expiresAt,
        now,
      }),
    ).resolves.toMatchObject({ idempotent: true, resultVersion: 2 });
    expect(transactionRunner).toHaveBeenCalledTimes(2);
  });

  it('only resolves public access for an active company and person', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      preAdmissionAccess: { findFirst },
    } as unknown as PrismaService;

    await expect(
      new PrismaPreAdmissionAccessRepository(prisma).resolve({
        accessId,
        tokenHash: 'b'.repeat(64),
        now,
      }),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          company: { status: 'ACTIVE' },
          personRegistration: { status: 'ACTIVE' },
        }),
      }),
    );
  });
});
