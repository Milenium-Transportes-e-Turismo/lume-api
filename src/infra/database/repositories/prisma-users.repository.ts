import { Injectable } from '@nestjs/common';

import {
  UsersRepository,
  type FindUserUpdateReplayInput,
  type UpdateUserPersistenceInput,
  type UpdateUserPersistenceResult,
  type UpdateUserStatusPersistenceInput,
  type UserListQuery,
  type UserListResult,
  type UserProfileRecord,
  type UserRecord,
} from '../../../application/contracts/repositories';
import type { User } from '../../../domain/entities/user';
import {
  departmentsAllowingPermission,
  isImplicitPermissionCode,
  TENANT_WIDE_PERMISSION,
} from '../../../domain/access/access.constants';
import { isTenantBusinessPermission } from '../../../domain/access/tenant-authority';
import {
  DocumentAccessMode as PrismaDocumentAccessMode,
  UserClientCategory as PrismaUserClientCategory,
  UserAccountStatus as PrismaUserAccountStatus,
  type Prisma,
} from '../prisma/generated/client';
import { rethrowKnownPrismaConflict } from '../prisma/prisma-errors';
import { mapUserRecord, userRecordSelect } from '../prisma/prisma.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { conflict } from '../../../core/errors/app-error';
import { userMutationAuthorizationFingerprint } from '../../../domain/access/user-management-policy';

const userProfileSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  profilePicture: true,
  profilePictureMime: true,
} as const satisfies Prisma.UserSelect;

function mapUserProfile(
  row: Prisma.UserGetPayload<{ select: typeof userProfileSelect }>,
): UserProfileRecord {
  return {
    ...row,
    profilePicture: row.profilePicture
      ? new Uint8Array(row.profilePicture)
      : null,
  };
}

function userUpdateData(
  input: UpdateUserPersistenceInput,
): Prisma.UserUncheckedUpdateInput {
  return {
    ...(input.routingCompanyId === undefined
      ? {}
      : { routingCompanyId: input.routingCompanyId }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.emailNormalized === undefined
      ? {}
      : { emailNormalized: input.emailNormalized }),
    ...(input.cpfNormalized === undefined
      ? {}
      : { cpfNormalized: input.cpfNormalized }),
    ...(input.isAdministrator === undefined
      ? {}
      : { isAdministrator: input.isAdministrator }),
    ...(input.documentAccessMode === undefined
      ? {}
      : {
          documentAccessMode:
            input.documentAccessMode === 'document-portal'
              ? PrismaDocumentAccessMode.DOCUMENT_PORTAL
              : input.documentAccessMode === 'client'
                ? PrismaDocumentAccessMode.CLIENT
                : PrismaDocumentAccessMode.STANDARD,
        }),
    ...(input.clientCategory === undefined
      ? {}
      : {
          clientCategory:
            input.clientCategory === null
              ? null
              : input.clientCategory === 'legal-entity'
                ? PrismaUserClientCategory.LEGAL_ENTITY
                : PrismaUserClientCategory.INDIVIDUAL,
        }),
    ...(input.jobTitle === undefined ? {} : { jobTitle: input.jobTitle }),
    ...(input.maritalStatus === undefined
      ? {}
      : { maritalStatus: input.maritalStatus }),
    ...(input.militaryDocumentStatus === undefined
      ? {}
      : { militaryDocumentStatus: input.militaryDocumentStatus }),
    ...(input.dependents === undefined
      ? {}
      : { dependents: input.dependents as unknown as Prisma.InputJsonValue }),
    ...(input.departments === undefined
      ? {}
      : { departments: [...input.departments] }),
    ...(input.permissionCodes === undefined
      ? {}
      : { permissionCodes: [...input.permissionCodes] }),
    version: { increment: 1 },
  };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function userMutationSnapshot(record: UserRecord) {
  const props = record.user.props;
  return {
    id: props.id,
    routingCompanyId: props.routingCompanyId,
    name: props.name,
    email: props.email,
    cpfNormalized: props.cpfNormalized,
    isAdministrator: props.isAdministrator,
    documentAccessMode: props.documentAccessMode,
    clientCategory: props.clientCategory,
    jobTitle: props.jobTitle,
    maritalStatus: props.maritalStatus,
    militaryDocumentStatus: props.militaryDocumentStatus,
    dependents: props.dependents,
    departments: props.departments,
    permissionCodes: props.permissionCodes,
    status: props.status,
    isActive: props.isActive,
    version: props.version,
    updatedAt: props.updatedAt.toISOString(),
  };
}

function userChangedFields(before: UserRecord, after: UserRecord): string[] {
  const beforeSnapshot = userMutationSnapshot(before);
  const afterSnapshot = userMutationSnapshot(after);
  const trackedFields = [
    ['routingCompanyId', 'routingCompanyId'],
    ['name', 'name'],
    ['email', 'email'],
    ['cpf', 'cpfNormalized'],
    ['isAdministrator', 'isAdministrator'],
    ['documentAccessMode', 'documentAccessMode'],
    ['clientCategory', 'clientCategory'],
    ['jobTitle', 'jobTitle'],
    ['maritalStatus', 'maritalStatus'],
    ['militaryDocumentStatus', 'militaryDocumentStatus'],
    ['dependents', 'dependents'],
    ['departments', 'departments'],
    ['permissionCodes', 'permissionCodes'],
  ] as const;

  return trackedFields
    .filter(
      ([, snapshotField]) =>
        JSON.stringify(beforeSnapshot[snapshotField]) !==
        JSON.stringify(afterSnapshot[snapshotField]),
    )
    .map(([field]) => field);
}

function isSerializationConflict(error: unknown): boolean {
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
    ('cause' in error && isSerializationConflict(error.cause)) ||
    ('meta' in error && isSerializationConflict(error.meta)) ||
    ('driverAdapterError' in error &&
      isSerializationConflict(error.driverAdapterError))
  );
}

@Injectable()
export class PrismaUsersRepository extends UsersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isSerializationConflict(error) || attempt >= 4) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(5 * 2 ** attempt, 40)),
        );
      }
    }
  }

  private mutationUserIds(
    userId: string,
    input: UpdateUserPersistenceInput,
  ): string[] {
    return Array.from(new Set([userId, input.command.actorUserId])).sort();
  }

  private async lockMutationUsers(
    transaction: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    input: UpdateUserPersistenceInput,
  ): Promise<void> {
    const userIds = this.mutationUserIds(userId, input);
    for (const lockedUserId of userIds) {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM users
        WHERE id = CAST(${lockedUserId} AS uuid)
          AND company_id = CAST(${companyId} AS uuid)
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw conflict(
          'O usuário foi alterado por outra operação. Atualize os dados e tente novamente.',
        );
      }
    }
  }

  private async lockAdministratorInvariant(
    transaction: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`${companyId}:active-administrator-invariant`})
      )
    `;
  }

  private async assertMutationSnapshot(
    transaction: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    input: UpdateUserPersistenceInput,
  ): Promise<void> {
    const snapshot = input.mutationSnapshot;
    const userIds = this.mutationUserIds(userId, input);
    const current = await transaction.user.findMany({
      where: { companyId, id: { in: userIds } },
      select: {
        id: true,
        updatedAt: true,
        version: true,
        isAdministrator: true,
        documentAccessMode: true,
        departments: true,
        permissionCodes: true,
        isActive: true,
        status: true,
        deletedAt: true,
        company: { select: { status: true } },
      },
    });
    const updatedAtByUserId = new Map(
      current.map((user) => [user.id, user.updatedAt.getTime()]),
    );
    const actor = current.find((user) => user.id === input.command.actorUserId);
    if (
      snapshot.actorUserId !== input.command.actorUserId ||
      updatedAtByUserId.get(userId) !== snapshot.targetUpdatedAt.getTime() ||
      !actor ||
      actor.deletedAt !== null ||
      !actor.isActive ||
      actor.status !== PrismaUserAccountStatus.ACTIVE ||
      actor.company.status !== 'ACTIVE' ||
      actor.updatedAt.getTime() !== snapshot.actorUpdatedAt.getTime() ||
      actor.version !== snapshot.actorVersion ||
      userMutationAuthorizationFingerprint({
        ...actor,
        companyIsActive: actor.company.status === 'ACTIVE',
      }) !== snapshot.actorAuthorizationFingerprint
    ) {
      throw conflict(
        'O usuário ou o acesso do responsável foi alterado. Atualize os dados e tente novamente.',
      );
    }
  }

  private async assertActiveMutationActor(
    transaction: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: {
        id_companyId: { id: actorUserId, companyId },
      },
      select: {
        isActive: true,
        status: true,
        deletedAt: true,
        company: { select: { status: true } },
      },
    });
    if (
      !actor ||
      actor.deletedAt !== null ||
      !actor.isActive ||
      actor.status !== PrismaUserAccountStatus.ACTIVE ||
      actor.company.status !== 'ACTIVE'
    ) {
      throw conflict(
        'O acesso do responsável foi revogado. Atualize os dados e tente novamente.',
      );
    }
  }

  private async reactivateExpiredSuspensions(
    companyId?: string,
    userId?: string,
  ): Promise<void> {
    await this.prisma.user.updateMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(userId ? { id: userId } : {}),
        deletedAt: null,
        status: PrismaUserAccountStatus.SUSPENDED,
        suspendedUntil: { lte: new Date() },
      },
      data: {
        status: PrismaUserAccountStatus.ACTIVE,
        isActive: true,
        suspendedUntil: null,
        suspensionReason: null,
        tokenVersion: { increment: 1 },
      },
    });
  }

  async loginIdentifierExists(input: {
    usernameNormalized?: string;
    emailNormalized?: string;
    cpfNormalized?: string | null;
    exceptUserId?: string;
  }): Promise<'username' | 'email' | 'cpf' | null> {
    const alternatives: Prisma.UserWhereInput[] = [];

    if (input.usernameNormalized) {
      alternatives.push({ usernameNormalized: input.usernameNormalized });
    }
    if (input.emailNormalized) {
      alternatives.push({ emailNormalized: input.emailNormalized });
    }
    if (input.cpfNormalized) {
      alternatives.push({ cpfNormalized: input.cpfNormalized });
    }
    if (alternatives.length === 0) {
      return null;
    }

    const match = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: alternatives,
        ...(input.exceptUserId ? { NOT: { id: input.exceptUserId } } : {}),
      },
      select: {
        usernameNormalized: true,
        emailNormalized: true,
        cpfNormalized: true,
      },
    });

    if (!match) {
      return null;
    }
    if (input.usernameNormalized === match.usernameNormalized) {
      return 'username';
    }
    if (input.emailNormalized === match.emailNormalized) {
      return 'email';
    }
    return 'cpf';
  }

  async findByLoginIdentifier(identifier: string): Promise<UserRecord | null> {
    let row = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { usernameNormalized: identifier },
          { emailNormalized: identifier },
        ],
      },
      select: userRecordSelect,
    });
    if (
      row?.status === PrismaUserAccountStatus.SUSPENDED &&
      row.suspendedUntil &&
      row.suspendedUntil <= new Date()
    ) {
      await this.reactivateExpiredSuspensions(row.companyId, row.id);
      row = await this.prisma.user.findFirst({
        where: { id: row.id, companyId: row.companyId, deletedAt: null },
        select: userRecordSelect,
      });
    }

    return row ? mapUserRecord(row) : null;
  }

  async findById(
    companyId: string,
    userId: string,
  ): Promise<UserRecord | null> {
    await this.reactivateExpiredSuspensions(companyId, userId);
    const row = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: userRecordSelect,
    });

    return row ? mapUserRecord(row) : null;
  }

  async findProfileById(
    companyId: string,
    userId: string,
  ): Promise<UserProfileRecord | null> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: userProfileSelect,
    });

    return row ? mapUserProfile(row) : null;
  }

  async create(user: User): Promise<UserRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            ...user.props,
            departments: [...user.props.departments],
            permissionCodes: [...user.props.permissionCodes],
            status: PrismaUserAccountStatus.ACTIVE,
            documentAccessMode:
              user.props.documentAccessMode === 'document-portal'
                ? PrismaDocumentAccessMode.DOCUMENT_PORTAL
                : user.props.documentAccessMode === 'client'
                  ? PrismaDocumentAccessMode.CLIENT
                  : PrismaDocumentAccessMode.STANDARD,
            clientCategory:
              user.props.clientCategory === null
                ? null
                : user.props.clientCategory === 'legal-entity'
                  ? PrismaUserClientCategory.LEGAL_ENTITY
                  : PrismaUserClientCategory.INDIVIDUAL,
            dependents: user.props
              .dependents as unknown as Prisma.InputJsonValue,
            suspendedUntil: null,
            suspensionReason: null,
          },
        });

        const row = await transaction.user.findUniqueOrThrow({
          where: { id_companyId: { id: user.id, companyId: user.companyId } },
          select: userRecordSelect,
        });

        return mapUserRecord(row);
      });
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async list(companyId: string, query: UserListQuery): Promise<UserListResult> {
    await this.reactivateExpiredSuspensions(companyId);
    const search = query.search?.trim();
    const accessFilters: Prisma.UserWhereInput[] = [];
    if (query.department) {
      accessFilters.push({ departments: { has: query.department } });
    }
    if (query.permission && !isImplicitPermissionCode(query.permission)) {
      accessFilters.push({
        OR: [
          { isAdministrator: true },
          {
            AND: [
              {
                documentAccessMode: {
                  not: PrismaDocumentAccessMode.DOCUMENT_PORTAL,
                },
              },
              {
                OR: [
                  ...(isTenantBusinessPermission(query.permission)
                    ? [
                        {
                          AND: [
                            { departments: { has: 'directorate' } },
                            {
                              permissionCodes: {
                                has: TENANT_WIDE_PERMISSION,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  {
                    AND: [
                      { permissionCodes: { has: query.permission } },
                      {
                        departments: {
                          hasSome: departmentsAllowingPermission(
                            query.permission,
                          ),
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    const where: Prisma.UserWhereInput = {
      companyId,
      ...(query.routingCompanyId
        ? { routingCompanyId: query.routingCompanyId }
        : {}),
      deletedAt: null,
      ...(query.excludeUserId ? { id: { not: query.excludeUserId } } : {}),
      ...(query.excludePrivilegedUsers
        ? {
            NOT: {
              OR: [
                { isAdministrator: true },
                {
                  AND: [
                    {
                      documentAccessMode: {
                        not: PrismaDocumentAccessMode.DOCUMENT_PORTAL,
                      },
                    },
                    { departments: { has: 'directorate' } },
                    { permissionCodes: { has: TENANT_WIDE_PERMISSION } },
                  ],
                },
              ],
            },
          }
        : query.excludeAdministrators
          ? { isAdministrator: false }
          : {}),
      ...(accessFilters.length > 0 ? { AND: accessFilters } : {}),
      ...(query.status
        ? {
            status:
              query.status === 'active'
                ? PrismaUserAccountStatus.ACTIVE
                : query.status === 'inactive'
                  ? PrismaUserAccountStatus.INACTIVE
                  : PrismaUserAccountStatus.SUSPENDED,
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userRecordSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: rows.map(mapUserRecord), total };
  }

  private async loadUpdateReplay(
    client: Prisma.TransactionClient,
    companyId: string,
    input: FindUserUpdateReplayInput,
  ): Promise<UpdateUserPersistenceResult | null> {
    const history = await client.userUpdateHistory.findUnique({
      where: {
        companyId_commandId: {
          companyId,
          commandId: input.commandId,
        },
      },
      select: {
        userId: true,
        actorUserId: true,
        commandFingerprint: true,
      },
    });
    if (!history) return null;
    if (
      history.userId !== input.userId ||
      (history.actorUserId ?? undefined) !== input.actorUserId ||
      history.commandFingerprint !== input.requestFingerprint
    ) {
      throw conflict('O commandId já foi utilizado com outros dados.');
    }
    const row = await client.user.findUnique({
      where: { id_companyId: { id: input.userId, companyId } },
      select: userRecordSelect,
    });
    if (!row) {
      throw conflict('O resultado idempotente não está mais disponível.');
    }
    return { record: mapUserRecord(row), idempotent: true };
  }

  async findUpdateReplay(
    companyId: string,
    input: FindUserUpdateReplayInput,
  ): Promise<UpdateUserPersistenceResult | null> {
    return this.retrySerializable(() =>
      this.prisma.$transaction(
        async (transaction) => {
          const locked = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM users
            WHERE id = CAST(${input.actorUserId} AS uuid)
              AND company_id = CAST(${companyId} AS uuid)
            FOR UPDATE
          `;
          if (locked.length !== 1) {
            throw conflict(
              'O acesso do responsável foi revogado. Atualize os dados e tente novamente.',
            );
          }
          await this.assertActiveMutationActor(
            transaction,
            companyId,
            input.actorUserId,
          );
          return this.loadUpdateReplay(transaction, companyId, input);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  private async executeUpdateCommand(
    companyId: string,
    userId: string,
    input: UpdateUserPersistenceInput,
    enforceAdministratorInvariant: boolean,
  ): Promise<UpdateUserPersistenceResult | null> {
    const replayInput: FindUserUpdateReplayInput = {
      userId,
      actorUserId: input.command.actorUserId,
      commandId: input.command.commandId,
      requestFingerprint: input.command.requestFingerprint,
    };
    try {
      return await this.retrySerializable(() =>
        this.prisma.$transaction(
          async (transaction) => {
            if (enforceAdministratorInvariant) {
              await this.lockAdministratorInvariant(transaction, companyId);
            }
            await this.lockMutationUsers(transaction, companyId, userId, input);
            await this.assertActiveMutationActor(
              transaction,
              companyId,
              input.command.actorUserId,
            );
            const replayed = await this.loadUpdateReplay(
              transaction,
              companyId,
              replayInput,
            );
            if (replayed) return replayed;

            await this.assertMutationSnapshot(
              transaction,
              companyId,
              userId,
              input,
            );
            const beforeRow = await transaction.user.findUnique({
              where: { id_companyId: { id: userId, companyId } },
              select: userRecordSelect,
            });
            if (!beforeRow) {
              throw conflict(
                'O usuário foi alterado por outra operação. Atualize os dados e tente novamente.',
              );
            }
            if (beforeRow.version !== input.command.expectedVersion) {
              throw conflict(
                `O usuário foi alterado por outro comando. Versão atual: ${beforeRow.version}.`,
              );
            }

            if (enforceAdministratorInvariant) {
              const activeAdministrators = await transaction.user.count({
                where: {
                  companyId,
                  isAdministrator: true,
                  isActive: true,
                  status: PrismaUserAccountStatus.ACTIVE,
                },
              });
              if (activeAdministrators <= 1) return null;
            }

            const changed = await transaction.user.updateMany({
              where: {
                id: userId,
                companyId,
                deletedAt: null,
                version: input.command.expectedVersion,
                ...(enforceAdministratorInvariant
                  ? {
                      isAdministrator: true,
                      isActive: true,
                      status: PrismaUserAccountStatus.ACTIVE,
                    }
                  : {}),
              },
              data: userUpdateData(input),
            });
            if (changed.count !== 1) {
              throw conflict(
                'O usuário foi alterado por outro comando. Recarregue e tente novamente.',
              );
            }

            const row = await transaction.user.findUniqueOrThrow({
              where: { id_companyId: { id: userId, companyId } },
              select: userRecordSelect,
            });
            const before = mapUserRecord(beforeRow);
            const record = mapUserRecord(row);
            const changedFields = userChangedFields(before, record);
            const occurredAt = new Date();
            await transaction.userUpdateHistory.create({
              data: {
                companyId,
                userId,
                actorUserId: input.command.actorUserId,
                commandId: input.command.commandId,
                commandFingerprint: input.command.requestFingerprint,
                action: 'USER_UPDATED',
                expectedVersion: input.command.expectedVersion,
                resultingVersion: record.user.props.version,
                changedFields,
                beforeSnapshot: json(userMutationSnapshot(before)),
                resultSnapshot: json(userMutationSnapshot(record)),
                occurredAt,
              },
            });
            await transaction.tenantAuditLog.create({
              data: {
                companyId,
                actorUserId: input.command.actorUserId,
                action: 'USER_UPDATED',
                targetType: 'user',
                targetId: userId,
                metadata: json({
                  commandId: input.command.commandId,
                  expectedVersion: input.command.expectedVersion,
                  resultingVersion: record.user.props.version,
                  changedFields,
                  requestedFields: input.command.changedFields,
                }),
              },
            });
            return { record, idempotent: false };
          },
          { isolationLevel: 'Serializable' },
        ),
      );
    } catch (error) {
      if (isUniqueConflict(error)) {
        const replayed = await this.findUpdateReplay(companyId, replayInput);
        if (replayed) return replayed;
      }
      rethrowKnownPrismaConflict(error);
    }
  }

  async update(
    companyId: string,
    userId: string,
    input: UpdateUserPersistenceInput,
  ): Promise<UpdateUserPersistenceResult> {
    const result = await this.executeUpdateCommand(
      companyId,
      userId,
      input,
      false,
    );
    if (!result) {
      throw conflict('Não foi possível atualizar o usuário.');
    }
    return result;
  }

  updateWithAdministratorInvariant(
    companyId: string,
    userId: string,
    input: UpdateUserPersistenceInput,
  ): Promise<UpdateUserPersistenceResult | null> {
    return this.executeUpdateCommand(companyId, userId, input, true);
  }

  async updateStatus(
    companyId: string,
    userId: string,
    input: UpdateUserStatusPersistenceInput,
  ): Promise<UserRecord> {
    const status =
      input.status === 'active'
        ? PrismaUserAccountStatus.ACTIVE
        : input.status === 'inactive'
          ? PrismaUserAccountStatus.INACTIVE
          : PrismaUserAccountStatus.SUSPENDED;

    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.user.updateMany({
        where: {
          id: userId,
          companyId,
          ...(input.status === 'active'
            ? {}
            : {
                NOT: {
                  isAdministrator: true,
                  isActive: true,
                  status: PrismaUserAccountStatus.ACTIVE,
                },
              }),
        },
        data: {
          status,
          isActive: input.status === 'active',
          suspendedUntil: input.suspendedUntil,
          suspensionReason: input.suspensionReason,
          tokenVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw conflict(
          'O estado administrativo do usuário mudou. Atualize os dados e tente novamente.',
        );
      }
      await transaction.refreshToken.updateMany({
        where: { companyId, userId, revokedAt: null },
        data: { revokedAt: input.changedAt },
      });
      const row = await transaction.user.findUniqueOrThrow({
        where: { id_companyId: { id: userId, companyId } },
        select: userRecordSelect,
      });
      return mapUserRecord(row);
    });
  }

  async updateStatusWithAdministratorInvariant(
    companyId: string,
    userId: string,
    input: UpdateUserStatusPersistenceInput,
  ): Promise<UserRecord | null> {
    const status =
      input.status === 'active'
        ? PrismaUserAccountStatus.ACTIVE
        : input.status === 'inactive'
          ? PrismaUserAccountStatus.INACTIVE
          : PrismaUserAccountStatus.SUSPENDED;

    return this.retrySerializable(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockAdministratorInvariant(transaction, companyId);
          const activeAdministrators = await transaction.user.count({
            where: {
              companyId,
              isAdministrator: true,
              isActive: true,
              status: PrismaUserAccountStatus.ACTIVE,
            },
          });
          if (activeAdministrators <= 1) return null;

          const changed = await transaction.user.updateMany({
            where: {
              id: userId,
              companyId,
              isAdministrator: true,
              isActive: true,
              status: PrismaUserAccountStatus.ACTIVE,
            },
            data: {
              status,
              isActive: input.status === 'active',
              suspendedUntil: input.suspendedUntil,
              suspensionReason: input.suspensionReason,
              tokenVersion: { increment: 1 },
            },
          });
          if (changed.count !== 1) return null;

          await transaction.refreshToken.updateMany({
            where: { companyId, userId, revokedAt: null },
            data: { revokedAt: input.changedAt },
          });
          const row = await transaction.user.findUniqueOrThrow({
            where: { id_companyId: { id: userId, companyId } },
            select: userRecordSelect,
          });
          return mapUserRecord(row);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  async softDelete(
    companyId: string,
    userId: string,
    deletedAt: Date,
  ): Promise<boolean> {
    return this.retrySerializable(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockAdministratorInvariant(transaction, companyId);
          const target = await transaction.user.findFirst({
            where: { id: userId, companyId, deletedAt: null },
            select: { isAdministrator: true },
          });
          if (!target) return false;

          if (target.isAdministrator) {
            const activeAdministrators = await transaction.user.count({
              where: {
                companyId,
                deletedAt: null,
                isAdministrator: true,
                isActive: true,
                status: PrismaUserAccountStatus.ACTIVE,
              },
            });
            if (activeAdministrators <= 1) return false;
          }

          const anonymizedIdentifier = `excluido-${userId.slice(0, 24)}`;
          const anonymizedEmail = `excluido+${userId}@invalid.local`;
          const changed = await transaction.user.updateMany({
            where: { id: userId, companyId, deletedAt: null },
            data: {
              name: 'Usuário excluído',
              username: anonymizedIdentifier,
              usernameNormalized: anonymizedIdentifier,
              email: anonymizedEmail,
              emailNormalized: anonymizedEmail,
              cpfNormalized: null,
              profilePicture: null,
              profilePictureMime: null,
              isAdministrator: false,
              departments: [],
              permissionCodes: [],
              status: PrismaUserAccountStatus.INACTIVE,
              isActive: false,
              suspendedUntil: null,
              suspensionReason: null,
              deletedAt,
              tokenVersion: { increment: 1 },
            },
          });
          if (changed.count !== 1) return false;

          await Promise.all([
            transaction.refreshToken.updateMany({
              where: { companyId, userId, revokedAt: null },
              data: { revokedAt: deletedAt },
            }),
            transaction.passwordChangeChallenge.updateMany({
              where: { companyId, userId, consumedAt: null },
              data: { consumedAt: deletedAt },
            }),
          ]);
          return true;
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  async markLastLogin(
    companyId: string,
    userId: string,
    date: Date,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id_companyId: { id: userId, companyId } },
      data: { lastLoginAt: date },
    });
  }

  countActiveAdministrators(companyId: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        status: PrismaUserAccountStatus.ACTIVE,
        isAdministrator: true,
      },
    });
  }

  async listPasswordHashes(
    companyId: string,
    userId: string,
    limit: number,
  ): Promise<string[]> {
    const [current, history] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id_companyId: { id: userId, companyId } },
        select: { passwordHash: true },
      }),
      this.prisma.userPasswordHistory.findMany({
        where: { companyId, userId },
        orderBy: { createdAt: 'desc' },
        take: Math.max(0, limit - 1),
        select: { passwordHash: true },
      }),
    ]);

    return current
      ? [current.passwordHash, ...history.map((entry) => entry.passwordHash)]
      : [];
  }

  async changePassword(
    companyId: string,
    userId: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUniqueOrThrow({
        where: { id_companyId: { id: userId, companyId } },
        select: { passwordHash: true },
      });

      await transaction.userPasswordHistory.create({
        data: {
          companyId,
          userId,
          passwordHash: current.passwordHash,
          createdAt: changedAt,
        },
      });
      await transaction.user.update({
        where: { id_companyId: { id: userId, companyId } },
        data: {
          passwordHash,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      });
      await transaction.refreshToken.updateMany({
        where: { companyId, userId, revokedAt: null },
        data: { revokedAt: changedAt },
      });
    });
  }

  async requirePasswordChange(
    companyId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id_companyId: { id: userId, companyId } },
        data: {
          mustChangePassword: true,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { companyId, userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async updateProfilePicture(
    companyId: string,
    userId: string,
    picture: Uint8Array<ArrayBuffer> | null,
    mimeType: string | null,
  ): Promise<UserProfileRecord> {
    const row = await this.prisma.user.update({
      where: { id_companyId: { id: userId, companyId } },
      data: {
        profilePicture: picture,
        profilePictureMime: mimeType,
      },
      select: userProfileSelect,
    });
    return mapUserProfile(row);
  }
}
