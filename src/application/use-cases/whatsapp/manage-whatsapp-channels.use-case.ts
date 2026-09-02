import {
  EvolutionInstanceManagementError,
  EvolutionInstanceManagementGateway,
  type EvolutionInstanceConnectionState,
  type EvolutionQrCode,
} from '../../contracts/evolution-instance-management.gateway';
import {
  WhatsAppChannelManagementRepository,
  type ManagedWhatsAppChannel,
} from '../../contracts/whatsapp-channel-management.repository';
import { notFound, validationError } from '../../../core/errors/app-error';
import {
  createEvolutionInstanceName,
  evolveChannelStatus,
  validateChannelConfiguration,
  type ChannelConnectionStatus,
  type ChannelRoutingMode,
} from '../../../domain/whatsapp/whatsapp-channel';

export interface WhatsAppChannelOperationResult {
  readonly channel: ManagedWhatsAppChannel;
  readonly qrCode: EvolutionQrCode | null;
  readonly providerIssue: {
    readonly reason: string;
    readonly message: string;
  } | null;
  readonly infrastructureCleanupPending?: boolean;
}

type ProviderIssue = NonNullable<
  WhatsAppChannelOperationResult['providerIssue']
>;

function webhookUrl(publicApiBaseUrl: string, channelId: string): string {
  const base = publicApiBaseUrl.trim().replace(/\/+$/u, '');
  try {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw validationError(
      'A URL pública da API precisa estar configurada para criar canais.',
    );
  }
  return `${base}/webhooks/evolution/${encodeURIComponent(channelId)}`;
}

function providerIssue(error: unknown): ProviderIssue {
  if (error instanceof EvolutionInstanceManagementError) {
    return { reason: error.reason, message: error.message };
  }
  return {
    reason: 'provider-unavailable',
    message: 'A Evolution está temporariamente indisponível.',
  };
}

function connectionStatus(
  state: EvolutionInstanceConnectionState,
): ChannelConnectionStatus {
  return state;
}

function mutationCommand(commandId: string, step: string): string {
  const value = `${commandId}:${step}`;
  if (value.length > 120) {
    throw validationError('O commandId informado é muito longo.');
  }
  return value;
}

export class QueryWhatsAppChannelsUseCase {
  constructor(private readonly channels: WhatsAppChannelManagementRepository) {}

  list(companyId: string) {
    return this.channels.list(companyId);
  }

  async get(companyId: string, channelId: string) {
    const channel = await this.channels.get(companyId, channelId);
    if (!channel) throw notFound('Canal WhatsApp');
    return channel;
  }
}

export class CreateWhatsAppChannelUseCase {
  constructor(
    private readonly channels: WhatsAppChannelManagementRepository,
    private readonly evolution: EvolutionInstanceManagementGateway,
    private readonly publicApiBaseUrl: string,
  ) {}

  async execute(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly displayName: string;
    readonly phoneNumber: string;
    readonly departmentId: string | null;
    readonly routingMode: ChannelRoutingMode;
    readonly allowedAutomaticTargetDepartmentIds: readonly string[];
  }): Promise<WhatsAppChannelOperationResult> {
    const tenantName = await this.channels.getTenantTechnicalName(
      input.companyId,
    );
    const instanceName = createEvolutionInstanceName({
      tenantSlug: tenantName,
      channelSlug: input.displayName,
    });
    const configuration = validateChannelConfiguration({
      displayName: input.displayName,
      phoneNumber: input.phoneNumber,
      evolutionInstanceName: instanceName,
      departmentId: input.departmentId,
      routingMode: input.routingMode,
      organizationalStatus: 'pending',
      connectionStatus: 'disconnected',
      allowedAutomaticTargetDepartmentIds:
        input.allowedAutomaticTargetDepartmentIds,
    });
    const created = await this.channels.createPending({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      commandId: input.commandId,
      displayName: configuration.displayName,
      phoneNumber: configuration.phoneNumber,
      evolutionInstanceName: instanceName,
      departmentId: configuration.departmentId,
      routingMode: configuration.routingMode,
      allowedAutomaticTargetDepartmentIds:
        configuration.allowedAutomaticTargetDepartmentIds,
    });

    try {
      const provider = created.replayed
        ? await this.evolution.connect(instanceName)
        : await this.evolution.create({
            instanceName,
            phoneNumber: configuration.phoneNumber,
            webhookUrl: webhookUrl(this.publicApiBaseUrl, created.channel.id),
          });
      const synchronized = synchronizeProviderState(
        created.channel,
        provider.connectionState,
        false,
      );
      const result = await this.channels.mutate({
        companyId: input.companyId,
        channelId: created.channel.id,
        commandId: mutationCommand(input.commandId, 'provider-ready'),
        expectedVersion: created.channel.version,
        eventName: 'qr-requested',
        actorUserId: input.actorUserId,
        patch: {
          organizationalStatus: synchronized.organizationalStatus,
          connectionStatus: synchronized.connectionStatus,
          evolutionInstanceId: provider.instanceId,
        },
        metadata: { provider: 'evolution' },
      });
      return {
        channel: result.channel,
        qrCode: provider.qrCode,
        providerIssue: null,
      };
    } catch (error) {
      const issue = providerIssue(error);
      const failed = await this.channels.mutate({
        companyId: input.companyId,
        channelId: created.channel.id,
        commandId: mutationCommand(input.commandId, 'provider-failed'),
        expectedVersion: created.channel.version,
        eventName: 'provider-operation-failed',
        actorUserId: input.actorUserId,
        patch: { connectionStatus: 'error' },
        metadata: { reason: issue.reason },
      });
      return { channel: failed.channel, qrCode: null, providerIssue: issue };
    }
  }
}

export class ManageWhatsAppChannelUseCase {
  constructor(
    private readonly channels: WhatsAppChannelManagementRepository,
    private readonly evolution: EvolutionInstanceManagementGateway,
  ) {}

  async updateConfiguration(input: {
    readonly companyId: string;
    readonly channelId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly expectedVersion: number;
    readonly displayName: string;
    readonly departmentId: string | null;
    readonly routingMode: ChannelRoutingMode;
    readonly allowedAutomaticTargetDepartmentIds: readonly string[];
  }): Promise<ManagedWhatsAppChannel> {
    const current = await this.required(input.companyId, input.channelId);
    const next = validateChannelConfiguration({
      ...current,
      displayName: input.displayName,
      departmentId: input.departmentId,
      routingMode: input.routingMode,
      allowedAutomaticTargetDepartmentIds:
        input.allowedAutomaticTargetDepartmentIds,
    });
    const result = await this.channels.mutate({
      companyId: input.companyId,
      channelId: input.channelId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      eventName: 'configuration-updated',
      actorUserId: input.actorUserId,
      patch: {
        displayName: next.displayName,
        departmentId: next.departmentId,
        routingMode: next.routingMode,
        allowedAutomaticTargetDepartmentIds:
          next.allowedAutomaticTargetDepartmentIds,
      },
    });
    return result.channel;
  }

  requestQr(input: VersionedChannelCommand) {
    return this.connect(input, 'qr-requested', false);
  }

  reconnect(input: VersionedChannelCommand) {
    return this.connect(input, 'reconnect-requested', true);
  }

  async synchronizeConnection(
    input: VersionedChannelCommand,
  ): Promise<WhatsAppChannelOperationResult> {
    const current = await this.required(input.companyId, input.channelId);
    try {
      const providerState = await this.evolution.getConnectionState(
        current.evolutionInstanceName,
      );
      const snapshot = synchronizeProviderState(
        current,
        providerState,
        input.isAdministrator,
      );
      const result = await this.channels.mutate({
        companyId: input.companyId,
        channelId: input.channelId,
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        eventName: 'connection-synchronized',
        actorUserId: input.actorUserId,
        patch: {
          organizationalStatus: snapshot.organizationalStatus,
          connectionStatus: snapshot.connectionStatus,
        },
      });
      return { channel: result.channel, qrCode: null, providerIssue: null };
    } catch (error) {
      return this.recordProviderFailure(input, error);
    }
  }

  async disconnect(
    input: VersionedChannelCommand,
  ): Promise<WhatsAppChannelOperationResult> {
    const current = await this.required(input.companyId, input.channelId);
    try {
      await this.evolution.disconnect(current.evolutionInstanceName);
      const snapshot = evolveChannelStatus({
        current,
        action: 'disconnected',
        isAdministrator: input.isAdministrator,
      });
      const result = await this.channels.mutate({
        companyId: input.companyId,
        channelId: input.channelId,
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        eventName: 'disconnected',
        actorUserId: input.actorUserId,
        patch: { connectionStatus: snapshot.connectionStatus },
      });
      return { channel: result.channel, qrCode: null, providerIssue: null };
    } catch (error) {
      return this.recordProviderFailure(input, error);
    }
  }

  async cancelSetup(
    input: VersionedChannelCommand,
  ): Promise<WhatsAppChannelOperationResult> {
    const current = await this.required(input.companyId, input.channelId);
    const snapshot = evolveChannelStatus({
      current,
      action: 'cancel-pending',
      isAdministrator: input.isAdministrator,
    });
    const cancelled = await this.channels.mutate({
      companyId: input.companyId,
      channelId: input.channelId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      eventName: 'setup-cancelled',
      actorUserId: input.actorUserId,
      patch: {
        organizationalStatus: snapshot.organizationalStatus,
        connectionStatus: snapshot.connectionStatus,
        cancelledAt: input.now,
      },
    });
    try {
      await this.evolution.removeCancelledSetup(current.evolutionInstanceName);
      return {
        channel: cancelled.channel,
        qrCode: null,
        providerIssue: null,
        infrastructureCleanupPending: false,
      };
    } catch (error) {
      return {
        channel: cancelled.channel,
        qrCode: null,
        providerIssue: providerIssue(error),
        infrastructureCleanupPending: true,
      };
    }
  }

  async disable(
    input: VersionedChannelCommand,
  ): Promise<WhatsAppChannelOperationResult> {
    const current = await this.required(input.companyId, input.channelId);
    const snapshot = evolveChannelStatus({
      current,
      action: 'disable-operational',
      isAdministrator: input.isAdministrator,
    });
    const disabled = await this.channels.mutate({
      companyId: input.companyId,
      channelId: input.channelId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      eventName: 'operational-channel-disabled',
      actorUserId: input.actorUserId,
      patch: {
        organizationalStatus: snapshot.organizationalStatus,
        disabledAt: input.now,
      },
    });
    try {
      await this.evolution.disconnect(current.evolutionInstanceName);
      return { channel: disabled.channel, qrCode: null, providerIssue: null };
    } catch (error) {
      return {
        channel: disabled.channel,
        qrCode: null,
        providerIssue: providerIssue(error),
      };
    }
  }

  private async connect(
    input: VersionedChannelCommand,
    eventName: 'qr-requested' | 'reconnect-requested',
    restart: boolean,
  ): Promise<WhatsAppChannelOperationResult> {
    const current = await this.required(input.companyId, input.channelId);
    const connecting = evolveChannelStatus({
      current,
      action: 'request-qr',
      isAdministrator: input.isAdministrator,
    });
    const started = await this.channels.mutate({
      companyId: input.companyId,
      channelId: input.channelId,
      commandId: mutationCommand(input.commandId, 'started'),
      expectedVersion: input.expectedVersion,
      eventName,
      actorUserId: input.actorUserId,
      patch: { connectionStatus: connecting.connectionStatus },
    });
    try {
      if (restart) {
        await this.evolution.restart(current.evolutionInstanceName);
      }
      const provider = await this.evolution.connect(
        current.evolutionInstanceName,
      );
      const providerSnapshot = synchronizeProviderState(
        started.channel,
        provider.connectionState,
        input.isAdministrator,
      );
      const synchronized = await this.channels.mutate({
        companyId: input.companyId,
        channelId: input.channelId,
        commandId: mutationCommand(input.commandId, 'provider-ready'),
        expectedVersion: started.channel.version,
        eventName: 'connection-synchronized',
        actorUserId: input.actorUserId,
        patch: {
          organizationalStatus: providerSnapshot.organizationalStatus,
          connectionStatus: providerSnapshot.connectionStatus,
          evolutionInstanceId: provider.instanceId,
        },
      });
      return {
        channel: synchronized.channel,
        qrCode: provider.qrCode,
        providerIssue: null,
      };
    } catch (error) {
      return this.recordProviderFailure(
        { ...input, expectedVersion: started.channel.version },
        error,
      );
    }
  }

  private async recordProviderFailure(
    input: VersionedChannelCommand,
    error: unknown,
  ): Promise<WhatsAppChannelOperationResult> {
    const issue = providerIssue(error);
    const failed = await this.channels.mutate({
      companyId: input.companyId,
      channelId: input.channelId,
      commandId: mutationCommand(input.commandId, 'provider-failed'),
      expectedVersion: input.expectedVersion,
      eventName: 'provider-operation-failed',
      actorUserId: input.actorUserId,
      patch: { connectionStatus: 'error' },
      metadata: { reason: issue.reason },
    });
    return { channel: failed.channel, qrCode: null, providerIssue: issue };
  }

  private async required(companyId: string, channelId: string) {
    const channel = await this.channels.get(companyId, channelId);
    if (!channel) throw notFound('Canal WhatsApp');
    return channel;
  }
}

function synchronizeProviderState(
  current: ManagedWhatsAppChannel,
  providerState: EvolutionInstanceConnectionState,
  isAdministrator: boolean,
): ManagedWhatsAppChannel {
  if (providerState === 'connected') {
    return {
      ...current,
      ...evolveChannelStatus({
        current,
        action: 'connected',
        isAdministrator,
      }),
    };
  }
  if (providerState === 'disconnected') {
    return {
      ...current,
      ...evolveChannelStatus({
        current,
        action: 'disconnected',
        isAdministrator,
      }),
    };
  }
  return { ...current, connectionStatus: connectionStatus(providerState) };
}

interface VersionedChannelCommand {
  readonly companyId: string;
  readonly channelId: string;
  readonly actorUserId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly isAdministrator: boolean;
  readonly now: Date;
}
