import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import {
  conflict,
  notFound,
  validationError,
} from '../../core/errors/app-error';
import { PrismaService } from '../../infra/database/prisma/prisma.service';
import {
  Prisma,
  RoutingContractStatus,
} from '../../infra/database/prisma/generated/client';
import {
  DEFAULT_CATALOGS,
  type TransportInput,
  type TransportResource,
  validateInterval,
} from './transport-catalog.rules';

type Tx = Prisma.TransactionClient;
type Page = {
  page: number;
  pageSize: number;
  search: string;
  kind?: string;
  registrationId?: string;
};
function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function dayString(value: Date) {
  return value.toISOString().slice(0, 10);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}
function assertVersion(row: { version: number } | null, expected: number) {
  if (!row) throw notFound('Registro');
  if (row.version !== expected)
    throw conflict('O registro foi alterado. Recarregue antes de salvar.');
}
const supplierInclude = {} satisfies Prisma.TransportSupplierProfileInclude;
const contractInclude = {
  contract: true,
  supplier: { include: supplierInclude },
  conditions: { orderBy: { validFrom: 'asc' as const } },
} satisfies Prisma.TransportContractProfileInclude;
function supplierOutput(
  row: Prisma.TransportSupplierProfileGetPayload<{
    include: typeof supplierInclude;
  }>,
) {
  return {
    ...row,
    id: row.registrationId,
  };
}
function contractOutput(
  row: Prisma.TransportContractProfileGetPayload<{
    include: typeof contractInclude;
  }>,
) {
  const { contract, ...profile } = row;
  return {
    ...profile,
    id: row.contractId,
    clientRegistrationId: contract.routingCompanyId,
    code: contract.code,
    name: contract.name,
    status: contract.status.toLowerCase(),
    validFrom: dayString(contract.validFrom),
    validUntil: contract.validUntil ? dayString(contract.validUntil) : null,
    version: contract.version,
  };
}

@Injectable()
export class TransportCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}
  async list(companyId: string, resource: TransportResource, page: Page) {
    const { page: current, pageSize, search } = page;
    const bounds = { skip: (current - 1) * pageSize, take: pageSize };
    const contains = { contains: search, mode: 'insensitive' as const };
    let items: unknown[], total: number;
    switch (resource) {
      case 'companies': {
        const where: Prisma.TransportSupplierProfileWhereInput = {
          companyId,
          ...(search
            ? {
                OR: [
                  { legalName: contains },
                  { tradeName: contains },
                  { cnpj: contains },
                ],
              }
            : {}),
        };
        const [rows, count] = await this.prisma.$transaction([
          this.prisma.transportSupplierProfile.findMany({
            where,
            ...bounds,
            include: supplierInclude,
            orderBy: { legalName: 'asc' },
          }),
          this.prisma.transportSupplierProfile.count({ where }),
        ]);
        items = rows.map(supplierOutput);
        total = count;
        break;
      }
      case 'fleet': {
        const where: Prisma.TransportFleetWhereInput = {
          companyId,
          ...(search
            ? { OR: [{ fleetCode: contains }, { plate: contains }] }
            : {}),
        };
        [items, total] = await this.prisma.$transaction([
          this.prisma.transportFleet.findMany({
            where,
            ...bounds,
            include: {
              supplier: { include: supplierInclude },
              serviceType: true,
              vehicleType: true,
              category: true,
              ownerships: {
                orderBy: { validFrom: 'asc' },
                include: { supplier: { include: supplierInclude } },
              },
            },
            orderBy: { fleetCode: 'asc' },
          }),
          this.prisma.transportFleet.count({ where }),
        ]);
        break;
      }
      case 'catalogs': {
        const where: Prisma.TransportCatalogItemWhereInput = {
          companyId,
          ...(page.kind ? { kind: page.kind } : {}),
          ...(search ? { name: contains } : {}),
        };
        [items, total] = await this.prisma.$transaction([
          this.prisma.transportCatalogItem.findMany({
            where,
            ...bounds,
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
          }),
          this.prisma.transportCatalogItem.count({ where }),
        ]);
        break;
      }
      case 'affiliations': {
        const where: Prisma.TransportAffiliationWhereInput = {
          companyId,
          ...(page.registrationId
            ? { registrationId: page.registrationId }
            : {}),
          ...(search ? { registration: { legalName: contains } } : {}),
        };
        [items, total] = await this.prisma.$transaction([
          this.prisma.transportAffiliation.findMany({
            where,
            ...bounds,
            include: {
              registration: true,
              supplier: { include: supplierInclude },
            },
            orderBy: { validFrom: 'desc' },
          }),
          this.prisma.transportAffiliation.count({ where }),
        ]);
        break;
      }
      case 'contracts': {
        const where: Prisma.TransportContractProfileWhereInput = {
          companyId,
          contract: {
            ...(page.registrationId
              ? { routingCompanyId: page.registrationId }
              : {}),
            ...(search ? { OR: [{ name: contains }, { code: contains }] } : {}),
          },
        };
        const [rows, count] = await this.prisma.$transaction([
          this.prisma.transportContractProfile.findMany({
            where,
            ...bounds,
            include: contractInclude,
            orderBy: { contract: { name: 'asc' } },
          }),
          this.prisma.transportContractProfile.count({ where }),
        ]);
        items = rows.map(contractOutput);
        total = count;
        break;
      }
      case 'routes': {
        const where: Prisma.TransportExternalRouteWhereInput = {
          companyId,
          ...(search
            ? { OR: [{ name: contains }, { externalId: contains }] }
            : {}),
        };
        [items, total] = await this.prisma.$transaction([
          this.prisma.transportExternalRoute.findMany({
            where,
            ...bounds,
            orderBy: { name: 'asc' },
          }),
          this.prisma.transportExternalRoute.count({ where }),
        ]);
        break;
      }
    }
    return { items: snapshot(items), total, page: current, pageSize };
  }
  async contractCandidates(companyId: string, page: Page) {
    const where: Prisma.RoutingContractWhereInput = {
      companyId,
      transportProfile: { is: null },
      ...(page.registrationId ? { routingCompanyId: page.registrationId } : {}),
      ...(page.search
        ? {
            OR: [
              { name: { contains: page.search, mode: 'insensitive' } },
              { code: { contains: page.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.routingContract.findMany({
        where,
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          routingCompanyId: true,
          code: true,
          name: true,
          status: true,
          validFrom: true,
          validUntil: true,
          version: true,
        },
      }),
      this.prisma.routingContract.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        clientRegistrationId: row.routingCompanyId,
        code: row.code,
        name: row.name,
        status: row.status.toLowerCase(),
        validFrom: dayString(row.validFrom),
        validUntil: row.validUntil ? dayString(row.validUntil) : null,
        version: row.version,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }
  async get(
    companyId: string,
    resource: TransportResource,
    id: string,
    tx: Tx = this.prisma,
  ) {
    const where = { companyId, id };
    let row: unknown;
    switch (resource) {
      case 'companies': {
        const found = await tx.transportSupplierProfile.findUnique({
          where: {
            registrationId_companyId: { registrationId: id, companyId },
          },
          include: supplierInclude,
        });
        row = found ? supplierOutput(found) : null;
        break;
      }
      case 'fleet':
        row = await tx.transportFleet.findFirst({
          where,
          include: {
            supplier: { include: supplierInclude },
            serviceType: true,
            vehicleType: true,
            category: true,
            ownerships: {
              orderBy: { validFrom: 'asc' },
              include: { supplier: { include: supplierInclude } },
            },
          },
        });
        break;
      case 'catalogs':
        row = await tx.transportCatalogItem.findFirst({ where });
        break;
      case 'affiliations':
        row = await tx.transportAffiliation.findFirst({
          where,
          include: {
            registration: true,
            supplier: { include: supplierInclude },
          },
        });
        break;
      case 'contracts': {
        const found = await tx.transportContractProfile.findUnique({
          where: { contractId_companyId: { contractId: id, companyId } },
          include: contractInclude,
        });
        row = found ? contractOutput(found) : null;
        break;
      }
      case 'routes':
        row = await tx.transportExternalRoute.findFirst({
          where,
          include: {
            assignments: {
              orderBy: { validFrom: 'asc' },
              include: { contract: { include: { contract: true } } },
            },
          },
        });
        break;
    }
    if (!row) throw notFound('Registro de transporte');
    return snapshot(row);
  }
  async history(
    companyId: string,
    resource: TransportResource,
    id: string,
    take: number,
    page: number,
  ) {
    await this.get(companyId, resource, id);
    const where = {
      companyId,
      targetType: `transport-${resource}`,
      targetId: id,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenantAuditLog.findMany({
        where,
        take,
        skip: (page - 1) * take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.tenantAuditLog.count({ where }),
    ]);
    return { items, total, page, pageSize: take };
  }
  private async command(
    current: AuthenticatedPrincipal,
    action: string,
    id: string | undefined,
    input: TransportInput,
    work: (tx: Tx) => Promise<{
      response: Prisma.InputJsonValue;
      before?: Prisma.InputJsonValue;
      targetId: string;
    }>,
  ) {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(stable({ actor: current.id, action, id, input })))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // All writers in this aggregate serialize by tenant; optimistic checks also protect canonical writers.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.companyId}), hashtext('transport-catalog'))`;
            const receipt = await tx.transportCatalogCommand.findUnique({
              where: {
                companyId_commandId: {
                  companyId: current.companyId,
                  commandId: input.commandId,
                },
              },
            });
            if (receipt) {
              if (receipt.requestHash !== requestHash)
                throw conflict('commandId já utilizado para outra operação.');
              return receipt.response;
            }
            const result = await work(tx);
            if (action.startsWith('contracts:'))
              await tx.routingContractHistory.create({
                data: {
                  companyId: current.companyId,
                  contractId: result.targetId,
                  actorUserId: current.id,
                  commandId: input.commandId,
                  action: 'TRANSPORT_CONTRACT_UPDATED',
                  beforeSnapshot: result.before,
                  afterSnapshot: result.response,
                },
              });

            await tx.tenantAuditLog.create({
              data: {
                companyId: current.companyId,
                actorUserId: current.id,
                action: `TRANSPORT_${action.toUpperCase().replaceAll('-', '_')}`,
                targetType: `transport-${action.split(':')[0]}`,
                targetId: result.targetId,
                metadata: snapshot({
                  commandId: input.commandId,
                  expectedVersion: input.expectedVersion,
                  before: result.before ?? null,
                  after: result.response,
                }),
              },
            });
            await tx.transportCatalogCommand.create({
              data: {
                companyId: current.companyId,
                commandId: input.commandId,
                requestHash,
                response: result.response,
              },
            });
            return result.response;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034' && attempt < 2) continue;
          if (['P2002', 'P2034'].includes(error.code))
            throw conflict(
              'Registro duplicado ou alteração concorrente. Recarregue e tente novamente.',
            );
          if (error.code === 'P2003')
            throw validationError(
              'A referência pertence a outro tenant ou não está disponível.',
            );
        }
        throw error;
      }
    }
    throw conflict('Não foi possível concluir a alteração concorrente.');
  }
  private async supplier(tx: Tx, companyId: string, id: string) {
    const found = await tx.transportSupplierProfile.findFirst({
      where: {
        companyId,
        registrationId: id,
        active: true,
      },
    });
    if (!found)
      throw validationError(
        'Selecione uma empresa prestadora ativa deste tenant.',
      );
  }
  private async registration(tx: Tx, companyId: string, id: string) {
    const found = await tx.routingCompany.findFirst({
      where: { companyId, id, transportSupplier: { is: null } },
    });
    if (!found)
      throw validationError('Cadastro principal não encontrado neste tenant.');
    return found;
  }
  async save(
    current: AuthenticatedPrincipal,
    resource: TransportResource,
    input: TransportInput,
    id?: string,
  ) {
    return this.command(
      current,
      `${resource}:${id ? 'update' : 'create'}`,
      id,
      input,
      async (tx) => {
        const companyId = current.companyId;
        const before = id
          ? await this.get(companyId, resource, id, tx)
          : undefined;
        let targetId = id ?? randomUUID();
        switch (resource) {
          case 'companies': {
            if (input.registrationId)
              throw validationError(
                'CNPJs do tenant são independentes do Cadastro de clientes e funcionários.',
              );
            if (id) {
              const existing = await tx.transportSupplierProfile.findFirst({
                where: { registrationId: id, companyId },
              });
              assertVersion(existing, input.expectedVersion);
              if (input.cnpj && input.cnpj !== existing!.cnpj)
                throw validationError(
                  'CNPJ identifica a empresa; cadastre outra empresa para outro CNPJ.',
                );
              const changed = await tx.transportSupplierProfile.updateMany({
                where: {
                  registrationId: id,
                  companyId,
                  version: input.expectedVersion,
                },
                data: {
                  legalName: input.legalName,
                  tradeName: input.tradeName,
                  active: input.active,
                  version: { increment: 1 },
                },
              });
              if (changed.count !== 1)
                throw conflict(
                  'Empresa alterada simultaneamente. Recarregue antes de salvar.',
                );
            } else {
              await tx.transportSupplierProfile.create({
                data: {
                  registrationId: targetId,
                  companyId,
                  cnpj: input.cnpj!,
                  legalName: input.legalName!,
                  tradeName: input.tradeName!,
                  active: input.active ?? true,
                },
              });
            }
            break;
          }
          case 'catalogs': {
            if (id) {
              const previous = await tx.transportCatalogItem.findFirst({
                where: { id, companyId },
              });
              assertVersion(previous, input.expectedVersion);
              if (
                (input.kind && input.kind !== previous!.kind) ||
                (input.code && input.code !== previous!.code)
              )
                throw validationError(
                  'Tipo e código do catálogo são imutáveis; inative e cadastre outro.',
                );
              await tx.transportCatalogItem.update({
                where: { id_companyId: { id, companyId } },
                data: {
                  name: input.name,
                  active: input.active,
                  version: { increment: 1 },
                },
              });
            } else
              await tx.transportCatalogItem.create({
                data: {
                  id: targetId,
                  companyId,
                  kind: input.kind!,
                  name: input.name!,
                  active: input.active ?? true,
                },
              });
            break;
          }
          case 'fleet': {
            const previous = id
              ? await tx.transportFleet.findFirst({ where: { id, companyId } })
              : null;
            if (id) assertVersion(previous, input.expectedVersion);
            if (input.supplierRegistrationId)
              await this.supplier(tx, companyId, input.supplierRegistrationId);
            if (
              previous &&
              input.supplierRegistrationId &&
              input.supplierRegistrationId !== previous.supplierRegistrationId
            )
              throw validationError(
                'Troca de empresa da frota exige vínculo com vigência; mantenha o histórico e registre a transferência no fluxo de vínculos.',
              );
            for (const [field, kind] of [
              ['serviceTypeId', 'service-type'],
              ['vehicleTypeId', 'vehicle-type'],
              ['categoryId', 'category'],
            ] as const) {
              if (
                input[field] &&
                !(await tx.transportCatalogItem.findFirst({
                  where: { id: input[field], companyId, kind, active: true },
                }))
              )
                throw validationError(
                  `Selecione ${kind} ativo do catálogo deste tenant.`,
                );
            }
            const provider =
              input.provider === undefined
                ? previous?.provider
                : input.provider;
            const externalVehicleId =
              input.externalVehicleId === undefined
                ? previous?.externalVehicleId
                : input.externalVehicleId;
            if (Boolean(provider) !== Boolean(externalVehicleId))
              throw validationError(
                'Fornecedor e ID externo do veículo devem ser preenchidos juntos.',
              );
            const fleetData = {
              fleetCode: input.fleetCode,
              supplierRegistrationId: input.supplierRegistrationId,
              plate: input.plate,
              serviceTypeId: input.serviceTypeId,
              vehicleTypeId: input.vehicleTypeId,
              categoryId: input.categoryId,
              axles: input.axles,
              passengers: input.passengers,
              model: input.model,
              active: input.active,
              provider: input.provider,
              externalVehicleId: input.externalVehicleId,
            };
            if (id)
              await tx.transportFleet.update({
                where: { id_companyId: { id, companyId } },
                data: { ...fleetData, version: { increment: 1 } },
              });
            else
              await tx.transportFleet.create({
                data: {
                  ...fleetData,
                  id: targetId,
                  companyId,
                  fleetCode: input.fleetCode!,
                  supplierRegistrationId: input.supplierRegistrationId!,
                },
              });
            if (!id)
              await tx.transportFleetOwnership.create({
                data: {
                  companyId,
                  fleetId: targetId,
                  supplierRegistrationId: input.supplierRegistrationId!,
                  validFrom: day(input.validFrom ?? dayString(new Date())),
                },
              });
            else if (input.validFrom)
              throw validationError(
                'Use o histórico de vínculos para alterar a vigência da frota.',
              );
            break;
          }
          case 'affiliations': {
            const previous = id
              ? await tx.transportAffiliation.findFirst({
                  where: { id, companyId },
                })
              : null;
            if (id) {
              assertVersion(previous, input.expectedVersion);
              for (const field of [
                'registrationId',
                'supplierRegistrationId',
                'role',
              ] as const)
                if (input[field] && input[field] !== previous![field])
                  throw validationError(
                    'Encerre a vigência anterior e crie novo vínculo para trocar empresa ou papel.',
                  );
              if (
                input.validFrom &&
                input.validFrom !== dayString(previous!.validFrom)
              )
                throw validationError(
                  'O início do vínculo histórico não pode ser alterado.',
                );
              if (
                previous!.validUntil &&
                input.validUntil !== undefined &&
                (!input.validUntil ||
                  input.validUntil > dayString(previous!.validUntil))
              )
                throw validationError(
                  'Uma vigência encerrada não pode ser ampliada ou reaberta por edição.',
                );
            }
            const from = input.validFrom ?? dayString(previous!.validFrom),
              until =
                input.validUntil === undefined
                  ? previous?.validUntil
                    ? dayString(previous.validUntil)
                    : null
                  : input.validUntil;
            validateInterval(from, until);
            const registrationId =
                input.registrationId ?? previous!.registrationId,
              role = input.role ?? previous!.role;
            const canonical = await this.registration(
              tx,
              companyId,
              registrationId,
            );
            if (role === 'employee' && canonical.clientType !== 'PF')
              throw validationError(
                'O vínculo de funcionário exige pessoa física cadastrada.',
              );
            if (input.supplierRegistrationId)
              await this.supplier(tx, companyId, input.supplierRegistrationId);
            const overlap = await tx.transportAffiliation.findFirst({
              where: {
                companyId,
                registrationId,
                role,
                ...(id ? { id: { not: id } } : {}),
                validFrom: { lte: until ? day(until) : new Date('9999-12-31') },
                OR: [{ validUntil: null }, { validUntil: { gte: day(from) } }],
              },
            });
            if (overlap)
              throw conflict(
                'Existe outro vínculo desse papel com vigência sobreposta.',
              );
            if (id)
              await tx.transportAffiliation.update({
                where: { id_companyId: { id, companyId } },
                data: {
                  validUntil: until ? day(until) : null,
                  version: { increment: 1 },
                },
              });
            else
              await tx.transportAffiliation.create({
                data: {
                  id: targetId,
                  companyId,
                  registrationId,
                  supplierRegistrationId: input.supplierRegistrationId!,
                  role,
                  validFrom: day(from),
                  validUntil: until ? day(until) : null,
                },
              });
            break;
          }
          case 'contracts': {
            if (id) {
              if (input.existingContractId)
                throw validationError(
                  'Associação de contrato existente é permitida somente na criação do perfil.',
                );
              const previous = await tx.transportContractProfile.findFirst({
                where: { companyId, contractId: id },
                include: { contract: true },
              });
              assertVersion(previous?.contract ?? null, input.expectedVersion);
              for (const field of [
                'supplierRegistrationId',
                'modality',
              ] as const)
                if (input[field] && input[field] !== previous![field])
                  throw validationError(
                    'Empresa e modalidade históricas não podem ser substituídas; cadastre outro contrato com vigência.',
                  );
              if (
                input.clientRegistrationId &&
                input.clientRegistrationId !==
                  previous!.contract.routingCompanyId
              )
                throw validationError(
                  'O cliente histórico do contrato não pode ser substituído.',
                );
              if (
                input.validFrom &&
                input.validFrom !== dayString(previous!.contract.validFrom)
              )
                throw validationError(
                  'Início contratual é histórico e não pode ser substituído.',
                );
              validateInterval(
                dayString(previous!.contract.validFrom),
                input.validUntil,
              );
              if (input.validUntil) {
                const limit = day(input.validUntil);
                const openAssignment =
                  await tx.transportRouteAssignment.findFirst({
                    where: {
                      companyId,
                      contractId: id,
                      OR: [
                        { validUntil: null },
                        { validUntil: { gt: limit } },
                        { validFrom: { gt: limit } },
                      ],
                    },
                  });
                const openCondition =
                  await tx.transportContractCondition.findFirst({
                    where: {
                      companyId,
                      contractId: id,
                      OR: [
                        { validUntil: null },
                        { validUntil: { gt: limit } },
                        { validFrom: { gt: limit } },
                      ],
                    },
                  });
                if (openAssignment || openCondition)
                  throw validationError(
                    'Encerre condições e vínculos de rotas antes de antecipar o fim do contrato.',
                  );
              }
              const result = await tx.routingContract.updateMany({
                where: { id, companyId, version: input.expectedVersion },
                data: {
                  code: input.code,
                  name: input.name,
                  status: input.status
                    ? (input.status.toUpperCase() as RoutingContractStatus)
                    : undefined,
                  validUntil:
                    input.validUntil === undefined
                      ? undefined
                      : input.validUntil
                        ? day(input.validUntil)
                        : null,
                  version: { increment: 1 },
                },
              });
              if (result.count !== 1)
                throw conflict('Contrato alterado simultaneamente.');
            } else {
              await this.registration(
                tx,
                companyId,
                input.clientRegistrationId!,
              );
              await this.supplier(tx, companyId, input.supplierRegistrationId!);
              validateInterval(input.validFrom!, input.validUntil);
              // The canonical legacy contract also stores route-planning fields. Empty values mean unconfigured, never a route inference.
              if (input.existingContractId) {
                const existing = await tx.routingContract.findFirst({
                  where: { companyId, id: input.existingContractId },
                  include: { transportProfile: true },
                });
                if (!existing)
                  throw validationError(
                    'Contrato existente não encontrado neste tenant.',
                  );
                if (existing.transportProfile)
                  throw conflict(
                    'Este contrato já possui perfil de transporte.',
                  );
                if (
                  existing.routingCompanyId !== input.clientRegistrationId ||
                  existing.code !== input.code ||
                  existing.name !== input.name ||
                  dayString(existing.validFrom) !== input.validFrom ||
                  (existing.validUntil
                    ? dayString(existing.validUntil)
                    : null) !== (input.validUntil ?? null) ||
                  (input.status &&
                    existing.status.toLowerCase() !== input.status)
                )
                  throw conflict(
                    'Os dados do contrato existente diferem da seleção. Recarregue o contrato antes de associar.',
                  );
                targetId = existing.id;
              } else {
                await tx.routingContract.create({
                  data: {
                    id: targetId,
                    companyId,
                    routingCompanyId: input.clientRegistrationId!,
                    code: input.code!,
                    name: input.name!,
                    operationType: input.modality!,
                    routeType: 'UNSPECIFIED',
                    periodicity: 'UNSPECIFIED',
                    status: input.status
                      ? (input.status.toUpperCase() as RoutingContractStatus)
                      : 'DRAFT',
                    contractedVehicleCount: 0,
                    predictedVehicleName: '',
                    predictedVehicleCapacity: 0,
                    maxWalkingDistanceMeters: 0,
                    unitName: '',
                    originLabel: '',
                    originStreet: '',
                    originNumber: '',
                    originDistrict: '',
                    originPostalCode: '',
                    originCity: '',
                    originState: '',
                    destinationLabel: '',
                    destinationStreet: '',
                    destinationNumber: '',
                    destinationDistrict: '',
                    destinationPostalCode: '',
                    destinationCity: '',
                    destinationState: '',
                    validFrom: day(input.validFrom!),
                    validUntil: input.validUntil ? day(input.validUntil) : null,
                    createdByUserId: current.id,
                  },
                });
              }
              await tx.transportContractProfile.create({
                data: {
                  contractId: targetId,
                  companyId,
                  supplierRegistrationId: input.supplierRegistrationId!,
                  modality: input.modality!,
                },
              });
            }
            break;
          }
          case 'routes': {
            if (id) {
              const previous = await tx.transportExternalRoute.findFirst({
                where: { id, companyId },
              });
              assertVersion(previous, input.expectedVersion);
              if (
                (input.provider && input.provider !== previous!.provider) ||
                (input.externalId !== undefined &&
                  previous!.externalId !== null &&
                  input.externalId !== previous!.externalId)
              )
                throw validationError(
                  'Identidade externa confirmada não pode ser substituída. Cadastre outra rota.',
                );
              await tx.transportExternalRoute.update({
                where: { id_companyId: { id, companyId } },
                data: {
                  name: input.name,
                  externalId: input.externalId,
                  version: { increment: 1 },
                },
              });
            } else
              await tx.transportExternalRoute.create({
                data: {
                  id: targetId,
                  companyId,
                  provider: input.provider!,
                  externalId: input.externalId,
                  name: input.name!,
                },
              });
            break;
          }
        }
        return {
          targetId,
          before,
          response: await this.get(companyId, resource, targetId, tx),
        };
      },
    );
  }
  async initialize(current: AuthenticatedPrincipal, input: TransportInput) {
    if (input.expectedVersion !== 0)
      throw validationError('Inicialização exige expectedVersion=0.');
    return this.command(
      current,
      'catalogs:initialize',
      undefined,
      input,
      async (tx) => {
        for (const [kind, seedKey, name] of DEFAULT_CATALOGS)
          await tx.transportCatalogItem.upsert({
            where: {
              companyId_kind_seedKey: {
                companyId: current.companyId,
                kind,
                seedKey,
              },
            },
            create: { companyId: current.companyId, kind, seedKey, name },
            update: {},
          });
        return {
          targetId: 'defaults',
          response: snapshot({ initialized: true }),
        };
      },
    );
  }
  async addPeriod(
    current: AuthenticatedPrincipal,
    resource: 'contracts' | 'routes',
    id: string,
    input: TransportInput,
  ) {
    validateInterval(input.validFrom!, input.validUntil);
    if (resource === 'contracts') {
      if (
        input.period !== 'monthly' &&
        (input.transitionMonth ||
          (input.transitionAllowanceKm !== undefined &&
            input.transitionAllowanceKm !== null))
      )
        throw validationError(
          'Condição de transição mensal exige período mensal.',
        );
      if (
        input.transitionAllowanceKm !== undefined &&
        input.transitionAllowanceKm !== null &&
        !input.transitionMonth
      )
        throw validationError('Informe o mês de transição.');
      if (
        input.transitionMonth &&
        (input.transitionMonth < input.validFrom!.slice(0, 7) ||
          (input.validUntil &&
            input.transitionMonth > input.validUntil.slice(0, 7)))
      )
        throw validationError('O mês de transição deve pertencer à vigência.');
    }
    return this.command(
      current,
      `${resource}:add-period`,
      id,
      input,
      async (tx) => {
        const companyId = current.companyId,
          before = await this.get(companyId, resource, id, tx);
        const contractId = resource === 'contracts' ? id : input.contractId!;
        const profile = await tx.transportContractProfile.findFirst({
          where: { companyId, contractId },
          include: { contract: true },
        });
        if (!profile)
          throw validationError('Contrato não encontrado neste tenant.');
        const contract = profile.contract;
        if (
          day(input.validFrom!) < contract.validFrom ||
          (contract.validUntil &&
            (!input.validUntil || day(input.validUntil) > contract.validUntil))
        )
          throw validationError(
            'A vigência deve estar contida na vigência contratual.',
          );
        const overlapDates = {
          validFrom: {
            lte: input.validUntil
              ? day(input.validUntil)
              : new Date('9999-12-31'),
          },
          OR: [
            { validUntil: null },
            { validUntil: { gte: day(input.validFrom!) } },
          ],
        };
        if (resource === 'contracts') {
          assertVersion(contract, input.expectedVersion);
          if (
            await tx.transportContractCondition.findFirst({
              where: { companyId, contractId: id, ...overlapDates },
            })
          )
            throw conflict(
              'Já existe condição para parte dessa vigência. Encerre a anterior antes de criar outra.',
            );
          await tx.transportContractCondition.create({
            data: {
              companyId,
              contractId: id,
              validFrom: day(input.validFrom!),
              validUntil: input.validUntil ? day(input.validUntil) : null,
              period: input.period!,
              allowanceKm: input.allowanceKm,
              includeGarage: input.includeGarage!,
              transitionMonth: input.transitionMonth,
              transitionAllowanceKm: input.transitionAllowanceKm,
            },
          });
          const result = await tx.routingContract.updateMany({
            where: { companyId, id, version: input.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (result.count !== 1)
            throw conflict('Contrato alterado simultaneamente.');
        } else {
          const route = await tx.transportExternalRoute.findFirst({
            where: { companyId, id },
          });
          assertVersion(route, input.expectedVersion);
          if (
            await tx.transportRouteAssignment.findFirst({
              where: { companyId, routeId: id, ...overlapDates },
            })
          )
            throw conflict('A rota já pertence a um contrato nessa vigência.');
          await tx.transportRouteAssignment.create({
            data: {
              companyId,
              routeId: id,
              contractId,
              validFrom: day(input.validFrom!),
              validUntil: input.validUntil ? day(input.validUntil) : null,
            },
          });
          await tx.transportExternalRoute.update({
            where: { id_companyId: { id, companyId } },
            data: { version: { increment: 1 } },
          });
        }
        return {
          targetId: id,
          before,
          response: await this.get(companyId, resource, id, tx),
        };
      },
    );
  }
  async fleetOwnership(
    current: AuthenticatedPrincipal,
    id: string,
    input: TransportInput,
    periodId?: string,
  ) {
    return this.command(
      current,
      `fleet:ownership:${periodId ?? 'create'}`,
      id,
      input,
      async (tx) => {
        const companyId = current.companyId,
          before = await this.get(companyId, 'fleet', id, tx);
        const owner = await tx.transportFleet.findFirst({
          where: { companyId, id },
        });
        assertVersion(owner, input.expectedVersion);
        if (periodId) {
          const period = await tx.transportFleetOwnership.findFirst({
            where: { companyId, fleetId: id, id: periodId },
          });
          if (!period) throw notFound('Vínculo da frota');
          validateInterval(dayString(period.validFrom), input.validUntil);
          if (period.validUntil && day(input.validUntil!) > period.validUntil)
            throw conflict(
              'O encerramento não pode ampliar a vigência anterior.',
            );
          await tx.transportFleetOwnership.update({
            where: { id_companyId: { id: periodId, companyId } },
            data: {
              validUntil: day(input.validUntil!),
              version: { increment: 1 },
            },
          });
        } else {
          validateInterval(input.validFrom!, input.validUntil);
          await this.supplier(tx, companyId, input.supplierRegistrationId!);
          const overlap = await tx.transportFleetOwnership.findFirst({
            where: {
              companyId,
              fleetId: id,
              validFrom: {
                lte: input.validUntil
                  ? day(input.validUntil)
                  : new Date('9999-12-31'),
              },
              OR: [
                { validUntil: null },
                { validUntil: { gte: day(input.validFrom!) } },
              ],
            },
          });
          if (overlap)
            throw conflict(
              'Encerre o vínculo anterior antes de cadastrar uma vigência sobreposta.',
            );
          await tx.transportFleetOwnership.create({
            data: {
              companyId,
              fleetId: id,
              supplierRegistrationId: input.supplierRegistrationId!,
              validFrom: day(input.validFrom!),
              validUntil: input.validUntil ? day(input.validUntil) : null,
            },
          });
        }
        await tx.transportFleet.update({
          where: { id_companyId: { id, companyId } },
          data: { version: { increment: 1 } },
        });
        return {
          targetId: id,
          before,
          response: await this.get(companyId, 'fleet', id, tx),
        };
      },
    );
  }
  async closePeriod(
    current: AuthenticatedPrincipal,
    resource: 'contracts' | 'routes',
    id: string,
    periodId: string,
    input: TransportInput,
  ) {
    return this.command(
      current,
      `${resource}:close-period:${periodId}`,
      id,
      input,
      async (tx) => {
        const companyId = current.companyId,
          before = await this.get(companyId, resource, id, tx);
        if (resource === 'contracts') {
          const owner = await tx.routingContract.findFirst({
            where: { companyId, id },
          });
          assertVersion(owner, input.expectedVersion);
          const period = await tx.transportContractCondition.findFirst({
            where: { companyId, id: periodId, contractId: id },
          });
          if (!period) throw notFound('Condição');
          validateInterval(dayString(period.validFrom), input.validUntil);
          if (period.validUntil && day(input.validUntil!) > period.validUntil)
            throw conflict(
              'O encerramento não pode ampliar a vigência anterior.',
            );
          await tx.transportContractCondition.update({
            where: { id_companyId: { id: periodId, companyId } },
            data: {
              validUntil: day(input.validUntil!),
              version: { increment: 1 },
            },
          });
          const result = await tx.routingContract.updateMany({
            where: { companyId, id, version: input.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (result.count !== 1)
            throw conflict('Contrato alterado simultaneamente.');
        } else {
          const owner = await tx.transportExternalRoute.findFirst({
            where: { companyId, id },
          });
          assertVersion(owner, input.expectedVersion);
          const period = await tx.transportRouteAssignment.findFirst({
            where: { companyId, id: periodId, routeId: id },
          });
          if (!period) throw notFound('Vínculo');
          validateInterval(dayString(period.validFrom), input.validUntil);
          if (period.validUntil && day(input.validUntil!) > period.validUntil)
            throw conflict(
              'O encerramento não pode ampliar a vigência anterior.',
            );
          await tx.transportRouteAssignment.update({
            where: { id_companyId: { id: periodId, companyId } },
            data: {
              validUntil: day(input.validUntil!),
              version: { increment: 1 },
            },
          });
          await tx.transportExternalRoute.update({
            where: { id_companyId: { id, companyId } },
            data: { version: { increment: 1 } },
          });
        }
        return {
          targetId: id,
          before,
          response: await this.get(companyId, resource, id, tx),
        };
      },
    );
  }
}
