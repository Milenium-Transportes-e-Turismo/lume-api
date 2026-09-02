import { describe, expect, it, vi } from 'vitest';

import { PrismaRegistrationIdentityCandidateReader } from './prisma-registration-identity-candidate.reader';

describe('PrismaRegistrationIdentityCandidateReader', () => {
  it('returns canonical Pessoa candidates isolated by tenant', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'person-1',
        companyId: 'company-1',
        clientType: 'PF',
        cpf: '52998224725',
        individualEmail: 'primary@example.com',
        registrationEmails: [{ address: 'secondary@example.com' }],
      },
    ]);
    const reader = new PrismaRegistrationIdentityCandidateReader({
      routingCompany: { findMany },
    } as never);

    await expect(
      reader.findCandidates({
        companyId: 'company-1',
        cpf: '52998224725',
        email: 'primary@example.com',
      }),
    ).resolves.toEqual([
      {
        registrationId: 'person-1',
        companyId: 'company-1',
        type: 'pf',
        cpf: '52998224725',
        emails: ['primary@example.com', 'secondary@example.com'],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
        orderBy: { id: 'asc' },
      }),
    );
  });

  it('does not query the database without CPF or e-mail evidence', async () => {
    const findMany = vi.fn();
    const reader = new PrismaRegistrationIdentityCandidateReader({
      routingCompany: { findMany },
    } as never);

    await expect(
      reader.findCandidates({
        companyId: 'company-1',
        cpf: null,
        email: null,
      }),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
