import { describe, expect, it } from 'vitest';

import { FakePasswordHasher } from '../../../test/fakes/in-memory';
import {
  selectBootstrapAdministrator,
  stillUsesBootstrapPassword,
} from './production-bootstrap.service';

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
