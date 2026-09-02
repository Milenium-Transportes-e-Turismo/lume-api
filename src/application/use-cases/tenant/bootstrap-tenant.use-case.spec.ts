import { describe, expect, it } from 'vitest';

import { companyFixture } from '../../../../test/fixtures/company';
import {
  FakeOfflineLicenseVerifier,
  FakePasswordHasher,
  InMemoryStore,
  InMemoryTenantBootstrapRepository,
} from '../../../../test/fakes/in-memory';
import {
  ASSIGNABLE_DEPARTMENTS,
  ASSIGNABLE_DEPARTMENT_LABELS,
} from '../../../domain/access/access.constants';
import { BootstrapTenantUseCase } from './bootstrap-tenant.use-case';

describe('BootstrapTenantUseCase', () => {
  it('publishes all assignable departments with PT-BR labels', () => {
    expect(ASSIGNABLE_DEPARTMENTS).toEqual([
      'client-company',
      'human-resources',
      'commercial',
      'purchasing',
      'controllership',
      'personnel-department',
      'financial',
      'management',
      'directorate',
      'maintenance',
      'monitoring',
      'operations',
      'information-technology',
    ]);
    expect(
      ASSIGNABLE_DEPARTMENTS.map(
        (department) => ASSIGNABLE_DEPARTMENT_LABELS[department],
      ),
    ).toEqual([
      'Empresa cliente',
      'Recursos Humanos',
      'Comercial',
      'Compras',
      'Controladoria',
      'Departamento Pessoal',
      'Financeiro',
      'Gerência',
      'Diretoria',
      'Manutenção',
      'Monitoramento',
      'Operacional',
      'Tecnologia da Informação (TI)',
    ]);
  });

  it('uses the tenant id signed by the control plane', async () => {
    const store = new InMemoryStore();
    const license = new FakeOfflineLicenseVerifier();
    const result = await new BootstrapTenantUseCase(
      new InMemoryTenantBootstrapRepository(store),
      new FakePasswordHasher(),
      license,
    ).execute(companyFixture);

    expect(result.tenant.id).toBe(license.status().payload.tenantId);
    expect(store.tenantDepartments).toHaveLength(13);
    expect(
      store.tenantDepartments.map((department) => department.name),
    ).toEqual([
      'Empresa cliente',
      'Recursos Humanos',
      'Comercial',
      'Compras',
      'Controladoria',
      'Departamento Pessoal',
      'Financeiro',
      'Gerência',
      'Diretoria',
      'Manutenção',
      'Monitoramento',
      'Operacional',
      'Tecnologia da Informação (TI)',
    ]);
    expect(
      store.tenantDepartments.find((department) => department.isDefault)?.code,
    ).toBe('commercial');
    expect(store.users).toHaveLength(1);
    expect(store.users[0].props).toMatchObject({
      isAdministrator: true,
      mustChangePassword: true,
      departments: [],
      permissionCodes: [],
    });
  });

  it('refuses a second tenant in the same installation', async () => {
    const store = new InMemoryStore();
    const useCase = new BootstrapTenantUseCase(
      new InMemoryTenantBootstrapRepository(store),
      new FakePasswordHasher(),
      new FakeOfflineLicenseVerifier(),
    );
    await useCase.execute(companyFixture);
    await expect(useCase.execute(companyFixture)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
