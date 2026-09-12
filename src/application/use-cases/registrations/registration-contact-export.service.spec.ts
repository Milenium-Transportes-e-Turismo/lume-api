import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import type { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { DataExchangeConverter } from '../../../infra/data-exchange/data-exchange-converter';
import type { DataExchangeUseCase } from '../data-exchange/data-exchange.use-case';
import {
  exportContact,
  googleContactsTable,
  RegistrationContactExportService,
} from './registration-contact-export.service';

vi.mock('../../../infra/database/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

function registration(overrides = {}) {
  return {
    id: 'registration',
    companyId: 'tenant',
    clientType: 'PF',
    legalName: 'José da Silva',
    firstName: 'José',
    lastName: 'da Silva',
    individualName: 'José da Silva',
    registrationPhones: [
      { normalizedValue: '5534999990123', activeFrom: null, activeUntil: null },
      { normalizedValue: '5534999990123', activeFrom: null, activeUntil: null },
      { normalizedValue: '12025550123', activeFrom: null, activeUntil: null },
      {
        normalizedValue: '5534999999999',
        activeFrom: null,
        activeUntil: new Date('2025-01-01'),
      },
      {
        normalizedValue: '5534999999998',
        activeFrom: new Date('2027-01-01'),
        activeUntil: null,
      },
    ],
    registrationEmails: [
      { address: 'jose@example.com' },
      { address: 'JOSE@example.com' },
    ],
    fixedPoints: [
      {
        street: 'Rua A',
        number: '10',
        postalCode: '01001000',
        city: 'São Paulo',
        state: 'SP',
        district: 'Centro',
      },
    ],
    tagAssignments: [{ tag: { name: 'Cliente' } }],
    ...overrides,
  } as unknown as Parameters<typeof exportContact>[0];
}

const current = {
  id: 'user',
  companyId: 'tenant',
  routingCompanyId: null,
  permissions: ['documents:view'],
} as AuthenticatedPrincipal;

describe('Google Contacts export from approved registrations', () => {
  it('keeps current phones, deduplicates within the registration and preserves international country codes', () => {
    const contact = exportContact(registration(), '2026-09-08');
    expect(contact.phones).toEqual(['+5534999990123', '+12025550123']);
    expect(contact.emails).toHaveLength(1);
    expect(contact.labels).toBe('Lume ::: Cliente');
  });

  it('preserves accents, postal code, full name and all contact columns in Google CSV', async () => {
    const contact = exportContact(registration(), '2026-09-08');
    const table = googleContactsTable([contact]);
    const csv = (
      await new DataExchangeConverter().createCsv(table.headers, table.rows)
    ).toString('utf8');
    expect(csv).toContain(
      'First Name,Last Name,Organization Name,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value',
    );
    expect(csv).toContain(
      'José,da Silva,,Other,+5534999990123,Other,+12025550123',
    );
    expect(csv).toContain(
      '"Rua A, 10",Centro,São Paulo,SP,01001000,Brasil,Lume ::: Cliente',
    );
  });

  it('uses the company name and only falls back to legacy contacts when canonical contacts do not exist', () => {
    const contact = exportContact(
      registration({
        clientType: 'PJ',
        legalName: 'Transportes, S.A.',
        tradeName: 'Viação Boa',
        registrationPhones: [],
        legalPhones: ['(34) 99999-0000'],
        registrationEmails: [],
        legalEmail: 'oi@example.com',
      }),
      '2026-09-08',
    );
    expect(contact).toMatchObject({
      firstName: 'Viação Boa',
      lastName: '',
      organization: 'Transportes, S.A.',
      phones: ['+5534999990000'],
    });
    const expired = exportContact(
      registration({
        registrationPhones: [
          {
            normalizedValue: '5534999990000',
            activeUntil: new Date('2025-01-01'),
          },
        ],
        individualWhatsapp: '5534999990000',
      }),
      '2026-09-08',
    );
    expect(expired.phones).toEqual([]);
  });

  it('escapes CSV and neutralizes formulas while preserving only valid phone numbers with +', async () => {
    const csv = (
      await new DataExchangeConverter().createCsv(
        ['First Name', 'Phone 1 - Value', 'Phone 2 - Value'],
        [
          ['=HYPERLINK("x")', '+5534999990123', '+SUM(1,2)'],
          ['José, "Jô"\nSilva', '', ''],
        ],
      )
    ).toString('utf8');
    expect(csv).toContain('+5534999990123');
    expect(csv).toContain(String.fromCharCode(39) + '=HYPERLINK');
    expect(csv).toContain(String.fromCharCode(39) + '+SUM(1,2)');
    expect(csv).toContain('José, ""Jô""');
  });

  it('scopes previews to the tenant and approved active non-temporary registrations, including client account scope', async () => {
    const findMany = vi.fn().mockResolvedValue([registration()]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      routingCompany: { findMany, count },
      $transaction: vi.fn((items: Promise<unknown>[]) => Promise.all(items)),
    };
    const service = new RegistrationContactExportService(
      prisma as unknown as PrismaService,
      {} as DataExchangeUseCase,
    );
    const result = await service.preview(
      { ...current, routingCompanyId: 'restricted-registration' },
      2,
    );
    expect(result.totalBatches).toBe(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'tenant',
          status: 'ACTIVE',
          isTemporary: false,
          transportSupplier: { is: null },
          id: 'restricted-registration',
        },
        skip: 3000,
        take: 20,
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        companyId: 'tenant',
        status: 'ACTIVE',
        isTemporary: false,
        transportSupplier: { is: null },
        id: 'restricted-registration',
      },
    });
  });

  it('limits each file to 3000 records and persists through the existing exchange with tenant and command', async () => {
    const findMany = vi.fn().mockResolvedValue([registration()]);
    const exchange = {
      exportCsv: vi.fn().mockResolvedValue({ artifact: { id: 'artifact' } }),
      getContent: vi.fn().mockResolvedValue({ content: Buffer.from('csv') }),
    };
    const service = new RegistrationContactExportService(
      { routingCompany: { findMany } } as unknown as PrismaService,
      exchange as unknown as DataExchangeUseCase,
    );
    await service.export(current, 'command', 2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 3000,
        take: 3000,
        where: {
          companyId: 'tenant',
          status: 'ACTIVE',
          isTemporary: false,
          transportSupplier: { is: null },
        },
      }),
    );
    expect(exchange.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'command',
        companyId: 'tenant',
        actorUserId: 'user',
        purpose: 'approved-registration-contacts',
      }),
    );
    expect(exchange.getContent).toHaveBeenCalledWith('tenant', 'artifact');
  });

  it('rejects export without document access and does not create empty artifacts', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const exchange = { exportCsv: vi.fn() };
    const service = new RegistrationContactExportService(
      { routingCompany: { findMany } } as unknown as PrismaService,
      exchange as unknown as DataExchangeUseCase,
    );
    await expect(
      service.export({ ...current, permissions: [] }, 'command'),
    ).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
    await expect(service.export(current, 'command')).rejects.toThrow(
      'Nenhum cadastro',
    );
    expect(exchange.exportCsv).not.toHaveBeenCalled();
  });
});
