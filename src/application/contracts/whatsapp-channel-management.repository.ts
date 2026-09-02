import type {
  ChannelConnectionStatus,
  ChannelOrganizationalStatus,
  ChannelRoutingMode,
  WhatsAppChannelSnapshot,
} from '../../domain/whatsapp/whatsapp-channel';

export interface ManagedWhatsAppChannel extends WhatsAppChannelSnapshot {
  readonly id: string;
  readonly companyId: string;
  readonly providerId: string;
  readonly evolutionInstanceId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePendingWhatsAppChannelInput {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly commandId: string;
  readonly displayName: string;
  readonly phoneNumber: string;
  readonly evolutionInstanceName: string;
  readonly departmentId: string | null;
  readonly routingMode: ChannelRoutingMode;
  readonly allowedAutomaticTargetDepartmentIds: readonly string[];
}

export interface CreatePendingWhatsAppChannelResult {
  readonly channel: ManagedWhatsAppChannel;
  readonly replayed: boolean;
}

export interface WhatsAppChannelMutationPatch {
  readonly displayName?: string;
  readonly departmentId?: string | null;
  readonly routingMode?: ChannelRoutingMode;
  readonly organizationalStatus?: ChannelOrganizationalStatus;
  readonly connectionStatus?: ChannelConnectionStatus;
  readonly allowedAutomaticTargetDepartmentIds?: readonly string[];
  readonly evolutionInstanceId?: string | null;
  readonly cancelledAt?: Date | null;
  readonly disabledAt?: Date | null;
}

export interface MutateWhatsAppChannelInput {
  readonly companyId: string;
  readonly channelId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly eventName:
    | 'configuration-updated'
    | 'qr-requested'
    | 'connection-synchronized'
    | 'disconnected'
    | 'reconnect-requested'
    | 'setup-cancelled'
    | 'operational-channel-disabled'
    | 'provider-operation-failed';
  readonly actorUserId: string;
  readonly patch: WhatsAppChannelMutationPatch;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MutateWhatsAppChannelResult {
  readonly channel: ManagedWhatsAppChannel;
  readonly replayed: boolean;
}

export abstract class WhatsAppChannelManagementRepository {
  abstract getTenantTechnicalName(companyId: string): Promise<string>;

  abstract list(companyId: string): Promise<readonly ManagedWhatsAppChannel[]>;

  abstract get(
    companyId: string,
    channelId: string,
  ): Promise<ManagedWhatsAppChannel | null>;

  abstract createPending(
    input: CreatePendingWhatsAppChannelInput,
  ): Promise<CreatePendingWhatsAppChannelResult>;

  abstract mutate(
    input: MutateWhatsAppChannelInput,
  ): Promise<MutateWhatsAppChannelResult>;
}
