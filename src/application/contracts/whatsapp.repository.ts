import type { Department } from '../../domain/access/access.constants';
import type { QuoteRequestStatus } from '../../domain/commercial/quote-status';
import type {
  ConversationState,
  DeliveryStatus,
  MessageDirection,
  MessageKind,
  TransitionName,
} from '../../domain/whatsapp/whatsapp.constants';

export interface WebhookChannelConfiguration {
  id: string;
  companyId: string;
  instanceName: string;
  webhookSecretHash: string;
  ignoreGroups: boolean;
  ignoreFromMe: boolean;
  enabled: boolean;
}

export interface PersistWebhookMessageInput {
  channel: WebhookChannelConfiguration;
  automationEnabled: boolean;
  externalEventId: string;
  providerMessageId: string;
  correlationId: string;
  payloadHash: string;
  phoneNormalized: string;
  direction: MessageDirection;
  displayName?: string;
  profilePictureUrl?: string;
  occurredAt: Date;
  kind: MessageKind;
  text?: string;
  media?: Readonly<Record<string, unknown>>;
}

export interface PersistWebhookMessageResult {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly messageId: string | null;
  readonly conversationId: string | null;
  readonly automationAllowed?: boolean;
  readonly canGenerateReply?: boolean;
  readonly canSendReply?: boolean;
  readonly isFirstContact?: boolean;
  readonly reopenedAfterClosure?: boolean;
  readonly version?: number;
}

export interface TransitionCommand {
  companyId: string;
  conversationId: string;
  commandId: string;
  expectedVersion: number;
  name: TransitionName;
  actorType: 'user' | 'webhook' | 'system';
  actorUserId?: string;
  targetDepartment?: Department;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateOutboundInput {
  companyId: string;
  conversationId: string;
  commandId: string;
  expectedVersion: number;
  automatic: true;
  purpose?:
    | 'main-menu'
    | 'commercial-follow-up-menu'
    | 'department-notification'
    | 'unsupported-message-kind';
  inReplyToMessageId?: string;
  recipientPhone?: string;
  kind: MessageKind;
  text?: string;
  media?: Readonly<Record<string, unknown>>;
}

export interface CreateHumanOutboundInput {
  companyId: string;
  conversationId: string;
  commandId: string;
  idempotencyKey: string;
  expectedVersion: number;
  actorUserId: string;
  text?: string;
  attachment?: {
    messageId: string;
    kind: Extract<
      MessageKind,
      'image' | 'document' | 'audio' | 'video' | 'contact' | 'sticker'
    >;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
  };
}

export interface ClaimEvolutionDispatchInput {
  companyId: string;
  messageId: string;
  attemptId: string;
  commandId: string;
  ownerId: string;
  reconciliation?: 'confirmed-not-sent';
}

export interface EvolutionResultInput {
  companyId: string;
  messageId: string;
  commandId: string;
  attemptId: string;
  status: Exclude<DeliveryStatus, 'received' | 'pending'>;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface MarkEvolutionDispatchUnknownInput {
  companyId: string;
  messageId: string;
  attemptId: string;
  ownerId: string;
  errorCode: string;
  errorMessage: string;
}

export interface CompleteOutboxExecutionInput {
  companyId: string;
  eventId: string;
  commandId: string;
  executionId: string;
  automationProvider?: 'api';
  aggregateType: string;
  aggregateId: string;
  outcome: 'succeeded' | 'retryable-failure' | 'terminal-failure';
  consumedSourceEventIds?: string[];
  errorCode?: string;
  errorMessage?: string;
}

export type AutomationOutboxReconciliationResolution =
  | 'confirmed-sent'
  | 'confirmed-not-sent'
  | 'confirmed-processed'
  | 'confirmed-not-processed';

export interface ReconcileAutomationOutboxInput {
  companyId: string;
  eventId: string;
  commandId: string;
  resolution: AutomationOutboxReconciliationResolution;
  evidence: string;
  providerMessageId?: string;
  serviceIdentityId: string;
  serviceIdentityName: string;
}

export interface ConversationListQuery {
  page: number;
  pageSize: number;
  department?: Department;
  departments?: readonly Department[];
  state?: ConversationState;
  control?: 'bot' | 'human' | 'paused' | 'closed';
  requestStatus?: QuoteRequestStatus;
  search?: string;
  archive?: 'active' | 'archived' | 'all';
}

export interface ConversationAccessScope {
  /** `null` is an explicit tenant-wide scope for trusted callers. */
  readonly departments: readonly Department[] | null;
}

export interface EnsureWhatsAppConversationResult {
  readonly id: string;
  readonly version: number;
  readonly conversationState: ConversationState;
  readonly assignedTo: { readonly id: string; readonly name: string } | null;
}

export interface MessageListQuery {
  page: number;
  pageSize: number;
  search?: string;
}

export interface TransitionListQuery {
  page: number;
  pageSize: number;
}

export abstract class WhatsAppRepository {
  abstract findWebhookChannel(
    channelId: string,
  ): Promise<WebhookChannelConfiguration | null>;
  abstract persistWebhookMessage(
    input: PersistWebhookMessageInput,
  ): Promise<PersistWebhookMessageResult>;
  abstract transition(input: TransitionCommand): Promise<unknown>;
  abstract ensureConversationForPhone(
    companyId: string,
    phoneNormalized: string,
  ): Promise<EnsureWhatsAppConversationResult>;
  abstract createOutbound(input: CreateOutboundInput): Promise<unknown>;
  abstract createHumanOutbound(
    input: CreateHumanOutboundInput,
  ): Promise<unknown>;
  abstract claimEvolutionDispatch(
    input: ClaimEvolutionDispatchInput,
  ): Promise<unknown>;
  abstract recordEvolutionResult(input: EvolutionResultInput): Promise<unknown>;
  abstract markEvolutionDispatchUnknown(
    input: MarkEvolutionDispatchUnknownInput,
  ): Promise<unknown>;
  abstract completeOutboxExecution(
    input: CompleteOutboxExecutionInput,
  ): Promise<unknown>;
  abstract reconcileAutomationOutbox(
    input: ReconcileAutomationOutboxInput,
  ): Promise<unknown>;
  abstract listConversations(
    companyId: string,
    query: ConversationListQuery,
  ): Promise<unknown>;
  abstract getConversation(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ): Promise<unknown>;
  abstract getAutomationBatch(
    companyId: string,
    conversationId: string,
    sourceEventId: string,
    windowSeconds: number,
  ): Promise<unknown>;
  abstract listMessages(
    companyId: string,
    conversationId: string,
    query: MessageListQuery,
    scope: ConversationAccessScope,
  ): Promise<unknown>;
  abstract listTransitions(
    companyId: string,
    conversationId: string,
    query: TransitionListQuery,
    scope: ConversationAccessScope,
  ): Promise<unknown>;
}
