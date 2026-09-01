import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AppError,
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  applyTripCommand,
  createTripDraft,
  type Trip,
  type TripCommand,
  type TripCommandResult,
  type TripEvidence,
  type TripStatus,
} from '../../../domain/trips/trip';
import {
  freezeTripRoutePlanSelection,
  prepareTripRoutePlanSelection,
  type TripRoutePlanSelection,
} from '../../../domain/trips/trip-route-plan';
import {
  OperationalTripStatus,
  OperationalTripSourceKind,
  Prisma,
  RequestStatus,
  RoutingContractStatus,
  UserAccountStatus,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { rethrowKnownPrismaConflict } from '../../../infra/database/prisma/prisma-errors';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

const tripInclude = {
  legs: { orderBy: [{ sequence: 'asc' as const }, { id: 'asc' as const }] },
  contract: {
    select: {
      routingCompanyId: true,
      status: true,
      validFrom: true,
      validUntil: true,
    },
  },
  confirmedService: { select: { id: true } },
} satisfies Prisma.OperationalTripInclude;

type TripRow = Prisma.OperationalTripGetPayload<{
  include: typeof tripInclude;
}>;

type TripRoutePlanSelectionRow =
  Prisma.OperationalTripRoutePlanSelectionGetPayload<object>;

const statusToPrisma: Readonly<Record<TripStatus, OperationalTripStatus>> = {
  draft: OperationalTripStatus.DRAFT,
  scheduled: OperationalTripStatus.SCHEDULED,
  'in-execution': OperationalTripStatus.IN_EXECUTION,
  suspended: OperationalTripStatus.SUSPENDED,
  interrupted: OperationalTripStatus.INTERRUPTED,
  'early-terminated': OperationalTripStatus.EARLY_TERMINATED,
  completed: OperationalTripStatus.COMPLETED,
  cancelled: OperationalTripStatus.CANCELLED,
};

const statusFromPrisma: Readonly<Record<OperationalTripStatus, TripStatus>> = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  IN_EXECUTION: 'in-execution',
  SUSPENDED: 'suspended',
  INTERRUPTED: 'interrupted',
  EARLY_TERMINATED: 'early-terminated',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

interface CreateOperationalTripBaseInput {
  code: string;
  serviceDate: string | null;
  legs: Array<{ id?: string; sequence: number; label: string }>;
  commandId: string;
}

export type CreateOperationalTripInput = CreateOperationalTripBaseInput &
  (
    | {
        sourceKind?: 'continuous-contract';
        contractId: string;
        expectedContractVersion: number;
      }
    | {
        sourceKind: 'confirmed-service';
        confirmedServiceId: string;
        expectedConfirmedServiceVersion: number;
      }
  );

export interface OperationalTripListQuery {
  page: number;
  pageSize: number;
  status?: TripStatus;
  contractId?: string;
  serviceFrom?: string;
  serviceTo?: string;
}

export interface SelectOperationalTripRoutePlanInput {
  routeId: string;
  expectedRouteVersion: number;
  commandId: string;
  expectedVersion: number;
  reason?: string;
}

interface OperationalTripPlanInput {
  serviceDate: string | null;
  legs: Array<{ id?: string; sequence: number; label: string }>;
}

export type OperationalTripActionInput =
  | { type: 'edit-draft'; plan: OperationalTripPlanInput }
  | { type: 'schedule' }
  | {
      type: 'revise-schedule';
      plan: OperationalTripPlanInput;
      reason: string;
    }
  | { type: 'start' }
  | { type: 'suspend'; reason: string; evidence?: readonly TripEvidence[] }
  | { type: 'resume'; reason: string; evidence?: readonly TripEvidence[] }
  | { type: 'interrupt'; reason: string; evidence: readonly TripEvidence[] }
  | { type: 'close-early'; reason: string }
  | { type: 'complete' }
  | { type: 'cancel'; reason: string }
  | {
      type: 'record-occurrence';
      reason: string;
      evidence: readonly TripEvidence[];
    }
  | {
      type: 'record-deviation';
      reason: string;
      evidence: readonly TripEvidence[];
    };

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function parseDateOnly(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`Informe ${label} no formato AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateOnly(date) !== value) {
    throw validationError(`Informe ${label} válida.`);
  }
  return date;
}

function currentBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function assertContractAllowsTripDate(
  contract: {
    status: RoutingContractStatus;
    validFrom: Date;
    validUntil: Date | null;
  },
  serviceDate: string,
): void {
  if (contract.status !== RoutingContractStatus.ACTIVE) {
    throw validationError(
      'A viagem só pode ser programada a partir de contrato ativo.',
    );
  }
  const validFrom = dateOnly(contract.validFrom)!;
  const validUntil = dateOnly(contract.validUntil);
  if (
    serviceDate < validFrom ||
    (validUntil !== null && serviceDate > validUntil)
  ) {
    throw validationError(
      'A data da viagem deve estar dentro da vigência do contrato.',
    );
  }
}

function payload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fingerprint(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function toDomain(row: TripRow): Trip {
  const source =
    row.sourceKind === OperationalTripSourceKind.CONFIRMED_SERVICE
      ? {
          kind: 'confirmed-service' as const,
          confirmedServiceId: row.confirmedServiceId!,
          sourceVersion: row.sourceVersion,
        }
      : {
          kind: 'continuous-contract' as const,
          contractId: row.contractId!,
          sourceVersion: row.sourceVersion,
        };
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    source,
    status: statusFromPrisma[row.status],
    plan: {
      serviceDate: dateOnly(row.serviceDate),
      legs: row.legs.map((leg) => ({
        id: leg.id,
        sequence: leg.sequence,
        label: leg.label,
      })),
    },
    version: row.version,
    planVersion: row.planVersion,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function presentTrip(trip: Trip) {
  return {
    ...trip,
    plan: {
      serviceDate: trip.plan.serviceDate,
      legs: trip.plan.legs.map((leg) => ({ ...leg })),
    },
    scheduledAt: trip.scheduledAt?.toISOString() ?? null,
    startedAt: trip.startedAt?.toISOString() ?? null,
    endedAt: trip.endedAt?.toISOString() ?? null,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}

function presentResult(result: TripCommandResult) {
  return {
    trip: presentTrip(result.trip),
    history: {
      ...result.history,
      occurredAt: result.history.occurredAt.toISOString(),
    },
    planVersion: result.planVersion
      ? {
          ...result.planVersion,
          createdAt: result.planVersion.createdAt.toISOString(),
        }
      : null,
    operationalRecord: result.operationalRecord
      ? {
          ...result.operationalRecord,
          occurredAt: result.operationalRecord.occurredAt.toISOString(),
        }
      : null,
  };
}

function toTripRoutePlanSelection(
  row: TripRoutePlanSelectionRow,
): TripRoutePlanSelection {
  return {
    ...row,
    sourceSnapshot: row.sourceSnapshot as Readonly<Record<string, unknown>>,
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function presentTripRoutePlanSelection(selection: TripRoutePlanSelection) {
  const route = record(selection.sourceSnapshot.route);
  const origin = record(route.origin);
  const destination = record(route.destination);
  return {
    id: selection.id,
    sourceRouteId: selection.sourceRouteId,
    sourceRouteVersion: selection.sourceRouteVersion,
    sourcePlanVersion: selection.sourcePlanVersion,
    routeAggregateVersionAtSelection:
      selection.routeAggregateVersionAtSelection,
    reason: selection.reason,
    selectedByUserId: selection.selectedByUserId,
    selectedAt: selection.selectedAt.toISOString(),
    supersededAt: selection.supersededAt?.toISOString() ?? null,
    usedForExecutionAt: selection.usedForExecutionAt?.toISOString() ?? null,
    planSummary: {
      code: route.code ?? null,
      name: route.name ?? null,
      shift: route.shift ?? null,
      type: route.type ?? null,
      originLabel: origin.label ?? null,
      destinationLabel: destination.label ?? null,
      plannedOutboundKm: route.plannedOutboundKm ?? null,
      plannedReturnKm: route.plannedReturnKm ?? null,
      plannedTotalKm: route.plannedTotalKm ?? null,
      estimatedDurationMinutes: route.estimatedDurationMinutes ?? null,
    },
  };
}

@Injectable()
export class OperationalTripsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertScope(
    current: AuthenticatedPrincipal,
    routingCompanyId: string,
  ): void {
    if (
      current.routingCompanyId &&
      current.routingCompanyId !== routingCompanyId
    ) {
      throw forbidden('A viagem informada não pertence ao seu acesso.');
    }
  }

  private async assertActorCanMutate(
    transaction: Prisma.TransactionClient,
    current: AuthenticatedPrincipal,
    requiredPermissions: readonly string[],
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: {
        id_companyId: { id: current.id, companyId: current.companyId },
      },
      select: {
        isActive: true,
        status: true,
        deletedAt: true,
        isAdministrator: true,
        permissionCodes: true,
      },
    });
    if (
      !actor?.isActive ||
      actor.status !== UserAccountStatus.ACTIVE ||
      actor.deletedAt
    ) {
      throw forbidden('O usuário não está ativo neste tenant.');
    }
    if (
      !actor.isAdministrator &&
      !requiredPermissions.some((permission) =>
        actor.permissionCodes.includes(permission),
      )
    ) {
      throw forbidden('A permissão para alterar Viagens não está mais ativa.');
    }
  }

  private assertTripScope(
    current: AuthenticatedPrincipal,
    trip: { readonly contract: { readonly routingCompanyId: string } | null },
  ): void {
    if (trip.contract) {
      this.assertScope(current, trip.contract.routingCompanyId);
      return;
    }
    if (current.routingCompanyId) {
      throw forbidden(
        'Uma viagem eventual sem vínculo confirmado ao cliente não pertence ao seu acesso.',
      );
    }
  }

  private async replay(
    companyId: string,
    commandId: string,
    expectedFingerprint: string,
    expectedTripId?: string,
  ) {
    const history = await this.prisma.operationalTripHistory.findUnique({
      where: { companyId_commandId: { companyId, commandId } },
    });
    if (!history) return null;
    if (history.commandFingerprint !== expectedFingerprint) {
      throw conflict('O commandId já foi usado com outros dados.');
    }
    if (expectedTripId && history.tripId !== expectedTripId) {
      throw conflict('O commandId já foi usado em outra viagem.');
    }
    return {
      ...(history.resultSnapshot as Record<string, unknown>),
      idempotent: true,
    };
  }

  async create(
    current: AuthenticatedPrincipal,
    input: CreateOperationalTripInput,
  ) {
    const sourceKind = input.sourceKind ?? 'continuous-contract';
    if (sourceKind === 'continuous-contract') {
      if (
        !('expectedContractVersion' in input) ||
        !Number.isInteger(input.expectedContractVersion) ||
        input.expectedContractVersion < 1
      ) {
        throw validationError(
          'Informe a versão esperada válida do contrato de origem.',
        );
      }
    } else if (
      !('expectedConfirmedServiceVersion' in input) ||
      !Number.isInteger(input.expectedConfirmedServiceVersion) ||
      input.expectedConfirmedServiceVersion < 1
    ) {
      throw validationError(
        'Informe a versão esperada válida do Serviço Confirmado.',
      );
    }
    const commandFingerprint = fingerprint({
      companyId: current.companyId,
      actorUserId: current.id,
      ...input,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.assertActorCanMutate(transaction, current, [
          'trips:create',
          'trips:manage',
          'routes:create',
          'routes:manage',
        ]);
        const repeated = await transaction.operationalTripHistory.findUnique({
          where: {
            companyId_commandId: {
              companyId: current.companyId,
              commandId: input.commandId,
            },
          },
        });
        if (repeated) {
          if (repeated.commandFingerprint !== commandFingerprint) {
            throw conflict('O commandId já foi usado com outros dados.');
          }
          return {
            ...(repeated.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        let tripSource: Trip['source'];
        let contractId: string | null = null;
        let confirmedServiceId: string | null = null;
        let serviceDate = input.serviceDate;

        if (sourceKind === 'continuous-contract' && 'contractId' in input) {
          const contract = await transaction.routingContract.findUnique({
            where: {
              id_companyId: {
                id: input.contractId,
                companyId: current.companyId,
              },
            },
            select: {
              id: true,
              routingCompanyId: true,
              status: true,
              validFrom: true,
              validUntil: true,
              version: true,
            },
          });
          if (!contract) throw notFound('Contrato de origem');
          if (contract.version !== input.expectedContractVersion) {
            throw conflict(
              `O contrato de origem foi alterado. Versão atual: ${contract.version}.`,
            );
          }
          this.assertScope(current, contract.routingCompanyId);
          const dateToValidate = serviceDate ?? currentBusinessDate();
          assertContractAllowsTripDate(contract, dateToValidate);
          contractId = contract.id;
          tripSource = {
            kind: 'continuous-contract',
            contractId: contract.id,
            sourceVersion: contract.version,
          };
        } else if (
          sourceKind === 'confirmed-service' &&
          'confirmedServiceId' in input
        ) {
          if (current.routingCompanyId) {
            throw forbidden(
              'Somente a equipe interna pode criar uma Viagem eventual enquanto o Serviço Confirmado não possui vínculo autoritativo com o cliente.',
            );
          }
          await transaction.$queryRaw(
            Prisma.sql`
              SELECT "id"
              FROM "confirmed_services"
              WHERE "id" = CAST(${input.confirmedServiceId} AS uuid)
                AND "company_id" = CAST(${current.companyId} AS uuid)
              FOR UPDATE
            `,
          );
          const confirmedService =
            await transaction.confirmedService.findUnique({
              where: {
                id_companyId: {
                  id: input.confirmedServiceId,
                  companyId: current.companyId,
                },
              },
              select: {
                id: true,
                version: true,
                sourceQuoteVersion: true,
                serviceSnapshot: true,
                sourceQuoteRequest: {
                  select: { status: true, version: true },
                },
              },
            });
          if (!confirmedService) throw notFound('Serviço Confirmado');
          if (
            confirmedService.version !== input.expectedConfirmedServiceVersion
          ) {
            throw conflict(
              `O Serviço Confirmado foi alterado. Versão atual: ${confirmedService.version}.`,
            );
          }
          if (
            confirmedService.sourceQuoteRequest.status !==
              RequestStatus.APPROVED ||
            confirmedService.sourceQuoteRequest.version !==
              confirmedService.sourceQuoteVersion
          ) {
            throw conflict(
              'O Serviço Confirmado não está mais elegível para originar uma nova Viagem.',
            );
          }
          const snapshot = record(confirmedService.serviceSnapshot);
          const confirmedDepartureDate =
            typeof snapshot.departureDate === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(snapshot.departureDate)
              ? snapshot.departureDate
              : null;
          if (!confirmedDepartureDate) {
            throw validationError(
              'O Serviço Confirmado não possui uma data de saída válida.',
            );
          }
          if (serviceDate && serviceDate !== confirmedDepartureDate) {
            throw validationError(
              'A data da Viagem eventual deve ser a data confirmada no serviço de origem.',
            );
          }
          serviceDate = confirmedDepartureDate;
          confirmedServiceId = confirmedService.id;
          tripSource = {
            kind: 'confirmed-service',
            confirmedServiceId: confirmedService.id,
            sourceVersion: confirmedService.version,
          };
        } else {
          throw validationError('Informe uma origem válida para a Viagem.');
        }

        const created = createTripDraft({
          id: randomUUID(),
          companyId: current.companyId,
          code: input.code,
          source: tripSource,
          plan: {
            serviceDate,
            legs: input.legs.map((leg) => ({
              id: leg.id ?? randomUUID(),
              sequence: leg.sequence,
              label: leg.label,
            })),
          },
          actorUserId: current.id,
          commandId: input.commandId,
          createdAt: new Date(),
        });
        const row = await transaction.operationalTrip.create({
          data: {
            id: created.trip.id,
            companyId: current.companyId,
            sourceKind:
              created.trip.source.kind === 'confirmed-service'
                ? OperationalTripSourceKind.CONFIRMED_SERVICE
                : OperationalTripSourceKind.CONTINUOUS_CONTRACT,
            contractId,
            confirmedServiceId,
            code: created.trip.code,
            sourceVersion: created.trip.source.sourceVersion,
            status: OperationalTripStatus.DRAFT,
            serviceDate: parseDateOnly(
              created.trip.plan.serviceDate ?? undefined,
              'a data da viagem',
            ),
            planVersion: 0,
            version: 1,
            createdByUserId: current.id,
            createdAt: created.trip.createdAt,
            updatedAt: created.trip.updatedAt,
            legs: {
              create: created.trip.plan.legs.map((leg) => ({
                id: leg.id,
                sequence: leg.sequence,
                label: leg.label,
              })),
            },
          },
          include: tripInclude,
        });
        const persisted = {
          ...created,
          trip: toDomain(row),
        };
        const resultSnapshot = presentResult(persisted);
        await transaction.operationalTripHistory.create({
          data: {
            companyId: current.companyId,
            tripId: row.id,
            commandId: input.commandId,
            commandFingerprint,
            actorUserId: current.id,
            action: created.history.action,
            fromStatus: null,
            toStatus: OperationalTripStatus.DRAFT,
            reason: null,
            expectedVersion: null,
            resultingVersion: 1,
            resultSnapshot: payload(resultSnapshot),
            occurredAt: created.history.occurredAt,
          },
        });
        return { ...resultSnapshot, idempotent: false };
      });
    } catch (error) {
      if (
        isUniqueConflict(error) ||
        (error instanceof AppError && error.code === 'CONFLICT')
      ) {
        const replayed = await this.replay(
          current.companyId,
          input.commandId,
          commandFingerprint,
        );
        if (replayed) return replayed;
      }
      rethrowKnownPrismaConflict(error);
    }
  }

  async list(current: AuthenticatedPrincipal, query: OperationalTripListQuery) {
    if (
      query.serviceFrom &&
      query.serviceTo &&
      query.serviceFrom > query.serviceTo
    ) {
      throw validationError(
        'A data inicial da consulta não pode ser posterior à data final.',
      );
    }
    const where: Prisma.OperationalTripWhereInput = {
      companyId: current.companyId,
      ...(query.status ? { status: statusToPrisma[query.status] } : {}),
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(current.routingCompanyId
        ? { contract: { routingCompanyId: current.routingCompanyId } }
        : {}),
      ...(query.serviceFrom || query.serviceTo
        ? {
            serviceDate: {
              ...(query.serviceFrom
                ? {
                    gte: parseDateOnly(query.serviceFrom, 'a data inicial')!,
                  }
                : {}),
              ...(query.serviceTo
                ? {
                    lte: parseDateOnly(query.serviceTo, 'a data final')!,
                  }
                : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.operationalTrip.findMany({
        where,
        include: tripInclude,
        orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.operationalTrip.count({ where }),
    ]);
    return {
      items: rows.map((row) => presentTrip(toDomain(row))),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(current: AuthenticatedPrincipal, tripId: string) {
    const row = await this.prisma.operationalTrip.findUnique({
      where: {
        id_companyId: { id: tripId, companyId: current.companyId },
      },
      include: tripInclude,
    });
    if (!row) throw notFound('Viagem');
    this.assertTripScope(current, row);
    return presentTrip(toDomain(row));
  }

  async history(current: AuthenticatedPrincipal, tripId: string) {
    await this.get(current, tripId);
    const rows = await this.prisma.operationalTripHistory.findMany({
      where: { companyId: current.companyId, tripId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ resultingVersion: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      commandId: row.commandId,
      action: row.action,
      fromStatus: row.fromStatus ? statusFromPrisma[row.fromStatus] : null,
      toStatus: statusFromPrisma[row.toStatus],
      reason: row.reason,
      expectedVersion: row.expectedVersion,
      resultingVersion: row.resultingVersion,
      actor: row.actor,
      result: row.resultSnapshot,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async routePlans(current: AuthenticatedPrincipal, tripId: string) {
    const trip = await this.prisma.operationalTrip.findUnique({
      where: {
        id_companyId: { id: tripId, companyId: current.companyId },
      },
      select: {
        contract: { select: { routingCompanyId: true } },
      },
    });
    if (!trip) throw notFound('Viagem');
    this.assertTripScope(current, trip);

    const rows = await this.prisma.operationalTripRoutePlanSelection.findMany({
      where: { companyId: current.companyId, tripId },
      orderBy: [{ selectedAt: 'asc' }, { id: 'asc' }],
    });
    const items = rows.map((row) =>
      presentTripRoutePlanSelection(toTripRoutePlanSelection(row)),
    );
    return {
      tripId,
      currentSelectionId:
        rows.find((row) => row.supersededAt === null)?.id ?? null,
      executionSelectionId:
        rows.find((row) => row.usedForExecutionAt !== null)?.id ?? null,
      items,
    };
  }

  async selectRoutePlan(
    current: AuthenticatedPrincipal,
    tripId: string,
    input: SelectOperationalTripRoutePlanInput,
  ) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw validationError('Informe a versão esperada válida para a Viagem.');
    }
    const commandFingerprint = fingerprint({
      companyId: current.companyId,
      tripId,
      actorUserId: current.id,
      ...input,
    });

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.assertActorCanMutate(transaction, current, [
          'trips:update',
          'trips:manage',
          'routes:update',
          'routes:manage',
        ]);
        const repeated = await transaction.operationalTripHistory.findUnique({
          where: {
            companyId_commandId: {
              companyId: current.companyId,
              commandId: input.commandId,
            },
          },
        });
        if (repeated) {
          if (repeated.commandFingerprint !== commandFingerprint) {
            throw conflict('O commandId já foi usado com outros dados.');
          }
          if (repeated.tripId !== tripId) {
            throw conflict('O commandId já foi usado em outra viagem.');
          }
          return {
            ...(repeated.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const tripRow = await transaction.operationalTrip.findUnique({
          where: {
            id_companyId: { id: tripId, companyId: current.companyId },
          },
          include: tripInclude,
        });
        if (!tripRow) throw notFound('Viagem');
        this.assertTripScope(current, tripRow);
        if (!tripRow.contract || !tripRow.contractId) {
          throw validationError(
            'As Rotas recorrentes atuais pertencem a contratos contínuos; um Plano de Rota eventual ainda deve ser cadastrado em uma estrutura própria.',
          );
        }
        if (tripRow.version !== input.expectedVersion) {
          throw conflict(
            `A Viagem foi alterada por outro comando. Versão atual: ${tripRow.version}.`,
          );
        }

        await transaction.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "routing_routes"
            WHERE "id" = CAST(${input.routeId} AS uuid)
              AND "company_id" = CAST(${current.companyId} AS uuid)
            FOR UPDATE
          `,
        );
        const route = await transaction.routingRoute.findUnique({
          where: {
            id_companyId: {
              id: input.routeId,
              companyId: current.companyId,
            },
          },
          select: {
            id: true,
            contractId: true,
            routingCompanyId: true,
            version: true,
            approvedVersion: true,
          },
        });
        if (!route) throw notFound('Rota');
        this.assertScope(current, route.routingCompanyId);
        if (route.approvedVersion === null) {
          throw validationError('A Rota ainda não possui uma versão aprovada.');
        }
        const approval = await transaction.routingRouteApproval.findUnique({
          where: {
            companyId_routeId_approvedVersion: {
              companyId: current.companyId,
              routeId: route.id,
              approvedVersion: route.approvedVersion,
            },
          },
          select: { id: true },
        });
        const approvedVersionRow =
          await transaction.routingRouteVersion.findUnique({
            where: {
              companyId_routeId_version: {
                companyId: current.companyId,
                routeId: route.id,
                version: route.approvedVersion,
              },
            },
          });
        const currentSelectionRow =
          await transaction.operationalTripRoutePlanSelection.findFirst({
            where: {
              companyId: current.companyId,
              tripId,
              supersededAt: null,
            },
          });
        if (!approval || !approvedVersionRow) {
          throw validationError(
            'A versão aprovada da Rota não possui snapshot e aprovação íntegros.',
          );
        }

        const selectedAt = new Date();
        const selection = prepareTripRoutePlanSelection({
          id: randomUUID(),
          companyId: current.companyId,
          tripId,
          tripStatus: statusFromPrisma[tripRow.status],
          tripContractId: tripRow.contractId,
          tripStartedAt: tripRow.startedAt,
          route: {
            id: route.id,
            contractId: route.contractId,
            aggregateVersion: route.version,
            approvedVersion: route.approvedVersion,
          },
          approvedVersion: {
            version: approvedVersionRow.version,
            planVersion: approvedVersionRow.planVersion,
            snapshot: approvedVersionRow.snapshot as Readonly<
              Record<string, unknown>
            >,
          },
          expectedRouteVersion: input.expectedRouteVersion,
          currentSelection: currentSelectionRow
            ? toTripRoutePlanSelection(currentSelectionRow)
            : null,
          actorUserId: current.id,
          commandId: input.commandId,
          reason: input.reason,
          selectedAt,
        });

        const updated = await transaction.operationalTrip.updateMany({
          where: {
            id: tripId,
            companyId: current.companyId,
            version: input.expectedVersion,
          },
          data: {
            version: { increment: 1 },
            updatedAt: selectedAt,
          },
        });
        if (updated.count !== 1) {
          throw conflict(
            'A Viagem foi alterada por outro comando. Recarregue e tente novamente.',
          );
        }

        if (currentSelectionRow) {
          const superseded =
            await transaction.operationalTripRoutePlanSelection.updateMany({
              where: {
                id: currentSelectionRow.id,
                companyId: current.companyId,
                tripId,
                supersededAt: null,
                usedForExecutionAt: null,
              },
              data: { supersededAt: selectedAt },
            });
          if (superseded.count !== 1) {
            throw conflict(
              'O Plano de Rota vigente foi alterado por outro comando.',
            );
          }
        }

        const createdSelection =
          await transaction.operationalTripRoutePlanSelection.create({
            data: {
              id: selection.id,
              companyId: selection.companyId,
              tripId: selection.tripId,
              sourceRouteId: selection.sourceRouteId,
              sourceRouteVersion: selection.sourceRouteVersion,
              sourcePlanVersion: selection.sourcePlanVersion,
              routeAggregateVersionAtSelection:
                selection.routeAggregateVersionAtSelection,
              sourceSnapshot: payload(selection.sourceSnapshot),
              commandId: selection.commandId,
              selectedByUserId: selection.selectedByUserId,
              reason: selection.reason,
              selectedAt: selection.selectedAt,
            },
          });
        const persistedTrip =
          await transaction.operationalTrip.findUniqueOrThrow({
            where: {
              id_companyId: { id: tripId, companyId: current.companyId },
            },
            include: tripInclude,
          });
        const resultSnapshot = {
          trip: presentTrip(toDomain(persistedTrip)),
          selection: presentTripRoutePlanSelection(
            toTripRoutePlanSelection(createdSelection),
          ),
          supersededSelectionId: currentSelectionRow?.id ?? null,
        };
        await transaction.operationalTripHistory.create({
          data: {
            companyId: current.companyId,
            tripId,
            commandId: input.commandId,
            commandFingerprint,
            actorUserId: current.id,
            action: 'route-plan-selected',
            fromStatus: tripRow.status,
            toStatus: tripRow.status,
            reason: selection.reason,
            expectedVersion: input.expectedVersion,
            resultingVersion: tripRow.version + 1,
            resultSnapshot: payload(resultSnapshot),
            occurredAt: selectedAt,
          },
        });
        return { ...resultSnapshot, idempotent: false };
      });
    } catch (error) {
      if (
        isUniqueConflict(error) ||
        (error instanceof AppError && error.code === 'CONFLICT')
      ) {
        const replayed = await this.replay(
          current.companyId,
          input.commandId,
          commandFingerprint,
          tripId,
        );
        if (replayed) return replayed;
      }
      rethrowKnownPrismaConflict(error);
    }
  }

  async apply(
    current: AuthenticatedPrincipal,
    tripId: string,
    input: OperationalTripActionInput & {
      commandId: string;
      expectedVersion: number;
    },
  ) {
    const commandFingerprint = fingerprint({
      companyId: current.companyId,
      tripId,
      actorUserId: current.id,
      ...input,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.assertActorCanMutate(transaction, current, [
          'trips:update',
          'trips:manage',
          'routes:update',
          'routes:manage',
        ]);
        const repeated = await transaction.operationalTripHistory.findUnique({
          where: {
            companyId_commandId: {
              companyId: current.companyId,
              commandId: input.commandId,
            },
          },
        });
        if (repeated) {
          if (repeated.commandFingerprint !== commandFingerprint) {
            throw conflict('O commandId já foi usado com outros dados.');
          }
          if (repeated.tripId !== tripId) {
            throw conflict('O commandId já foi usado em outra viagem.');
          }
          return {
            ...(repeated.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const row = await transaction.operationalTrip.findUnique({
          where: {
            id_companyId: { id: tripId, companyId: current.companyId },
          },
          include: tripInclude,
        });
        if (!row) throw notFound('Viagem');
        this.assertTripScope(current, row);
        const currentTrip = toDomain(row);
        const routePlanToFreeze =
          input.type === 'start'
            ? await transaction.operationalTripRoutePlanSelection.findFirst({
                where: {
                  companyId: current.companyId,
                  tripId,
                  supersededAt: null,
                },
              })
            : null;
        const command = {
          ...input,
          ...('plan' in input && input.plan
            ? {
                plan: {
                  ...input.plan,
                  legs: input.plan.legs.map((leg) => ({
                    ...leg,
                    id: leg.id ?? randomUUID(),
                  })),
                },
              }
            : {}),
          actorUserId: current.id,
          occurredAt: new Date(),
        } as TripCommand;
        const applied = applyTripCommand(currentTrip, command);
        const frozenRoutePlan =
          routePlanToFreeze && applied.trip.startedAt
            ? freezeTripRoutePlanSelection(
                toTripRoutePlanSelection(routePlanToFreeze),
                applied.trip.startedAt,
              )
            : null;
        if (
          (input.type === 'schedule' || input.type === 'revise-schedule') &&
          applied.trip.plan.serviceDate &&
          row.contract
        ) {
          assertContractAllowsTripDate(
            row.contract,
            applied.trip.plan.serviceDate,
          );
        }

        const updated = await transaction.operationalTrip.updateMany({
          where: {
            id: tripId,
            companyId: current.companyId,
            version: input.expectedVersion,
          },
          data: {
            status: statusToPrisma[applied.trip.status],
            serviceDate: parseDateOnly(
              applied.trip.plan.serviceDate ?? undefined,
              'a data da viagem',
            ),
            planVersion: applied.trip.planVersion,
            scheduledAt: applied.trip.scheduledAt,
            startedAt: applied.trip.startedAt,
            endedAt: applied.trip.endedAt,
            version: applied.trip.version,
            updatedAt: applied.trip.updatedAt,
          },
        });
        if (updated.count !== 1) {
          const latest = await transaction.operationalTrip.findUniqueOrThrow({
            where: {
              id_companyId: { id: tripId, companyId: current.companyId },
            },
            select: { version: true },
          });
          throw conflict(
            `A viagem foi alterada por outro comando. Versão atual: ${latest.version}.`,
          );
        }

        if (routePlanToFreeze && frozenRoutePlan?.usedForExecutionAt) {
          const frozen =
            await transaction.operationalTripRoutePlanSelection.updateMany({
              where: {
                id: routePlanToFreeze.id,
                companyId: current.companyId,
                tripId,
                supersededAt: null,
                usedForExecutionAt: null,
              },
              data: {
                usedForExecutionAt: frozenRoutePlan.usedForExecutionAt,
              },
            });
          if (frozen.count !== 1) {
            throw conflict(
              'O Plano de Rota vigente foi alterado durante o início da Viagem.',
            );
          }
        }

        if (input.type === 'edit-draft' || input.type === 'revise-schedule') {
          await transaction.operationalTripLeg.deleteMany({
            where: { companyId: current.companyId, tripId },
          });
          await transaction.operationalTripLeg.createMany({
            data: applied.trip.plan.legs.map((leg) => ({
              id: leg.id,
              companyId: current.companyId,
              tripId,
              sequence: leg.sequence,
              label: leg.label,
            })),
          });
        }

        if (applied.planVersion) {
          await transaction.operationalTripVersion.create({
            data: {
              companyId: current.companyId,
              tripId,
              commandId: input.commandId,
              version: applied.planVersion.version,
              aggregateVersion: applied.planVersion.aggregateVersion,
              snapshot: payload(applied.planVersion.plan),
              reason: applied.planVersion.reason,
              createdByUserId: current.id,
              createdAt: applied.planVersion.createdAt,
            },
          });
        }
        if (applied.operationalRecord) {
          await transaction.operationalTripOccurrence.create({
            data: {
              companyId: current.companyId,
              tripId,
              commandId: input.commandId,
              kind: applied.operationalRecord.kind,
              category:
                applied.operationalRecord.kind === 'occurrence'
                  ? applied.operationalRecord.category
                  : null,
              reason: applied.operationalRecord.reason,
              evidence: payload(applied.operationalRecord.evidence),
              resultingVersion: applied.operationalRecord.resultingVersion,
              actorUserId: current.id,
              occurredAt: applied.operationalRecord.occurredAt,
            },
          });
        }

        const persistedRow =
          await transaction.operationalTrip.findUniqueOrThrow({
            where: {
              id_companyId: { id: tripId, companyId: current.companyId },
            },
            include: tripInclude,
          });
        const persisted = {
          ...applied,
          trip: toDomain(persistedRow),
        };
        const resultSnapshot = presentResult(persisted);
        await transaction.operationalTripHistory.create({
          data: {
            companyId: current.companyId,
            tripId,
            commandId: input.commandId,
            commandFingerprint,
            actorUserId: current.id,
            action: applied.history.action,
            fromStatus: applied.history.fromStatus
              ? statusToPrisma[applied.history.fromStatus]
              : null,
            toStatus: statusToPrisma[applied.history.toStatus],
            reason: applied.history.reason,
            expectedVersion: applied.history.expectedVersion,
            resultingVersion: applied.history.resultingVersion,
            resultSnapshot: payload(resultSnapshot),
            occurredAt: applied.history.occurredAt,
          },
        });
        return { ...resultSnapshot, idempotent: false };
      });
    } catch (error) {
      if (
        isUniqueConflict(error) ||
        (error instanceof AppError && error.code === 'CONFLICT')
      ) {
        const replayed = await this.replay(
          current.companyId,
          input.commandId,
          commandFingerprint,
          tripId,
        );
        if (replayed) return replayed;
      }
      rethrowKnownPrismaConflict(error);
    }
  }
}
