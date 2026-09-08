import {
  INTERNAL_DEPARTMENTS,
  type Department,
} from '../access/access.constants';
import type { ServicePriority } from './service-session';
import type { QuoteRequestStatus } from '../commercial/quote-status';
import {
  UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
  type ConversationState,
  type FlowStep,
  type MessageKind,
  type TransitionName,
} from './whatsapp.constants';

export const QUOTE_CONFIRMATION_MESSAGE =
  'Dados do orçamento confirmados. Sua solicitação foi encaminhada ao time Comercial. Pode continuar a conversa por aqui sempre que precisar.';

export type AutomationTopic =
  | 'whatsapp.inbound.persisted'
  | 'whatsapp.inbound.human-notification'
  | 'whatsapp.outbound.requested';

export interface QuoteRequestSnapshot {
  readonly id: string;
  readonly sequence: number;
  readonly status: QuoteRequestStatus;
  readonly version: number;
  readonly contactName?: string | null;
  readonly document?: string | null;
  readonly email?: string | null;
  readonly serviceType?: string | null;
  readonly origin?: string | null;
  readonly destination?: string | null;
  readonly departureDate?: string | null;
  readonly departureAt?: string | null;
  readonly returnDate?: string | null;
  readonly returnAt?: string | null;
  readonly passengerCount?: number | null;
  readonly vehicleType?: string | null;
  readonly vehicleAtDisposal?: boolean | null;
  readonly localTransfers?: boolean | null;
  readonly notes?: string | null;
  readonly structuredData?: Readonly<Record<string, unknown>> | null;
}

export interface AutomationConversation {
  readonly id: string;
  readonly department: Department;
  readonly conversationState: ConversationState;
  readonly flowStep: FlowStep;
  readonly requestStatus: QuoteRequestStatus;
  readonly resumeState: ConversationState | null;
  readonly version: number;
  readonly mainMenuPresentedAt?: string | null;
  readonly followUpMenuPresentedAt?: string | null;
  readonly departmentContactOption?: string | null;
  readonly assignedTo?: { readonly id: string; readonly name: string } | null;
  readonly currentQuoteRequest?: QuoteRequestSnapshot | null;
}

export interface WhatsAppAutomationEnvelope {
  readonly schemaVersion: '1.0';
  readonly id: string;
  readonly companyId: string;
  readonly topic: AutomationTopic;
  readonly aggregateType: 'whatsapp-conversation';
  readonly aggregateId: string;
  readonly aggregateSequence: number;
  readonly executionId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly eventId: string;
    readonly messageId: string;
    readonly attemptId?: string;
    readonly conversationId: string;
    readonly channelId: string;
    readonly companyId: string;
    readonly contact: {
      readonly id: string;
      readonly phone: string;
      readonly displayName: string | null;
    };
    readonly message: {
      readonly providerMessageId: string | null;
      readonly direction: 'inbound' | 'outbound';
      readonly deliveryStatus: 'received' | 'pending';
      readonly kind: MessageKind;
      readonly text: string | null;
      readonly media: Readonly<Record<string, unknown>> | null;
      readonly occurredAt: string;
    };
    readonly conversation: AutomationConversation;
    readonly automationAllowed: boolean;
    readonly canGenerateReply: boolean;
    readonly canSendReply: boolean;
    readonly contextualTransition: boolean;
    readonly isFirstContact: boolean;
    readonly reopenedAfterClosure: boolean;
    readonly automatic?: boolean;
  };
}

export const QUOTE_STATUSES_WITH_FOLLOW_UP_MENU: ReadonlySet<QuoteRequestStatus> =
  new Set(['waiting-for-customer', 'under-review', 'approved', 'rejected']);

export type AiMode =
  | 'natural-service'
  | 'eventual-quote'
  | 'continuous-pretriage'
  | 'quote-correction-or-confirmation';

export interface AutomationPlan {
  readonly kind:
    | 'static-reply'
    | 'ai'
    | 'human-notification'
    | 'suppressed'
    | 'transition-only';
  readonly responseMessage: string | null;
  readonly transitionBeforeAi: TransitionName | null;
  readonly transitionAfterSend: TransitionName | null;
  readonly transitionMetadata: Readonly<Record<string, unknown>> | null;
  readonly aiMode: AiMode | null;
  readonly reason: string;
  readonly outboundPurpose?:
    | 'main-menu'
    | 'commercial-follow-up-menu'
    | 'department-notification'
    | 'unsupported-message-kind'
    | null;
  readonly outboundRecipientPhoneEnv?: string | null;
}

export interface AiProviderOutput {
  readonly message: string;
  readonly collectionStatus:
    'collecting' | 'ready-for-summary' | 'completed' | 'human-handoff';
  readonly extractedDataPatch: Readonly<Record<string, unknown>>;
  readonly missingFields: readonly string[];
  readonly summaryPresented: boolean;
  readonly customerDecision:
    'undecided' | 'confirmed' | 'correction-requested' | 'human-requested';
  /** Silent orchestration classification persisted on the active service session. */
  readonly priority?: ServicePriority;
  /** Auditable explanation for the orchestration priority. */
  readonly priorityReason?: string;
  readonly targetDepartment?: Department;
}

export interface AiValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly output: AiProviderOutput | null;
}

export interface BufferedMessage {
  readonly sourceEventId: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly kind: string;
  readonly text: string | null;
  readonly mediaInterpretationStatus?:
    'not-requested' | 'pending' | 'succeeded' | 'failed' | 'unsupported';
  readonly interpretedText?: string | null;
  readonly interpretationSource?: 'human' | 'machine' | 'none';
  readonly mediaInterpretationId?: string | null;
  readonly isFirstContact: boolean;
}

export function decideAutomationPlan(input: {
  readonly envelope: WhatsAppAutomationEnvelope;
  readonly conversation?: AutomationConversation;
  readonly bufferedText?: string | null;
  readonly pendingQuestion?: string | null;
  readonly mediaInterpretationAvailable?: boolean;
}): AutomationPlan {
  const { envelope } = input;
  const currentConversation =
    input.conversation ?? envelope.payload.conversation;
  const routingConversation = currentConversation;
  const messageText = (
    input.bufferedText ??
    getProcessableMessageText(envelope) ??
    ''
  ).trim();

  const humanAutomationBlocked =
    envelope.topic === 'whatsapp.inbound.human-notification' ||
    currentConversation.conversationState === 'human-active' ||
    currentConversation.conversationState === 'sent-to-human' ||
    currentConversation.flowStep === 'human-service' ||
    currentConversation.assignedTo != null;

  if (humanAutomationBlocked) {
    return {
      kind: 'human-notification',
      responseMessage: null,
      transitionBeforeAi: null,
      transitionAfterSend: null,
      transitionMetadata: {
        reason: 'human-conversation-inbound',
        historyAvailableInPanel: true,
      },
      aiMode: null,
      reason: 'human-active-blocks-bot',
    };
  }

  if (
    envelope.payload.automationAllowed !== true ||
    envelope.payload.canGenerateReply !== true ||
    envelope.payload.canSendReply !== true ||
    currentConversation.conversationState !== 'bot-active'
  ) {
    return suppressed('tenant-api-did-not-authorize-automatic-reply');
  }

  const initialMenuRequired =
    currentConversation.conversationState === 'bot-active' &&
    (envelope.payload.isFirstContact ||
      envelope.payload.reopenedAfterClosure) &&
    !currentConversation.mainMenuPresentedAt;

  if (initialMenuRequired) {
    if (
      (envelope.payload.message.kind === 'text' ||
        input.mediaInterpretationAvailable === true) &&
      messageText
    ) {
      return aiPlan(
        'natural-service',
        null,
        envelope.payload.reopenedAfterClosure
          ? 'natural-language-after-closure'
          : 'natural-language-first-contact',
      );
    }
    return {
      kind: 'static-reply',
      responseMessage:
        'Recebi sua mensagem. O conteúdo continuará disponível no atendimento; se precisar, descreva em texto o que deseja enquanto a análise é preparada.',
      transitionBeforeAi: null,
      transitionAfterSend: null,
      transitionMetadata: {
        reason: envelope.payload.reopenedAfterClosure
          ? 'main-menu-after-closure'
          : 'initial-menu',
      },
      aiMode: null,
      reason: envelope.payload.reopenedAfterClosure
        ? 'reopened-conversation-menu-pending-durable-confirmation'
        : 'initial-menu-pending-durable-confirmation',
      outboundPurpose: null,
    };
  }

  if (
    envelope.payload.message.kind !== 'text' &&
    input.mediaInterpretationAvailable !== true
  ) {
    const pendingQuestion = input.pendingQuestion?.trim();
    const inQuoteCollection = [
      'quote-data-collection',
      'quote-summary-confirmation',
    ].includes(currentConversation.flowStep);
    return {
      kind: 'static-reply',
      responseMessage:
        inQuoteCollection && pendingQuestion
          ? `${pendingQuestion}\n\n${UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT}`
          : UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT,
      transitionBeforeAi: null,
      transitionAfterSend: null,
      transitionMetadata: null,
      aiMode: null,
      reason: 'unsupported-message-kind-preserves-conversation-state',
      outboundPurpose: 'unsupported-message-kind',
    };
  }

  if (!messageText) {
    return {
      kind: 'static-reply',
      responseMessage:
        'Não consegui identificar o conteúdo da mensagem. Pode me explicar o que precisa?',
      transitionBeforeAi: null,
      transitionAfterSend: null,
      transitionMetadata: null,
      aiMode: null,
      reason: 'processable-text-required',
    };
  }

  switch (routingConversation.flowStep) {
    case 'main-menu':
      return aiPlan('natural-service', null, 'natural-language-service');
    case 'commercial-menu':
    case 'commercial-follow-up-menu':
      return aiPlan('natural-service', null, 'contextual-commercial-service');
    case 'quote-data-collection':
      return aiPlan(
        resolveQuoteMode(routingConversation),
        null,
        'continue-quote',
      );
    case 'quote-summary-confirmation':
      return aiPlan(
        'quote-correction-or-confirmation',
        null,
        'evaluate-summary-decision',
      );
    case 'human-service':
    case 'quote-send-pending':
      return {
        kind: 'human-notification',
        responseMessage: null,
        transitionBeforeAi: null,
        transitionAfterSend: null,
        transitionMetadata: {
          reason: 'human-service-inbound',
          historyAvailableInPanel: true,
        },
        aiMode: null,
        reason: 'human-service-blocks-bot',
      };
    case 'closed':
      return suppressed('conversation-closed');
  }
}

export function validateAiProviderOutput(value: unknown): AiValidationResult {
  const errors: string[] = [];
  const output = asRecord(value);

  if (!output) {
    return {
      valid: false,
      errors: ['resposta deve ser um objeto JSON'],
      output: null,
    };
  }

  const message =
    typeof output.message === 'string' ? output.message.trim() : '';
  if (!message) errors.push('message é obrigatório');

  const statuses = new Set([
    'collecting',
    'ready-for-summary',
    'completed',
    'human-handoff',
  ]);
  if (!statuses.has(String(output.collectionStatus))) {
    errors.push('collectionStatus é inválido');
  }

  if (!asRecord(output.extractedDataPatch)) {
    errors.push('extractedDataPatch deve ser um objeto');
  }

  if (
    !Array.isArray(output.missingFields) ||
    output.missingFields.some((item) => typeof item !== 'string')
  ) {
    errors.push('missingFields deve ser uma lista de strings');
  }

  if (typeof output.summaryPresented !== 'boolean') {
    errors.push('summaryPresented deve ser boolean');
  }

  const decisions = new Set([
    'undecided',
    'confirmed',
    'correction-requested',
    'human-requested',
  ]);
  if (!decisions.has(String(output.customerDecision))) {
    errors.push('customerDecision é inválido');
  }

  const priorities = new Set(['low', 'normal', 'high', 'urgent']);
  const hasPriority = output.priority !== undefined;
  const hasPriorityReason = output.priorityReason !== undefined;
  if (hasPriority !== hasPriorityReason) {
    errors.push('priority e priorityReason devem ser informados juntos');
  }
  if (hasPriority && !priorities.has(String(output.priority))) {
    errors.push('priority é inválida');
  }
  const priorityReason =
    typeof output.priorityReason === 'string'
      ? output.priorityReason.trim()
      : '';
  if (hasPriorityReason && (!priorityReason || priorityReason.length > 500)) {
    errors.push('priorityReason deve possuir entre 1 e 500 caracteres');
  }

  if (
    output.targetDepartment !== undefined &&
    !INTERNAL_DEPARTMENTS.includes(output.targetDepartment as never)
  ) {
    errors.push('targetDepartment é inválido');
  }

  if (errors.length > 0) {
    return { valid: false, errors, output: null };
  }

  return {
    valid: true,
    errors: [],
    output: {
      message,
      collectionStatus:
        output.collectionStatus as AiProviderOutput['collectionStatus'],
      extractedDataPatch: output.extractedDataPatch as Record<string, unknown>,
      missingFields: output.missingFields as string[],
      summaryPresented: output.summaryPresented as boolean,
      customerDecision:
        output.customerDecision as AiProviderOutput['customerDecision'],
      ...(output.targetDepartment
        ? { targetDepartment: output.targetDepartment as Department }
        : {}),
      ...(hasPriority
        ? {
            priority: output.priority as ServicePriority,
            priorityReason,
          }
        : {}),
    },
  };
}

/**
 * Converts only the provider's structured natural-service completion signal
 * into a lifecycle resolution. Quote completion and handoff still have
 * durable downstream work and therefore cannot close the service session.
 */
export function aiOutputResolvesConversation(
  output: AiProviderOutput,
  aiMode: AiMode,
): boolean {
  return (
    aiMode === 'natural-service' &&
    output.collectionStatus === 'completed' &&
    output.missingFields.length === 0 &&
    (output.customerDecision === 'undecided' ||
      output.customerDecision === 'confirmed')
  );
}

export function deriveAiActions(
  output: AiProviderOutput,
  aiMode: AiMode,
): {
  readonly sendMessage: boolean;
  readonly transitionBeforeSend: TransitionName | null;
  readonly transitionAfterSend: TransitionName | null;
  readonly humanReason: string | null;
} {
  if (aiMode === 'natural-service') {
    const humanRequested =
      output.customerDecision === 'human-requested' ||
      output.collectionStatus === 'human-handoff';
    return {
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: humanRequested ? 'forward' : null,
      humanReason: humanRequested ? 'customer-requested-human' : null,
    };
  }

  if (output.customerDecision === 'confirmed') {
    return {
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: 'confirm-quote',
      humanReason: 'quote-summary-confirmed',
    };
  }

  if (output.customerDecision === 'correction-requested') {
    return {
      sendMessage: true,
      transitionBeforeSend: 'correct-quote',
      transitionAfterSend: null,
      humanReason: null,
    };
  }

  if (
    output.customerDecision === 'human-requested' ||
    output.collectionStatus === 'human-handoff'
  ) {
    return {
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: 'forward',
      humanReason: 'customer-requested-human',
    };
  }

  if (
    aiMode === 'continuous-pretriage' &&
    output.collectionStatus === 'completed'
  ) {
    return {
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: 'forward',
      humanReason: 'continuous-pretriage-completed',
    };
  }

  if (
    output.summaryPresented ||
    output.collectionStatus === 'ready-for-summary'
  ) {
    return {
      sendMessage: true,
      transitionBeforeSend: null,
      transitionAfterSend: 'present-quote-summary',
      humanReason: null,
    };
  }

  return {
    sendMessage: true,
    transitionBeforeSend: null,
    transitionAfterSend: null,
    humanReason: null,
  };
}

export function isExplicitPositiveConfirmation(value: string): boolean {
  const normalized = value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  const confirmations = [
    'sim',
    'sim, confirmo',
    'sim, esta correto',
    'sim, pode confirmar',
    'sim, pode enviar',
    'sim, pode encaminhar',
    'confirmo',
    'confirmado',
    'correto',
    'esta correto',
    'esta tudo certo',
    'os dados estao corretos',
    'pode confirmar',
    'pode enviar',
    'pode encaminhar',
    'de acordo',
    'tudo certo',
    'ok',
    'okay',
  ] as const;

  return confirmations.some(
    (confirmation) =>
      normalized === confirmation ||
      normalized.startsWith(`${confirmation},`) ||
      normalized.startsWith(`${confirmation}.`) ||
      normalized.startsWith(`${confirmation};`) ||
      normalized.startsWith(`${confirmation}:`) ||
      normalized.startsWith(`${confirmation} `),
  );
}

export function appendBufferedMessage(
  current: readonly BufferedMessage[],
  next: BufferedMessage,
): BufferedMessage[] {
  const bySourceEvent = new Map(
    current.map((message) => [message.sourceEventId, message]),
  );
  bySourceEvent.set(next.sourceEventId, next);

  return [...bySourceEvent.values()].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

export function buildBufferedText(
  messages: readonly BufferedMessage[],
): string {
  return messages
    .map((message) => message.interpretedText?.trim() || message.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join('\n');
}

export function mediaInterpretationsUsedInBufferedText(
  messages: readonly BufferedMessage[],
): readonly {
  readonly interpretationId: string;
  readonly effectiveSource: 'machine' | 'human';
}[] {
  const sources = new Map<
    string,
    {
      readonly interpretationId: string;
      readonly effectiveSource: 'machine' | 'human';
    }
  >();
  for (const message of messages) {
    const interpretationId = message.mediaInterpretationId?.trim();
    const effectiveSource = message.interpretationSource;
    if (
      !interpretationId ||
      !message.interpretedText?.trim() ||
      (effectiveSource !== 'machine' && effectiveSource !== 'human')
    ) {
      continue;
    }
    sources.set(interpretationId, {
      interpretationId,
      effectiveSource,
    });
  }
  return [...sources.values()];
}

export function deterministicCommandId(
  sourceEventId: string,
  action: string,
): string {
  const value = `${sourceEventId}:${action}`;
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca77, 0xc2b2ae3d];
  const hashes = seeds.map((seed, index) => {
    let hash = seed >>> 0;
    for (let cursor = 0; cursor < value.length; cursor += 1) {
      hash ^= value.charCodeAt(cursor) + index * 17;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= hash >>> 13;
    }
    return hash >>> 0;
  });
  const bytes = hashes.flatMap((hash) => [
    (hash >>> 24) & 0xff,
    (hash >>> 16) & 0xff,
    (hash >>> 8) & 0xff,
    hash & 0xff,
  ]);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function redisConversationPrefix(input: {
  readonly environment: string;
  readonly companyId: string;
  readonly conversationId: string;
}): string {
  const clean = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return [
    'milenium',
    'whatsapp',
    clean(input.environment || 'local'),
    clean(input.companyId),
    clean(input.conversationId),
  ].join(':');
}

function aiPlan(
  aiMode: AiMode,
  transitionBeforeAi: TransitionName | null,
  reason: string,
): AutomationPlan {
  return {
    kind: 'ai',
    responseMessage: null,
    transitionBeforeAi,
    transitionAfterSend: null,
    transitionMetadata: null,
    aiMode,
    reason,
  };
}

function suppressed(reason: string): AutomationPlan {
  return {
    kind: 'suppressed',
    responseMessage: null,
    transitionBeforeAi: null,
    transitionAfterSend: null,
    transitionMetadata: null,
    aiMode: null,
    reason,
  };
}

function resolveQuoteMode(conversation: AutomationConversation): AiMode {
  const quoteMode = conversation.currentQuoteRequest?.structuredData?.quoteMode;
  const serviceType =
    conversation.currentQuoteRequest?.serviceType?.toLowerCase() ??
    (typeof quoteMode === 'string' ? quoteMode : '').toLowerCase();

  return serviceType.includes('cont') || serviceType.includes('continuous')
    ? 'continuous-pretriage'
    : 'eventual-quote';
}

function getProcessableMessageText(
  event: WhatsAppAutomationEnvelope,
): string | null {
  const message = event.payload.message;

  if (message.kind !== 'text') return null;

  const sanitized = (message.text ?? '')
    .trim()
    .replace(
      /\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/g,
      '[DADO_PESSOAL_MASCARADO]',
    );

  return sanitized.length > 0 ? sanitized : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
