import { Injectable } from '@nestjs/common';

import {
  type AttestCommercialServiceRequirementCommand,
  type AttestCommercialServiceRequirementResult,
  type CommercialServiceReadinessResult,
  type CommercialServiceRequirementAttestationRecord,
  ConfirmedServiceRepository,
  type ConfirmedServiceRecord,
  type ConfirmServiceCommand,
  type ConfirmServiceResult,
  type MarkCommercialServiceRequirementNotApplicableCommand,
  type MarkCommercialServiceRequirementNotApplicableResult,
} from '../../../application/contracts/confirmed-service.repository';
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  assertCanMarkCommercialServiceRequirementNotApplicable,
  assertCanAttestCommercialServiceRequirement,
  assertCanConfirmCommercialService,
  type CommercialServiceRequirementKind,
  type CommercialServiceRequirementOutcome,
} from '../../../domain/commercial/confirmed-service';
import { presentDateOnly } from '../../../domain/commercial/quote-schedule';
import {
  CommercialServiceRequirementKind as PrismaCommercialServiceRequirementKind,
  CommercialServiceRequirementOutcome as PrismaCommercialServiceRequirementOutcome,
  Prisma,
  RequestStatus,
  UserAccountStatus,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

type RepeatedCommandClient = Pick<
  Prisma.TransactionClient,
  'confirmedServiceHistory' | 'confirmedService'
>;

type RepeatedAttestationClient = Pick<
  Prisma.TransactionClient,
  'commercialServiceRequirementAttestation'
>;

type RequirementAttestationWriteCommand =
  | (AttestCommercialServiceRequirementCommand & {
      readonly outcome: 'SATISFIED';
      readonly reason: null;
    })
  | (MarkCommercialServiceRequirementNotApplicableCommand & {
      readonly outcome: 'NOT_APPLICABLE';
    });

type ConfirmedServiceRow = {
  readonly id: string;
  readonly companyId: string;
  readonly sourceQuoteRequestId: string;
  readonly sourceQuoteVersion: number;
  readonly sourceItemKey: string;
  readonly serviceSnapshot: unknown;
  readonly requirementsSnapshot: unknown;
  readonly confirmationBasis: string;
  readonly version: number;
  readonly confirmedByUserId: string;
  readonly confirmedAt: Date;
};

type CommercialServiceRequirementAttestationRow = {
  readonly id: string;
  readonly companyId: string;
  readonly sourceQuoteRequestId: string;
  readonly sourceQuoteVersion: number;
  readonly sourceItemKey: string;
  readonly kind: PrismaCommercialServiceRequirementKind;
  readonly outcome: PrismaCommercialServiceRequirementOutcome;
  readonly reason: string | null;
  readonly evidence: string;
  readonly actorUserId: string;
  readonly commandId: string;
  readonly attestedAt: Date;
};

const requirementKindToPrisma: Readonly<
  Record<
    CommercialServiceRequirementKind,
    PrismaCommercialServiceRequirementKind
  >
> = {
  financial: PrismaCommercialServiceRequirementKind.FINANCIAL,
  operational: PrismaCommercialServiceRequirementKind.OPERATIONAL,
};

const requirementKindFromPrisma: Readonly<
  Record<
    PrismaCommercialServiceRequirementKind,
    CommercialServiceRequirementKind
  >
> = {
  FINANCIAL: 'financial',
  OPERATIONAL: 'operational',
};

const requirementOutcomeFromPrisma: Readonly<
  Record<
    PrismaCommercialServiceRequirementOutcome,
    CommercialServiceRequirementOutcome
  >
> = {
  SATISFIED: 'SATISFIED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

const requirementOutcomeToPrisma: Readonly<
  Record<
    CommercialServiceRequirementOutcome,
    PrismaCommercialServiceRequirementOutcome
  >
> = {
  SATISFIED: PrismaCommercialServiceRequirementOutcome.SATISFIED,
  NOT_APPLICABLE: PrismaCommercialServiceRequirementOutcome.NOT_APPLICABLE,
};

const requirementOutcomeSnapshotValue: Readonly<
  Record<
    PrismaCommercialServiceRequirementOutcome,
    'satisfied' | 'not-applicable'
  >
> = {
  SATISFIED: 'satisfied',
  NOT_APPLICABLE: 'not-applicable',
};

function mapAttestation(
  row: CommercialServiceRequirementAttestationRow,
): CommercialServiceRequirementAttestationRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceQuoteRequestId: row.sourceQuoteRequestId,
    sourceQuoteVersion: row.sourceQuoteVersion,
    sourceItemKey: row.sourceItemKey,
    kind: requirementKindFromPrisma[row.kind],
    outcome: requirementOutcomeFromPrisma[row.outcome],
    reason: row.reason,
    evidence: row.evidence,
    actorUserId: row.actorUserId,
    commandId: row.commandId,
    attestedAt: row.attestedAt,
  };
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function mapService(row: ConfirmedServiceRow): ConfirmedServiceRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceQuoteRequestId: row.sourceQuoteRequestId,
    sourceQuoteVersion: row.sourceQuoteVersion,
    sourceItemKey: row.sourceItemKey,
    serviceSnapshot: jsonRecord(row.serviceSnapshot),
    requirementsSnapshot: jsonRecord(row.requirementsSnapshot),
    confirmationBasis: row.confirmationBasis,
    version: row.version,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt,
  };
}

function resultSnapshot(
  service: ConfirmedServiceRecord,
): Prisma.InputJsonObject {
  return {
    id: service.id,
    companyId: service.companyId,
    sourceQuoteRequestId: service.sourceQuoteRequestId,
    sourceQuoteVersion: service.sourceQuoteVersion,
    sourceItemKey: service.sourceItemKey,
    serviceSnapshot: service.serviceSnapshot as Prisma.InputJsonObject,
    requirementsSnapshot:
      service.requirementsSnapshot as Prisma.InputJsonObject,
    confirmationBasis: service.confirmationBasis,
    version: service.version,
    confirmedByUserId: service.confirmedByUserId,
    confirmedAt: service.confirmedAt.toISOString(),
  };
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isTransactionWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (
    ('code' in error &&
      ['P2034', '40001', '40P01'].includes(String(error.code))) ||
    ('kind' in error && error.kind === 'TransactionWriteConflict')
  ) {
    return true;
  }
  if (
    'message' in error &&
    typeof error.message === 'string' &&
    /write conflict|deadlock|serialization failure|transactionwriteconflict/i.test(
      error.message,
    )
  ) {
    return true;
  }
  return (
    ('cause' in error && isTransactionWriteConflict(error.cause)) ||
    ('meta' in error && isTransactionWriteConflict(error.meta)) ||
    ('driverAdapterError' in error &&
      isTransactionWriteConflict(error.driverAdapterError))
  );
}

function isConcurrencyConflict(error: unknown): boolean {
  return isPrismaUniqueConflict(error) || isTransactionWriteConflict(error);
}

@Injectable()
export class PrismaConfirmedServiceRepository extends ConfirmedServiceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async lockActorForAuthority(
    transaction: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string,
  ): Promise<void> {
    const lockedActor = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM users
      WHERE id = CAST(${actorUserId} AS uuid)
        AND company_id = CAST(${companyId} AS uuid)
      FOR SHARE
    `;
    if (lockedActor.length !== 1) {
      throw forbidden('O usuário não está ativo neste tenant.');
    }
  }

  private async assertActorCanConfirm(
    transaction: Prisma.TransactionClient,
    input: Pick<ConfirmServiceCommand, 'companyId' | 'actorUserId'>,
  ): Promise<void> {
    await this.lockActorForAuthority(
      transaction,
      input.companyId,
      input.actorUserId,
    );
    const actor = await transaction.user.findUnique({
      where: {
        id_companyId: {
          id: input.actorUserId,
          companyId: input.companyId,
        },
      },
      select: {
        isActive: true,
        status: true,
        deletedAt: true,
        isAdministrator: true,
        documentAccessMode: true,
        departments: true,
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
    assertCanConfirmCommercialService({
      isAdministrator: actor.isAdministrator,
      departments: actor.departments,
      permissionCodes: actor.permissionCodes,
      permissions: actor.permissionCodes,
      documentAccessMode: actor.documentAccessMode,
    });
  }

  private async assertActorCanRecordRequirement(
    transaction: Prisma.TransactionClient,
    input: Pick<
      RequirementAttestationWriteCommand,
      'companyId' | 'actorUserId' | 'kind' | 'outcome'
    >,
  ): Promise<void> {
    await this.lockActorForAuthority(
      transaction,
      input.companyId,
      input.actorUserId,
    );
    const actor = await transaction.user.findUnique({
      where: {
        id_companyId: {
          id: input.actorUserId,
          companyId: input.companyId,
        },
      },
      select: {
        isActive: true,
        status: true,
        deletedAt: true,
        isAdministrator: true,
        documentAccessMode: true,
        departments: true,
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
    if (input.outcome === 'SATISFIED') {
      assertCanAttestCommercialServiceRequirement(
        {
          isAdministrator: actor.isAdministrator,
          departments: actor.departments,
          permissionCodes: actor.permissionCodes,
          permissions: actor.permissionCodes,
          documentAccessMode: actor.documentAccessMode,
        },
        input.kind,
      );
      return;
    }
    assertCanMarkCommercialServiceRequirementNotApplicable({
      isAdministrator: actor.isAdministrator,
      departments: actor.departments,
      permissionCodes: actor.permissionCodes,
      permissions: actor.permissionCodes,
      documentAccessMode: actor.documentAccessMode,
    });
  }

  private async repeatedCommand(
    client: RepeatedCommandClient,
    input: ConfirmServiceCommand,
  ): Promise<ConfirmServiceResult | null> {
    const history = await client.confirmedServiceHistory.findUnique({
      where: {
        companyId_commandId: {
          companyId: input.companyId,
          commandId: input.commandId,
        },
      },
      select: {
        confirmedServiceId: true,
        actorUserId: true,
        action: true,
        commandFingerprint: true,
      },
    });
    if (!history) return null;
    if (
      history.actorUserId !== input.actorUserId ||
      history.action !== 'confirmed' ||
      history.commandFingerprint !== input.requestFingerprint
    ) {
      throw conflict('Este commandId já foi utilizado com outros dados.');
    }
    const service = await client.confirmedService.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: history.confirmedServiceId,
          companyId: input.companyId,
        },
      },
    });
    return { service: mapService(service), idempotent: true };
  }

  private async repeatedAttestation(
    client: RepeatedAttestationClient,
    input: RequirementAttestationWriteCommand,
  ): Promise<AttestCommercialServiceRequirementResult | null> {
    const attestation =
      await client.commercialServiceRequirementAttestation.findUnique({
        where: {
          companyId_commandId: {
            companyId: input.companyId,
            commandId: input.commandId,
          },
        },
      });
    if (!attestation) return null;
    if (
      attestation.actorUserId !== input.actorUserId ||
      attestation.sourceQuoteRequestId !== input.quoteRequestId ||
      attestation.kind !== requirementKindToPrisma[input.kind] ||
      attestation.outcome !== requirementOutcomeToPrisma[input.outcome] ||
      attestation.commandFingerprint !== input.requestFingerprint
    ) {
      throw conflict('Este commandId já foi utilizado com outros dados.');
    }
    return { attestation: mapAttestation(attestation), idempotent: true };
  }

  private async retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          !isTransactionWriteConflict(error) ||
          attempt >= SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  private async replayAfterConcurrentFailure(
    input: ConfirmServiceCommand,
  ): Promise<ConfirmServiceResult | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const repeated = await this.repeatedCommand(this.prisma, input);
      if (repeated) return repeated;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return null;
  }

  private async replayAttestationAfterConcurrentFailure(
    input: RequirementAttestationWriteCommand,
  ): Promise<AttestCommercialServiceRequirementResult | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const repeated = await this.repeatedAttestation(this.prisma, input);
      if (repeated) return repeated;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return null;
  }

  async attestRequirement(
    input: AttestCommercialServiceRequirementCommand,
  ): Promise<AttestCommercialServiceRequirementResult> {
    return this.recordRequirementAttestation({
      ...input,
      outcome: 'SATISFIED',
      reason: null,
    });
  }

  async markRequirementNotApplicable(
    input: MarkCommercialServiceRequirementNotApplicableCommand,
  ): Promise<MarkCommercialServiceRequirementNotApplicableResult> {
    return this.recordRequirementAttestation({
      ...input,
      outcome: 'NOT_APPLICABLE',
    });
  }

  private async recordRequirementAttestation(
    input: RequirementAttestationWriteCommand,
  ): Promise<AttestCommercialServiceRequirementResult> {
    try {
      return await this.retrySerializable(() =>
        this.prisma.$transaction(
          async (transaction) => {
            await this.assertActorCanRecordRequirement(transaction, input);
            const repeated = await this.repeatedAttestation(transaction, input);
            if (repeated) return repeated;

            const quote = await transaction.quoteRequest.findUnique({
              where: {
                id_companyId: {
                  id: input.quoteRequestId,
                  companyId: input.companyId,
                },
              },
              select: {
                id: true,
                status: true,
                version: true,
                departureDate: true,
              },
            });
            if (!quote) throw notFound('Orçamento aceito');
            if (quote.status !== RequestStatus.APPROVED) {
              throw validationError(
                'Somente um orçamento aceito pode receber atestes de confirmação.',
              );
            }
            if (quote.version !== input.expectedVersion) {
              throw conflict(
                'O orçamento aceito foi alterado; recarregue a versão atual.',
              );
            }
            if (!quote.departureDate) {
              throw validationError(
                'A data de saída é obrigatória antes dos atestes de confirmação.',
              );
            }

            const existing =
              await transaction.commercialServiceRequirementAttestation.findUnique(
                {
                  where: {
                    companyId_sourceQuoteRequestId_sourceQuoteVersion_sourceItemKey_kind:
                      {
                        companyId: input.companyId,
                        sourceQuoteRequestId: quote.id,
                        sourceQuoteVersion: quote.version,
                        sourceItemKey: input.sourceItemKey,
                        kind: requirementKindToPrisma[input.kind],
                      },
                  },
                  select: { id: true },
                },
              );
            if (existing) {
              throw conflict(
                `O requisito ${input.kind === 'financial' ? 'financeiro' : 'operacional'} já possui ateste nesta versão do orçamento.`,
              );
            }

            const attestedAt = new Date();
            const created =
              await transaction.commercialServiceRequirementAttestation.create({
                data: {
                  companyId: input.companyId,
                  sourceQuoteRequestId: quote.id,
                  sourceQuoteVersion: quote.version,
                  sourceItemKey: input.sourceItemKey,
                  kind: requirementKindToPrisma[input.kind],
                  outcome: requirementOutcomeToPrisma[input.outcome],
                  reason: input.reason,
                  evidence: input.evidence,
                  actorUserId: input.actorUserId,
                  commandId: input.commandId,
                  commandFingerprint: input.requestFingerprint,
                  attestedAt,
                },
              });
            const attestation = mapAttestation(created);
            await transaction.tenantAuditLog.create({
              data: {
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action:
                  input.outcome === 'SATISFIED'
                    ? 'commercial.service-requirement.attest'
                    : 'commercial.service-requirement.mark-not-applicable',
                targetType: 'quote-request',
                targetId: quote.id,
                metadata: {
                  sourceQuoteVersion: quote.version,
                  sourceItemKey: input.sourceItemKey,
                  requirement: input.kind,
                  outcome: input.outcome,
                  reason: input.reason,
                  evidence: input.evidence,
                  attestationId: attestation.id,
                },
              },
            });
            return { attestation, idempotent: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (!isConcurrencyConflict(error)) throw error;
      const replayed =
        await this.replayAttestationAfterConcurrentFailure(input);
      if (replayed) return replayed;
      if (error instanceof AppError && error.code === 'CONFLICT') throw error;
      throw conflict(
        'O requisito foi atestado por outro comando; recarregue antes de tentar novamente.',
      );
    }
  }

  async confirm(input: ConfirmServiceCommand): Promise<ConfirmServiceResult> {
    try {
      return await this.retrySerializable(() =>
        this.prisma.$transaction(
          async (transaction) => {
            await this.assertActorCanConfirm(transaction, input);
            const repeated = await this.repeatedCommand(transaction, input);
            if (repeated) return repeated;

            const quote = await transaction.quoteRequest.findUnique({
              where: {
                id_companyId: {
                  id: input.quoteRequestId,
                  companyId: input.companyId,
                },
              },
              select: {
                id: true,
                companyId: true,
                sequence: true,
                status: true,
                version: true,
                serviceType: true,
                origin: true,
                destination: true,
                departureDate: true,
                departureAt: true,
                returnDate: true,
                returnAt: true,
                passengerCount: true,
                vehicleType: true,
                vehicleAtDisposal: true,
                localTransfers: true,
                notes: true,
                decidedAt: true,
                decidedByUserId: true,
              },
            });
            if (!quote) throw notFound('Orçamento aceito');
            if (quote.status !== RequestStatus.APPROVED) {
              throw validationError(
                'Somente um orçamento aceito pode ter um serviço confirmado.',
              );
            }
            if (quote.version !== input.expectedVersion) {
              throw conflict(
                'O orçamento aceito foi alterado; recarregue e confirme a versão atual.',
              );
            }
            if (!quote.departureDate) {
              throw validationError(
                'A data de saída é obrigatória antes da confirmação do serviço.',
              );
            }

            const existing = await transaction.confirmedService.findUnique({
              where: {
                companyId_sourceQuoteRequestId_sourceItemKey: {
                  companyId: input.companyId,
                  sourceQuoteRequestId: quote.id,
                  sourceItemKey: input.sourceItemKey,
                },
              },
              select: { id: true },
            });
            if (existing) {
              throw conflict(
                'Este serviço proposto já possui uma confirmação registrada.',
              );
            }

            const requirementRows =
              await transaction.commercialServiceRequirementAttestation.findMany(
                {
                  where: {
                    companyId: input.companyId,
                    sourceQuoteRequestId: quote.id,
                    sourceQuoteVersion: quote.version,
                    sourceItemKey: input.sourceItemKey,
                    kind: {
                      in: [
                        PrismaCommercialServiceRequirementKind.FINANCIAL,
                        PrismaCommercialServiceRequirementKind.OPERATIONAL,
                      ],
                    },
                  },
                },
              );
            const financialAttestation = requirementRows.find(
              (row) =>
                row.kind === PrismaCommercialServiceRequirementKind.FINANCIAL,
            );
            const operationalAttestation = requirementRows.find(
              (row) =>
                row.kind === PrismaCommercialServiceRequirementKind.OPERATIONAL,
            );
            if (!financialAttestation || !operationalAttestation) {
              throw validationError(
                'A confirmação exige atestes separados do Financeiro e do Operacional para esta versão do orçamento.',
              );
            }

            const serviceSnapshot = {
              quoteSequence: quote.sequence,
              source: 'legacy-quote-primary-service',
              serviceType: quote.serviceType,
              origin: quote.origin,
              destination: quote.destination,
              departureDate: presentDateOnly(quote.departureDate),
              departureAt: quote.departureAt?.toISOString() ?? null,
              returnDate: presentDateOnly(quote.returnDate),
              returnAt: quote.returnAt?.toISOString() ?? null,
              passengerCount: quote.passengerCount,
              vehicleType: quote.vehicleType,
              vehicleAtDisposal: quote.vehicleAtDisposal,
              localTransfers: quote.localTransfers,
              notes: quote.notes,
            };
            const requirementsSnapshot = {
              commercialAcceptance: {
                outcome: 'satisfied',
                provenance: 'quote-request',
                quoteRequestId: quote.id,
                quoteVersion: quote.version,
                decidedAt: quote.decidedAt?.toISOString() ?? null,
                decidedByUserId: quote.decidedByUserId,
              },
              financial: {
                outcome:
                  requirementOutcomeSnapshotValue[financialAttestation.outcome],
                provenance:
                  financialAttestation.outcome ===
                  PrismaCommercialServiceRequirementOutcome.SATISFIED
                    ? 'financial-attestation'
                    : 'requirement-not-applicable-decision',
                attestationId: financialAttestation.id,
                reason: financialAttestation.reason,
                evidence: financialAttestation.evidence,
                attestedByUserId: financialAttestation.actorUserId,
                attestedAt: financialAttestation.attestedAt.toISOString(),
              },
              operational: {
                outcome:
                  requirementOutcomeSnapshotValue[
                    operationalAttestation.outcome
                  ],
                provenance:
                  operationalAttestation.outcome ===
                  PrismaCommercialServiceRequirementOutcome.SATISFIED
                    ? 'operational-attestation'
                    : 'requirement-not-applicable-decision',
                attestationId: operationalAttestation.id,
                reason: operationalAttestation.reason,
                evidence: operationalAttestation.evidence,
                attestedByUserId: operationalAttestation.actorUserId,
                attestedAt: operationalAttestation.attestedAt.toISOString(),
              },
            };
            const confirmedAt = new Date();
            const created = await transaction.confirmedService.create({
              data: {
                companyId: input.companyId,
                sourceQuoteRequestId: quote.id,
                sourceQuoteVersion: quote.version,
                sourceItemKey: input.sourceItemKey,
                serviceSnapshot,
                requirementsSnapshot,
                confirmationBasis: input.confirmationBasis,
                financialAttestationId: financialAttestation.id,
                operationalAttestationId: operationalAttestation.id,
                version: 1,
                confirmedByUserId: input.actorUserId,
                confirmedAt,
              },
            });
            const service = mapService(created);
            await transaction.confirmedServiceHistory.create({
              data: {
                companyId: input.companyId,
                confirmedServiceId: service.id,
                actorUserId: input.actorUserId,
                commandId: input.commandId,
                commandFingerprint: input.requestFingerprint,
                action: 'confirmed',
                expectedVersion: input.expectedVersion,
                resultingVersion: service.version,
                resultSnapshot: resultSnapshot(service),
              },
            });
            await transaction.tenantAuditLog.create({
              data: {
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: 'commercial.service.confirm',
                targetType: 'confirmed-service',
                targetId: service.id,
                metadata: {
                  sourceQuoteRequestId: quote.id,
                  sourceQuoteVersion: quote.version,
                  sourceItemKey: input.sourceItemKey,
                  version: service.version,
                  requirementsSnapshot,
                },
              },
            });
            return { service, idempotent: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (!isConcurrencyConflict(error)) throw error;
      const replayed = await this.replayAfterConcurrentFailure(input);
      if (replayed) return replayed;
      if (error instanceof AppError && error.code === 'CONFLICT') throw error;
      throw conflict(
        'O serviço foi confirmado ou alterado por outro comando; recarregue antes de tentar novamente.',
      );
    }
  }

  async readiness(input: {
    readonly companyId: string;
    readonly quoteRequestId: string;
  }): Promise<CommercialServiceReadinessResult> {
    const quote = await this.prisma.quoteRequest.findUnique({
      where: {
        id_companyId: {
          id: input.quoteRequestId,
          companyId: input.companyId,
        },
      },
      select: { id: true, status: true, version: true },
    });
    if (!quote) throw notFound('Orçamento comercial');
    const [attestationRows, confirmedService] = await Promise.all([
      this.prisma.commercialServiceRequirementAttestation.findMany({
        where: {
          companyId: input.companyId,
          sourceQuoteRequestId: quote.id,
          sourceQuoteVersion: quote.version,
          sourceItemKey: 'legacy-primary',
        },
        orderBy: [{ kind: 'asc' }, { attestedAt: 'asc' }],
      }),
      this.prisma.confirmedService.findUnique({
        where: {
          companyId_sourceQuoteRequestId_sourceItemKey: {
            companyId: input.companyId,
            sourceQuoteRequestId: quote.id,
            sourceItemKey: 'legacy-primary',
          },
        },
      }),
    ]);
    return {
      quote: {
        id: quote.id,
        status: quote.status.toLowerCase().replaceAll('_', '-'),
        version: quote.version,
      },
      attestations: attestationRows.map(mapAttestation),
      confirmedService: confirmedService ? mapService(confirmedService) : null,
    };
  }
}
