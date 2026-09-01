import { Injectable } from '@nestjs/common';

import {
  PreAdmissionAccessRepository,
  type PreAdmissionAccessRecord,
  type PreAdmissionMutationResult,
} from '../../../application/contracts/pre-admission-access.repository';
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import { canManagePreAdmission } from '../../../domain/identity/pre-admission-access';
import {
  CompanyStatus,
  Prisma,
  RoutingClientType,
  RoutingCompanyStatus,
  UserAccountStatus,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

const accessInclude = {
  personRegistration: {
    select: { individualName: true, legalName: true },
  },
  items: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      documentTypeId: true,
      position: true,
      instructions: true,
      configSnapshot: true,
    },
  },
} satisfies Prisma.PreAdmissionAccessInclude;

type AccessRow = Prisma.PreAdmissionAccessGetPayload<{
  include: typeof accessInclude;
}>;

type HistoryRow = {
  readonly preAdmissionAccessId: string;
  readonly action: string;
  readonly requestFingerprint: string;
  readonly resultVersion: number;
  readonly resultTokenGeneration: number;
  readonly resultExpiresAt: Date;
  readonly resultRevokedAt: Date | null;
};

type RepeatedCommandClient = Pick<
  Prisma.TransactionClient,
  'preAdmissionAccessHistory' | 'preAdmissionAccess'
>;

const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

class ConcurrentPreAdmissionConflict extends AppError {
  constructor(message: string) {
    super('CONFLICT', message);
  }
}

function concurrentConflict(message: string): AppError {
  return new ConcurrentPreAdmissionConflict(message);
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
  return (
    isPrismaUniqueConflict(error) ||
    isTransactionWriteConflict(error) ||
    error instanceof ConcurrentPreAdmissionConflict
  );
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function mapAccess(row: AccessRow): PreAdmissionAccessRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    personRegistrationId: row.personRegistrationId,
    personName:
      row.personRegistration.individualName ?? row.personRegistration.legalName,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    version: row.version,
    tokenGeneration: row.tokenGeneration,
    requestedDocuments: row.items.map((item) => {
      const snapshot = jsonRecord(item.configSnapshot);
      return {
        id: item.id,
        documentTypeId: item.documentTypeId,
        code: typeof snapshot.code === 'string' ? snapshot.code : 'documento',
        name:
          typeof snapshot.name === 'string'
            ? snapshot.name
            : 'Documento solicitado',
        acceptedMimeTypes: stringArray(snapshot.acceptedMimeTypes),
        maxFileSizeBytes: numberValue(snapshot.maxFileSizeBytes, 0),
        minFiles: numberValue(snapshot.minFiles, 1),
        maxFiles: numberValue(snapshot.maxFiles, 1),
        requiresFrontBack: snapshot.requiresFrontBack === true,
        instructions: item.instructions,
        position: item.position,
      };
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mutationResult(
  row: AccessRow,
  history: HistoryRow,
  idempotent: boolean,
): PreAdmissionMutationResult {
  return {
    access: mapAccess(row),
    idempotent,
    resultVersion: history.resultVersion,
    resultTokenGeneration: history.resultTokenGeneration,
    resultExpiresAt: history.resultExpiresAt,
    resultRevokedAt: history.resultRevokedAt,
  };
}

@Injectable()
export class PrismaPreAdmissionAccessRepository extends PreAdmissionAccessRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async assertActorCanManage(
    transaction: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: { id_companyId: { id: actorUserId, companyId } },
      select: {
        isActive: true,
        status: true,
        deletedAt: true,
        departments: true,
        permissionCodes: true,
      },
    });
    if (
      !actor?.isActive ||
      actor.status !== UserAccountStatus.ACTIVE ||
      actor.deletedAt ||
      !canManagePreAdmission({
        departments: actor.departments,
        permissions: actor.permissionCodes,
      })
    ) {
      throw forbidden(
        'Somente RH ou Departamento Pessoal com permissão específica de gestão documental pode administrar acessos de pré-admissão.',
      );
    }
  }

  private async repeatedCommand(
    transaction: RepeatedCommandClient,
    input: {
      readonly companyId: string;
      readonly commandId: string;
      readonly actorUserId: string;
      readonly action: 'created' | 'renewed' | 'revoked';
      readonly requestFingerprint: string;
      readonly accessId?: string;
    },
  ): Promise<PreAdmissionMutationResult | null> {
    const history = await transaction.preAdmissionAccessHistory.findUnique({
      where: {
        companyId_commandId: {
          companyId: input.companyId,
          commandId: input.commandId,
        },
      },
      select: {
        preAdmissionAccessId: true,
        action: true,
        requestFingerprint: true,
        actorUserId: true,
        resultVersion: true,
        resultTokenGeneration: true,
        resultExpiresAt: true,
        resultRevokedAt: true,
      },
    });
    if (!history) return null;
    if (
      history.action !== input.action ||
      history.requestFingerprint !== input.requestFingerprint ||
      history.actorUserId !== input.actorUserId ||
      (input.accessId && history.preAdmissionAccessId !== input.accessId)
    ) {
      throw conflict('Este commandId já foi utilizado com outros dados.');
    }
    const access = await transaction.preAdmissionAccess.findUniqueOrThrow({
      where: {
        id_companyId: {
          id: history.preAdmissionAccessId,
          companyId: input.companyId,
        },
      },
      include: accessInclude,
    });
    return mutationResult(access, history, true);
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

  private async replayAfterConcurrentFailure(input: {
    readonly companyId: string;
    readonly commandId: string;
    readonly actorUserId: string;
    readonly action: 'created' | 'renewed' | 'revoked';
    readonly requestFingerprint: string;
    readonly accessId?: string;
  }): Promise<PreAdmissionMutationResult | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const repeated = await this.repeatedCommand(this.prisma, input);
      if (repeated) return repeated;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return null;
  }

  async create(
    input: Parameters<PreAdmissionAccessRepository['create']>[0],
  ): Promise<PreAdmissionMutationResult> {
    try {
      return await this.retrySerializable(() =>
        this.prisma.$transaction(
          async (transaction) => {
            await this.assertActorCanManage(
              transaction,
              input.companyId,
              input.actorUserId,
            );
            const repeated = await this.repeatedCommand(transaction, {
              ...input,
              action: 'created',
            });
            if (repeated) return repeated;

            const documentTypeIds = Array.from(new Set(input.documentTypeIds));
            if (
              documentTypeIds.length === 0 ||
              documentTypeIds.length !== input.documentTypeIds.length
            ) {
              throw validationError(
                'Informe ao menos um tipo documental, sem duplicidades.',
              );
            }
            const [person, documentTypes, openAccess] = await Promise.all([
              transaction.routingCompany.findUnique({
                where: {
                  id_companyId: {
                    id: input.personRegistrationId,
                    companyId: input.companyId,
                  },
                },
                select: { id: true, clientType: true, status: true },
              }),
              transaction.documentType.findMany({
                where: {
                  companyId: input.companyId,
                  id: { in: documentTypeIds },
                  active: true,
                },
                select: {
                  id: true,
                  code: true,
                  name: true,
                  acceptedMimeTypes: true,
                  maxFileSizeBytes: true,
                  minFiles: true,
                  maxFiles: true,
                  requiresFrontBack: true,
                },
              }),
              transaction.preAdmissionAccess.findFirst({
                where: {
                  companyId: input.companyId,
                  personRegistrationId: input.personRegistrationId,
                  revokedAt: null,
                },
                select: { id: true },
              }),
            ]);
            if (
              !person ||
              person.clientType !== RoutingClientType.PF ||
              person.status !== RoutingCompanyStatus.ACTIVE
            ) {
              throw notFound('Pessoa ativa do Cadastro Principal');
            }
            if (documentTypes.length !== documentTypeIds.length) {
              throw validationError(
                'Um ou mais tipos documentais não existem ou estão inativos neste tenant.',
              );
            }
            if (openAccess) {
              throw concurrentConflict(
                'Esta pessoa já possui um acesso de pré-admissão; renove ou revogue o acesso existente.',
              );
            }
            const documentTypeById = new Map(
              documentTypes.map((documentType) => [
                documentType.id,
                documentType,
              ]),
            );
            const access = await transaction.preAdmissionAccess.create({
              data: {
                id: input.id,
                companyId: input.companyId,
                personRegistrationId: input.personRegistrationId,
                createdByUserId: input.actorUserId,
                tokenHash: input.tokenHash,
                tokenGeneration: 1,
                expiresAt: input.expiresAt,
                version: 1,
                createdAt: input.now,
                updatedAt: input.now,
                items: {
                  create: documentTypeIds.map((documentTypeId, index) => {
                    const documentType = documentTypeById.get(documentTypeId)!;
                    return {
                      documentTypeId,
                      position: index + 1,
                      instructions:
                        input.instructions?.[documentTypeId]?.trim() || null,
                      configSnapshot: {
                        code: documentType.code,
                        name: documentType.name,
                        acceptedMimeTypes: documentType.acceptedMimeTypes,
                        maxFileSizeBytes: documentType.maxFileSizeBytes,
                        minFiles: documentType.minFiles,
                        maxFiles: documentType.maxFiles,
                        requiresFrontBack: documentType.requiresFrontBack,
                      },
                    };
                  }),
                },
              },
              include: accessInclude,
            });
            const history = await transaction.preAdmissionAccessHistory.create({
              data: {
                companyId: input.companyId,
                preAdmissionAccessId: access.id,
                actorUserId: input.actorUserId,
                commandId: input.commandId,
                expectedVersion: input.expectedVersion,
                action: 'created',
                requestFingerprint: input.requestFingerprint,
                resultVersion: 1,
                resultTokenGeneration: 1,
                resultExpiresAt: input.expiresAt,
                resultRevokedAt: null,
              },
            });
            await transaction.tenantAuditLog.create({
              data: {
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: 'pre-admission.access.create',
                targetType: 'pre-admission-access',
                targetId: access.id,
                metadata: {
                  personRegistrationId: input.personRegistrationId,
                  documentTypeIds,
                  expiresAt: input.expiresAt.toISOString(),
                  version: 1,
                },
              },
            });
            return mutationResult(access, history, false);
          },
          { isolationLevel: 'Serializable' },
        ),
      );
    } catch (error) {
      if (!isConcurrencyConflict(error)) throw error;
      const replayed = await this.replayAfterConcurrentFailure({
        ...input,
        action: 'created',
      });
      if (replayed) return replayed;
      if (error instanceof AppError && error.code === 'CONFLICT') throw error;
      throw conflict(
        'Esta pessoa já possui um acesso de pré-admissão; renove ou revogue o acesso existente.',
      );
    }
  }

  async renew(
    input: Parameters<PreAdmissionAccessRepository['renew']>[0],
  ): Promise<PreAdmissionMutationResult> {
    return this.changeAccess(input, 'renewed');
  }

  async revoke(
    input: Parameters<PreAdmissionAccessRepository['revoke']>[0],
  ): Promise<PreAdmissionMutationResult> {
    return this.changeAccess(input, 'revoked');
  }

  private async changeAccess(
    input:
      | Parameters<PreAdmissionAccessRepository['renew']>[0]
      | Parameters<PreAdmissionAccessRepository['revoke']>[0],
    action: 'renewed' | 'revoked',
  ): Promise<PreAdmissionMutationResult> {
    try {
      return await this.retrySerializable(() =>
        this.prisma.$transaction(
          async (transaction) => {
            await this.assertActorCanManage(
              transaction,
              input.companyId,
              input.actorUserId,
            );
            const repeated = await this.repeatedCommand(transaction, {
              ...input,
              action,
            });
            if (repeated) return repeated;
            const access = await transaction.preAdmissionAccess.findUnique({
              where: {
                id_companyId: {
                  id: input.accessId,
                  companyId: input.companyId,
                },
              },
              include: accessInclude,
            });
            if (!access) throw notFound('Acesso de pré-admissão');
            if (access.version !== input.expectedVersion) {
              throw concurrentConflict(
                'O acesso de pré-admissão foi alterado; recarregue e tente novamente.',
              );
            }
            const resultVersion = input.expectedVersion + 1;
            const isRenewal = action === 'renewed';
            if (isRenewal) {
              const otherOpenAccess =
                await transaction.preAdmissionAccess.findFirst({
                  where: {
                    companyId: input.companyId,
                    personRegistrationId: access.personRegistrationId,
                    revokedAt: null,
                    id: { not: input.accessId },
                  },
                  select: { id: true },
                });
              if (otherOpenAccess) {
                throw conflict(
                  'Esta pessoa já possui outro acesso de pré-admissão aberto.',
                );
              }
            }
            const resultExpiresAt = isRenewal
              ? (input as Parameters<PreAdmissionAccessRepository['renew']>[0])
                  .expiresAt
              : access.expiresAt;
            const resultRevokedAt = isRenewal ? null : input.now;
            const resultTokenGeneration = resultVersion;
            const changed = await transaction.preAdmissionAccess.updateMany({
              where: {
                id: input.accessId,
                companyId: input.companyId,
                version: input.expectedVersion,
              },
              data: {
                version: resultVersion,
                tokenGeneration: resultTokenGeneration,
                expiresAt: resultExpiresAt,
                revokedAt: resultRevokedAt,
                updatedAt: input.now,
                ...(isRenewal
                  ? {
                      tokenHash: (
                        input as Parameters<
                          PreAdmissionAccessRepository['renew']
                        >[0]
                      ).tokenHash,
                    }
                  : {}),
              },
            });
            if (changed.count !== 1) {
              throw concurrentConflict(
                'O acesso de pré-admissão foi alterado; recarregue e tente novamente.',
              );
            }
            const history = await transaction.preAdmissionAccessHistory.create({
              data: {
                companyId: input.companyId,
                preAdmissionAccessId: input.accessId,
                actorUserId: input.actorUserId,
                commandId: input.commandId,
                expectedVersion: input.expectedVersion,
                action,
                requestFingerprint: input.requestFingerprint,
                resultVersion,
                resultTokenGeneration,
                resultExpiresAt,
                resultRevokedAt,
              },
            });
            await transaction.tenantAuditLog.create({
              data: {
                companyId: input.companyId,
                actorUserId: input.actorUserId,
                action: `pre-admission.access.${action}`,
                targetType: 'pre-admission-access',
                targetId: input.accessId,
                metadata: {
                  expectedVersion: input.expectedVersion,
                  resultVersion,
                  expiresAt: resultExpiresAt.toISOString(),
                  revokedAt: resultRevokedAt?.toISOString() ?? null,
                },
              },
            });
            const updated =
              await transaction.preAdmissionAccess.findUniqueOrThrow({
                where: {
                  id_companyId: {
                    id: input.accessId,
                    companyId: input.companyId,
                  },
                },
                include: accessInclude,
              });
            return mutationResult(updated, history, false);
          },
          { isolationLevel: 'Serializable' },
        ),
      );
    } catch (error) {
      if (!isConcurrencyConflict(error)) throw error;
      const replayed = await this.replayAfterConcurrentFailure({
        ...input,
        action,
      });
      if (replayed) return replayed;
      if (error instanceof AppError && error.code === 'CONFLICT') throw error;
      throw conflict(
        'O acesso de pré-admissão foi alterado; recarregue e tente novamente.',
      );
    }
  }

  async resolve(
    input: Parameters<PreAdmissionAccessRepository['resolve']>[0],
  ): Promise<PreAdmissionAccessRecord | null> {
    const access = await this.prisma.preAdmissionAccess.findFirst({
      where: {
        id: input.accessId,
        tokenHash: input.tokenHash,
        revokedAt: null,
        expiresAt: { gt: input.now },
        company: { status: CompanyStatus.ACTIVE },
        personRegistration: { status: RoutingCompanyStatus.ACTIVE },
      },
      include: accessInclude,
    });
    return access ? mapAccess(access) : null;
  }
}
