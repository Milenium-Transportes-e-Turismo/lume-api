import { Injectable } from '@nestjs/common';

import { forbidden, validationError } from '../../../core/errors/app-error';
import {
  Prisma,
  type RoutingCompany,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { DataExchangeUseCase } from '../data-exchange/data-exchange.use-case';

export const GOOGLE_CONTACTS_BATCH_SIZE = 3000;
const contactInclude = {
  registrationPhones: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  registrationEmails: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  fixedPoints: {
    where: { code: { startsWith: 'ADR-' }, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
  tagAssignments: { include: { tag: true } },
} satisfies Prisma.RoutingCompanyInclude;
type ExportRegistration = Prisma.RoutingCompanyGetPayload<{
  include: typeof contactInclude;
}>;

function legacyPhones(row: RoutingCompany): string[] {
  const values =
    row.clientType === 'PF' ? row.individualPhones : row.legalPhones;
  const whatsapp =
    row.clientType === 'PF' ? row.individualWhatsapp : row.legalWhatsapp;
  return [whatsapp, ...(Array.isArray(values) ? values : [])].flatMap(
    (value) => (typeof value === 'string' ? [value] : []),
  );
}

function internationalPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const normalized =
    !value.trim().startsWith('+') &&
    (digits.length === 10 || digits.length === 11)
      ? '55' + digits
      : digits;
  return /^[1-9][0-9]{6,14}$/.test(normalized) ? '+' + normalized : null;
}

export function exportContact(row: ExportRegistration, today: string) {
  const phones = row.registrationPhones.length
    ? row.registrationPhones
        .filter(
          (phone) =>
            (!phone.activeFrom ||
              phone.activeFrom.toISOString().slice(0, 10) <= today) &&
            (!phone.activeUntil ||
              phone.activeUntil.toISOString().slice(0, 10) >= today),
        )
        .map((phone) => '+' + phone.normalizedValue.replace(/^\+/, ''))
    : legacyPhones(row);
  const emails = row.registrationEmails.length
    ? row.registrationEmails.map((email) => email.address)
    : [row.clientType === 'PF' ? row.individualEmail : row.legalEmail].filter(
        (email): email is string => !!email,
      );
  return {
    id: row.id,
    name:
      row.clientType === 'PF'
        ? row.individualName || row.legalName
        : row.tradeName || row.legalName,
    firstName:
      row.clientType === 'PF'
        ? row.firstName || row.individualName || row.legalName
        : row.tradeName || row.legalName,
    lastName:
      row.clientType === 'PF' && row.firstName ? row.lastName || '' : '',
    organization: row.clientType === 'PJ' ? row.legalName : '',
    phones: [
      ...new Set(
        phones
          .map(internationalPhone)
          .filter((phone): phone is string => !!phone),
      ),
    ],
    emails: [
      ...new Map(
        emails.map((email) => [email.trim().toLowerCase(), email.trim()]),
      ).values(),
    ],
    address: row.fixedPoints[0],
    labels: [
      'Lume',
      ...row.tagAssignments.map(({ tag }) => tag.name).sort(),
    ].join(' ::: '),
  };
}

export function googleContactsTable(
  contacts: ReturnType<typeof exportContact>[],
) {
  const phoneCount = Math.max(
    1,
    ...contacts.map((contact) => contact.phones.length),
  );
  const emailCount = Math.max(
    1,
    ...contacts.map((contact) => contact.emails.length),
  );
  const headers = ['First Name', 'Last Name', 'Organization Name'];
  for (let index = 1; index <= phoneCount; index++)
    headers.push('Phone ' + index + ' - Label', 'Phone ' + index + ' - Value');
  for (let index = 1; index <= emailCount; index++)
    headers.push('Email ' + index + ' - Label', 'Email ' + index + ' - Value');
  headers.push(
    'Address 1 - Label',
    'Address 1 - Street',
    'Address 1 - Extended Address',
    'Address 1 - City',
    'Address 1 - Region',
    'Address 1 - Postal Code',
    'Address 1 - Country',
    'Labels',
  );
  if (headers.length > 200)
    throw validationError(
      'Há contatos com telefones ou e-mails demais para um único arquivo.',
    );
  const rows = contacts.map((contact) => {
    const row = [contact.firstName, contact.lastName, contact.organization];
    for (let index = 0; index < phoneCount; index++)
      row.push(
        contact.phones[index] ? 'Other' : '',
        contact.phones[index] || '',
      );
    for (let index = 0; index < emailCount; index++)
      row.push(
        contact.emails[index] ? 'Other' : '',
        contact.emails[index] || '',
      );
    const address = contact.address;
    row.push(
      address ? 'Other' : '',
      address
        ? [address.street, address.number].filter(Boolean).join(', ')
        : '',
      address
        ? [address.complement, address.district].filter(Boolean).join(', ')
        : '',
      address?.city || '',
      address?.state || '',
      address?.postalCode || '',
      address ? 'Brasil' : '',
      contact.labels,
    );
    return row;
  });
  return { headers, rows };
}

@Injectable()
export class RegistrationContactExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: DataExchangeUseCase,
  ) {}

  private where(
    current: AuthenticatedPrincipal,
  ): Prisma.RoutingCompanyWhereInput {
    return {
      companyId: current.companyId,
      status: 'ACTIVE',
      isTemporary: false,
      ...(current.routingCompanyId ? { id: current.routingCompanyId } : {}),
    };
  }

  async preview(current: AuthenticatedPrincipal, batch = 1) {
    const where = this.where(current);
    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.routingCompany.count({ where }),
        this.prisma.routingCompany.findMany({
          where,
          include: contactInclude,
          orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
          skip: (batch - 1) * GOOGLE_CONTACTS_BATCH_SIZE,
          take: 20,
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    });
    return {
      total,
      batch,
      batchSize: GOOGLE_CONTACTS_BATCH_SIZE,
      totalBatches: Math.max(1, Math.ceil(total / GOOGLE_CONTACTS_BATCH_SIZE)),
      contacts: rows.map((row) => {
        const contact = exportContact(row, today);
        return {
          id: contact.id,
          name: contact.name,
          phones: contact.phones,
          emails: contact.emails,
        };
      }),
    };
  }

  async export(current: AuthenticatedPrincipal, commandId: string, batch = 1) {
    if (
      !current.permissions.includes('documents:view') &&
      !current.permissions.includes('documents:manage')
    ) {
      throw forbidden('Você não tem permissão para exportar arquivos.');
    }
    const rows = await this.prisma.routingCompany.findMany({
      where: this.where(current),
      include: contactInclude,
      orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
      skip: (batch - 1) * GOOGLE_CONTACTS_BATCH_SIZE,
      take: GOOGLE_CONTACTS_BATCH_SIZE,
    });
    if (!rows.length)
      throw validationError(
        'Nenhum cadastro aprovado e ativo disponível neste lote.',
      );
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    });
    const table = googleContactsTable(
      rows.map((row) => exportContact(row, today)),
    );
    const stored = await this.exchange.exportCsv({
      companyId: current.companyId,
      actorUserId: current.id,
      commandId,
      fileName: 'lume-google-contacts-' + batch + '.csv',
      purpose: 'approved-registration-contacts',
      ...table,
    });
    return this.exchange.getContent(current.companyId, stored.artifact.id);
  }
}
