import { describe, it, expect, vi } from 'vitest';
import { TransportCatalogUseCase } from './transport-catalog.use-case';
import type { TransportCatalogRepository } from './transport-catalog.repository';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
const principal = {
  id: '6b9b642a-0bf2-4d69-adf9-7a7f634659ef',
  companyId: '7b9b642a-0bf2-4d69-adf9-7a7f634659ef',
  isActive: true,
  isAdministrator: false,
  permissions: ['clients:view', 'clients:update'],
  departments: ['operations'],
} as unknown as AuthenticatedPrincipal;
function setup() {
  const repository = {
    list: vi.fn(),
    save: vi.fn(),
    get: vi.fn(),
    contractCandidates: vi.fn(),
  };
  return {
    repository,
    service: new TransportCatalogUseCase(
      repository as unknown as TransportCatalogRepository,
    ),
  };
}
describe('transport authorization and bounded access', () => {
  it('uses authenticated tenant and bounds pagination before querying', async () => {
    const { service, repository } = setup();
    await service.list(principal, 'companies', {
      page: '2',
      pageSize: '50',
      companyId: 'other',
    });
    expect(repository.list).toHaveBeenCalledWith(
      principal.companyId,
      'companies',
      { page: 2, pageSize: 50, search: '', kind: undefined },
    );
    expect(() =>
      service.list(principal, 'companies', { pageSize: '100000' }),
    ).toThrow('Paginação');
  });
  it('denies operations with unrelated view permissions and deactivation bypass', () => {
    const { service, repository } = setup();
    expect(() => service.get(principal, 'contracts', principal.id)).toThrow(
      'permissão',
    );
    expect(() =>
      service.save(
        principal,
        'companies',
        { commandId: principal.id, expectedVersion: 1, active: false },
        principal.id,
      ),
    ).toThrow('diretoria');
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('enforces expected version for creation and updates before persistence', () => {
    const { service, repository } = setup();
    expect(() =>
      service.save(
        principal,
        'companies',
        { commandId: principal.id, expectedVersion: 0, tradeName: 'Novo nome' },
        principal.id,
      ),
    ).toThrow('versão');
    expect(repository.save).not.toHaveBeenCalled();
  });
});

it('validates profile filters before querying lists or contract candidates', async () => {
  const { service, repository } = setup();
  const actor = { ...principal, isAdministrator: true };
  await service.list(actor, 'affiliations', { registrationId: principal.id });
  await service.list(actor, 'contracts', { registrationId: principal.id });
  await service.contractCandidates(actor, { registrationId: principal.id });
  expect(repository.list).toHaveBeenCalledWith(
    principal.companyId,
    'contracts',
    expect.objectContaining({ registrationId: principal.id }),
  );
  expect(repository.contractCandidates).toHaveBeenCalledWith(
    principal.companyId,
    expect.objectContaining({ registrationId: principal.id }),
  );
  for (const registrationId of ['', 'invalid', 'one,two']) {
    expect(() =>
      service.list(actor, 'affiliations', { registrationId }),
    ).toThrow();
    expect(() =>
      service.contractCandidates(actor, { registrationId }),
    ).toThrow();
  }
  expect(repository.list).toHaveBeenCalledTimes(2);
  expect(repository.contractCandidates).toHaveBeenCalledTimes(1);
});
