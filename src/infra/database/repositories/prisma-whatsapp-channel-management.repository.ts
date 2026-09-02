import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  WhatsAppChannelManagementRepository,
  type CreatePendingWhatsAppChannelInput,
  type CreatePendingWhatsAppChannelResult,
  type ManagedWhatsAppChannel,
  type MutateWhatsAppChannelInput,
  type MutateWhatsAppChannelResult,
} from '../../../application/contracts/whatsapp-channel-management.repository';
import {
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import type {
  ChannelConnectionStatus,
  ChannelOrganizationalStatus,
  ChannelRoutingMode,
} from '../../../domain/whatsapp/whatsapp-channel';
import {
  MutationActorType,
  WhatsAppChannelConnectionStatus,
  WhatsAppChannelOrganizationalStatus,
  WhatsAppChannelRoutingMode,
  WhatsAppProviderType,
  type Prisma,
} from '../prisma/generated/client';
import { rethrowKnownPrismaConflict } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

const channelInclude = {
  allowedAutomaticTargets: { select: { departmentId: true } },
} as const satisfies Prisma.WhatsAppChannelInclude;

type ChannelRow = Prisma.WhatsAppChannelGetPayload<{
  include: typeof channelInclude;
}>;

const routingToPrisma: Readonly<
  Record<ChannelRoutingMode, WhatsAppChannelRoutingMode>
> = {
  'department-owned': WhatsAppChannelRoutingMode.DEPARTMENT_OWNED,
  'general-triage': WhatsAppChannelRoutingMode.GENERAL_TRIAGE,
};

const routingFromPrisma: Readonly<
  Record<WhatsAppChannelRoutingMode, ChannelRoutingMode>
> = {
  DEPARTMENT_OWNED: 'department-owned',
  GENERAL_TRIAGE: 'general-triage',
};

const organizationToPrisma: Readonly<
  Record<ChannelOrganizationalStatus, WhatsAppChannelOrganizationalStatus>
> = {
  pending: WhatsAppChannelOrganizationalStatus.PENDING,
  active: WhatsAppChannelOrganizationalStatus.ACTIVE,
  cancelled: WhatsAppChannelOrganizationalStatus.CANCELLED,
  disabled: WhatsAppChannelOrganizationalStatus.DISABLED,
};

const organizationFromPrisma: Readonly<
  Record<WhatsAppChannelOrganizationalStatus, ChannelOrganizationalStatus>
> = {
  PENDING: 'pending',
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  DISABLED: 'disabled',
};

const connectionToPrisma: Readonly<
  Record<ChannelConnectionStatus, WhatsAppChannelConnectionStatus>
> = {
  unknown: WhatsAppChannelConnectionStatus.UNKNOWN,
  connected: WhatsAppChannelConnectionStatus.CONNECTED,
  disconnected: WhatsAppChannelConnectionStatus.DISCONNECTED,
  connecting: WhatsAppChannelConnectionStatus.CONNECTING,
  error: WhatsAppChannelConnectionStatus.ERROR,
};

const connectionFromPrisma: Readonly<
  Record<WhatsAppChannelConnectionStatus, ChannelConnectionStatus>
> = {
  UNKNOWN: 'unknown',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  ERROR: 'error',
};

function toManagedChannel(row: ChannelRow): ManagedWhatsAppChannel {
  return {
    id: row.id,
    companyId: row.companyId,
    providerId: row.providerId,
    displayName: row.name,
    phoneNumber: row.phoneNumber,
    evolutionInstanceName: row.instanceName,
    evolutionInstanceId: row.evolutionInstanceId,
    departmentId: row.departmentId,
    routingMode: routingFromPrisma[row.routingMode],
    organizationalStatus: organizationFromPrisma[row.organizationalStatus],
    connectionStatus: connectionFromPrisma[row.connectionStatus],
    allowedAutomaticTargetDepartmentIds: row.allowedAutomaticTargets
      .map((target) => target.departmentId)
      .sort(),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validateCommandId(value: string): string {
  const commandId = value.trim();
  if (!commandId || commandId.length > 120) {
    throw validationError('commandId deve possuir entre 1 e 120 caracteres.');
  }
  return commandId;
}

async function assertDepartments(
  transaction: Prisma.TransactionClient,
  companyId: string,
  departmentIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(departmentIds.filter(Boolean))];
  if (unique.length === 0) return;
  const count = await transaction.tenantDepartment.count({
    where: { companyId, id: { in: unique } },
  });
  if (count !== unique.length) {
    throw validationError(
      'Um ou mais departamentos do canal não pertencem ao tenant.',
    );
  }
}

@Injectable()
export class PrismaWhatsAppChannelManagementRepository extends WhatsAppChannelManagementRepository {
  private readonly webhookSecretHash: string;
  private readonly webhookConfigured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    const webhookSecret = (
      config.get<string>('EVOLUTION_WEBHOOK_SECRET') ?? ''
    ).trim();
    this.webhookConfigured = webhookSecret.length >= 32;
    this.webhookSecretHash = createHash('sha256')
      .update(webhookSecret)
      .digest('hex');
  }

  async getTenantTechnicalName(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { legalName: true, tradeName: true },
    });
    if (!company) throw notFound('Tenant');
    return company.tradeName?.trim() || company.legalName;
  }

  async list(companyId: string): Promise<readonly ManagedWhatsAppChannel[]> {
    const rows = await this.prisma.whatsAppChannel.findMany({
      where: { companyId },
      include: channelInclude,
      orderBy: [{ organizationalStatus: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toManagedChannel);
  }

  async get(
    companyId: string,
    channelId: string,
  ): Promise<ManagedWhatsAppChannel | null> {
    const row = await this.prisma.whatsAppChannel.findFirst({
      where: { id: channelId, companyId },
      include: channelInclude,
    });
    return row ? toManagedChannel(row) : null;
  }

  async createPending(
    input: CreatePendingWhatsAppChannelInput,
  ): Promise<CreatePendingWhatsAppChannelResult> {
    if (!this.webhookConfigured) {
      throw validationError(
        'Configure o segredo do webhook Evolution antes de criar um canal.',
      );
    }
    const commandId = validateCommandId(input.commandId);
    const commandFingerprint = fingerprint({
      operation: 'create-pending-channel',
      ...input,
      commandId: undefined,
    });
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const replay = await transaction.whatsAppChannelEvent.findUnique({
            where: {
              companyId_commandId: { companyId: input.companyId, commandId },
            },
          });
          if (replay) {
            if (replay.commandFingerprint !== commandFingerprint) {
              throw conflict('commandId já foi utilizado com outro conteúdo.');
            }
            const existing = await transaction.whatsAppChannel.findFirst({
              where: { id: replay.channelId, companyId: input.companyId },
              include: channelInclude,
            });
            if (!existing) throw notFound('Canal WhatsApp');
            return { channel: toManagedChannel(existing), replayed: true };
          }

          await assertDepartments(transaction, input.companyId, [
            ...(input.departmentId ? [input.departmentId] : []),
            ...input.allowedAutomaticTargetDepartmentIds,
          ]);
          const provider = await transaction.whatsAppProvider.findFirst({
            where: {
              companyId: input.companyId,
              enabled: true,
              type: WhatsAppProviderType.EVOLUTION,
            },
            orderBy: { createdAt: 'asc' },
          });
          if (!provider) {
            throw validationError(
              'Nenhum provider Evolution ativo foi configurado para o tenant.',
            );
          }
          const row = await transaction.whatsAppChannel.create({
            data: {
              companyId: input.companyId,
              providerId: provider.id,
              createdByUserId: input.actorUserId,
              name: input.displayName,
              phoneNumber: input.phoneNumber,
              instanceName: input.evolutionInstanceName,
              departmentId: input.departmentId,
              routingMode: routingToPrisma[input.routingMode],
              organizationalStatus: WhatsAppChannelOrganizationalStatus.PENDING,
              connectionStatus: WhatsAppChannelConnectionStatus.DISCONNECTED,
              webhookSecretHash: this.webhookSecretHash,
              ignoreGroups: false,
              ignoreFromMe: false,
              enabled: true,
              version: 1,
              allowedAutomaticTargets: {
                create: [
                  ...new Set(
                    input.allowedAutomaticTargetDepartmentIds.filter(Boolean),
                  ),
                ].map((departmentId) => ({
                  companyId: input.companyId,
                  departmentId,
                })),
              },
            },
            include: channelInclude,
          });
          const after = toManagedChannel(row);
          await transaction.whatsAppChannelEvent.create({
            data: {
              companyId: input.companyId,
              channelId: row.id,
              commandId,
              commandFingerprint,
              name: 'channel-created',
              expectedVersion: 0,
              resultingVersion: 1,
              actorType: MutationActorType.HUMAN_USER,
              actorUserId: input.actorUserId,
              beforeSnapshot: {},
              afterSnapshot: asPrismaJson(after),
              metadata: { provider: 'evolution' },
            },
          });
          return { channel: after, replayed: false };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }

  async mutate(
    input: MutateWhatsAppChannelInput,
  ): Promise<MutateWhatsAppChannelResult> {
    const commandId = validateCommandId(input.commandId);
    const commandFingerprint = fingerprint({
      operation: input.eventName,
      channelId: input.channelId,
      expectedVersion: input.expectedVersion,
      patch: input.patch,
      metadata: input.metadata ?? {},
    });
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const replay = await transaction.whatsAppChannelEvent.findUnique({
            where: {
              companyId_commandId: { companyId: input.companyId, commandId },
            },
          });
          if (replay) {
            if (
              replay.channelId !== input.channelId ||
              replay.commandFingerprint !== commandFingerprint
            ) {
              throw conflict('commandId já foi utilizado com outro conteúdo.');
            }
            const existing = await transaction.whatsAppChannel.findFirst({
              where: { id: input.channelId, companyId: input.companyId },
              include: channelInclude,
            });
            if (!existing) throw notFound('Canal WhatsApp');
            return { channel: toManagedChannel(existing), replayed: true };
          }

          const beforeRow = await transaction.whatsAppChannel.findFirst({
            where: { id: input.channelId, companyId: input.companyId },
            include: channelInclude,
          });
          if (!beforeRow) throw notFound('Canal WhatsApp');
          if (beforeRow.version !== input.expectedVersion) {
            throw conflict(
              'O canal foi atualizado por outra operação. Recarregue os dados.',
            );
          }
          const targetIds =
            input.patch.allowedAutomaticTargetDepartmentIds ??
            beforeRow.allowedAutomaticTargets.map(
              (target) => target.departmentId,
            );
          await assertDepartments(transaction, input.companyId, [
            ...(input.patch.departmentId
              ? [input.patch.departmentId]
              : input.patch.departmentId === undefined && beforeRow.departmentId
                ? [beforeRow.departmentId]
                : []),
            ...targetIds,
          ]);
          const data: Prisma.WhatsAppChannelUpdateManyMutationInput = {
            version: { increment: 1 },
            ...(input.patch.displayName === undefined
              ? {}
              : { name: input.patch.displayName }),
            ...(input.patch.departmentId === undefined
              ? {}
              : { departmentId: input.patch.departmentId }),
            ...(input.patch.routingMode === undefined
              ? {}
              : { routingMode: routingToPrisma[input.patch.routingMode] }),
            ...(input.patch.organizationalStatus === undefined
              ? {}
              : {
                  organizationalStatus:
                    organizationToPrisma[input.patch.organizationalStatus],
                }),
            ...(input.patch.connectionStatus === undefined
              ? {}
              : {
                  connectionStatus:
                    connectionToPrisma[input.patch.connectionStatus],
                }),
            ...(input.patch.evolutionInstanceId === undefined
              ? {}
              : { evolutionInstanceId: input.patch.evolutionInstanceId }),
            ...(input.patch.cancelledAt === undefined
              ? {}
              : { cancelledAt: input.patch.cancelledAt }),
            ...(input.patch.disabledAt === undefined
              ? {}
              : { disabledAt: input.patch.disabledAt }),
          };
          const updated = await transaction.whatsAppChannel.updateMany({
            where: {
              id: input.channelId,
              companyId: input.companyId,
              version: input.expectedVersion,
            },
            data,
          });
          if (updated.count !== 1) {
            throw conflict(
              'O canal foi atualizado por outra operação. Recarregue os dados.',
            );
          }
          if (input.patch.allowedAutomaticTargetDepartmentIds !== undefined) {
            await transaction.whatsAppChannelAutomaticTargetDepartment.deleteMany(
              {
                where: {
                  companyId: input.companyId,
                  channelId: input.channelId,
                },
              },
            );
            if (targetIds.length > 0) {
              await transaction.whatsAppChannelAutomaticTargetDepartment.createMany(
                {
                  data: [...new Set(targetIds)].map((departmentId) => ({
                    companyId: input.companyId,
                    channelId: input.channelId,
                    departmentId,
                  })),
                },
              );
            }
          }
          const afterRow = await transaction.whatsAppChannel.findFirst({
            where: { id: input.channelId, companyId: input.companyId },
            include: channelInclude,
          });
          if (!afterRow) throw notFound('Canal WhatsApp');
          const before = toManagedChannel(beforeRow);
          const after = toManagedChannel(afterRow);
          await transaction.whatsAppChannelEvent.create({
            data: {
              companyId: input.companyId,
              channelId: input.channelId,
              commandId,
              commandFingerprint,
              name: input.eventName,
              expectedVersion: input.expectedVersion,
              resultingVersion: input.expectedVersion + 1,
              actorType: MutationActorType.HUMAN_USER,
              actorUserId: input.actorUserId,
              beforeSnapshot: asPrismaJson(before),
              afterSnapshot: asPrismaJson(after),
              metadata: asPrismaJson(input.metadata ?? {}),
            },
          });
          return { channel: after, replayed: false };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      rethrowKnownPrismaConflict(error);
    }
  }
}
