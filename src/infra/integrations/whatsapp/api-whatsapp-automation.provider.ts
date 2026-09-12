import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpEvolutionOutboundGateway } from '../evolution/evolution-outbound.client';
import {
  CommercialQuoteRepository,
  type QuoteRequestPatch,
} from '../../../application/contracts/commercial-quote.repository';
import type { EvolutionOutboundInput } from '../../../application/contracts/evolution-outbound.gateway';
import { WhatsAppMediaStorage } from '../../../application/contracts/whatsapp-media.storage';
import {
  WhatsAppContinuityClassificationError,
  type WhatsAppConversationAgentInput,
} from '../../../application/contracts/whatsapp-conversation-agent';
import {
  type ClaimedWhatsAppAutomationEvent,
  buildWhatsAppAutomationEnvelope,
  WhatsAppAutomationExecutionError,
  WhatsAppAutomationProvider,
} from '../../../application/contracts/whatsapp-automation.provider';
import {
  WhatsAppRepository,
  type CreateOutboundInput,
  type TransitionCommand,
} from '../../../application/contracts/whatsapp.repository';
import type { Department } from '../../../domain/access/access.constants';
import { DEPARTMENTS } from '../../../domain/access/access.constants';
import { isQuoteRequestStatus } from '../../../domain/commercial/quote-status';
import { AppError } from '../../../core/errors/app-error';
import {
  CONVERSATION_STATES,
  FLOW_STEPS,
  MESSAGE_KINDS,
  type MessageKind,
} from '../../../domain/whatsapp/whatsapp.constants';
import {
  dateOnlyFromDateTime,
  parseBusinessDateTime,
  parseDateOnly,
} from '../../../domain/commercial/quote-schedule';
import {
  QUOTE_CONFIRMATION_MESSAGE,
  aiOutputResolvesConversation,
  buildBufferedText,
  decideAutomationPlan,
  deriveAiActions,
  deterministicCommandId,
  isExplicitPositiveConfirmation,
  mediaInterpretationsUsedInBufferedText,
  type AiMode,
  type AiProviderOutput,
  type AutomationConversation,
  type AutomationPlan,
  type BufferedMessage,
  type QuoteRequestSnapshot,
  type WhatsAppAutomationEnvelope as DomainAutomationEnvelope,
} from '../../../domain/whatsapp/whatsapp-automation-flow';
import { PlatformWhatsAppConversationAgent } from '../whatsapp-ai/platform-whatsapp-conversation-agent';
import { WhatsAppAutomationDecisionStore } from './whatsapp-automation-decision.store';
import { WhatsAppAutomationCheckpointStore } from './whatsapp-automation-checkpoint.store';

interface AutomationPayload {
  eventId: string;
  messageId: string;
  attemptId?: string;
  dispatchGeneration?: string;
  conversationId: string;
  channelId: string;
  companyId: string;
  contact: {
    id: string;
    phone: string;
    displayName: string | null;
  };
  message: {
    providerMessageId: string | null;
    kind: MessageKind;
    direction: 'inbound' | 'outbound';
    deliveryStatus: 'received' | 'pending';
    text: string | null;
    media: Readonly<Record<string, unknown>> | null;
    occurredAt: string;
  };
  conversation: AutomationConversation;
  automationAllowed: boolean;
  canGenerateReply: boolean;
  canSendReply: boolean;
  contextualTransition: boolean;
  isFirstContact: boolean;
  reopenedAfterClosure: boolean;
  automatic?: boolean;
}

interface DurableBatchResult {
  conversation: AutomationConversation;
  messages: BufferedMessage[];
  pendingQuestion: string | null;
}

const EVOLUTION_RESULT_PERSISTENCE_ATTEMPTS = 2;
const MEDIA_INTERPRETATION_STATUSES = [
  'not-requested',
  'pending',
  'succeeded',
  'failed',
  'unsupported',
] as const;
const MEDIA_INTERPRETATION_SOURCES = ['human', 'machine', 'none'] as const;

@Injectable()
export class ApiWhatsAppAutomationProvider extends WhatsAppAutomationProvider {
  readonly name = 'api' as const;
  readonly acknowledgement = 'before-execution' as const;
  private readonly logger = new Logger(ApiWhatsAppAutomationProvider.name);

  private readonly normalWindowSeconds: number;
  private readonly departmentWindowSeconds: number;
  private readonly departmentPhones: Readonly<Record<string, string>>;
  private readonly automationActiveSince: Date | null;

  constructor(
    private readonly repository: WhatsAppRepository,
    private readonly commercialQuotes: CommercialQuoteRepository,
    private readonly conversationAgent: PlatformWhatsAppConversationAgent,
    private readonly checkpointStore: WhatsAppAutomationCheckpointStore,
    private readonly decisionStore: WhatsAppAutomationDecisionStore,
    private readonly evolution: HttpEvolutionOutboundGateway,
    private readonly mediaStorage: WhatsAppMediaStorage,
    config: ConfigService,
  ) {
    super();
    this.normalWindowSeconds = Math.max(
      1,
      Math.ceil(
        (config.get<number>('WHATSAPP_API_DEBOUNCE_MS') ?? 2_000) / 1_000,
      ),
    );
    this.departmentWindowSeconds = Math.max(
      1,
      Math.ceil(
        (config.get<number>('WHATSAPP_API_DEPARTMENT_COLLECTION_MS') ??
          120_000) / 1_000,
      ),
    );
    const automationEnabled = config.get<boolean>('WHATSAPP_ENABLED') ?? false;
    const configuredActiveSince = config.get<string>(
      'WHATSAPP_AUTOMATION_ACTIVE_SINCE',
    );
    this.automationActiveSince = automationEnabled
      ? new Date(configuredActiveSince || Date.now())
      : null;
    this.departmentPhones = {
      MILENIUM_DIRECTOR_PHONE:
        config.get<string>('MILENIUM_DIRECTOR_PHONE') ?? '',
      MILENIUM_DEPARTMENT_PURCHASES_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_PURCHASES_PHONE') ?? '',
      MILENIUM_DEPARTMENT_CONTROLLING_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_CONTROLLING_PHONE') ?? '',
      MILENIUM_DEPARTMENT_DP_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_DP_PHONE') ?? '',
      MILENIUM_DEPARTMENT_FINANCE_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_FINANCE_PHONE') ?? '',
      MILENIUM_DEPARTMENT_MANAGEMENT_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_MANAGEMENT_PHONE') ?? '',
      MILENIUM_DEPARTMENT_MAINTENANCE_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_MAINTENANCE_PHONE') ?? '',
      MILENIUM_DEPARTMENT_MONITORING_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_MONITORING_PHONE') ?? '',
      MILENIUM_DEPARTMENT_OPERATIONAL_PHONE:
        config.get<string>('MILENIUM_DEPARTMENT_OPERATIONAL_PHONE') ?? '',
    };
  }

  async execute(event: ClaimedWhatsAppAutomationEvent): Promise<void> {
    if (event.topic === 'whatsapp.assistant-collection.requested') {
      const commandId = stringValue(asRecord(event.payload).commandId);
      if (!commandId) throw contractInvalid('commandId');
      const authorized = await this.repository.getAuthorizedAssistantCollection(
        event.companyId,
        event.aggregateId,
        commandId,
      );
      if (!authorized) {
        await this.complete(event, 'succeeded');
        return;
      }
      const data = asRecord(authorized);
      const payload = parseAutomationPayload(data.payload);
      const checkpoint = await this.checkpointStore.getOrCreate(event, () => {
        const messages = Array.isArray(data.messages)
          ? data.messages.map(asBufferedMessage)
          : [];
        return Promise.resolve({
          conversation: asAutomationConversation(data.conversation),
          messages,
          bufferedText: buildBufferedText(messages),
          plan: {
            kind: 'ai' as const,
            aiMode: 'eventual-quote' as const,
            reason: 'human-authorized-new-quote',
            responseMessage: null,
            transitionBeforeAi: null,
            transitionAfterSend: null,
            transitionMetadata: null,
          },
        });
      });
      try {
        await this.processInteractivePlan(
          event,
          payload,
          {
            conversation: checkpoint.conversation,
            messages: [...checkpoint.messages],
            pendingQuestion: null,
          },
          checkpoint.plan,
          checkpoint.bufferedText,
        );
      } catch (error) {
        if (!(await this.wasSupersededByHumanAction(error, event, payload)))
          throw error;
      }
      await this.complete(event, 'succeeded');
      return;
    }
    if (event.topic === 'whatsapp.outbound.requested') {
      await this.processRequestedOutbound(event);
      await this.complete(event, 'succeeded');
      return;
    }

    if (
      event.topic !== 'whatsapp.inbound.persisted' &&
      event.topic !== 'whatsapp.inbound.human-notification'
    ) {
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        'UNSUPPORTED_AUTOMATION_TOPIC',
        'O evento não pertence ao fluxo de automação do WhatsApp.',
      );
    }

    const payload = parseAutomationPayload(event.payload);
    assertEnvelopeIdentity(event, payload);
    if (
      this.automationActiveSince &&
      new Date(payload.message.occurredAt) < this.automationActiveSince
    ) {
      this.logger.log(
        `Evento anterior à ativação concluído sem resposta outboxId=${event.id} correlationId=${event.correlationId}`,
      );
      await this.complete(event, 'succeeded', [payload.eventId]);
      return;
    }
    const channel = await this.repository.findWebhookChannel(payload.channelId);
    if (!channel || channel.agentsEnabled === false) {
      await this.complete(event, 'succeeded', [payload.eventId]);
      return;
    }
    await this.resolvePendingContinuity(event, payload);
    const checkpoint = await this.checkpointStore.getOrCreate(
      event,
      async () => {
        const batch = await this.getDurableBatch(event, payload);
        const bufferedText = buildBufferedText(batch.messages);
        const mediaInterpretationAvailable = batch.messages.some(
          (message) =>
            message.kind !== 'text' &&
            message.mediaInterpretationStatus === 'succeeded' &&
            Boolean(message.interpretedText?.trim()),
        );
        const plan = decideAutomationPlan({
          envelope: toDomainEnvelope(event, payload),
          conversation: batch.conversation,
          bufferedText,
          pendingQuestion: batch.pendingQuestion,
          mediaInterpretationAvailable,
        });
        return {
          conversation: batch.conversation,
          messages: batch.messages,
          bufferedText,
          plan,
        };
      },
    );
    const batch: DurableBatchResult = {
      conversation: checkpoint.conversation,
      messages: [...checkpoint.messages],
      pendingQuestion: null,
    };
    const { bufferedText, plan } = checkpoint;

    if (plan.kind === 'human-notification') {
      try {
        const context = await this.repository.getHumanObservationContext(
          event.companyId,
          payload.conversationId,
          payload.eventId,
        );
        if (context) {
          const result = await this.conversationAgent.observeHumanConversation({
            ...context,
            companyId: event.companyId,
            conversationId: payload.conversationId,
            sourceEventId: payload.eventId,
            serviceSessionId: context.sourceServiceSessionId,
            observationOnly: true,
          });
          await this.repository.recordHumanObservation({
            companyId: event.companyId,
            conversationId: payload.conversationId,
            sourceEventId: payload.eventId,
            serviceSessionId: context.sourceServiceSessionId,
            expectedVersion: context.expectedVersion,
            result,
          });
        }
      } catch {
        this.logger.warn(
          `Observação silenciosa indisponível; atendimento humano preservado conversationId=${payload.conversationId}`,
        );
      }
    }

    if (
      plan.kind === 'suppressed' ||
      plan.kind === 'human-notification' ||
      plan.kind === 'transition-only'
    ) {
      await this.complete(
        event,
        'succeeded',
        event.topic === 'whatsapp.inbound.persisted'
          ? batch.messages.map((message) => message.sourceEventId)
          : undefined,
      );
      return;
    }

    try {
      await this.processInteractivePlan(
        event,
        payload,
        batch,
        plan,
        bufferedText,
      );
    } catch (error) {
      if (!(await this.wasSupersededByHumanAction(error, event, payload))) {
        throw error;
      }
      await this.complete(
        event,
        'succeeded',
        batch.messages.map((message) => message.sourceEventId),
      );
      return;
    }
    await this.complete(
      event,
      'succeeded',
      batch.messages.map((message) => message.sourceEventId),
    );
  }

  private async resolvePendingContinuity(
    event: ClaimedWhatsAppAutomationEvent,
    payload: AutomationPayload,
  ): Promise<void> {
    const candidate = await this.repository.getPendingContinuityClassification(
      event.companyId,
      payload.conversationId,
      payload.eventId,
    );
    if (!candidate) return;

    let classification: Awaited<
      ReturnType<PlatformWhatsAppConversationAgent['classifyContinuity']>
    > | null = null;
    let failedAttribution: {
      readonly agentId: string;
      readonly agentExecutionId: string;
    } | null = null;
    try {
      classification = await this.conversationAgent.classifyContinuity({
        sourceEventId: payload.eventId,
        companyId: event.companyId,
        conversationId: payload.conversationId,
        serviceSessionId: candidate.sourceServiceSessionId,
        currentDepartmentId: candidate.currentDepartmentId,
        previousMessages: candidate.previousMessages,
        userMessage: candidate.userMessage,
        allowedTargetDepartments: candidate.allowedTargetDepartments,
      });
    } catch (error) {
      if (
        error instanceof WhatsAppContinuityClassificationError &&
        error.agentId &&
        error.agentExecutionId
      ) {
        failedAttribution = {
          agentId: error.agentId,
          agentExecutionId: error.agentExecutionId,
        };
      }
      this.logger.warn(
        `Classificador de continuidade indisponível; aplicado UNCERTAIN seguro conversationId=${payload.conversationId}`,
      );
    }

    await this.repository.applyContinuityClassification({
      companyId: event.companyId,
      conversationId: payload.conversationId,
      sourceEventId: payload.eventId,
      decisionId: candidate.decisionId,
      commandId: deterministicCommandId(
        payload.eventId,
        'continuity-classification',
      ),
      expectedVersion: candidate.expectedVersion,
      classification: classification?.classification ?? 'uncertain',
      confidence: classification?.confidence ?? null,
      reason:
        classification?.reason ??
        'Classificador indisponível; continuidade preservada por fallback seguro.',
      targetDepartmentId:
        classification?.targetDepartmentId ?? candidate.currentDepartmentId,
      ...(classification
        ? {
            actorAgentId: classification.agentId,
            agentExecutionId: classification.agentExecutionId,
          }
        : failedAttribution
          ? {
              actorAgentId: failedAttribution.agentId,
              agentExecutionId: failedAttribution.agentExecutionId,
            }
          : {}),
    });
  }

  private async processInteractivePlan(
    event: ClaimedWhatsAppAutomationEvent,
    payload: AutomationPayload,
    batch: DurableBatchResult,
    plan: AutomationPlan,
    bufferedText: string,
  ): Promise<void> {
    let conversation = batch.conversation;
    if (plan.transitionBeforeAi) {
      conversation = await this.transition(
        event,
        conversation,
        plan.transitionBeforeAi,
        {
          ...plan,
          transitionMetadata: {
            ...plan.transitionMetadata,
            ...(plan.transitionBeforeAi === 'new-quote-request'
              ? {
                  quoteContextStartedAt: batch.messages
                    .map((message) => message.occurredAt)
                    .sort()[0],
                }
              : {}),
          },
        },
      );
    }

    let responseMessage = plan.responseMessage;
    let transitionBeforeSend = null as TransitionCommand['name'] | null;
    let transitionAfterSend = plan.transitionAfterSend;
    let transitionReason = plan.reason;
    let transitionMetadata = plan.transitionMetadata;
    let agentAttribution: {
      readonly agentId: string;
      readonly agentExecutionId: string;
    } | null = null;
    let sessionPriority: NonNullable<
      CreateOutboundInput['sessionPriority']
    > | null = null;
    let conversationResolved = false;
    let waitingOnCustomer = false;

    if (plan.kind === 'ai') {
      if (!plan.aiMode) {
        throw new WhatsAppAutomationExecutionError(
          'terminal-failure',
          'AI_MODE_MISSING',
          'O plano de IA não informou o modo de coleta.',
        );
      }
      const replyAuthorization =
        await this.repository.assertAutomaticReplyAllowed(
          event.companyId,
          payload.conversationId,
        );
      const mediaInterpretations = mediaInterpretationsUsedInBufferedText(
        batch.messages,
      );
      const agentInput = {
        sourceEventId: payload.eventId,
        correlationId: event.correlationId,
        companyId: event.companyId,
        conversationId: payload.conversationId,
        serviceSessionId: replyAuthorization.serviceSessionId,
        aiMode: plan.aiMode,
        userMessage: bufferedText,
        contextThrough: batch.messages
          .map((message) => message.occurredAt)
          .sort()
          .at(-1),
        ...(mediaInterpretations.length > 0 ? { mediaInterpretations } : {}),
        currentConversation: conversation,
      } satisfies WhatsAppConversationAgentInput;
      const aiResult = await this.decisionStore.getOrCreate(
        event,
        agentInput,
        () => this.conversationAgent.complete(agentInput),
      );
      if (aiResult.agentId && aiResult.agentExecutionId) {
        agentAttribution = {
          agentId: aiResult.agentId,
          agentExecutionId: aiResult.agentExecutionId,
        };
      }
      if (aiResult.output.priority && aiResult.output.priorityReason?.trim()) {
        sessionPriority = {
          priority: aiResult.output.priority,
          reason: aiResult.output.priorityReason.trim(),
        };
      }
      let effectiveMode = plan.aiMode;
      if (
        effectiveMode === 'natural-service' &&
        conversation.department === 'commercial' &&
        !conversation.currentQuoteRequest &&
        conversation.requestStatus === 'not-started' &&
        ['main-menu', 'commercial-menu'].includes(conversation.flowStep) &&
        aiResult.output.extractedDataPatch.serviceType === 'eventual' &&
        aiResult.output.customerDecision !== 'human-requested' &&
        aiResult.output.collectionStatus !== 'human-handoff'
      ) {
        assertSafeAiDecision(aiResult.output, 'eventual-quote', bufferedText);
        conversation = await this.transition(
          event,
          conversation,
          'start-quote',
          {
            ...plan,
            reason: 'natural-language-eventual-quote',
          },
        );
        effectiveMode = 'eventual-quote';
      }
      assertSafeAiDecision(aiResult.output, effectiveMode, bufferedText);
      const actions = deriveAiActions(aiResult.output, effectiveMode);
      if (
        actions.transitionAfterSend === 'forward' &&
        !aiResult.output.targetDepartment
      ) {
        throw contractInvalid('targetDepartment');
      }
      conversationResolved = aiOutputResolvesConversation(
        aiResult.output,
        effectiveMode,
      );
      waitingOnCustomer =
        aiResult.output.message.includes('?') &&
        !conversationResolved &&
        actions.transitionAfterSend !== 'forward' &&
        actions.transitionAfterSend !== 'confirm-quote' &&
        (aiResult.output.collectionStatus === 'collecting' ||
          aiResult.output.missingFields.length > 0 ||
          actions.transitionAfterSend === 'present-quote-summary');
      transitionBeforeSend = actions.transitionBeforeSend;
      transitionAfterSend = actions.transitionAfterSend;
      transitionReason = actions.humanReason ?? plan.reason;
      transitionMetadata =
        actions.transitionAfterSend === 'forward'
          ? {
              targetDepartment: aiResult.output.targetDepartment,
              reason: transitionReason,
              historyAvailableInPanel: true,
            }
          : { reason: transitionReason };
      responseMessage =
        effectiveMode !== 'natural-service' &&
        aiResult.output.customerDecision === 'confirmed'
          ? QUOTE_CONFIRMATION_MESSAGE
          : aiResult.output.message;

      if (transitionBeforeSend) {
        conversation = await this.transition(
          event,
          conversation,
          transitionBeforeSend,
          {
            ...plan,
            reason: transitionReason,
            transitionMetadata,
          },
        );
      }
      if (effectiveMode !== 'natural-service') {
        conversation = await this.patchQuoteFromAi(
          event,
          conversation,
          effectiveMode,
          aiResult.output,
        );
      }
      if (
        transitionAfterSend === 'present-quote-summary' ||
        transitionAfterSend === 'confirm-quote'
      ) {
        assertMinimumQuoteComplete(conversation.currentQuoteRequest);
      }
    }

    if (!responseMessage?.trim()) {
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        'AUTOMATION_RESPONSE_EMPTY',
        'O fluxo não produziu uma mensagem para envio.',
      );
    }

    if (
      transitionAfterSend === 'forward' ||
      transitionAfterSend === 'confirm-quote'
    ) {
      if (transitionAfterSend === 'confirm-quote') {
        transitionMetadata = {
          ...transitionMetadata,
          targetDepartment: 'commercial',
        };
      }
      await this.transition(
        event,
        conversation,
        transitionAfterSend,
        {
          ...plan,
          reason: transitionReason,
          transitionMetadata,
        },
        {
          customerMessage: responseMessage,
          occurredAt: new Date(),
          ...(agentAttribution
            ? {
                actorAgentId: agentAttribution.agentId,
                agentExecutionId: agentAttribution.agentExecutionId,
              }
            : {}),
          ...(sessionPriority && agentAttribution ? { sessionPriority } : {}),
        },
      );
      return;
    }

    const recipientPhone = plan.outboundRecipientPhoneEnv
      ? this.departmentPhones[plan.outboundRecipientPhoneEnv]
      : payload.contact.phone;
    const outbound = asRecord(
      await this.repository.createOutbound({
        companyId: event.companyId,
        conversationId: payload.conversationId,
        commandId: deterministicCommandId(payload.eventId, 'outbound'),
        expectedVersion: conversation.version,
        automatic: true,
        ...(agentAttribution
          ? {
              actorAgentId: agentAttribution.agentId,
              agentExecutionId: agentAttribution.agentExecutionId,
            }
          : {}),
        ...(sessionPriority && agentAttribution ? { sessionPriority } : {}),
        ...(conversationResolved
          ? { conversationResolved: true as const }
          : {}),
        ...(plan.outboundPurpose
          ? { purpose: plan.outboundPurpose }
          : agentAttribution && waitingOnCustomer
            ? { purpose: 'customer-information-request' as const }
            : agentAttribution && conversationResolved
              ? { purpose: 'service-session-resolution' as const }
              : {}),
        ...(plan.outboundPurpose === 'unsupported-message-kind'
          ? { inReplyToMessageId: payload.messageId }
          : {}),
        ...(plan.outboundPurpose === 'department-notification'
          ? { recipientPhone }
          : {}),
        kind: 'text',
        text: responseMessage,
      }),
    );
    await this.deliverPersistedMessage(event, {
      ...parseOutboundMessage(outbound, recipientPhone),
      sourceChannelId: payload.channelId,
    });

    if (transitionAfterSend) {
      await this.transition(event, conversation, transitionAfterSend, {
        ...plan,
        reason: transitionReason,
        transitionMetadata,
      });
    }
  }

  private async getDurableBatch(
    event: ClaimedWhatsAppAutomationEvent,
    payload: AutomationPayload,
  ): Promise<DurableBatchResult> {
    const windowSeconds = payload.conversation.departmentContactOption
      ? this.departmentWindowSeconds
      : this.normalWindowSeconds;
    const result = asRecord(
      await this.repository.getAutomationBatch(
        event.companyId,
        payload.conversationId,
        payload.eventId,
        windowSeconds,
      ),
    );
    const conversation = asAutomationConversation(result.conversation);
    const batch = asRecord(result.batch);
    const messages = Array.isArray(batch.messages)
      ? batch.messages.map(asBufferedMessage)
      : [];
    const pendingQuestion = nullableOptionalString(batch.pendingQuestion);
    if (messages.length === 0) {
      throw new WhatsAppAutomationExecutionError(
        'retryable-failure',
        'AUTOMATION_BATCH_EMPTY',
        'O lote durável ainda não está disponível.',
      );
    }
    const automaticMediaInterpretationPending =
      payload.automationAllowed === true &&
      payload.canGenerateReply === true &&
      payload.canSendReply === true &&
      messages.some(
        (message) =>
          message.kind !== 'text' &&
          (message.mediaInterpretationStatus === 'not-requested' ||
            message.mediaInterpretationStatus === 'pending'),
      );
    if (automaticMediaInterpretationPending) {
      throw new WhatsAppAutomationExecutionError(
        'retryable-failure',
        'MEDIA_INTERPRETATION_PENDING',
        'A interpretação durável da mídia ainda não foi concluída.',
      );
    }
    return { conversation, messages, pendingQuestion };
  }

  private async wasSupersededByHumanAction(
    error: unknown,
    event: ClaimedWhatsAppAutomationEvent,
    payload: AutomationPayload,
  ): Promise<boolean> {
    if (!(error instanceof AppError) || error.code !== 'CONFLICT') return false;
    const channel = await this.repository.findWebhookChannel(payload.channelId);
    if (channel?.agentsEnabled === false) return true;
    const current = asAutomationConversation(
      await this.repository.getConversation(
        event.companyId,
        payload.conversationId,
        { departments: null },
      ),
    );
    return (
      current.conversationState === 'human-active' ||
      current.conversationState === 'sent-to-human' ||
      current.conversationState === 'closed' ||
      current.flowStep === 'human-service'
    );
  }

  private async transition(
    event: ClaimedWhatsAppAutomationEvent,
    conversation: AutomationConversation,
    name: TransitionCommand['name'],
    plan: Pick<AutomationPlan, 'reason' | 'transitionMetadata'>,
    automaticHumanHandoff?: TransitionCommand['automaticHumanHandoff'],
  ): Promise<AutomationConversation> {
    const metadata: Record<string, unknown> = {
      ...(plan.transitionMetadata ?? {}),
      sourceEventId: event.correlationId,
      correlationId: event.correlationId,

      reason:
        stringValue(plan.transitionMetadata?.reason) ?? plan.reason ?? name,
    };
    const targetDepartment = departmentValue(metadata.targetDepartment);
    const result = await this.repository.transition({
      companyId: event.companyId,
      conversationId: conversation.id,
      commandId: deterministicCommandId(
        event.correlationId,
        `transition:${name}`,
      ),
      expectedVersion: conversation.version,
      name,
      actorType: 'system',
      ...(targetDepartment ? { targetDepartment } : {}),
      metadata,
      ...(automaticHumanHandoff ? { automaticHumanHandoff } : {}),
    });
    return asAutomationConversation(result);
  }

  private async patchQuoteFromAi(
    event: ClaimedWhatsAppAutomationEvent,
    conversation: AutomationConversation,
    aiMode: AiMode,
    output: AiProviderOutput,
  ): Promise<AutomationConversation> {
    const quote = conversation.currentQuoteRequest;
    if (!quote) {
      throw new WhatsAppAutomationExecutionError(
        'retryable-failure',
        'QUOTE_REQUEST_MISSING',
        'A coleta não possui uma solicitação de orçamento ativa.',
      );
    }
    const patch = quotePatch(output, aiMode);
    if (Object.keys(patch).length === 0) return conversation;
    const updatedQuote = asQuoteSnapshot(
      await this.commercialQuotes.patchQuoteRequest(event.companyId, quote.id, {
        ...patch,
        commandId: deterministicCommandId(event.correlationId, 'quote-patch'),
        expectedVersion: quote.version,
      }),
    );
    return { ...conversation, currentQuoteRequest: updatedQuote };
  }

  private async processRequestedOutbound(
    event: ClaimedWhatsAppAutomationEvent,
  ): Promise<void> {
    const payload = parseAutomationPayload(event.payload);
    const message = payload.message;
    let outboundInput: EvolutionOutboundInput;
    if (message.kind === 'text' && message.text?.trim()) {
      outboundInput = {
        kind: 'text',
        recipientPhone: payload.contact.phone,
        text: message.text,
      };
    } else if (message.kind === 'document') {
      const media = asRecord(message.media);
      if (typeof media.storageKey === 'string' && media.storageKey) {
        outboundInput = await this.storedOutboundMedia(
          payload.contact.phone,
          'document',
          media,
          message.text,
        );
      } else {
        const documentId = requiredString(media.documentId, 'documentId');
        const document = asRecord(
          await this.commercialQuotes.getQuoteProposalDocument(
            event.companyId,
            documentId,
          ),
        );
        outboundInput = {
          kind: 'document',
          recipientPhone: payload.contact.phone,
          fileName: requiredString(document.fileName, 'fileName'),
          mimeType: requiredString(document.mimeType, 'mimeType'),
          content: bufferValue(document.content),
          ...(message.text?.trim() ? { caption: message.text } : {}),
        };
      }
    } else if (
      message.kind === 'image' ||
      message.kind === 'video' ||
      message.kind === 'audio' ||
      message.kind === 'contact' ||
      message.kind === 'sticker'
    ) {
      const media = asRecord(message.media);
      if (message.kind === 'sticker') {
        const storageKey = requiredString(media.storageKey, 'storageKey');
        outboundInput = {
          kind: 'sticker',
          recipientPhone: payload.contact.phone,
          fileName: requiredString(media.fileName, 'fileName'),
          mimeType: 'image/webp',
          content: await this.mediaStorage.read(storageKey),
        };
      } else {
        outboundInput = await this.storedOutboundMedia(
          payload.contact.phone,
          message.kind === 'contact' ? 'document' : message.kind,
          media,
          message.text,
        );
      }
    } else {
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        'OUTBOUND_KIND_UNSUPPORTED',
        'O tipo de mensagem não pode ser enviado por este adaptador.',
      );
    }
    await this.deliverPersistedMessage(event, {
      messageId: payload.messageId,
      attemptId: requiredString(payload.attemptId, 'attemptId'),
      ...(payload.dispatchGeneration
        ? { dispatchGeneration: payload.dispatchGeneration }
        : {}),
      recipientPhone: payload.contact.phone,
      sourceChannelId: payload.channelId,
      input: outboundInput,
    });
  }

  private async storedOutboundMedia(
    recipientPhone: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    media: Readonly<Record<string, unknown>>,
    caption: string | null,
  ): Promise<Extract<EvolutionOutboundInput, { kind: 'media' }>> {
    const storageKey = requiredString(media.storageKey, 'storageKey');
    return {
      kind: 'media',
      recipientPhone,
      mediaType,
      fileName: requiredString(media.fileName, 'fileName'),
      mimeType: requiredString(media.mimeType, 'mimeType'),
      content: await this.mediaStorage.read(storageKey),
      ...(caption?.trim() ? { caption } : {}),
    };
  }

  private async deliverPersistedMessage(
    event: ClaimedWhatsAppAutomationEvent,
    outbound: {
      messageId: string;
      attemptId: string;
      dispatchGeneration?: string;
      recipientPhone: string;
      sourceChannelId?: string;
      input: EvolutionOutboundInput;
    },
  ): Promise<void> {
    const dispatchOwnerId = deterministicCommandId(
      event.id,
      'api-evolution-owner',
    );
    const dispatchGeneration = outbound.dispatchGeneration ?? 'initial';
    const claim = asRecord(
      await this.repository.claimEvolutionDispatch({
        companyId: event.companyId,
        messageId: outbound.messageId,
        attemptId: outbound.attemptId,
        commandId: deterministicCommandId(
          event.correlationId,
          `evolution-claim:${outbound.messageId}:${dispatchGeneration}`,
        ),
        ownerId: dispatchOwnerId,
      }),
    );
    if (claim.shouldSend !== true) {
      const state = stringValue(claim.state) ?? 'unknown';
      if (state === 'succeeded') return;
      if (state === 'failed') {
        throw new WhatsAppAutomationExecutionError(
          'terminal-failure',
          'EVOLUTION_PREVIOUSLY_FAILED',
          'A tentativa de envio já foi concluída com falha.',
        );
      }
      if (claim.requiresReconciliation === true || state === 'unknown') {
        throw new WhatsAppAutomationExecutionError(
          'terminal-failure',
          'EVOLUTION_RECONCILIATION_REQUIRED',
          'O resultado do envio precisa de reconciliação antes de nova tentativa.',
        );
      }
      throw new WhatsAppAutomationExecutionError(
        'retryable-failure',
        'EVOLUTION_DISPATCH_LEASED',
        'A tentativa de envio ainda possui uma concessão ativa.',
      );
    }

    const claimedChannelId = stringValue(claim.sourceChannelId);
    const sourceChannelId = claimedChannelId ?? outbound.sourceChannelId;
    const instanceName = stringValue(claim.instanceName);
    const routedInput = {
      ...outbound.input,
      ...(sourceChannelId ? { sourceChannelId } : {}),
      ...(instanceName ? { instanceName } : {}),
    };
    const result = await this.evolution.send(routedInput);
    if (result.outcome === 'ambiguous') {
      await this.repository.markEvolutionDispatchUnknown({
        companyId: event.companyId,
        messageId: outbound.messageId,
        attemptId: outbound.attemptId,
        ownerId: dispatchOwnerId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        'EVOLUTION_RECONCILIATION_REQUIRED',
        result.errorMessage,
      );
    }

    if (result.outcome === 'not-sent') {
      await this.repository.recordEvolutionResult({
        companyId: event.companyId,
        messageId: outbound.messageId,
        attemptId: outbound.attemptId,
        commandId: deterministicCommandId(
          event.correlationId,
          `evolution-result:${outbound.messageId}:${dispatchGeneration}`,
        ),
        status: 'failed',
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      throw new WhatsAppAutomationExecutionError(
        'terminal-failure',
        result.errorCode,
        result.errorMessage,
      );
    }

    const confirmedResult = {
      companyId: event.companyId,
      messageId: outbound.messageId,
      attemptId: outbound.attemptId,
      commandId: deterministicCommandId(
        event.correlationId,
        `evolution-result:${outbound.messageId}:${dispatchGeneration}`,
      ),
      status: result.deliveryStatus,
      ...(result.providerMessageId
        ? { providerMessageId: result.providerMessageId }
        : {}),
    } as const;
    for (
      let attempt = 0;
      attempt < EVOLUTION_RESULT_PERSISTENCE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await this.repository.recordEvolutionResult(confirmedResult);
        return;
      } catch {
        // A mesma commandId torna a repetição local idempotente.
      }
    }

    try {
      await this.repository.markEvolutionDispatchUnknown({
        companyId: event.companyId,
        messageId: outbound.messageId,
        attemptId: outbound.attemptId,
        ownerId: dispatchOwnerId,
        errorCode: 'EVOLUTION_RESULT_PERSISTENCE_FAILED',
        errorMessage:
          'A Evolution confirmou o envio, mas o resultado não pôde ser persistido.',
      });
    } catch {
      // Best effort: a falha terminal mantém o evento preso ao provider da API.
    }
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'EVOLUTION_RECONCILIATION_REQUIRED',
      'O envio foi confirmado, mas o resultado precisa de reconciliação antes de qualquer nova tentativa.',
    );
  }

  private complete(
    event: ClaimedWhatsAppAutomationEvent,
    outcome: 'succeeded' | 'retryable-failure' | 'terminal-failure',
    consumedSourceEventIds?: string[],
  ): Promise<unknown> {
    return this.repository.completeOutboxExecution({
      companyId: event.companyId,
      eventId: event.id,
      commandId: deterministicCommandId(event.executionId, 'completion'),
      executionId: event.executionId,
      automationProvider: 'api',
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      outcome,
      ...(consumedSourceEventIds && consumedSourceEventIds.length > 0
        ? { consumedSourceEventIds: [...new Set(consumedSourceEventIds)] }
        : {}),
    });
  }
}

function parseAutomationPayload(value: unknown): AutomationPayload {
  const payload = asRecord(value);
  const contact = asRecord(payload.contact);
  const message = asRecord(payload.message);
  const messageKind = requiredString(message.kind, 'message.kind');
  if (!MESSAGE_KINDS.includes(messageKind as MessageKind)) {
    throw contractInvalid('message.kind');
  }
  const direction = requiredString(message.direction, 'message.direction');
  if (direction !== 'inbound' && direction !== 'outbound') {
    throw contractInvalid('message.direction');
  }
  const deliveryStatus = requiredString(
    message.deliveryStatus,
    'message.deliveryStatus',
  );
  if (deliveryStatus !== 'received' && deliveryStatus !== 'pending') {
    throw contractInvalid('message.deliveryStatus');
  }
  const occurredAt = requiredString(message.occurredAt, 'message.occurredAt');
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw contractInvalid('message.occurredAt');
  }
  const rawText = message.text;
  if (rawText !== null && typeof rawText !== 'string') {
    throw contractInvalid('message.text');
  }
  const rawMedia = message.media;
  if (
    rawMedia !== null &&
    (typeof rawMedia !== 'object' || Array.isArray(rawMedia))
  ) {
    throw contractInvalid('message.media');
  }
  return {
    eventId: requiredString(payload.eventId, 'eventId'),
    messageId: requiredUuid(payload.messageId, 'messageId'),
    ...(payload.attemptId === undefined
      ? {}
      : { attemptId: requiredUuid(payload.attemptId, 'attemptId') }),
    ...(payload.dispatchGeneration === undefined
      ? {}
      : {
          dispatchGeneration: requiredUuid(
            payload.dispatchGeneration,
            'dispatchGeneration',
          ),
        }),
    conversationId: requiredUuid(payload.conversationId, 'conversationId'),
    channelId: requiredUuid(payload.channelId, 'channelId'),
    companyId: requiredUuid(payload.companyId, 'companyId'),
    contact: {
      id: requiredUuid(contact.id, 'contact.id'),
      phone: requiredPhone(contact.phone, 'contact.phone'),
      displayName: nullableString(contact.displayName, 'contact.displayName'),
    },
    message: {
      providerMessageId: nullableString(
        message.providerMessageId,
        'message.providerMessageId',
      ),
      kind: messageKind as MessageKind,
      direction,
      deliveryStatus,
      text: rawText,
      media: rawMedia === null ? null : asRecord(rawMedia),
      occurredAt,
    },
    conversation: asAutomationConversation(payload.conversation),
    automationAllowed: requiredBoolean(
      payload.automationAllowed,
      'automationAllowed',
    ),
    canGenerateReply: requiredBoolean(
      payload.canGenerateReply,
      'canGenerateReply',
    ),
    canSendReply: requiredBoolean(payload.canSendReply, 'canSendReply'),
    contextualTransition: requiredBoolean(
      payload.contextualTransition,
      'contextualTransition',
    ),
    isFirstContact: requiredBoolean(payload.isFirstContact, 'isFirstContact'),
    reopenedAfterClosure: payload.reopenedAfterClosure === true,
    ...(payload.automatic === undefined
      ? {}
      : { automatic: requiredBoolean(payload.automatic, 'automatic') }),
  };
}

function assertEnvelopeIdentity(
  event: ClaimedWhatsAppAutomationEvent,
  payload: AutomationPayload,
): void {
  requiredUuid(event.id, 'envelope.id');
  requiredUuid(event.executionId, 'envelope.executionId');
  const inbound = event.topic !== 'whatsapp.outbound.requested';
  const invalidIdentity =
    !Number.isInteger(event.aggregateSequence) ||
    event.aggregateSequence < 1 ||
    !event.correlationId.trim() ||
    Number.isNaN(event.createdAt.valueOf()) ||
    event.aggregateType !== 'whatsapp-conversation' ||
    event.aggregateId !== payload.conversationId ||
    event.companyId !== payload.companyId ||
    payload.conversation.id !== payload.conversationId;
  const invalidDirection = inbound
    ? payload.message.direction !== 'inbound' ||
      payload.message.deliveryStatus !== 'received' ||
      payload.attemptId !== undefined ||
      payload.dispatchGeneration !== undefined ||
      payload.automatic !== undefined ||
      payload.message.providerMessageId === null
    : payload.message.direction !== 'outbound' ||
      payload.message.deliveryStatus !== 'pending' ||
      !payload.attemptId ||
      payload.automatic === undefined ||
      payload.message.providerMessageId !== null ||
      payload.automationAllowed ||
      payload.canGenerateReply ||
      !payload.canSendReply;
  const invalidTopicFlags =
    (event.topic === 'whatsapp.inbound.human-notification' &&
      (payload.automationAllowed ||
        payload.canGenerateReply ||
        payload.canSendReply)) ||
    (event.topic === 'whatsapp.inbound.persisted' &&
      payload.message.kind === 'text' &&
      (!payload.automationAllowed ||
        !payload.canGenerateReply ||
        !payload.canSendReply));
  const invalidContent = inbound
    ? payload.message.kind === 'text' && !payload.message.text?.trim()
    : !isValidOutboundContent(payload.message);
  if (
    invalidIdentity ||
    invalidDirection ||
    invalidTopicFlags ||
    invalidContent
  ) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATION_ENVELOPE_INVALID',
      'O envelope do evento de automação é inconsistente.',
    );
  }
}

function toDomainEnvelope(
  event: ClaimedWhatsAppAutomationEvent,
  payload: AutomationPayload,
): DomainAutomationEnvelope {
  const envelope = buildWhatsAppAutomationEnvelope(event);
  return {
    ...envelope,
    aggregateType: 'whatsapp-conversation',
    payload,
  };
}

function asAutomationConversation(value: unknown): AutomationConversation {
  const row = asRecord(value);
  const department = requiredString(row.department, 'conversation.department');
  const conversationState = requiredString(
    row.conversationState,
    'conversation.conversationState',
  );
  const flowStep = requiredString(row.flowStep, 'conversation.flowStep');
  const requestStatus = requiredString(
    row.requestStatus,
    'conversation.requestStatus',
  );
  if (!DEPARTMENTS.includes(department as Department)) {
    throw contractInvalid('conversation.department');
  }
  if (!CONVERSATION_STATES.includes(conversationState as never)) {
    throw contractInvalid('conversation.conversationState');
  }
  if (!FLOW_STEPS.includes(flowStep as never)) {
    throw contractInvalid('conversation.flowStep');
  }
  if (!isQuoteRequestStatus(requestStatus)) {
    throw contractInvalid('conversation.requestStatus');
  }
  const resumeState = nullableString(
    row.resumeState,
    'conversation.resumeState',
  );
  if (
    resumeState !== null &&
    !CONVERSATION_STATES.includes(resumeState as never)
  ) {
    throw contractInvalid('conversation.resumeState');
  }
  return {
    ...row,
    id: requiredUuid(row.id, 'conversation.id'),
    department: department as Department,
    conversationState:
      conversationState as AutomationConversation['conversationState'],
    flowStep: flowStep as AutomationConversation['flowStep'],
    requestStatus,
    resumeState: resumeState as AutomationConversation['resumeState'],
    version: integerValue(row.version, 'conversation.version'),
    currentQuoteRequest: row.currentQuoteRequest
      ? asQuoteSnapshot(row.currentQuoteRequest)
      : null,
  };
}

function asQuoteSnapshot(value: unknown): QuoteRequestSnapshot {
  const row = asRecord(value);
  const status = requiredString(row.status, 'quote.status');
  if (!isQuoteRequestStatus(status)) {
    throw contractInvalid('quote.status');
  }
  return {
    ...row,
    id: requiredUuid(row.id, 'quote.id'),
    sequence: integerValue(row.sequence, 'quote.sequence'),
    status,
    version: integerValue(row.version, 'quote.version'),
  };
}

function asBufferedMessage(value: unknown): BufferedMessage {
  const row = asRecord(value);
  const kind = requiredString(row.kind, 'kind');
  const occurredAt = requiredString(row.occurredAt, 'occurredAt');
  if (!MESSAGE_KINDS.includes(kind as MessageKind)) {
    throw contractInvalid('kind');
  }
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw contractInvalid('occurredAt');
  }
  const rawMediaStatus = row.mediaInterpretationStatus;
  if (
    rawMediaStatus !== undefined &&
    !MEDIA_INTERPRETATION_STATUSES.includes(rawMediaStatus as never)
  ) {
    throw contractInvalid('mediaInterpretationStatus');
  }
  const rawInterpretationSource = row.interpretationSource;
  if (
    rawInterpretationSource !== undefined &&
    !MEDIA_INTERPRETATION_SOURCES.includes(rawInterpretationSource as never)
  ) {
    throw contractInvalid('interpretationSource');
  }
  const rawInterpretationId = row.mediaInterpretationId;
  const mediaInterpretationId =
    rawInterpretationId === undefined || rawInterpretationId === null
      ? null
      : requiredUuid(rawInterpretationId, 'mediaInterpretationId');
  return {
    sourceEventId: requiredString(row.sourceEventId, 'sourceEventId'),
    messageId: requiredUuid(row.messageId, 'messageId'),
    occurredAt,
    kind,
    text: typeof row.text === 'string' ? row.text : null,
    ...(rawMediaStatus === undefined
      ? {}
      : {
          mediaInterpretationStatus:
            rawMediaStatus as BufferedMessage['mediaInterpretationStatus'],
        }),
    interpretedText:
      typeof row.interpretedText === 'string' ? row.interpretedText : null,
    ...(rawInterpretationSource === undefined
      ? {}
      : {
          interpretationSource:
            rawInterpretationSource as BufferedMessage['interpretationSource'],
        }),
    mediaInterpretationId,
    isFirstContact: row.isFirstContact === true,
  };
}

function parseOutboundMessage(
  value: Record<string, unknown>,
  fallbackPhone: string,
) {
  const attempts = Array.isArray(value.attempts) ? value.attempts : [];
  const attempt = asRecord(attempts[0]);
  const recipientPhone = stringValue(value.recipientPhone) ?? fallbackPhone;
  const kind = requiredString(value.kind, 'outbound.kind');
  if (kind !== 'text') {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATIC_OUTBOUND_KIND_INVALID',
      'A resposta automática precisa ser textual.',
    );
  }
  return {
    messageId: requiredString(value.id, 'outbound.id'),
    attemptId: requiredString(attempt.id, 'outbound.attemptId'),
    recipientPhone,
    input: {
      kind: 'text' as const,
      recipientPhone,
      text: requiredString(value.text, 'outbound.text'),
    },
  };
}

function quotePatch(
  output: AiProviderOutput,
  aiMode: AiMode,
): Partial<QuoteRequestPatch> {
  const source = asRecord(output.extractedDataPatch);
  const patch: Partial<QuoteRequestPatch> = {};
  for (const key of [
    'contactName',
    'document',
    'email',
    'serviceType',
    'origin',
    'destination',
    'vehicleType',
    'notes',
  ] as const) {
    const value = source[key];
    if (typeof value === 'string' || value === null) patch[key] = value;
  }
  if (aiMode === 'eventual-quote') patch.serviceType = 'eventual';
  if (aiMode === 'continuous-pretriage') patch.serviceType = 'continuous';
  if (
    typeof source.passengerCount === 'number' &&
    Number.isInteger(source.passengerCount)
  ) {
    patch.passengerCount = source.passengerCount;
  }
  for (const key of ['vehicleAtDisposal', 'localTransfers'] as const) {
    const value = source[key];
    if (typeof value === 'boolean' || value === null) patch[key] = value;
  }
  applySchedulePatch(patch, source, 'departure');
  applySchedulePatch(patch, source, 'return');
  const structuredData = optionalRecord(source.structuredData);
  patch.structuredData = {
    ...structuredData,
    quoteMode: aiMode,
    missingFields: output.missingFields,
    collectionStatus: output.collectionStatus,
  };
  return patch;
}

const SCHEDULE_FIELD_KEYS: Readonly<
  Record<
    'departure' | 'return',
    {
      instantKey: 'departureAt' | 'returnAt';
      dateKey: 'departureDate' | 'returnDate';
    }
  >
> = {
  departure: {
    instantKey: 'departureAt',
    dateKey: 'departureDate',
  },
  return: {
    instantKey: 'returnAt',
    dateKey: 'returnDate',
  },
};

function applySchedulePatch(
  patch: Partial<QuoteRequestPatch>,
  source: Record<string, unknown>,
  field: 'departure' | 'return',
): void {
  const { instantKey, dateKey } = SCHEDULE_FIELD_KEYS[field];
  const value = source[instantKey];
  if (value === null) {
    patch[instantKey] = null;
    patch[dateKey] = null;
    return;
  }
  if (typeof value !== 'string' || !value.trim()) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    patch[dateKey] = parseDateOnly(value, instantKey);
    patch[instantKey] = null;
    return;
  }
  let date: Date;
  try {
    date = parseBusinessDateTime(value, instantKey);
  } catch {
    throw new WhatsAppAutomationExecutionError(
      'retryable-failure',
      'AI_DATE_INVALID',
      `A IA retornou uma data inválida para ${instantKey}.`,
    );
  }
  patch[instantKey] = date;
  patch[dateKey] = dateOnlyFromDateTime(date);
}

function assertSafeAiDecision(
  output: AiProviderOutput,
  aiMode: AiMode,
  userMessage: string,
): void {
  if (
    aiMode !== 'natural-service' &&
    output.customerDecision === 'confirmed' &&
    (aiMode !== 'quote-correction-or-confirmation' ||
      !isExplicitPositiveConfirmation(userMessage))
  ) {
    throw new WhatsAppAutomationExecutionError(
      'retryable-failure',
      'AI_CONFIRMATION_NOT_EXPLICIT',
      'A confirmação do cliente não foi inequívoca.',
    );
  }
}

function assertMinimumQuoteComplete(
  quote: QuoteRequestSnapshot | null | undefined,
): void {
  const structured = optionalRecord(quote?.structuredData);
  const tripType = stringValue(structured.tripType);
  const missing = [
    !quote?.contactName && 'contactName',
    !quote?.serviceType && 'serviceType',
    !tripType && 'tripType',
    !quote?.origin && 'origin',
    !quote?.destination && 'destination',
    !quote?.departureDate && !quote?.departureAt && 'departureAt',
    tripType === 'round_trip' &&
      !quote?.returnDate &&
      !quote?.returnAt &&
      'returnAt',
    (!quote?.passengerCount || quote.passengerCount < 1) && 'passengerCount',
    !quote?.vehicleType && 'vehicleType',
    typeof quote?.vehicleAtDisposal !== 'boolean' && 'vehicleAtDisposal',
    typeof quote?.localTransfers !== 'boolean' && 'localTransfers',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new WhatsAppAutomationExecutionError(
      'retryable-failure',
      'AI_QUOTE_INCOMPLETE',
      `O resumo ainda não possui: ${missing.join(', ')}.`,
    );
  }
}

function departmentValue(value: unknown): Department | undefined {
  return typeof value === 'string' && DEPARTMENTS.includes(value as Department)
    ? (value as Department)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATION_CONTRACT_INVALID',
      'O contrato do evento de automação é inválido.',
    );
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isValidOutboundContent(
  message: AutomationPayload['message'],
): boolean {
  if (message.kind === 'text') {
    return Boolean(message.text?.trim()) && message.media === null;
  }
  if (message.kind !== 'document' || !message.media) return false;

  requiredUuid(message.media.documentId, 'message.media.documentId');
  const fileName = requiredString(
    message.media.fileName,
    'message.media.fileName',
  );
  const mimeType = requiredString(
    message.media.mimetype,
    'message.media.mimetype',
  );
  const sha256 = requiredString(message.media.sha256, 'message.media.sha256');
  return (
    fileName.toLowerCase().endsWith('.pdf') &&
    mimeType === 'application/pdf' &&
    Number.isSafeInteger(message.media.sizeBytes) &&
    Number(message.media.sizeBytes) > 0 &&
    /^[0-9a-f]{64}$/i.test(sha256)
  );
}

function contractInvalid(field: string): WhatsAppAutomationExecutionError {
  return new WhatsAppAutomationExecutionError(
    'terminal-failure',
    'AUTOMATION_CONTRACT_INVALID',
    `O campo ${field} não atende ao contrato esperado.`,
  );
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw contractInvalid(field);
  return value;
}

function requiredPhone(value: unknown, field: string): string {
  const phone = requiredString(value, field).replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(phone)) throw contractInvalid(field);
  return phone;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw contractInvalid(field);
  }
  return value.trim();
}

function nullableOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATION_CONTRACT_INVALID',
      `O campo ${field} não foi informado.`,
    );
  }
  return value.trim();
}

function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATION_CONTRACT_INVALID',
      `O campo ${field} não é um UUID válido.`,
    );
  }
  return normalized;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'AUTOMATION_CONTRACT_INVALID',
      `O campo ${field} não é um inteiro.`,
    );
  }
  return value as number;
}

function bufferValue(value: unknown): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new WhatsAppAutomationExecutionError(
      'terminal-failure',
      'PROPOSAL_DOCUMENT_INVALID',
      'O conteúdo do documento não está disponível.',
    );
  }
  return value;
}
