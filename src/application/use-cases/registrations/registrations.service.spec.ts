import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { RegistrationsService } from './registrations.service';

vi.mock('../../../infra/database/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('RegistrationsService', () => {
  it('lets the parent registration supply companyId to nested promotion records', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      registrationRole: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'role-client', code: 'client' }]),
      },
      registrationTag: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'tag-operations', code: 'operations' }]),
      },
      routingCompany: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
        findMany: vi.fn().mockResolvedValue([]),
      },
      registrationRelationship: { create: vi.fn() },
      routingCompanyHistory: { create: vi.fn() },
    };
    const service = new RegistrationsService(transaction as never);
    const current = {
      id: 'user-1',
      companyId: 'company-1',
      routingCompanyId: null,
    } as AuthenticatedPrincipal;

    await service.createPromotionGraph(
      transaction as never,
      current,
      {
        type: 'pf',
        firstName: 'ANA',
        roleCodes: ['client'],
        tagCodes: ['operations'],
        phones: [{ number: '(34) 99999-0000' }],
        emails: [{ address: 'ana@example.com' }],
      },
      { commandId: 'command-1', candidateId: 'candidate-1' },
    );

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data.companyId).toBe('company-1');
    expect(data.roleAssignments.create[0]).not.toHaveProperty('companyId');
    expect(data.tagAssignments.create[0]).not.toHaveProperty('companyId');
    expect(data.registrationPhones.create[0]).not.toHaveProperty('companyId');
    expect(data.registrationEmails.create[0]).not.toHaveProperty('companyId');
  });
});
