import { describe, expect, it, vi } from 'vitest';
import { RoutingCompaniesUseCase } from './routing-companies.use-case';
import { RoutingRepository } from '../../contracts/routing.repository';
import { createRoutingCompany } from '../../../domain/routing/routing-company';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
const current = { id: 'user', companyId: 'tenant' } as AuthenticatedPrincipal;
const input = {
  clientType: 'pj' as const,
  cnpj: '11.222.333/0001-81',
  legalName: 'Test Company',
  commandId: 'command',
};
function harness() {
  const company = createRoutingCompany({
    ...input,
    companyId: current.companyId,
  });
  const repository = {
    findCompanyByUniqueValue: vi.fn().mockResolvedValue(null),
    createCompany: vi.fn().mockImplementation((c) => Promise.resolve(c)),
    findCompany: vi.fn().mockResolvedValue(company),
    listCompanies: vi.fn().mockResolvedValue({ items: [company], total: 1 }),
    updateCompany: vi.fn().mockResolvedValue(company),
    listCompanyHistory: vi
      .fn()
      .mockResolvedValue([
        { createdAt: new Date('2026-01-01'), action: 'updated' },
      ]),
    listCompanyComments: vi.fn().mockResolvedValue([
      {
        id: 'comment',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]),
    createCompanyComment: vi.fn().mockResolvedValue({ id: 'comment' }),
    updateCompanyComment: vi.fn().mockResolvedValue({ id: 'comment' }),
    deleteCompanyComment: vi.fn().mockResolvedValue(true),
  };
  return {
    company,
    repository,
    service: new RoutingCompaniesUseCase(
      repository as unknown as RoutingRepository,
    ),
  };
}
describe('routing company access and mutation safeguards', () => {
  it('normalizes company documents and scopes uniqueness to the tenant', async () => {
    const { service, repository } = harness();
    expect(await service.create(current, input)).toMatchObject({
      companyId: 'tenant',
      cnpj: '11222333000181',
      createdAt: expect.any(String),
      avicLastSyncedAt: null,
    });
    expect(repository.findCompanyByUniqueValue).toHaveBeenCalledWith(
      'tenant',
      'cnpj',
      '11222333000181',
      undefined,
    );
    expect(repository.createCompany).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'tenant' }),
      'command',
    );
  });
  it('prevents a customer-scoped user from creating another customer', async () => {
    const { service, repository } = harness();
    await expect(
      service.create({ ...current, routingCompanyId: 'own' }, input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.createCompany).not.toHaveBeenCalled();
  });
  it('rejects duplicate corporate identity without storing another record', async () => {
    const { service, repository, company } = harness();
    repository.findCompanyByUniqueValue.mockResolvedValue(company);
    await expect(service.create(current, input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repository.createCompany).not.toHaveBeenCalled();
  });
  it('limits customer users to their own registration and returns empty when unavailable', async () => {
    const { service, repository, company } = harness();
    const user = { ...current, routingCompanyId: company.id };
    const query = { page: 1, pageSize: 10 };
    expect((await service.list(user, query)).total).toBe(1);
    expect(repository.listCompanies).not.toHaveBeenCalled();
    expect(repository.findCompany).toHaveBeenCalledWith('tenant', company.id);
    repository.findCompany.mockResolvedValue(null);
    expect(await service.list(user, query)).toEqual({ items: [], total: 0 });
  });
  it('forwards staff list filters within the tenant and formats timestamps', async () => {
    const { service, repository } = harness();
    const q = { page: 2, pageSize: 10, search: 'Test' };
    expect((await service.list(current, q)).items[0].createdAt).toEqual(
      expect.any(String),
    );
    expect(repository.listCompanies).toHaveBeenCalledWith('tenant', q);
  });
  it('rejects access to another customer before reading data', async () => {
    const { service, repository } = harness();
    await expect(
      service.get({ ...current, routingCompanyId: 'own' }, 'other'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.findCompany).not.toHaveBeenCalled();
    repository.findCompany.mockResolvedValue(null);
    await expect(service.get(current, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('preserves command identity and version on update and refuses a lost update', async () => {
    const { service, repository, company } = harness();
    await service.update(current, company.id, { ...input, expectedVersion: 2 });
    expect(repository.updateCompany).toHaveBeenCalledWith(
      'tenant',
      company.id,
      expect.objectContaining({
        commandId: 'command',
        expectedVersion: 2,
        actorUserId: 'user',
        taxId: '11222333000181',
      }),
    );
    expect(repository.findCompanyByUniqueValue).toHaveBeenCalledWith(
      'tenant',
      'cnpj',
      '11222333000181',
      company.id,
    );
    repository.updateCompany.mockResolvedValue(null);
    await expect(
      service.update(current, company.id, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('supports a PF with only a WhatsApp number without inventing a CPF', async () => {
    const { service, repository, company } = harness();
    await service.update(current, company.id, {
      clientType: 'pf',
      individualWhatsapp: '34999990000',
      commandId: 'command',
      expectedVersion: 1,
    });
    expect(repository.updateCompany).toHaveBeenCalledWith(
      'tenant',
      company.id,
      expect.objectContaining({
        cpf: null,
        taxId: expect.stringMatching(/^pf/),
        legalName: '5534999990000',
      }),
    );
  });
  it('keeps history and comment reads behind the same ownership check', async () => {
    const { service, repository, company } = harness();
    expect(await service.history(current, company.id)).toEqual([
      { createdAt: '2026-01-01T00:00:00.000Z', action: 'updated' },
    ]);
    expect(await service.comments(current, company.id)).toEqual([
      {
        id: 'comment',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    repository.findCompany.mockResolvedValue(null);
    await expect(service.comments(current, 'other')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('trims comments and rejects empty text without a write', async () => {
    const { service, repository, company } = harness();
    await expect(
      service.addComment(current, company.id, {
        commandId: 'command',
        comment: ' ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.createCompanyComment).not.toHaveBeenCalled();
    await service.addComment(current, company.id, {
      commandId: 'command',
      comment: ' note ',
    });
    expect(repository.createCompanyComment).toHaveBeenCalledWith({
      companyId: 'tenant',
      routingCompanyId: company.id,
      actorUserId: 'user',
      commandId: 'command',
      comment: 'note',
    });
  });
  it('updates and removes a comment with tenant, actor and command scope', async () => {
    const { service, repository, company } = harness();
    const expected = {
      companyId: 'tenant',
      routingCompanyId: company.id,
      actorUserId: 'user',
      commandId: 'command',
      commentId: 'comment',
    };
    await service.updateComment(current, company.id, 'comment', {
      commandId: 'command',
      comment: ' revised ',
    });
    expect(repository.updateCompanyComment).toHaveBeenCalledWith({
      ...expected,
      comment: 'revised',
    });
    expect(
      await service.removeComment(current, company.id, 'comment', 'command'),
    ).toEqual({ removed: true });
    expect(repository.deleteCompanyComment).toHaveBeenCalledWith(expected);
  });
  it('rejects absent comment targets and empty updates', async () => {
    const { service, repository, company } = harness();
    await expect(
      service.updateComment(current, company.id, 'comment', {
        commandId: 'command',
        comment: ' ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    repository.updateCompanyComment.mockResolvedValue(null);
    repository.deleteCompanyComment.mockResolvedValue(false);
    await expect(
      service.updateComment(current, company.id, 'comment', {
        commandId: 'command',
        comment: 'note',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.removeComment(current, company.id, 'comment', 'command'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
