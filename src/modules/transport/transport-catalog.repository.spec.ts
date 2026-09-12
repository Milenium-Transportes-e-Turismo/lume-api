import { describe, it, expect, vi } from 'vitest';
import { TransportCatalogRepository } from './transport-catalog.repository';
import type { PrismaService } from '../../infra/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
const current = { id: 'actor', companyId: 'tenant' } as AuthenticatedPrincipal;
function fakeCatalog() {
  const receipts = new Map<
    string,
    { requestHash: string; response: unknown }
  >();
  const catalog = {
    id: 'item',
    companyId: 'tenant',
    kind: 'service-type',
    code: 'custom',
    name: 'Before',
    active: true,
    version: 1,
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    transportCatalogCommand: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { companyId_commandId: { commandId: string } };
        }) =>
          Promise.resolve(
            receipts.get(where.companyId_commandId.commandId) ?? null,
          ),
      ),
      create: vi.fn(
        ({
          data,
        }: {
          data: { commandId: string; requestHash: string; response: unknown };
        }) => {
          receipts.set(data.commandId, data);
          return Promise.resolve(data);
        },
      ),
    },
    transportCatalogItem: {
      findFirst: vi.fn(({ where }: { where: { companyId: string } }) =>
        Promise.resolve(where.companyId === 'tenant' ? { ...catalog } : null),
      ),
      update: vi.fn(
        ({ data }: { data: { name?: string; active?: boolean } }) => {
          catalog.version++;
          if (data.name !== undefined) catalog.name = data.name;
          if (data.active !== undefined) catalog.active = data.active;
          return Promise.resolve({ ...catalog });
        },
      ),
    },
    tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  return {
    tx,
    catalog,
    repository: new TransportCatalogRepository(
      prisma as unknown as PrismaService,
    ),
  };
}
describe('transport atomic persistence', () => {
  it('replays the original response without duplicating audit even after a later edit', async () => {
    const { repository, tx, catalog } = fakeCatalog();
    const first = { commandId: 'one', expectedVersion: 1, name: 'First' };
    const saved = await repository.save(current, 'catalogs', first, 'item');
    await repository.save(
      current,
      'catalogs',
      { commandId: 'two', expectedVersion: 2, name: 'Second' },
      'item',
    );
    expect(await repository.save(current, 'catalogs', first, 'item')).toEqual(
      saved,
    );
    expect(catalog.name).toBe('Second');
    expect(tx.tenantAuditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.transportCatalogItem.update).toHaveBeenCalledTimes(2);
  });
  it('rejects command reuse for another payload, actor or stale version', async () => {
    const { repository, tx } = fakeCatalog();
    await repository.save(
      current,
      'catalogs',
      { commandId: 'one', expectedVersion: 1, name: 'First' },
      'item',
    );
    await expect(
      repository.save(
        current,
        'catalogs',
        { commandId: 'one', expectedVersion: 1, name: 'Different' },
        'item',
      ),
    ).rejects.toThrow('commandId');
    await expect(
      repository.save(
        { ...current, id: 'other' },
        'catalogs',
        { commandId: 'one', expectedVersion: 1, name: 'First' },
        'item',
      ),
    ).rejects.toThrow('commandId');
    await expect(
      repository.save(
        current,
        'catalogs',
        { commandId: 'new', expectedVersion: 1, name: 'Stale' },
        'item',
      ),
    ).rejects.toThrow('alterado');
    expect(tx.transportCatalogItem.update).toHaveBeenCalledTimes(1);
  });
  it('cannot read or mutate another tenant catalog even with its ID', async () => {
    const { repository, tx } = fakeCatalog();
    await expect(repository.get('other', 'catalogs', 'item')).rejects.toThrow(
      'não encontrado',
    );
    await expect(
      repository.save(
        { ...current, companyId: 'other' },
        'catalogs',
        { commandId: 'one', expectedVersion: 1, name: 'Intrusion' },
        'item',
      ),
    ).rejects.toThrow('não encontrado');
    expect(tx.transportCatalogItem.update).not.toHaveBeenCalled();
  });
  it('does not allow overlapping route assignments and checks contractual boundaries', async () => {
    const { tx } = fakeCatalog();
    const extended = {
      ...tx,
      transportExternalRoute: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'route', version: 1, assignments: [] }),
      },
      transportContractProfile: {
        findFirst: vi.fn().mockResolvedValue({
          contract: { validFrom: new Date('2026-01-01'), validUntil: null },
        }),
      },
      transportRouteAssignment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'old' }),
        create: vi.fn(),
      },
    };
    const repository = new TransportCatalogRepository({
      $transaction: (work: (tx: typeof extended) => Promise<unknown>) =>
        work(extended),
    } as unknown as PrismaService);
    await expect(
      repository.addPeriod(current, 'routes', 'route', {
        commandId: 'assign',
        expectedVersion: 1,
        contractId: 'contract',
        validFrom: '2026-09-01',
      }),
    ).rejects.toThrow('já pertence');
    expect(extended.transportRouteAssignment.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        companyId: 'tenant',
        routeId: 'route',
        validFrom: { lte: new Date('9999-12-31') },
      }),
    });
    expect(extended.transportRouteAssignment.create).not.toHaveBeenCalled();
    await expect(
      repository.addPeriod(current, 'routes', 'route', {
        commandId: 'tooearly',
        expectedVersion: 1,
        contractId: 'contract',
        validFrom: '2025-12-31',
      }),
    ).rejects.toThrow('contida');
  });
  it('attaches a transport profile to an existing canonical contract without recreating it', async () => {
    const { tx } = fakeCatalog();
    const contract = {
      id: 'legacy-contract',
      routingCompanyId: 'client',
      code: 'LEGACY',
      name: 'Existing contract',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01'),
      validUntil: null,
      version: 7,
      transportProfile: null,
    };
    const profile = {
      contractId: contract.id,
      companyId: 'tenant',
      supplierRegistrationId: 'supplier',
      modality: 'continuous',
      contract,
      conditions: [],
    };
    const extended = {
      ...tx,
      routingCompany: {
        findFirst: vi.fn().mockResolvedValue({ id: 'client' }),
      },
      transportSupplierProfile: {
        findFirst: vi.fn().mockResolvedValue({ registrationId: 'supplier' }),
      },
      routingContract: {
        findFirst: vi.fn().mockResolvedValue(contract),
        create: vi.fn(),
      },
      transportContractProfile: {
        create: vi.fn().mockResolvedValue(profile),
        findUnique: vi.fn().mockResolvedValue(profile),
      },
      routingContractHistory: { create: vi.fn().mockResolvedValue({}) },
    };
    const repository = new TransportCatalogRepository({
      $transaction: (work: (tx: typeof extended) => Promise<unknown>) =>
        work(extended),
    } as unknown as PrismaService);
    const input = {
      commandId: 'attach',
      expectedVersion: 0,
      existingContractId: contract.id,
      clientRegistrationId: 'client',
      supplierRegistrationId: 'supplier',
      code: 'LEGACY',
      name: 'Existing contract',
      status: 'active' as const,
      modality: 'continuous',
      validFrom: '2026-01-01',
    };
    const saved = await repository.save(current, 'contracts', input);
    expect(saved).toEqual(
      expect.objectContaining({ id: 'legacy-contract', version: 7 }),
    );
    expect(extended.routingContract.create).not.toHaveBeenCalled();
    expect(extended.transportContractProfile.create).toHaveBeenCalledWith({
      data: {
        contractId: 'legacy-contract',
        companyId: 'tenant',
        supplierRegistrationId: 'supplier',
        modality: 'continuous',
      },
    });
    await expect(
      repository.save(current, 'contracts', {
        ...input,
        commandId: 'wrong',
        code: 'changed',
      }),
    ).rejects.toThrow('diferem');
    expect(extended.transportContractProfile.create).toHaveBeenCalledTimes(1);
  });
});
