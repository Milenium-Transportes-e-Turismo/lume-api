import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  DEFAULT_REGISTRATION_ROLES,
  DEFAULT_REGISTRATION_TAGS,
  normalizeRegistrationInput,
  normalizeRegistrationPromotionPayload,
  normalizeRegistrationSearch,
  type NormalizedRegistrationInput,
  type RegistrationInput,
  type RegistrationPromotionPayload,
  type RegistrationRelationshipInput,
} from '../../../domain/registrations/registration';
import {
  Prisma,
  RoutingClientType,
  RoutingCompanyStatus,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { rethrowKnownPrismaConflict } from '../../../infra/database/prisma/prisma-errors';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

const registrationInclude = {
  roleAssignments: { include: { role: true } },
  tagAssignments: { include: { tag: true } },
  registrationPhones: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  registrationEmails: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] },
  externalReferences: { orderBy: [{ provider: 'asc' }, { id: 'asc' }] },
  outgoingRegistrationRelationships: {
    where: { active: true },
    include: {
      target: {
        select: {
          id: true,
          clientType: true,
          individualName: true,
          legalName: true,
          tradeName: true,
        },
      },
    },
  },
  incomingRegistrationRelationships: {
    where: { active: true },
    include: {
      source: {
        select: {
          id: true,
          clientType: true,
          individualName: true,
          legalName: true,
          tradeName: true,
        },
      },
    },
  },
} satisfies Prisma.RoutingCompanyInclude;

type RegistrationRow = Prisma.RoutingCompanyGetPayload<{
  include: typeof registrationInclude;
}>;

export interface RegistrationListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: 'active' | 'inactive';
  type?: 'pf' | 'pj';
  roleCodes?: string[];
  tagCodes?: string[];
  sort?: 'name' | 'status' | 'updated';
}

export interface RegistrationMutationInput extends RegistrationInput {
  commandId: string;
  expectedVersion?: number;
}

export interface RegistrationRelationshipMutationInput {
  targetRegistrationId: string;
  type: string;
  jobTitle?: string | null;
  department?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
  commandId: string;
  expectedVersion?: number;
}

export interface RegistrationPromotionContext {
  commandId: string;
  candidateId: string;
}

function displayName(row: {
  clientType: RoutingClientType;
  individualName: string | null;
  legalName: string;
  tradeName: string | null;
}): string {
  return row.clientType === 'PF'
    ? row.individualName || row.legalName
    : row.tradeName || row.legalName;
}

function presentRegistration(row: RegistrationRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.clientType.toLowerCase() as 'pf' | 'pj',
    status: row.status.toLowerCase() as 'active' | 'inactive',
    displayName: displayName(row),
    firstName: row.firstName,
    lastName: row.lastName,
    individualName: row.individualName,
    legalName: row.legalName,
    tradeName: row.tradeName,
    cpf: row.cpf,
    cnpj: row.cnpj,
    avicExternalId: row.avicExternalId,
    roles: row.roleAssignments
      .map(({ role }) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        isSystem: role.isSystem,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    tags: row.tagAssignments
      .map(({ tag }) => ({
        id: tag.id,
        code: tag.code,
        name: tag.name,
        color: tag.color,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    phones: row.registrationPhones.map((phone) => ({
      ...phone,
      activeFrom: phone.activeFrom?.toISOString().slice(0, 10) ?? null,
      activeUntil: phone.activeUntil?.toISOString().slice(0, 10) ?? null,
      createdAt: phone.createdAt.toISOString(),
      updatedAt: phone.updatedAt.toISOString(),
    })),
    emails: row.registrationEmails.map((email) => ({
      ...email,
      createdAt: email.createdAt.toISOString(),
      updatedAt: email.updatedAt.toISOString(),
    })),
    relationships: [
      ...row.outgoingRegistrationRelationships.map((relationship) => ({
        id: relationship.id,
        direction: 'outgoing' as const,
        type: relationship.type,
        jobTitle: relationship.jobTitle,
        department: relationship.department,
        isPrimary: relationship.isPrimary,
        notes: relationship.notes,
        version: relationship.version,
        relatedRegistration: {
          id: relationship.target.id,
          type: relationship.target.clientType.toLowerCase() as 'pf' | 'pj',
          displayName: displayName(relationship.target),
        },
      })),
      ...row.incomingRegistrationRelationships.map((relationship) => ({
        id: relationship.id,
        direction: 'incoming' as const,
        type: relationship.type,
        jobTitle: relationship.jobTitle,
        department: relationship.department,
        isPrimary: relationship.isPrimary,
        notes: relationship.notes,
        version: relationship.version,
        relatedRegistration: {
          id: relationship.source.id,
          type: relationship.source.clientType.toLowerCase() as 'pf' | 'pj',
          displayName: displayName(relationship.source),
        },
      })),
    ],
    externalReferences: row.externalReferences.map((reference) => ({
      ...reference,
      lastSyncedAt: reference.lastSyncedAt?.toISOString() ?? null,
      createdAt: reference.createdAt.toISOString(),
      updatedAt: reference.updatedAt.toISOString(),
    })),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function snapshot(registration: ReturnType<typeof presentRegistration>) {
  return JSON.parse(JSON.stringify(registration)) as Prisma.InputJsonValue;
}

function normalizeCatalogCode(value: string): string {
  const code = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!code || code.length > 64) {
    throw validationError('Informe um código válido.');
  }
  return code;
}

function compact(value?: string | null): string | null {
  return value?.replace(/\s+/g, ' ').trim() || null;
}

@Injectable()
export class RegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertInternal(current: AuthenticatedPrincipal) {
    if (current.routingCompanyId) {
      throw forbidden(
        'Usuários de clientes não podem alterar o Cadastro geral.',
      );
    }
  }

  private async ensureCatalog(
    companyId: string,
    transaction: Prisma.TransactionClient = this.prisma,
  ) {
    await transaction.registrationRole.createMany({
      data: DEFAULT_REGISTRATION_ROLES.map((role) => ({
        companyId,
        ...role,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
    await transaction.registrationTag.createMany({
      data: DEFAULT_REGISTRATION_TAGS.map((tag) => ({
        companyId,
        ...tag,
      })),
      skipDuplicates: true,
    });
  }

  async catalog(current: AuthenticatedPrincipal) {
    await this.ensureCatalog(current.companyId);
    const [roles, tags] = await this.prisma.$transaction([
      this.prisma.registrationRole.findMany({
        where: { companyId: current.companyId },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.registrationTag.findMany({
        where: { companyId: current.companyId },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      }),
    ]);
    return { roles, tags };
  }

  async createRole(
    current: AuthenticatedPrincipal,
    input: { code?: string; name: string },
  ) {
    this.assertInternal(current);
    const name = compact(input.name);
    if (!name) throw validationError('Informe o nome do Papel.');
    try {
      return await this.prisma.registrationRole.create({
        data: {
          companyId: current.companyId,
          code: normalizeCatalogCode(input.code || name),
          name,
        },
      });
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async createTag(
    current: AuthenticatedPrincipal,
    input: { code?: string; name: string; color?: string | null },
  ) {
    this.assertInternal(current);
    const name = compact(input.name);
    if (!name) throw validationError('Informe o nome do Marcador.');
    try {
      return await this.prisma.registrationTag.create({
        data: {
          companyId: current.companyId,
          code: normalizeCatalogCode(input.code || name),
          name,
          color: compact(input.color),
        },
      });
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  private async assertNoDuplicateRegistration(
    transaction: Prisma.TransactionClient,
    companyId: string,
    normalized: NormalizedRegistrationInput,
  ) {
    const displayName =
      normalized.type === 'pf'
        ? normalized.individualName!
        : normalized.legalName;
    const phoneValues = normalized.phones.map((phone) => phone.normalizedValue);
    const emailValues = normalized.emails.map((email) => email.address);
    const exactIdentitySignals: Prisma.RoutingCompanyWhereInput[] = [
      ...(normalized.cpf ? [{ cpf: normalized.cpf }] : []),
      ...(normalized.cnpj ? [{ cnpj: normalized.cnpj }] : []),
      ...(normalized.avicExternalId
        ? [{ avicExternalId: normalized.avicExternalId }]
        : []),
    ];
    const nameFilter: Prisma.RoutingCompanyWhereInput =
      normalized.type === 'pf'
        ? {
            clientType: 'PF',
            individualName: { equals: displayName, mode: 'insensitive' },
          }
        : {
            clientType: 'PJ',
            OR: [
              { legalName: { equals: displayName, mode: 'insensitive' } },
              { tradeName: { equals: displayName, mode: 'insensitive' } },
            ],
          };
    const contextualSignals: Prisma.RoutingCompanyWhereInput[] = [
      ...(phoneValues.length
        ? [
            {
              AND: [
                nameFilter,
                {
                  registrationPhones: {
                    some: { normalizedValue: { in: phoneValues } },
                  },
                },
              ],
            },
          ]
        : []),
      ...(emailValues.length
        ? [
            {
              AND: [
                nameFilter,
                {
                  registrationEmails: {
                    some: { address: { in: emailValues } },
                  },
                },
              ],
            },
          ]
        : []),
    ];
    const signals = [...exactIdentitySignals, ...contextualSignals];
    if (signals.length === 0) return;
    const duplicate = await transaction.routingCompany.findFirst({
      where: { companyId, OR: signals },
      select: {
        id: true,
        clientType: true,
        individualName: true,
        legalName: true,
        tradeName: true,
      },
    });
    if (duplicate) {
      throw conflict(
        `Já existe um Cadastro compatível com estes dados: ${displayName} (${duplicate.id}).`,
      );
    }
  }

  async createPromotionGraph(
    transaction: Prisma.TransactionClient,
    current: AuthenticatedPrincipal,
    payload: RegistrationPromotionPayload,
    context: RegistrationPromotionContext,
  ): Promise<{
    primaryRegistrationId: string;
    registrationIds: string[];
    relationshipIds: string[];
  }> {
    this.assertInternal(current);
    const graph = normalizeRegistrationPromotionPayload(payload);
    await this.ensureCatalog(current.companyId, transaction);
    const roleCodes = [
      ...new Set(
        graph.registrations.flatMap(
          ({ registration }) => registration.roleCodes,
        ),
      ),
    ];
    const tagCodes = [
      ...new Set(
        graph.registrations.flatMap(
          ({ registration }) => registration.tagCodes,
        ),
      ),
    ];
    const [roles, tags] = await Promise.all([
      transaction.registrationRole.findMany({
        where: {
          companyId: current.companyId,
          code: { in: roleCodes },
          active: true,
        },
      }),
      transaction.registrationTag.findMany({
        where: {
          companyId: current.companyId,
          code: { in: tagCodes },
          active: true,
        },
      }),
    ]);
    if (roles.length !== roleCodes.length) {
      throw validationError('Um Papel confirmado não existe ou está inativo.');
    }
    if (tags.length !== tagCodes.length) {
      throw validationError(
        'Um Marcador confirmado não existe ou está inativo.',
      );
    }
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    const tagByCode = new Map(tags.map((tag) => [tag.code, tag]));
    const registrationIdByLocalId = new Map<string, string>();

    for (const entry of graph.registrations) {
      await this.assertNoDuplicateRegistration(
        transaction,
        current.companyId,
        entry.registration,
      );
      const normalized = entry.registration;
      await transaction.routingCompany.create({
        data: {
          id: entry.id,
          companyId: current.companyId,
          taxId: normalized.taxId,
          legalName: normalized.legalName,
          tradeName: normalized.tradeName,
          clientType: normalized.type.toUpperCase() as RoutingClientType,
          firstName: normalized.firstName,
          lastName: normalized.lastName,
          individualName: normalized.individualName,
          cpf: normalized.cpf,
          individualEmail: normalized.individualEmail,
          individualWhatsapp: normalized.individualWhatsapp,
          individualPhones: normalized.individualPhones,
          cnpj: normalized.cnpj,
          legalEmail: normalized.legalEmail,
          legalWhatsapp: normalized.legalWhatsapp,
          legalPhones: normalized.legalPhones,
          status: normalized.status.toUpperCase() as RoutingCompanyStatus,
          avicExternalId: normalized.avicExternalId,
          createdByUserId: current.id,
          externalReferences: normalized.avicExternalId
            ? {
                create: {
                  provider: 'AVIC',
                  resourceType: 'registration',
                  externalResourceId: normalized.avicExternalId,
                  syncStatus: 'reference-only',
                },
              }
            : undefined,
          roleAssignments: {
            create: normalized.roleCodes.map((code) => ({
              roleId: roleByCode.get(code)!.id,
              assignedByUserId: current.id,
            })),
          },
          tagAssignments: {
            create: normalized.tagCodes.map((code) => ({
              tagId: tagByCode.get(code)!.id,
              assignedByUserId: current.id,
            })),
          },
          registrationPhones: {
            create: normalized.phones,
          },
          registrationEmails: {
            create: normalized.emails,
          },
        },
      });
      registrationIdByLocalId.set(entry.localId, entry.id);
    }

    const relationshipIds: string[] = [];
    for (const relationship of graph.relationships) {
      const relationshipId = randomUUID();
      const sourceRegistrationId = registrationIdByLocalId.get(
        relationship.sourceLocalId,
      )!;
      const targetRegistrationId = registrationIdByLocalId.get(
        relationship.targetLocalId,
      )!;
      await transaction.registrationRelationship.create({
        data: {
          id: relationshipId,
          companyId: current.companyId,
          sourceRegistrationId,
          targetRegistrationId,
          type: relationship.type,
          jobTitle: compact(relationship.jobTitle),
          department: compact(relationship.department),
          isPrimary: relationship.isPrimary === true,
          notes: compact(relationship.notes),
          createdByUserId: current.id,
        },
      });
      relationshipIds.push(relationshipId);
    }

    const createdRows = await transaction.routingCompany.findMany({
      where: {
        companyId: current.companyId,
        id: { in: [...registrationIdByLocalId.values()] },
      },
      include: registrationInclude,
    });
    const primaryRegistrationId = registrationIdByLocalId.get(
      graph.primaryLocalId,
    )!;
    for (const row of createdRows) {
      await transaction.routingCompanyHistory.create({
        data: {
          companyId: current.companyId,
          routingCompanyId: row.id,
          actorUserId: current.id,
          commandId:
            row.id === primaryRegistrationId ? context.commandId : randomUUID(),
          action: 'REGISTRATION_PROMOTED_FROM_RECONCILIATION',
          afterSnapshot: {
            registration: snapshot(presentRegistration(row)),
            candidateId: context.candidateId,
            source: 'registration-reconciliation',
            graphRegistrationIds: [...registrationIdByLocalId.values()],
            relationshipIds,
          },
        },
      });
    }
    return {
      primaryRegistrationId,
      registrationIds: [...registrationIdByLocalId.values()],
      relationshipIds,
    };
  }

  async list(current: AuthenticatedPrincipal, query: RegistrationListQuery) {
    const search = normalizeRegistrationSearch(query.search);
    const digits = search?.replace(/\D/g, '') || undefined;
    const roleCodes = query.roleCodes
      ?.map(normalizeCatalogCode)
      .filter(Boolean);
    const tagCodes = query.tagCodes?.map(normalizeCatalogCode).filter(Boolean);
    const where: Prisma.RoutingCompanyWhereInput = {
      companyId: current.companyId,
      ...(current.routingCompanyId ? { id: current.routingCompanyId } : {}),
      ...(query.status
        ? { status: query.status.toUpperCase() as RoutingCompanyStatus }
        : {}),
      ...(query.type
        ? { clientType: query.type.toUpperCase() as RoutingClientType }
        : {}),
      ...(roleCodes?.length
        ? { roleAssignments: { some: { role: { code: { in: roleCodes } } } } }
        : {}),
      ...(tagCodes?.length
        ? { tagAssignments: { some: { tag: { code: { in: tagCodes } } } } }
        : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { individualName: { contains: search, mode: 'insensitive' } },
              { legalName: { contains: search, mode: 'insensitive' } },
              { tradeName: { contains: search, mode: 'insensitive' } },
              { cpf: digits ? { contains: digits } : undefined },
              { cnpj: digits ? { contains: digits } : undefined },
              {
                avicExternalId: { contains: search, mode: 'insensitive' },
              },
              {
                registrationPhones: {
                  some: digits
                    ? { normalizedValue: { contains: digits } }
                    : undefined,
                },
              },
              {
                registrationEmails: {
                  some: { address: { contains: search, mode: 'insensitive' } },
                },
              },
              {
                roleAssignments: {
                  some: {
                    role: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
              {
                tagAssignments: {
                  some: {
                    tag: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
              {
                outgoingRegistrationRelationships: {
                  some: {
                    active: true,
                    target: {
                      OR: [
                        {
                          individualName: {
                            contains: search,
                            mode: 'insensitive',
                          },
                        },
                        {
                          legalName: { contains: search, mode: 'insensitive' },
                        },
                        {
                          tradeName: { contains: search, mode: 'insensitive' },
                        },
                      ],
                    },
                  },
                },
              },
              {
                incomingRegistrationRelationships: {
                  some: {
                    active: true,
                    source: {
                      OR: [
                        {
                          individualName: {
                            contains: search,
                            mode: 'insensitive',
                          },
                        },
                        {
                          legalName: { contains: search, mode: 'insensitive' },
                        },
                        {
                          tradeName: { contains: search, mode: 'insensitive' },
                        },
                      ],
                    },
                  },
                },
              },
            ].filter(Boolean) as Prisma.RoutingCompanyWhereInput[],
          }
        : {}),
    };
    const orderBy: Prisma.RoutingCompanyOrderByWithRelationInput[] =
      query.sort === 'status'
        ? [{ status: 'asc' }, { legalName: 'asc' }]
        : query.sort === 'updated'
          ? [{ updatedAt: 'desc' }, { id: 'asc' }]
          : [{ legalName: 'asc' }, { id: 'asc' }];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.routingCompany.findMany({
        where,
        include: registrationInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.routingCompany.count({ where }),
    ]);
    return { items: rows.map(presentRegistration), total };
  }

  async get(current: AuthenticatedPrincipal, registrationId: string) {
    if (
      current.routingCompanyId &&
      current.routingCompanyId !== registrationId
    ) {
      throw forbidden('O Cadastro informado não pertence ao seu acesso.');
    }
    const row = await this.prisma.routingCompany.findUnique({
      where: {
        id_companyId: { id: registrationId, companyId: current.companyId },
      },
      include: registrationInclude,
    });
    if (!row) throw notFound('Cadastro');
    return presentRegistration(row);
  }

  async create(
    current: AuthenticatedPrincipal,
    input: RegistrationMutationInput,
  ) {
    this.assertInternal(current);
    const id = randomUUID();
    const normalized = normalizeRegistrationInput(input, id);
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const repeated = await transaction.routingCompanyHistory.findUnique({
          where: {
            companyId_commandId: {
              companyId: current.companyId,
              commandId: input.commandId,
            },
          },
        });
        if (repeated) {
          return transaction.routingCompany.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: repeated.routingCompanyId,
                companyId: current.companyId,
              },
            },
            include: registrationInclude,
          });
        }
        await this.ensureCatalog(current.companyId, transaction);
        await this.assertNoDuplicateRegistration(
          transaction,
          current.companyId,
          normalized,
        );
        const [roles, tags] = await Promise.all([
          transaction.registrationRole.findMany({
            where: {
              companyId: current.companyId,
              code: { in: normalized.roleCodes },
              active: true,
            },
          }),
          transaction.registrationTag.findMany({
            where: {
              companyId: current.companyId,
              code: { in: normalized.tagCodes },
              active: true,
            },
          }),
        ]);
        if (roles.length !== normalized.roleCodes.length) {
          throw validationError(
            'Um dos Papéis selecionados não existe ou está inativo.',
          );
        }
        if (tags.length !== normalized.tagCodes.length) {
          throw validationError(
            'Um dos Marcadores selecionados não existe ou está inativo.',
          );
        }
        const created = await transaction.routingCompany.create({
          data: {
            id,
            companyId: current.companyId,
            taxId: normalized.taxId,
            legalName: normalized.legalName,
            tradeName: normalized.tradeName,
            clientType: normalized.type.toUpperCase() as RoutingClientType,
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            individualName: normalized.individualName,
            cpf: normalized.cpf,
            individualEmail: normalized.individualEmail,
            individualWhatsapp: normalized.individualWhatsapp,
            individualPhones: normalized.individualPhones,
            cnpj: normalized.cnpj,
            legalEmail: normalized.legalEmail,
            legalWhatsapp: normalized.legalWhatsapp,
            legalPhones: normalized.legalPhones,
            status: normalized.status.toUpperCase() as RoutingCompanyStatus,
            avicExternalId: normalized.avicExternalId,
            createdByUserId: current.id,
            externalReferences: normalized.avicExternalId
              ? {
                  create: {
                    provider: 'AVIC',
                    resourceType: 'registration',
                    externalResourceId: normalized.avicExternalId,
                    syncStatus: 'reference-only',
                  },
                }
              : undefined,
            roleAssignments: {
              create: roles.map((role) => ({
                roleId: role.id,
                assignedByUserId: current.id,
              })),
            },
            tagAssignments: {
              create: tags.map((tag) => ({
                tagId: tag.id,
                assignedByUserId: current.id,
              })),
            },
            registrationPhones: {
              create: normalized.phones,
            },
            registrationEmails: {
              create: normalized.emails,
            },
          },
          include: registrationInclude,
        });
        await transaction.routingCompanyHistory.create({
          data: {
            companyId: current.companyId,
            routingCompanyId: created.id,
            actorUserId: current.id,
            commandId: input.commandId,
            action: 'REGISTRATION_CREATED',
            afterSnapshot: snapshot(presentRegistration(created)),
          },
        });
        return created;
      });
      return presentRegistration(row);
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async update(
    current: AuthenticatedPrincipal,
    registrationId: string,
    input: RegistrationMutationInput & { expectedVersion: number },
  ) {
    this.assertInternal(current);
    const normalized = normalizeRegistrationInput(input, registrationId);
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const repeated = await transaction.routingCompanyHistory.findUnique({
          where: {
            companyId_commandId: {
              companyId: current.companyId,
              commandId: input.commandId,
            },
          },
        });
        if (repeated) {
          if (repeated.routingCompanyId !== registrationId) {
            throw conflict('O commandId já foi utilizado em outro Cadastro.');
          }
          return transaction.routingCompany.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: registrationId,
                companyId: current.companyId,
              },
            },
            include: registrationInclude,
          });
        }
        const before = await transaction.routingCompany.findUnique({
          where: {
            id_companyId: { id: registrationId, companyId: current.companyId },
          },
          include: registrationInclude,
        });
        if (!before) throw notFound('Cadastro');
        await this.ensureCatalog(current.companyId, transaction);
        const [roles, tags] = await Promise.all([
          transaction.registrationRole.findMany({
            where: {
              companyId: current.companyId,
              code: { in: normalized.roleCodes },
              active: true,
            },
          }),
          transaction.registrationTag.findMany({
            where: {
              companyId: current.companyId,
              code: { in: normalized.tagCodes },
              active: true,
            },
          }),
        ]);
        if (roles.length !== normalized.roleCodes.length) {
          throw validationError(
            'Um dos Papéis selecionados não existe ou está inativo.',
          );
        }
        if (tags.length !== normalized.tagCodes.length) {
          throw validationError(
            'Um dos Marcadores selecionados não existe ou está inativo.',
          );
        }
        const update = await transaction.routingCompany.updateMany({
          where: {
            id: registrationId,
            companyId: current.companyId,
            version: input.expectedVersion,
          },
          data: {
            taxId:
              normalized.type === 'pf' && !normalized.cpf
                ? before.taxId
                : normalized.taxId,
            legalName: normalized.legalName,
            tradeName: normalized.tradeName,
            clientType: normalized.type.toUpperCase() as RoutingClientType,
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            individualName: normalized.individualName,
            cpf: normalized.cpf,
            individualEmail: normalized.individualEmail,
            individualWhatsapp: normalized.individualWhatsapp,
            individualPhones: normalized.individualPhones,
            cnpj: normalized.cnpj,
            legalEmail: normalized.legalEmail,
            legalWhatsapp: normalized.legalWhatsapp,
            legalPhones: normalized.legalPhones,
            status: normalized.status.toUpperCase() as RoutingCompanyStatus,
            avicExternalId: normalized.avicExternalId,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1) {
          throw conflict(
            'O Cadastro foi alterado por outro usuário. Recarregue os dados e tente novamente.',
          );
        }
        await Promise.all([
          transaction.registrationRoleAssignment.deleteMany({
            where: { companyId: current.companyId, registrationId },
          }),
          transaction.registrationTagAssignment.deleteMany({
            where: { companyId: current.companyId, registrationId },
          }),
          transaction.registrationEmail.deleteMany({
            where: { companyId: current.companyId, registrationId },
          }),
          transaction.registrationExternalReference.deleteMany({
            where: {
              companyId: current.companyId,
              registrationId,
              provider: 'AVIC',
              resourceType: 'registration',
            },
          }),
        ]);
        const activePhoneValues = new Set(
          normalized.phones.map((phone) => phone.normalizedValue),
        );
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        await Promise.all([
          ...normalized.phones.map((phone) => {
            const existing = before.registrationPhones.find(
              (row) => row.normalizedValue === phone.normalizedValue,
            );
            return existing
              ? transaction.registrationPhone.updateMany({
                  where: {
                    id: existing.id,
                    companyId: current.companyId,
                    registrationId,
                  },
                  data: {
                    ...phone,
                    activeFrom:
                      existing.activeUntil || !existing.activeFrom
                        ? today
                        : existing.activeFrom,
                    activeUntil: null,
                  },
                })
              : transaction.registrationPhone.create({
                  data: {
                    companyId: current.companyId,
                    registrationId,
                    ...phone,
                    activeFrom: today,
                  },
                });
          }),
          ...before.registrationPhones
            .filter(
              (phone) =>
                !phone.activeUntil &&
                !activePhoneValues.has(phone.normalizedValue),
            )
            .map((phone) =>
              transaction.registrationPhone.updateMany({
                where: {
                  id: phone.id,
                  companyId: current.companyId,
                  registrationId,
                },
                data: {
                  activeUntil: today,
                  isPrimary: false,
                  hasWhatsApp: false,
                },
              }),
            ),
        ]);
        await Promise.all([
          transaction.registrationRoleAssignment.createMany({
            data: roles.map((role) => ({
              companyId: current.companyId,
              registrationId,
              roleId: role.id,
              assignedByUserId: current.id,
            })),
          }),
          transaction.registrationTagAssignment.createMany({
            data: tags.map((tag) => ({
              companyId: current.companyId,
              registrationId,
              tagId: tag.id,
              assignedByUserId: current.id,
            })),
          }),
          transaction.registrationEmail.createMany({
            data: normalized.emails.map((email) => ({
              companyId: current.companyId,
              registrationId,
              ...email,
            })),
          }),
          ...(normalized.avicExternalId
            ? [
                transaction.registrationExternalReference.create({
                  data: {
                    companyId: current.companyId,
                    registrationId,
                    provider: 'AVIC',
                    resourceType: 'registration',
                    externalResourceId: normalized.avicExternalId,
                    syncStatus: 'reference-only',
                  },
                }),
              ]
            : []),
        ]);
        const after = await transaction.routingCompany.findUniqueOrThrow({
          where: {
            id_companyId: { id: registrationId, companyId: current.companyId },
          },
          include: registrationInclude,
        });
        await transaction.routingCompanyHistory.create({
          data: {
            companyId: current.companyId,
            routingCompanyId: registrationId,
            actorUserId: current.id,
            commandId: input.commandId,
            action: 'REGISTRATION_UPDATED',
            beforeSnapshot: snapshot(presentRegistration(before)),
            afterSnapshot: snapshot(presentRegistration(after)),
          },
        });
        return after;
      });
      return presentRegistration(row);
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async createRelationship(
    current: AuthenticatedPrincipal,
    sourceRegistrationId: string,
    input: RegistrationRelationshipMutationInput,
  ) {
    this.assertInternal(current);
    const normalized = this.normalizeRelationship(sourceRegistrationId, input);
    return this.prisma.$transaction(async (transaction) => {
      const repeated = await transaction.routingCompanyHistory.findUnique({
        where: {
          companyId_commandId: {
            companyId: current.companyId,
            commandId: input.commandId,
          },
        },
      });
      if (repeated) {
        const relationshipId = (
          repeated.afterSnapshot as { relationshipId?: string }
        ).relationshipId;
        if (!relationshipId) throw conflict('O commandId já foi utilizado.');
        return transaction.registrationRelationship.findFirst({
          where: { id: relationshipId, companyId: current.companyId },
        });
      }
      const registrations = await transaction.routingCompany.count({
        where: {
          companyId: current.companyId,
          id: { in: [sourceRegistrationId, input.targetRegistrationId] },
        },
      });
      if (registrations !== 2) throw notFound('Cadastro relacionado');
      const relationship = await transaction.registrationRelationship.create({
        data: {
          companyId: current.companyId,
          sourceRegistrationId,
          targetRegistrationId: input.targetRegistrationId,
          createdByUserId: current.id,
          ...normalized,
        },
      });
      await transaction.routingCompanyHistory.create({
        data: {
          companyId: current.companyId,
          routingCompanyId: sourceRegistrationId,
          actorUserId: current.id,
          commandId: input.commandId,
          action: 'REGISTRATION_RELATIONSHIP_CREATED',
          afterSnapshot: JSON.parse(
            JSON.stringify({ relationshipId: relationship.id, ...normalized }),
          ) as Prisma.InputJsonValue,
        },
      });
      return relationship;
    });
  }

  async updateRelationship(
    current: AuthenticatedPrincipal,
    sourceRegistrationId: string,
    relationshipId: string,
    input: RegistrationRelationshipMutationInput & { expectedVersion: number },
  ) {
    this.assertInternal(current);
    const normalized = this.normalizeRelationship(sourceRegistrationId, input);
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.registrationRelationship.findFirst({
        where: {
          id: relationshipId,
          companyId: current.companyId,
          sourceRegistrationId,
        },
      });
      if (!before) throw notFound('Relacionamento');
      const updated = await transaction.registrationRelationship.updateMany({
        where: {
          id: relationshipId,
          companyId: current.companyId,
          sourceRegistrationId,
          version: input.expectedVersion,
        },
        data: { ...normalized, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw conflict('O relacionamento foi alterado por outro usuário.');
      }
      const after = await transaction.registrationRelationship.findFirstOrThrow(
        {
          where: { id: relationshipId, companyId: current.companyId },
        },
      );
      await transaction.routingCompanyHistory.create({
        data: {
          companyId: current.companyId,
          routingCompanyId: sourceRegistrationId,
          actorUserId: current.id,
          commandId: input.commandId,
          action: 'REGISTRATION_RELATIONSHIP_UPDATED',
          beforeSnapshot: JSON.parse(
            JSON.stringify(before),
          ) as Prisma.InputJsonValue,
          afterSnapshot: JSON.parse(
            JSON.stringify(after),
          ) as Prisma.InputJsonValue,
        },
      });
      return after;
    });
  }

  async removeRelationship(
    current: AuthenticatedPrincipal,
    sourceRegistrationId: string,
    relationshipId: string,
    input: { commandId: string; expectedVersion: number },
  ) {
    this.assertInternal(current);
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.registrationRelationship.findFirst({
        where: {
          id: relationshipId,
          companyId: current.companyId,
          sourceRegistrationId,
        },
      });
      if (!before) throw notFound('Relacionamento');
      const updated = await transaction.registrationRelationship.updateMany({
        where: {
          id: relationshipId,
          companyId: current.companyId,
          sourceRegistrationId,
          version: input.expectedVersion,
        },
        data: { active: false, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw conflict('O relacionamento foi alterado por outro usuário.');
      }
      await transaction.routingCompanyHistory.create({
        data: {
          companyId: current.companyId,
          routingCompanyId: sourceRegistrationId,
          actorUserId: current.id,
          commandId: input.commandId,
          action: 'REGISTRATION_RELATIONSHIP_REMOVED',
          beforeSnapshot: JSON.parse(
            JSON.stringify(before),
          ) as Prisma.InputJsonValue,
          afterSnapshot: { relationshipId, active: false },
        },
      });
      return { removed: true as const };
    });
  }

  private normalizeRelationship(
    sourceRegistrationId: string,
    input: RegistrationRelationshipMutationInput,
  ) {
    if (sourceRegistrationId === input.targetRegistrationId) {
      throw validationError(
        'Um Cadastro não pode se relacionar consigo mesmo.',
      );
    }
    const relationship: RegistrationRelationshipInput = {
      sourceLocalId: sourceRegistrationId,
      targetLocalId: input.targetRegistrationId,
      type: input.type,
      jobTitle: input.jobTitle,
      department: input.department,
      isPrimary: input.isPrimary,
      notes: input.notes,
    };
    const type = compact(relationship.type);
    if (!type) throw validationError('Informe o tipo do relacionamento.');
    return {
      type,
      jobTitle: compact(relationship.jobTitle),
      department: compact(relationship.department),
      isPrimary: relationship.isPrimary === true,
      notes: compact(relationship.notes),
      active: true,
    };
  }

  async history(current: AuthenticatedPrincipal, registrationId: string) {
    await this.get(current, registrationId);
    const rows = await this.prisma.routingCompanyHistory.findMany({
      where: { companyId: current.companyId, routingCompanyId: registrationId },
      include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(({ actor, ...row }) => ({
      ...row,
      actorName: actor?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
