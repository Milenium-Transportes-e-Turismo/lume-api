import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  FakeOfflineLicenseVerifier,
  FakePasswordHasher,
} from '../../../test/fakes/in-memory';
import { ensurePlatformAgentCatalog } from '../agents/platform-agent-persistence';
import {
  ProductionBootstrapService,
  selectBootstrapAdministrator,
  stillUsesBootstrapPassword,
} from './production-bootstrap.service';

vi.mock('../agents/platform-agent-persistence', () => ({
  ensurePlatformAgentCatalog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./document-catalog.seed', () => ({
  seedInitialDocumentCatalog: vi.fn().mockResolvedValue(undefined),
}));

const tenantId = '00000000-0000-4000-8000-000000000001';
const administrator = {
  id: '00000000-0000-4000-8000-000000000002',
  companyId: tenantId,
  passwordHash: 'stored-hash',
};

describe('production bootstrap password policy', () => {
  it('requires first access only while the stored hash still matches the bootstrap password', async () => {
    const passwordHasher = new FakePasswordHasher();
    const initialPassword = 'SenhaInicial@2026';

    await expect(
      stillUsesBootstrapPassword(
        passwordHasher,
        initialPassword,
        await passwordHasher.hash(initialPassword),
      ),
    ).resolves.toBe(true);
    await expect(
      stillUsesBootstrapPassword(
        passwordHasher,
        initialPassword,
        await passwordHasher.hash('SenhaJaAlterada@2026'),
      ),
    ).resolves.toBe(false);
    await expect(
      stillUsesBootstrapPassword(
        passwordHasher,
        '',
        await passwordHasher.hash(initialPassword),
      ),
    ).resolves.toBe(false);
  });
});

describe('production bootstrap administrator identity', () => {
  it('reuses the only matching user from the licensed tenant', () => {
    expect(selectBootstrapAdministrator([administrator], tenantId)).toEqual(
      administrator,
    );
  });

  it('rejects identifiers that resolve to different users', () => {
    expect(() =>
      selectBootstrapAdministrator(
        [
          administrator,
          {
            ...administrator,
            id: '00000000-0000-4000-8000-000000000003',
          },
        ],
        tenantId,
      ),
    ).toThrow(/correspondem a usuários diferentes/);
  });

  it('rejects an identifier owned by another tenant', () => {
    expect(() =>
      selectBootstrapAdministrator(
        [
          {
            ...administrator,
            companyId: '00000000-0000-4000-8000-000000000004',
          },
        ],
        tenantId,
      ),
    ).toThrow(/pertence a outro tenant/);
  });
});

describe('production bootstrap catalog synchronization', () => {
  it('synchronizes the platform agent catalog after the company exists', async () => {
    const transaction = {
      company: {
        upsert: vi.fn().mockResolvedValue({ id: tenantId }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([administrator]),
        update: vi.fn().mockResolvedValue(administrator),
      },
      tenantDepartment: {
        upsert: vi.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `department-${String(create.code).toLowerCase()}`,
          }),
        ),
      },
      tenantAuditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-id' }),
      },
    };
    const prisma = {
      company: {
        findFirst: vi.fn().mockResolvedValue({ id: tenantId }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([administrator]),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const config = new ConfigService({
      TENANT_LEGAL_NAME: 'Empresa Exemplo Ltda.',
      TENANT_TRADE_NAME: 'Empresa Exemplo',
      TENANT_TAX_ID: '04.252.011/0001-10',
      TENANT_ADMIN_NAME: 'Ana Souza',
      TENANT_ADMIN_USERNAME: 'ana.souza',
      TENANT_ADMIN_EMAIL: 'ana@empresa.test',
      TENANT_ADMIN_CPF: '529.982.247-25',
      WHATSAPP_ENABLED: false,
    });

    await new ProductionBootstrapService(
      prisma as never,
      new FakePasswordHasher(),
      new FakeOfflineLicenseVerifier(tenantId),
      config,
    ).execute();

    expect(transaction.company.upsert).toHaveBeenCalledOnce();
    expect(ensurePlatformAgentCatalog).toHaveBeenCalledWith(
      transaction,
      tenantId,
    );
    expect(transaction.company.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensurePlatformAgentCatalog).mock.invocationCallOrder[0],
    );
  });
});
