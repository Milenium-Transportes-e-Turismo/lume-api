import { describe, expect, it } from 'vitest';

import { ListPermissionsUseCase } from './list-permissions.use-case';

describe('ListPermissionsUseCase', () => {
  it('publishes a curated department and resource-action catalog', () => {
    const catalog = new ListPermissionsUseCase().execute();

    expect(catalog.permissions).toContain('dashboard:view');
    expect(catalog.permissions).toContain('users:manage');
    expect(catalog.permissions).not.toContain('users:delete');
    expect(catalog.permissions).not.toContain('dashboard:delete');
    expect(catalog.actionsByResource.dashboard).toEqual(['view']);
    expect(catalog.departments).toHaveLength(13);
    expect(catalog.permissions).toContain('tenant:manage');
    expect(catalog.permissions).toContain('whatsapp-conversations:attend');
    expect(catalog.permissions).toContain('service-confirmations:approve');
    expect(catalog.permissions).toContain('routing-contracts:view');
    expect(catalog.departments).toContainEqual({
      code: 'client-company',
      name: 'Empresa cliente',
    });
    expect(catalog.departments).toContainEqual({
      code: 'information-technology',
      name: 'Tecnologia da Informação (TI)',
    });
    expect(catalog.departments).toContainEqual({
      code: 'human-resources',
      name: 'Recursos Humanos',
    });
    expect(catalog.departments).toContainEqual({
      code: 'directorate',
      name: 'Diretoria',
    });
    for (const department of catalog.departments) {
      if (department.code === 'client-company') {
        expect(catalog.permissionsByDepartment[department.code]).not.toContain(
          'whatsapp-conversations:attend',
        );
      } else {
        expect(catalog.permissionsByDepartment[department.code]).toContain(
          'whatsapp-conversations:attend',
        );
      }
    }
    expect(catalog.permissionsByDepartment.management).toEqual(
      expect.arrayContaining([
        'clients:view',
        'clients:create',
        'clients:update',
      ]),
    );
    expect(catalog.permissionsByDepartment.management).not.toContain(
      'clients:manage',
    );
  });
});
