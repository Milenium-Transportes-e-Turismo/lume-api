import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CommercialQuoteRepository,
  type CreateQuoteProposalInput,
  type DecideQuoteProposalInput,
  type QuoteProposalListQuery,
  type QuoteRequestPatch,
  type SendQuoteProposalInput,
  type UpdateQuoteProposalStatusInput,
  type UploadQuoteProposalDocumentInput,
} from '../../../application/contracts/commercial-quote.repository';
import {
  WhatsAppRepository,
  type ApplyContinuityClassificationInput,
  type ApplyContinuityClassificationResult,
  type ClaimEvolutionDispatchInput,
  type CompleteOutboxExecutionInput,
  type ContinuityClassificationCandidate,
  type ConversationAccessScope,
  type ConversationListQuery,
  type CreateHumanOutboundInput,
  type CreateOutboundInput,
  type EvolutionResultInput,
  type EnsureWhatsAppConversationResult,
  type MarkEvolutionDispatchUnknownInput,
  type MessageListQuery,
  type PersistWebhookMessageInput,
  type PersistWebhookMessageResult,
  type PersistWebhookGroupMessageInput,
  type PersistWebhookGroupMessageResult,
  type ProcessServiceSessionLifecycleInput,
  type ProcessServiceSessionLifecycleResult,
  type ReconcileAutomationOutboxInput,
  type SyncWebhookGroupInput,
  type StartHumanWhatsAppConversationInput,
  type TransitionCommand,
  type TransitionListQuery,
  type WebhookChannelConfiguration,
} from '../../../application/contracts/whatsapp.repository';
import {
  AppError,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  isPermissionCode,
  type Department,
  type SupportedUserDepartment,
} from '../../../domain/access/access.constants';
import { resolveEffectivePermissions } from '../../../domain/access/resolve-permissions';
import {
  canExercisePermission,
  hasTenantWideAuthority,
} from '../../../domain/access/tenant-authority';
import {
  assertManualQuoteCancellationTransition,
  normalizeManualQuoteCancellation,
  type CommercialClosureClassification as CanonicalCommercialClosureClassification,
} from '../../../domain/commercial/quote-closure';
import type { QuoteRequestStatus as CanonicalRequestStatus } from '../../../domain/commercial/quote-status';
import {
  buildConversationClosureMessage,
  buildDepartmentContactClosureMessage,
} from '../../../domain/whatsapp/conversation-closure-message';
import {
  isHumanServiceOpen,
  parseHumanServiceHours,
} from '../../../domain/whatsapp/human-service-hours';
import {
  assertTransitionActor,
  resolveConversationTransition,
} from '../../../domain/whatsapp/conversation-transition.matrix';
import { validateQuoteProposalPdf } from '../../../domain/commercial/quote-proposal-pdf';
import {
  AI_CLOSING_WAIT_MS,
  LUME_AI_CLOSING_QUESTION,
  createPublicContinuationCode,
  decideServiceContinuity,
  formatAiClosureMessage,
  parsePublicContinuationCommand,
  publicContinuationCodeExpiresAt,
  type ServicePriority,
  type ServiceSessionStatus as DomainServiceSessionStatus,
} from '../../../domain/whatsapp/service-session';
import {
  selectPriorityResumeCandidate,
  type PausedPriorityCandidate,
} from '../../../domain/whatsapp/service-priority-coordination';
import { effectiveMediaInterpretation } from '../../../domain/whatsapp/media-interpretation-policy';
import {
  assertQuoteScheduleConsistency,
  dateOnlyFromDateTime,
  presentDateOnly,
} from '../../../domain/commercial/quote-schedule';
import { deterministicCommandId } from '../../../domain/whatsapp/whatsapp-automation-flow';
import type {
  ConversationSnapshot,
  ConversationState as CanonicalConversationState,
  DeliveryStatus as CanonicalDeliveryStatus,
  FlowStep as CanonicalFlowStep,
  MessageKind as CanonicalMessageKind,
} from '../../../domain/whatsapp/whatsapp.constants';
import { UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT } from '../../../domain/whatsapp/whatsapp.constants';
import { sanitizeLogText } from '../../../shared/utils/sensitive-data';
import { formatWhatsAppPhone } from '../../../shared/utils/normalization';
import {
  AgentExecutionStatus,
  CommercialClosureClassification,
  ConversationState,
  ConversationParticipantRole,
  ContinuityClassification,
  ContinuityFallbackAction,
  DeliveryStatus,
  DepartmentCode,
  DocumentAccessMode,
  EvolutionDispatchState,
  FlowStep,
  IntegrationOutboxStatus,
  MediaAssetType,
  MediaProcessingStatus,
  MessageAttemptStatus,
  MessageDirection,
  MessageKind,
  MutationActorType,
  QuoteProposalDocumentStatus,
  RequestStatus,
  ServiceAssignmentSource,
  ServiceAssignmentStatus,
  ServiceSessionControlMode,
  ServiceSessionPriority,
  ServiceSessionPrioritySource,
  ServiceSessionStatus,
  TransitionActorType,
  UserAccountStatus,
  WhatsAppAutomationExecutionStatus,
  WhatsAppAutomationProvider,
  WhatsAppGroupAiMode,
  WhatsAppMessageActorType,
  WhatsAppMessageSource,
  type Prisma,
} from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

const LEGACY_AUTOMATION_RECONCILIATION_REQUIRED =
  'LEGACY_AUTOMATION_RECONCILIATION_REQUIRED' as const;

const departmentToPrisma: Readonly<Record<Department, DepartmentCode>> = {
  'client-company': DepartmentCode.CLIENT_COMPANY,
  'human-resources': DepartmentCode.HUMAN_RESOURCES,
  'personnel-department': DepartmentCode.PERSONNEL_DEPARTMENT,
  commercial: DepartmentCode.COMMERCIAL,
  purchasing: DepartmentCode.PURCHASING,
  controlling: DepartmentCode.CONTROLLING,
  maintenance: DepartmentCode.MAINTENANCE,
  monitoring: DepartmentCode.MONITORING,
  management: DepartmentCode.MANAGEMENT,
  directorate: DepartmentCode.DIRECTORATE,
  operations: DepartmentCode.OPERATIONS,
  cleaning: DepartmentCode.CLEANING,
  financial: DepartmentCode.FINANCIAL,
  'information-technology': DepartmentCode.INFORMATION_TECHNOLOGY,
};

const departmentFromPrisma: Readonly<Record<DepartmentCode, Department>> = {
  CLIENT_COMPANY: 'client-company',
  HUMAN_RESOURCES: 'human-resources',
  PERSONNEL_DEPARTMENT: 'personnel-department',
  COMMERCIAL: 'commercial',
  PURCHASING: 'purchasing',
  CONTROLLING: 'controlling',
  MAINTENANCE: 'maintenance',
  MONITORING: 'monitoring',
  MANAGEMENT: 'management',
  DIRECTORATE: 'directorate',
  OPERATIONS: 'operations',
  CLEANING: 'cleaning',
  FINANCIAL: 'financial',
  INFORMATION_TECHNOLOGY: 'information-technology',
};

function userBelongsToDepartment(
  departments: readonly string[],
  department: Department,
): boolean {
  return departments.some(
    (assignedDepartment) =>
      assignedDepartment === department ||
      (assignedDepartment === 'controllership' && department === 'controlling'),
  );
}

function internalActorDepartments(
  departments: readonly string[],
): Department[] {
  return Array.from(
    new Set(
      departments
        .map((department) =>
          department === 'controllership' ? 'controlling' : department,
        )
        .filter(
          (department): department is Department =>
            department !== 'client-company' &&
            Object.prototype.hasOwnProperty.call(
              departmentToPrisma,
              department,
            ),
        ),
    ),
  );
}

function resolveInitialConversationDepartment(
  actor: {
    readonly departments: readonly string[];
    readonly hasTenantWideAuthority: boolean;
  },
  targetDepartment?: Department,
): Department {
  if (targetDepartment === 'client-company') {
    throw validationError(
      'Empresa cliente não pode ser a fila inicial de um atendimento interno.',
    );
  }
  if (targetDepartment) {
    if (
      !actor.hasTenantWideAuthority &&
      !userBelongsToDepartment(actor.departments, targetDepartment)
    ) {
      throw forbidden(
        'A fila inicial deve pertencer a um departamento atribuído ao atendente.',
      );
    }
    return targetDepartment;
  }

  const departments = internalActorDepartments(actor.departments);
  if (departments.length === 1) return departments[0];
  if (departments.length > 1) {
    throw validationError(
      'Informe a fila inicial porque o atendente pertence a mais de um departamento.',
    );
  }
  throw validationError(
    'Informe a fila interna inicial para este atendimento.',
  );
}

function conversationDepartmentWhere(
  scope: ConversationAccessScope,
): Prisma.WhatsAppConversationWhereInput {
  if (scope.departments === null) return {};

  const departments = Array.from(
    new Set(
      scope.departments.map((department) => departmentToPrisma[department]),
    ),
  );
  return {
    OR: [
      { department: { in: departments } },
      { pendingTransferDepartment: { in: departments } },
    ],
  };
}

const departmentContactLabels: Readonly<Partial<Record<Department, string>>> = {
  purchasing: 'Compras (Fornecedores)',
  controlling: 'Controladoria',
  'personnel-department': 'Departamento Pessoal',
  financial: 'Financeiro',
  management: 'Gerência',
  maintenance: 'Manutenção',
  monitoring: 'Monitoramento',
  operations: 'Operacional',
};

const stateToPrisma: Readonly<
  Record<CanonicalConversationState, ConversationState>
> = {
  'bot-active': ConversationState.BOT_ACTIVE,
  'waiting-for-customer': ConversationState.WAITING_FOR_CUSTOMER,
  'sent-to-human': ConversationState.SENT_TO_HUMAN,
  'human-active': ConversationState.HUMAN_ACTIVE,
  closed: ConversationState.CLOSED,
};

const stateFromPrisma: Readonly<
  Record<ConversationState, CanonicalConversationState>
> = {
  BOT_ACTIVE: 'bot-active',
  WAITING_FOR_CUSTOMER: 'waiting-for-customer',
  SENT_TO_HUMAN: 'sent-to-human',
  HUMAN_ACTIVE: 'human-active',
  CLOSED: 'closed',
};

const flowToPrisma: Readonly<Record<CanonicalFlowStep, FlowStep>> = {
  'main-menu': FlowStep.MAIN_MENU,
  'commercial-menu': FlowStep.COMMERCIAL_MENU,
  'quote-data-collection': FlowStep.QUOTE_DATA_COLLECTION,
  'quote-summary-confirmation': FlowStep.QUOTE_SUMMARY_CONFIRMATION,
  'quote-send-pending': FlowStep.QUOTE_SEND_PENDING,
  'commercial-follow-up-menu': FlowStep.COMMERCIAL_FOLLOW_UP_MENU,
  'human-service': FlowStep.HUMAN_SERVICE,
  closed: FlowStep.CLOSED,
};

const flowFromPrisma: Readonly<Record<FlowStep, CanonicalFlowStep>> = {
  MAIN_MENU: 'main-menu',
  COMMERCIAL_MENU: 'commercial-menu',
  QUOTE_DATA_COLLECTION: 'quote-data-collection',
  QUOTE_SUMMARY_CONFIRMATION: 'quote-summary-confirmation',
  QUOTE_SEND_PENDING: 'quote-send-pending',
  COMMERCIAL_FOLLOW_UP_MENU: 'commercial-follow-up-menu',
  HUMAN_SERVICE: 'human-service',
  CLOSED: 'closed',
};

const requestToPrisma: Readonly<Record<CanonicalRequestStatus, RequestStatus>> =
  {
    'not-started': RequestStatus.NOT_STARTED,
    'collecting-information': RequestStatus.COLLECTING_INFORMATION,
    'waiting-for-customer': RequestStatus.WAITING_FOR_CUSTOMER,
    'under-review': RequestStatus.UNDER_REVIEW,
    approved: RequestStatus.APPROVED,
    rejected: RequestStatus.REJECTED,
    cancelled: RequestStatus.CANCELLED,
  };

const requestFromPrisma: Readonly<
  Record<RequestStatus, CanonicalRequestStatus>
> = {
  NOT_STARTED: 'not-started',
  COLLECTING_INFORMATION: 'collecting-information',
  WAITING_FOR_CUSTOMER: 'waiting-for-customer',
  UNDER_REVIEW: 'under-review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

const servicePriorityToPrisma: Readonly<
  Record<
    NonNullable<CreateOutboundInput['sessionPriority']>['priority'],
    ServiceSessionPriority
  >
> = {
  low: ServiceSessionPriority.LOW,
  normal: ServiceSessionPriority.NORMAL,
  high: ServiceSessionPriority.HIGH,
  urgent: ServiceSessionPriority.URGENT,
};

const servicePriorityFromPrisma: Readonly<
  Record<ServiceSessionPriority, ServicePriority>
> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

type RestorablePrioritySessionStatus = Exclude<
  DomainServiceSessionStatus,
  'paused-by-higher-priority' | 'closing' | 'closed'
>;

const priorityResumeStatusToPrisma: Readonly<
  Record<RestorablePrioritySessionStatus, ServiceSessionStatus>
> = {
  open: ServiceSessionStatus.OPEN,
  'waiting-customer': ServiceSessionStatus.WAITING_CUSTOMER,
  'waiting-human': ServiceSessionStatus.WAITING_HUMAN,
};

function restorablePriorityStatus(
  value: unknown,
): RestorablePrioritySessionStatus | null {
  switch (value) {
    case 'open':
    case ServiceSessionStatus.OPEN:
      return 'open';
    case 'waiting-customer':
    case ServiceSessionStatus.WAITING_CUSTOMER:
      return 'waiting-customer';
    case 'waiting-human':
    case ServiceSessionStatus.WAITING_HUMAN:
      return 'waiting-human';
    default:
      return null;
  }
}

const closureToPrisma: Readonly<
  Record<
    CanonicalCommercialClosureClassification,
    CommercialClosureClassification
  >
> = {
  'opportunity-abandoned':
    CommercialClosureClassification.OPPORTUNITY_ABANDONED,
  'quote-rejected': CommercialClosureClassification.QUOTE_REJECTED,
  'acceptance-cancelled': CommercialClosureClassification.ACCEPTANCE_CANCELLED,
  superseded: CommercialClosureClassification.SUPERSEDED,
  'legacy-unclassified': CommercialClosureClassification.LEGACY_UNCLASSIFIED,
};

const closureFromPrisma: Readonly<
  Record<
    CommercialClosureClassification,
    CanonicalCommercialClosureClassification
  >
> = {
  OPPORTUNITY_ABANDONED: 'opportunity-abandoned',
  QUOTE_REJECTED: 'quote-rejected',
  ACCEPTANCE_CANCELLED: 'acceptance-cancelled',
  SUPERSEDED: 'superseded',
  LEGACY_UNCLASSIFIED: 'legacy-unclassified',
};
const COMMERCIAL_PENDING_QUOTES_NOTIFICATION =
  'commercial.pending-quote-proposals' as const;

function pendingQuoteProposalWhere(
  companyId: string,
): Prisma.QuoteRequestWhereInput {
  return {
    companyId,
    status: RequestStatus.UNDER_REVIEW,
    confirmedAt: { not: null },
    conversation: {
      department: DepartmentCode.COMMERCIAL,
      closedAt: null,
    },
  };
}

function quoteProposalStageWhere(
  companyId: string,
  stage: QuoteProposalListQuery['stage'],
): Prisma.QuoteRequestWhereInput {
  if (stage === 'pending') {
    return pendingQuoteProposalWhere(companyId);
  }

  const commercialConversation = {
    department: DepartmentCode.COMMERCIAL,
  };
  switch (stage) {
    case 'sent':
      return {
        companyId,
        status: RequestStatus.WAITING_FOR_CUSTOMER,
        conversation: commercialConversation,
        proposalDocuments: {
          some: { status: QuoteProposalDocumentStatus.SENT },
        },
      };
    case 'approved':
      return {
        companyId,
        status: RequestStatus.APPROVED,
        conversation: commercialConversation,
      };
    case 'cancelled':
      return {
        companyId,
        status: { in: [RequestStatus.REJECTED, RequestStatus.CANCELLED] },
        conversation: commercialConversation,
      };
  }
}

function quoteProposalFilterWhere(
  query: QuoteProposalListQuery,
): Prisma.QuoteRequestWhereInput {
  const filters: Prisma.QuoteRequestWhereInput[] = [];
  if (query.conversationId) {
    filters.push({ conversationId: query.conversationId });
  }

  const search = query.search?.trim();
  if (search) {
    const phoneSearch = search.replace(/\D/g, '');
    filters.push({
      OR: [
        { contactName: { contains: search, mode: 'insensitive' } },
        { origin: { contains: search, mode: 'insensitive' } },
        { destination: { contains: search, mode: 'insensitive' } },
        {
          conversation: {
            contact: {
              displayName: { contains: search, mode: 'insensitive' },
            },
          },
        },
        ...(phoneSearch
          ? [
              {
                conversation: {
                  contact: { phoneNormalized: { contains: phoneSearch } },
                },
              } satisfies Prisma.QuoteRequestWhereInput,
            ]
          : []),
        {
          proposalDocuments: {
            some: { fileName: { contains: search, mode: 'insensitive' } },
          },
        },
      ],
    });
  }

  const createdFrom = query.createdFrom
    ? new Date(query.createdFrom)
    : undefined;
  const createdTo = query.createdTo ? new Date(query.createdTo) : undefined;
  if (
    (createdFrom && Number.isNaN(createdFrom.valueOf())) ||
    (createdTo && Number.isNaN(createdTo.valueOf()))
  ) {
    throw validationError('O período de criação informado é inválido.');
  }
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw validationError(
      'A data inicial do filtro não pode ser posterior à data final.',
    );
  }
  if (createdFrom || createdTo) {
    filters.push({
      createdAt: {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {}),
      },
    });
  }

  return filters.length > 0 ? { AND: filters } : {};
}

function acceptsProposalDocuments(status: RequestStatus): boolean {
  return (
    status === RequestStatus.UNDER_REVIEW ||
    status === RequestStatus.WAITING_FOR_CUSTOMER
  );
}

function acceptsProposalDocumentsForCurrentCycle(
  quote: {
    id: string;
    status: RequestStatus;
    confirmedAt: Date | null;
  },
  currentQuote: { id: string } | null | undefined,
): boolean {
  return (
    currentQuote?.id === quote.id &&
    quote.confirmedAt !== null &&
    acceptsProposalDocuments(quote.status)
  );
}

type ClosingTransitionName = 'close' | 'close-after-rejection';

function isClosingTransition(
  name: TransitionCommand['name'],
): name is ClosingTransitionName {
  return name === 'close' || name === 'close-after-rejection';
}

const kindToPrisma: Readonly<Record<CanonicalMessageKind, MessageKind>> = {
  text: MessageKind.TEXT,
  image: MessageKind.IMAGE,
  document: MessageKind.DOCUMENT,
  audio: MessageKind.AUDIO,
  video: MessageKind.VIDEO,
  sticker: MessageKind.STICKER,
  location: MessageKind.LOCATION,
  contact: MessageKind.CONTACT,
  unknown: MessageKind.UNKNOWN,
};

const kindFromPrisma: Readonly<Record<MessageKind, CanonicalMessageKind>> = {
  TEXT: 'text',
  IMAGE: 'image',
  DOCUMENT: 'document',
  AUDIO: 'audio',
  VIDEO: 'video',
  STICKER: 'sticker',
  LOCATION: 'location',
  CONTACT: 'contact',
  UNKNOWN: 'unknown',
};

const deliveryToPrisma: Readonly<
  Record<CanonicalDeliveryStatus, DeliveryStatus>
> = {
  received: DeliveryStatus.RECEIVED,
  pending: DeliveryStatus.PENDING,
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  read: DeliveryStatus.READ,
  failed: DeliveryStatus.FAILED,
};

const deliveryFromPrisma: Readonly<
  Record<DeliveryStatus, CanonicalDeliveryStatus>
> = {
  RECEIVED: 'received',
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
};

const actorToPrisma = {
  user: TransitionActorType.USER,
  webhook: TransitionActorType.WEBHOOK,
  system: TransitionActorType.SYSTEM,
} as const;

const conversationInclude = {
  contact: true,
  channel: { select: { id: true, name: true, phoneNumber: true } },
  assignedTo: { select: { id: true, name: true } },
  pendingTransferRequestedBy: { select: { id: true, name: true } },
  quoteRequests: { orderBy: { sequence: 'desc' as const }, take: 1 },
  _count: {
    select: {
      quoteRequests: { where: { status: RequestStatus.APPROVED } },
    },
  },
} as const;

const conversationDetailInclude = {
  ...conversationInclude,
  transitions: {
    where: {
      name: { in: ['close', 'close-after-rejection'] as string[] },
    },
    orderBy: { resultingVersion: 'desc' as const },
    take: 1,
    include: {
      actorUser: { select: { id: true, name: true } },
    },
  },
} as const;

type ConversationWithRelations = Prisma.WhatsAppConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type ConversationDetailWithRelations = Prisma.WhatsAppConversationGetPayload<{
  include: typeof conversationDetailInclude;
}>;

const serviceSessionAuthorizationSelect = {
  id: true,
  companyId: true,
  threadId: true,
  sourceChannelId: true,
  currentDepartmentId: true,
  responsibleUserId: true,
  queueId: true,
  relatedServiceSessionId: true,
  status: true,
  controlMode: true,
  priority: true,
  priorityReason: true,
  prioritySource: true,
  isForeground: true,
  version: true,
  publicContinuationCode: true,
  continuationCodeExpiresAt: true,
  conversationResolved: true,
  pendingActions: true,
  resolutionConfirmedByCustomer: true,
  closingStartedAt: true,
  closingDeadlineAt: true,
  offHoursHandoffNotifiedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ServiceSessionAuthorization = Prisma.ServiceSessionGetPayload<{
  select: typeof serviceSessionAuthorizationSelect;
}>;

const priorityResumeSessionSelect = {
  ...serviceSessionAuthorizationSelect,
  queue: { select: { priorityWeight: true } },
  currentDepartment: {
    select: {
      serviceQueues: {
        where: { enabled: true },
        orderBy: [{ priorityWeight: 'desc' }, { id: 'asc' }],
        take: 1,
        select: { priorityWeight: true },
      },
    },
  },
} satisfies Prisma.ServiceSessionSelect;

type PriorityResumeSession = Prisma.ServiceSessionGetPayload<{
  select: typeof priorityResumeSessionSelect;
}>;

interface PriorityResumePredecessor {
  readonly session: PriorityResumeSession;
  readonly previousStatus: RestorablePrioritySessionStatus;
  readonly pausedAt: Date;
}

interface FoundationContext {
  readonly threadId: string;
  readonly session: ServiceSessionAuthorization;
}

function serviceSessionStateForConversation(state: ConversationState): {
  status: ServiceSessionStatus;
  controlMode: ServiceSessionControlMode;
  isForeground: boolean;
} {
  switch (state) {
    case ConversationState.WAITING_FOR_CUSTOMER:
      return {
        status: ServiceSessionStatus.WAITING_CUSTOMER,
        controlMode: ServiceSessionControlMode.AI,
        isForeground: true,
      };
    case ConversationState.SENT_TO_HUMAN:
      return {
        status: ServiceSessionStatus.WAITING_HUMAN,
        controlMode: ServiceSessionControlMode.HUMAN,
        isForeground: true,
      };
    case ConversationState.HUMAN_ACTIVE:
      return {
        status: ServiceSessionStatus.OPEN,
        controlMode: ServiceSessionControlMode.HUMAN,
        isForeground: true,
      };
    case ConversationState.CLOSED:
      return {
        status: ServiceSessionStatus.CLOSED,
        controlMode: ServiceSessionControlMode.AI,
        isForeground: false,
      };
    default:
      return {
        status: ServiceSessionStatus.OPEN,
        controlMode: ServiceSessionControlMode.AI,
        isForeground: true,
      };
  }
}

function serviceSessionSnapshot(session: ServiceSessionAuthorization) {
  return {
    id: session.id,
    threadId: session.threadId,
    sourceChannelId: session.sourceChannelId,
    currentDepartmentId: session.currentDepartmentId,
    responsibleUserId: session.responsibleUserId,
    queueId: session.queueId,
    relatedServiceSessionId: session.relatedServiceSessionId,
    status: session.status,
    controlMode: session.controlMode,
    priority: session.priority,
    priorityReason: session.priorityReason,
    prioritySource: session.prioritySource,
    isForeground: session.isForeground,
    version: session.version,
    publicContinuationCode: session.publicContinuationCode,
    continuationCodeExpiresAt:
      session.continuationCodeExpiresAt?.toISOString() ?? null,
    conversationResolved: session.conversationResolved,
    pendingActions: session.pendingActions,
    resolutionConfirmedByCustomer: session.resolutionConfirmedByCustomer,
    closingStartedAt: session.closingStartedAt?.toISOString() ?? null,
    closingDeadlineAt: session.closingDeadlineAt?.toISOString() ?? null,
    offHoursHandoffNotifiedAt:
      session.offHoursHandoffNotifiedAt?.toISOString() ?? null,
    closedAt: session.closedAt?.toISOString() ?? null,
  };
}

function automaticReplyBlocked(session: ServiceSessionAuthorization): boolean {
  return (
    session.controlMode !== ServiceSessionControlMode.AI ||
    session.status !== ServiceSessionStatus.OPEN ||
    !session.isForeground
  );
}

function pendingActionsAreEmpty(value: Prisma.JsonValue): boolean {
  return Array.isArray(value) && value.length === 0;
}

function payload(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function optionalJsonRecord(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return value ?? {};
}

function optionalMediaText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mediaAssetType(
  kind: CanonicalMessageKind,
  media: Readonly<Record<string, unknown>> | undefined,
): MediaAssetType | null {
  switch (kind) {
    case 'audio':
      return MediaAssetType.AUDIO;
    case 'image':
      return MediaAssetType.IMAGE;
    case 'document': {
      const mimeType = optionalMediaText(media?.mimeType ?? media?.mimetype)
        .trim()
        .toLowerCase();
      const fileName = optionalMediaText(media?.fileName).trim().toLowerCase();
      return mimeType.includes('spreadsheet') ||
        mimeType.includes('excel') ||
        mimeType === 'text/csv' ||
        /\.(?:xlsx?|csv)$/iu.test(fileName)
        ? MediaAssetType.SPREADSHEET
        : MediaAssetType.DOCUMENT;
    }
    case 'location':
      return MediaAssetType.LOCATION;
    case 'contact':
      return MediaAssetType.CONTACT;
    case 'video':
      return MediaAssetType.VIDEO;
    case 'sticker':
      return MediaAssetType.OTHER;
    default:
      return null;
  }
}

function optionalSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= 0
    ? numeric
    : null;
}

interface MessageMediaInterpretationRow {
  readonly id: string;
  readonly status: string;
  readonly transcription: string | null;
  readonly extractedText: string | null;
  readonly summary: string | null;
  readonly structuredData: Prisma.JsonValue | null;
  readonly provenance: Prisma.JsonValue;
  readonly errorCode: string | null;
  readonly completedAt: Date | null;
  readonly correction: {
    readonly correction: string;
    readonly feedback: string | null;
    readonly correctedByUserId: string;
    readonly createdAt: Date;
  } | null;
}

interface MessageMediaAssetRow {
  readonly id: string;
  readonly type: MediaAssetType;
  readonly status: MediaProcessingStatus;
  readonly mimeType: string | null;
  readonly originalName: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly durationSeconds: Prisma.Decimal | null;
  readonly pageCount: number | null;
  readonly storedAt: Date | null;
  readonly interpretation: MessageMediaInterpretationRow | null;
}

function machineMediaContext(
  interpretation: MessageMediaInterpretationRow | null,
): string | null {
  if (!interpretation) return null;
  return (
    interpretation.summary?.trim() ||
    interpretation.transcription?.trim() ||
    interpretation.extractedText?.trim() ||
    (interpretation.structuredData
      ? JSON.stringify(interpretation.structuredData)
      : null)
  );
}

function automationMediaContext(asset: MessageMediaAssetRow | null): {
  readonly mediaInterpretationStatus:
    'not-requested' | 'pending' | 'succeeded' | 'failed' | 'unsupported';
  readonly interpretedText: string | null;
  readonly interpretationSource: 'human' | 'machine' | 'none';
  readonly mediaInterpretationId: string | null;
} {
  if (!asset) {
    return {
      mediaInterpretationStatus: 'not-requested',
      interpretedText: null,
      interpretationSource: 'none',
      mediaInterpretationId: null,
    };
  }
  const interpretation = asset.interpretation;
  const effective = effectiveMediaInterpretation({
    machineInterpretation: machineMediaContext(interpretation),
    humanCorrection: interpretation?.correction?.correction ?? null,
  });
  const persistedStatus = interpretation?.status.toLowerCase();
  const mediaInterpretationStatus =
    persistedStatus === 'pending' ||
    persistedStatus === 'succeeded' ||
    persistedStatus === 'failed' ||
    persistedStatus === 'unsupported'
      ? persistedStatus
      : asset.status === MediaProcessingStatus.PROCESSING
        ? 'pending'
        : asset.status === MediaProcessingStatus.FAILED
          ? 'failed'
          : asset.status === MediaProcessingStatus.UNSUPPORTED
            ? 'unsupported'
            : 'not-requested';
  return {
    mediaInterpretationStatus,
    interpretedText: effective.value,
    interpretationSource: effective.source,
    mediaInterpretationId:
      mediaInterpretationStatus === 'succeeded' &&
      Boolean(effective.value?.trim()) &&
      (effective.source === 'machine' || effective.source === 'human')
        ? (interpretation?.id ?? null)
        : null,
  };
}

function presentMessageMediaAsset(asset: MessageMediaAssetRow | null) {
  if (!asset) return null;
  const interpretation = asset.interpretation;
  const effective = automationMediaContext(asset);
  return {
    id: asset.id,
    type: asset.type.toLowerCase(),
    status: asset.status.toLowerCase(),
    mimeType: asset.mimeType,
    originalName: asset.originalName,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    durationSeconds:
      asset.durationSeconds === null ? null : Number(asset.durationSeconds),
    pageCount: asset.pageCount,
    storedAt: asset.storedAt?.toISOString() ?? null,
    interpretation: interpretation
      ? {
          status: effective.mediaInterpretationStatus,
          transcription: interpretation.transcription,
          extractedText: interpretation.extractedText,
          summary: interpretation.summary,
          structuredData: interpretation.structuredData,
          provenance: interpretation.provenance,
          errorCode: interpretation.errorCode,
          completedAt: interpretation.completedAt?.toISOString() ?? null,
          correction: interpretation.correction
            ? {
                correction: interpretation.correction.correction,
                feedback: interpretation.correction.feedback,
                correctedByUserId: interpretation.correction.correctedByUserId,
                createdAt: interpretation.correction.createdAt.toISOString(),
              }
            : null,
          effectiveContext: {
            value: effective.interpretedText,
            source: effective.interpretationSource,
          },
        }
      : null,
  };
}

const messageMediaAssetInclude = {
  interpretation: {
    include: {
      correction: {
        select: {
          correction: true,
          feedback: true,
          correctedByUserId: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.MediaAssetInclude;

async function createWebhookMediaAsset(
  transaction: Prisma.TransactionClient,
  input: {
    readonly companyId: string;
    readonly kind: CanonicalMessageKind;
    readonly media?: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
    readonly group: boolean;
  },
): Promise<string | null> {
  const type = mediaAssetType(input.kind, input.media);
  if (!type) return null;
  const media = optionalJsonRecord(input.media);
  const mimeType =
    optionalMediaText(media.mimeType ?? media.mimetype).trim() || null;
  const originalName = optionalMediaText(media.fileName).trim() || null;
  const sizeBytes = optionalSafeInteger(media.size ?? media.sizeBytes);
  const durationSeconds = optionalFiniteNumber(
    media.durationSeconds ?? media.seconds,
  );
  const preserveOnly =
    input.group ||
    type === MediaAssetType.VIDEO ||
    type === MediaAssetType.OTHER;
  const metadataOnly =
    type === MediaAssetType.LOCATION || type === MediaAssetType.CONTACT;
  const asset = await transaction.mediaAsset.create({
    data: {
      companyId: input.companyId,
      type,
      status: preserveOnly
        ? MediaProcessingStatus.UNSUPPORTED
        : metadataOnly
          ? MediaProcessingStatus.STORED
          : MediaProcessingStatus.PROCESSING,
      mimeType,
      originalName,
      sizeBytes,
      durationSeconds,
      storedAt: metadataOnly ? input.occurredAt : null,
      metadata: payload({
        source: input.group
          ? 'evolution-whatsapp-group'
          : 'evolution-whatsapp-direct',
        interpretationPolicy: preserveOnly ? 'preserve-only' : 'eligible',
        webhookMedia: media,
      }),
    },
    select: { id: true },
  });
  return asset.id;
}

function correlation(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function commandFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function assertSameFingerprint(
  persisted: string,
  expected: string,
  keyName: string,
): void {
  if (persisted !== expected) {
    throw new AppError(
      'CONFLICT',
      `${keyName} já foi usado com outro conteúdo.`,
    );
  }
}

function assertQuoteComplete(quote: {
  contactName: string | null;
  serviceType: string | null;
  origin: string | null;
  destination: string | null;
  departureDate: Date | null;
  passengerCount: number | null;
}): void {
  const missing = [
    !quote.contactName?.trim() && 'contactName',
    !quote.serviceType?.trim() && 'serviceType',
    !quote.origin?.trim() && 'origin',
    !quote.destination?.trim() && 'destination',
    !quote.departureDate && 'departureDate',
    (!quote.passengerCount || quote.passengerCount < 1) && 'passengerCount',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw validationError(
      `O orçamento ainda não possui os campos obrigatórios: ${missing.join(', ')}.`,
    );
  }
}

function snapshot(row: {
  department: DepartmentCode;
  conversationState: ConversationState;
  flowStep: FlowStep;
  requestStatus: RequestStatus;
  resumeState: ConversationState | null;
  resumeFlowStep: FlowStep | null;
}): ConversationSnapshot {
  return {
    department: departmentFromPrisma[row.department],
    conversationState: stateFromPrisma[row.conversationState],
    flowStep: flowFromPrisma[row.flowStep],
    requestStatus: requestFromPrisma[row.requestStatus],
    resumeState: row.resumeState ? stateFromPrisma[row.resumeState] : null,
    resumeFlowStep: row.resumeFlowStep
      ? flowFromPrisma[row.resumeFlowStep]
      : null,
  };
}

function snapshotForProposalDelivery(row: {
  department: DepartmentCode;
  conversationState: ConversationState;
  flowStep: FlowStep;
  requestStatus: RequestStatus;
  resumeState: ConversationState | null;
  resumeFlowStep: FlowStep | null;
}): ConversationSnapshot {
  const current = snapshot(row);
  if (
    current.department === 'commercial' &&
    current.conversationState === 'bot-active' &&
    current.flowStep === 'commercial-follow-up-menu' &&
    current.requestStatus === 'under-review'
  ) {
    return { ...current, flowStep: 'quote-send-pending' };
  }
  return current;
}

function presentQuote(row: {
  id: string;
  sequence: number;
  status: RequestStatus;
  contactName: string | null;
  document: string | null;
  email: string | null;
  serviceType: string | null;
  origin: string | null;
  destination: string | null;
  departureDate: Date | null;
  departureAt: Date | null;
  returnDate: Date | null;
  returnAt: Date | null;
  passengerCount: number | null;
  vehicleType: string | null;
  vehicleAtDisposal: boolean | null;
  localTransfers: boolean | null;
  notes: string | null;
  structuredData: unknown;
  confirmedAt: Date | null;
  confirmedSummary: unknown;
  confirmedVersion: number | null;
  requestedByUserId: string | null;
  closureClassification: CommercialClosureClassification | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  requestedByUser?: { id: string; name: string } | null;
  decidedByUser?: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    sequence: row.sequence,
    status: requestFromPrisma[row.status],
    contactName: row.contactName,
    document: row.document,
    email: row.email,
    serviceType: row.serviceType,
    origin: row.origin,
    destination: row.destination,
    departureDate: presentDateOnly(row.departureDate),
    departureAt: row.departureAt?.toISOString() ?? null,
    returnDate: presentDateOnly(row.returnDate),
    returnAt: row.returnAt?.toISOString() ?? null,
    passengerCount: row.passengerCount,
    vehicleType: row.vehicleType,
    vehicleAtDisposal: row.vehicleAtDisposal,
    localTransfers: row.localTransfers,
    notes: row.notes,
    structuredData: row.structuredData,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedSummary: row.confirmedSummary,
    confirmedVersion: row.confirmedVersion,
    requestedBy:
      row.requestedByUser === undefined
        ? undefined
        : row.requestedByUser
          ? {
              type: 'attendant',
              id: row.requestedByUser.id,
              name: row.requestedByUser.name,
            }
          : {
              type: 'customer',
              id: null,
              name: row.contactName?.trim() || 'Cliente via WhatsApp',
            },
    decision: {
      status:
        row.status === RequestStatus.APPROVED
          ? 'approved'
          : row.status === RequestStatus.REJECTED
            ? 'rejected'
            : row.status === RequestStatus.CANCELLED
              ? 'cancelled'
              : 'pending',
      classification: row.closureClassification
        ? closureFromPrisma[row.closureClassification]
        : row.status === RequestStatus.CANCELLED
          ? 'legacy-unclassified'
          : row.status === RequestStatus.REJECTED
            ? 'quote-rejected'
            : null,
      reason:
        row.decisionReason ??
        (row.status === RequestStatus.CANCELLED ||
        row.status === RequestStatus.REJECTED
          ? 'Motivo não informado (registro legado).'
          : null),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedByUser
        ? { id: row.decidedByUser.id, name: row.decidedByUser.name }
        : null,
    },
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentProposalDocument(row: {
  id: string;
  quoteRequestId: string;
  conversationId: string;
  messageId: string | null;
  sequence: number;
  status: QuoteProposalDocumentStatus;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  providerMessageId: string | null;
  queuedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  uploadedByUser?: { id: string; name: string } | null;
  sentByUser?: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    quoteRequestId: row.quoteRequestId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    sequence: row.sequence,
    status: row.status.toLowerCase(),
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    providerMessageId: row.providerMessageId,
    queuedAt: row.queuedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    uploadedBy: row.uploadedByUser
      ? { id: row.uploadedByUser.id, name: row.uploadedByUser.name }
      : null,
    sentBy: row.sentByUser
      ? { id: row.sentByUser.id, name: row.sentByUser.name }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentConversation(row: ConversationWithRelations) {
  return {
    id: row.id,
    companyId: row.companyId,
    channel: row.channel,
    contact: {
      id: row.contact.id,
      phone: row.contact.phoneDisplay,
      displayName: row.contact.displayName,
      profilePictureUrl: row.contact.profilePictureUrl,
    },
    ...snapshot(row),
    assignedTo: row.assignedTo,
    pendingTransfer: row.pendingTransferDepartment
      ? {
          targetDepartment: departmentFromPrisma[row.pendingTransferDepartment],
          reason: row.pendingTransferReason,
          requestedAt: row.pendingTransferRequestedAt?.toISOString() ?? null,
          requestedBy: row.pendingTransferRequestedBy,
        }
      : null,
    unreadCount: row.unreadCount,
    version: row.version,
    mainMenuPresentedAt: row.mainMenuPresentedAt?.toISOString() ?? null,
    followUpMenuPresentedAt: row.followUpMenuPresentedAt?.toISOString() ?? null,
    contextualFollowUpAt: row.contextualFollowUpAt?.toISOString() ?? null,
    departmentContactOption: row.departmentContactOption,
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    closedAt: row.closedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archiveReason: row.archiveReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    currentQuoteRequest: row.quoteRequests[0]
      ? presentQuote(row.quoteRequests[0])
      : null,
    hasApprovedQuoteRequest: row._count.quoteRequests > 0,
  };
}

function closingReason(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const reason = (metadata as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

function presentClosure(
  transition: ConversationDetailWithRelations['transitions'][number],
) {
  return {
    transitionId: transition.id,
    transitionName: transition.name,
    occurredAt: transition.createdAt.toISOString(),
    reason: closingReason(transition.metadata),
    actor: {
      type: transition.actorType.toLowerCase(),
      user: transition.actorUser
        ? { id: transition.actorUser.id, name: transition.actorUser.name }
        : null,
    },
  };
}

function presentConversationDetail(row: ConversationDetailWithRelations) {
  return {
    ...presentConversation(row),
    closure: row.transitions[0] ? presentClosure(row.transitions[0]) : null,
  };
}

function currentVersionConflict(currentVersion: number): AppError {
  return new AppError(
    'CONFLICT',
    'A conversa foi alterada por outro comando.',
    { currentVersion },
  );
}

function quoteConversationClosed(
  conversationId: string,
  message = 'Não é possível cadastrar proposta em um atendimento encerrado.',
): AppError {
  return new AppError('QUOTE_CONVERSATION_CLOSED', message, {
    conversationId,
  });
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PrismaWhatsAppRepository
  extends WhatsAppRepository
  implements CommercialQuoteRepository
{
  private readonly dispatchLeaseMs: number;
  private readonly followUpInactivityMs: number;
  private readonly automationRetryBaseDelayMs: number;
  private readonly automationRetryMaximumDelayMs: number;
  private readonly preventCloseWithApprovedQuote: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    this.dispatchLeaseMs =
      config.get<number>('EVOLUTION_DISPATCH_LEASE_MS') ?? 90_000;
    this.followUpInactivityMs =
      config.get<number>('WHATSAPP_FOLLOW_UP_INACTIVITY_MS') ?? 1_800_000;
    this.automationRetryBaseDelayMs =
      config.get<number>('WHATSAPP_API_RETRY_BASE_DELAY_MS') ?? 1_000;
    this.automationRetryMaximumDelayMs =
      config.get<number>('WHATSAPP_API_RETRY_MAX_DELAY_MS') ?? 300_000;
    this.preventCloseWithApprovedQuote =
      config.get<boolean>('WHATSAPP_PREVENT_CLOSE_WITH_APPROVED_QUOTE') ??
      false;
  }

  private async ensureFoundationForConversation(
    transaction: Prisma.TransactionClient,
    conversation: Pick<
      ConversationWithRelations,
      | 'id'
      | 'companyId'
      | 'channelId'
      | 'contactId'
      | 'threadId'
      | 'department'
      | 'conversationState'
      | 'assignedToUserId'
      | 'closedAt'
    >,
    options: {
      commandSeed: string;
      occurredAt: Date;
      direction?: MessageDirection;
      desiredConversationState?: ConversationState;
      messageText?: string;
    },
  ): Promise<FoundationContext> {
    const thread = await transaction.whatsAppThread.upsert({
      where: {
        companyId_sourceChannelId_contactId: {
          companyId: conversation.companyId,
          sourceChannelId: conversation.channelId,
          contactId: conversation.contactId,
        },
      },
      create: {
        companyId: conversation.companyId,
        sourceChannelId: conversation.channelId,
        contactId: conversation.contactId,
        ...(options.direction === MessageDirection.INBOUND
          ? { lastInboundAt: options.occurredAt }
          : options.direction === MessageDirection.OUTBOUND
            ? { lastOutboundAt: options.occurredAt }
            : {}),
      },
      update: {},
      select: { id: true },
    });

    if (options.direction === MessageDirection.INBOUND) {
      await transaction.whatsAppThread.updateMany({
        where: {
          id: thread.id,
          companyId: conversation.companyId,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: options.occurredAt } },
          ],
        },
        data: { lastInboundAt: options.occurredAt },
      });
    } else if (options.direction === MessageDirection.OUTBOUND) {
      await transaction.whatsAppThread.updateMany({
        where: {
          id: thread.id,
          companyId: conversation.companyId,
          OR: [
            { lastOutboundAt: null },
            { lastOutboundAt: { lt: options.occurredAt } },
          ],
        },
        data: { lastOutboundAt: options.occurredAt },
      });
    }

    if (conversation.threadId !== thread.id) {
      await transaction.whatsAppConversation.updateMany({
        where: { id: conversation.id, companyId: conversation.companyId },
        data: { threadId: thread.id },
      });
    }

    await this.lockCommand(
      transaction,
      conversation.companyId,
      'service-session-lifecycle',
      thread.id,
    );

    let session = await transaction.serviceSession.findFirst({
      where: {
        companyId: conversation.companyId,
        threadId: thread.id,
        isForeground: true,
        status: { not: ServiceSessionStatus.CLOSED },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: serviceSessionAuthorizationSelect,
    });

    if (
      session &&
      options.direction === MessageDirection.INBOUND &&
      session.status === ServiceSessionStatus.CLOSING
    ) {
      const before = serviceSessionSnapshot(session);
      const commandId = correlation(
        'service-session-closing-cancelled',
        `${options.commandSeed}:${session.id}`,
      );
      const cancelled = await transaction.serviceSession.updateMany({
        where: {
          id: session.id,
          companyId: conversation.companyId,
          version: session.version,
          status: ServiceSessionStatus.CLOSING,
          controlMode: ServiceSessionControlMode.AI,
        },
        data: {
          status: ServiceSessionStatus.OPEN,
          conversationResolved: false,
          resolutionConfirmedByCustomer: false,
          closingStartedAt: null,
          closingDeadlineAt: null,
          version: { increment: 1 },
        },
      });
      if (cancelled.count !== 1) {
        throw new AppError(
          'CONFLICT',
          'A sessão mudou durante o cancelamento do encerramento.',
        );
      }
      session = await transaction.serviceSession.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: session.id,
            companyId: conversation.companyId,
          },
        },
        select: serviceSessionAuthorizationSelect,
      });
      const after = serviceSessionSnapshot(session);
      await transaction.serviceSessionEvent.create({
        data: {
          companyId: conversation.companyId,
          serviceSessionId: session.id,
          commandId,
          commandFingerprint: commandFingerprint({
            commandId,
            before,
            after,
            message: options.commandSeed,
          }),
          name: 'customer-replied-during-ai-closing',
          expectedVersion: before.version,
          resultingVersion: after.version,
          actorType: MutationActorType.SERVICE,
          beforeSnapshot: payload(before),
          afterSnapshot: payload(after),
          metadata: payload({ source: 'whatsapp-app' }),
          createdAt: options.occurredAt,
        },
      });
    }

    if (
      session &&
      options.direction === MessageDirection.INBOUND &&
      (session.conversationResolved || session.resolutionConfirmedByCustomer)
    ) {
      session = await this.updateFoundationSession(transaction, {
        companyId: conversation.companyId,
        session,
        commandId: correlation(
          'customer-reset-ai-resolution',
          `${options.commandSeed}:${session.id}`,
        ),
        name: 'customer-message-reset-ai-resolution',
        actorType: MutationActorType.SERVICE,
        status: session.status,
        controlMode: session.controlMode,
        isForeground: session.isForeground,
        conversationResolved: false,
        resolutionConfirmedByCustomer: false,
        occurredAt: options.occurredAt,
        metadata: {
          source: 'whatsapp-app',
          conversationId: conversation.id,
        },
      });
    }

    if (!session) {
      const desiredState =
        options.desiredConversationState ?? conversation.conversationState;
      const desired = serviceSessionStateForConversation(desiredState);
      const department = await transaction.tenantDepartment.findUnique({
        where: {
          companyId_code: {
            companyId: conversation.companyId,
            code: conversation.department,
          },
        },
        select: { id: true },
      });
      const continuationCode = parsePublicContinuationCommand(
        options.messageText ?? '',
      );
      const validCodeSession =
        options.direction === MessageDirection.INBOUND && continuationCode
          ? await transaction.serviceSession.findFirst({
              where: {
                companyId: conversation.companyId,
                threadId: thread.id,
                status: ServiceSessionStatus.CLOSED,
                publicContinuationCode: continuationCode,
                continuationCodeExpiresAt: { gt: options.occurredAt },
                closedAt: { not: null },
              },
              orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
              select: serviceSessionAuthorizationSelect,
            })
          : null;
      const previousClosed =
        validCodeSession ??
        (options.direction === MessageDirection.INBOUND
          ? await transaction.serviceSession.findFirst({
              where: {
                companyId: conversation.companyId,
                threadId: thread.id,
                status: ServiceSessionStatus.CLOSED,
                closedAt: { not: null },
              },
              orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
              select: serviceSessionAuthorizationSelect,
            })
          : null);
      const continuity =
        previousClosed?.closedAt &&
        options.direction === MessageDirection.INBOUND
          ? decideServiceContinuity({
              now: options.occurredAt,
              previousClosedAt: previousClosed.closedAt,
              validPublicContinuationCode: validCodeSession !== null,
            })
          : null;

      if (previousClosed && continuity?.action === 'reopen-previous') {
        const before = serviceSessionSnapshot(previousClosed);
        const reopened = await transaction.serviceSession.updateMany({
          where: {
            id: previousClosed.id,
            companyId: conversation.companyId,
            version: previousClosed.version,
            status: ServiceSessionStatus.CLOSED,
            isForeground: false,
          },
          data: {
            status: ServiceSessionStatus.OPEN,
            controlMode: ServiceSessionControlMode.AI,
            isForeground: true,
            responsibleUserId: null,
            queueId: null,
            publicContinuationCode: null,
            continuationCodeExpiresAt: null,
            conversationResolved: false,
            pendingActions: [],
            resolutionConfirmedByCustomer: false,
            closingStartedAt: null,
            closingDeadlineAt: null,
            closedAt: null,
            version: { increment: 1 },
          },
        });
        if (reopened.count !== 1) {
          throw new AppError(
            'CONFLICT',
            'A sessão mudou durante a decisão de continuidade.',
          );
        }
        session = await transaction.serviceSession.findUniqueOrThrow({
          where: {
            id_companyId: {
              id: previousClosed.id,
              companyId: conversation.companyId,
            },
          },
          select: serviceSessionAuthorizationSelect,
        });
        const after = serviceSessionSnapshot(session);
        const commandId = correlation(
          'service-session-reopened',
          `${options.commandSeed}:${session.id}`,
        );
        await transaction.serviceSessionEvent.create({
          data: {
            companyId: conversation.companyId,
            serviceSessionId: session.id,
            commandId,
            commandFingerprint: commandFingerprint({
              commandId,
              before,
              after,
              continuity,
            }),
            name: 'service-session-reopened',
            expectedVersion: previousClosed.version,
            resultingVersion: session.version,
            actorType: MutationActorType.SERVICE,
            beforeSnapshot: payload(before),
            afterSnapshot: payload(after),
            metadata: payload({
              source: 'whatsapp-app',
              publicCode: validCodeSession !== null,
            }),
            createdAt: options.occurredAt,
          },
        });
      } else {
        session = await transaction.serviceSession.create({
          data: {
            companyId: conversation.companyId,
            threadId: thread.id,
            sourceChannelId: conversation.channelId,
            currentDepartmentId: department?.id,
            responsibleUserId:
              desired.controlMode === ServiceSessionControlMode.HUMAN
                ? conversation.assignedToUserId
                : null,
            status: desired.status,
            controlMode: desired.controlMode,
            isForeground: desired.isForeground,
            ...(desired.status === ServiceSessionStatus.CLOSED
              ? { closedAt: conversation.closedAt ?? options.occurredAt }
              : {}),
          },
          select: serviceSessionAuthorizationSelect,
        });
        const commandId = correlation(
          'service-session-created',
          `${options.commandSeed}:${session.id}`,
        );
        const after = serviceSessionSnapshot(session);
        await transaction.serviceSessionEvent.create({
          data: {
            companyId: conversation.companyId,
            serviceSessionId: session.id,
            commandId,
            commandFingerprint: commandFingerprint({
              commandId,
              conversationId: conversation.id,
              threadId: thread.id,
              after,
            }),
            name: 'dual-write-session-created',
            expectedVersion: 0,
            resultingVersion: 1,
            actorType: MutationActorType.SERVICE,
            beforeSnapshot: payload({}),
            afterSnapshot: payload(after),
            metadata: payload({
              source: 'legacy-facade-dual-write',
              conversationId: conversation.id,
            }),
            createdAt: options.occurredAt,
          },
        });
      }

      if (previousClosed && continuity) {
        const decisionCommandId = correlation(
          'service-session-continuity',
          `${options.commandSeed}:${previousClosed.id}`,
        );
        await transaction.serviceSessionContinuityDecision.create({
          data: {
            companyId: conversation.companyId,
            commandId: decisionCommandId,
            sourceServiceSessionId: previousClosed.id,
            targetServiceSessionId: session.id,
            targetDepartmentId: session.currentDepartmentId,
            classification:
              continuity.classification === 'new-subject'
                ? ContinuityClassification.NEW_SUBJECT
                : continuity.classification === 'uncertain'
                  ? ContinuityClassification.UNCERTAIN
                  : ContinuityClassification.CONTINUATION,
            fallbackAction:
              continuity.classification === 'public-code'
                ? null
                : continuity.action === 'create-new'
                  ? ContinuityFallbackAction.CREATE_NEW
                  : continuity.fallbackAction === 'reopen-on-uncertain'
                    ? ContinuityFallbackAction.REOPEN_PREVIOUS
                    : null,
            confidence: continuity.confidence,
            reason: continuity.reason,
            createdAt: options.occurredAt,
          },
        });
      }
    }

    await transaction.quoteRequest.updateMany({
      where: {
        companyId: conversation.companyId,
        conversationId: conversation.id,
        OR: [{ threadId: null }, { serviceSessionId: null }],
      },
      data: { threadId: thread.id, serviceSessionId: session.id },
    });
    await transaction.quoteProposalDocument.updateMany({
      where: {
        companyId: conversation.companyId,
        conversationId: conversation.id,
        OR: [{ threadId: null }, { serviceSessionId: null }],
      },
      data: { threadId: thread.id, serviceSessionId: session.id },
    });

    return { threadId: thread.id, session };
  }

  private async resolveRegistrationCandidates(
    transaction: Prisma.TransactionClient,
    input: {
      companyId: string;
      serviceSessionId: string;
      whatsappContactId: string;
      phoneNormalized: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    const candidates = await transaction.registrationPhone.findMany({
      where: {
        companyId: input.companyId,
        normalizedValue: input.phoneNormalized,
        OR: [{ activeFrom: null }, { activeFrom: { lte: input.occurredAt } }],
        AND: [
          {
            OR: [
              { activeUntil: null },
              { activeUntil: { gte: input.occurredAt } },
            ],
          },
        ],
      },
      distinct: ['registrationId'],
      select: { registrationId: true },
    });
    const existing = await transaction.conversationParticipant.findMany({
      where: {
        companyId: input.companyId,
        serviceSessionId: input.serviceSessionId,
        whatsappContactId: input.whatsappContactId,
        validUntil: null,
      },
      select: { registrationId: true, isPrimary: true },
    });
    const existingRegistrationIds = new Set(
      existing.flatMap((item) =>
        item.registrationId ? [item.registrationId] : [],
      ),
    );
    const missing = candidates.filter(
      (candidate) => !existingRegistrationIds.has(candidate.registrationId),
    );
    const hasPrimary = existing.some((item) => item.isPrimary);

    if (missing.length > 0) {
      await transaction.conversationParticipant.createMany({
        data: missing.map((candidate) => ({
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: input.whatsappContactId,
          registrationId: candidate.registrationId,
          role: ConversationParticipantRole.UNKNOWN,
          isPrimary: !hasPrimary && candidates.length === 1,
          confidence: candidates.length === 1 ? 1 : undefined,
          identificationSource: 'registration-phone-candidate',
          metadata: payload({ candidate: true }),
          validFrom: input.occurredAt,
        })),
      });
    } else if (candidates.length === 0 && existing.length === 0) {
      await transaction.conversationParticipant.create({
        data: {
          companyId: input.companyId,
          serviceSessionId: input.serviceSessionId,
          whatsappContactId: input.whatsappContactId,
          role: ConversationParticipantRole.UNKNOWN,
          isPrimary: true,
          identificationSource: 'whatsapp-contact-only',
          metadata: payload({ candidate: false }),
          validFrom: input.occurredAt,
        },
      });
    }
  }

  private async updateFoundationSession(
    transaction: Prisma.TransactionClient,
    input: {
      companyId: string;
      session: ServiceSessionAuthorization;
      commandId: string;
      name: string;
      actorType: MutationActorType;
      actorUserId?: string;
      actorAgentId?: string;
      status: ServiceSessionStatus;
      controlMode: ServiceSessionControlMode;
      isForeground: boolean;
      responsibleUserId?: string | null;
      currentDepartmentId?: string | null;
      queueId?: string | null;
      priority?: ServiceSessionPriority;
      priorityReason?: string | null;
      prioritySource?: ServiceSessionPrioritySource;
      offHoursHandoffNotifiedAt?: Date | null;
      conversationResolved?: boolean;
      resolutionConfirmedByCustomer?: boolean;
      occurredAt: Date;
      metadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<ServiceSessionAuthorization> {
    const before = serviceSessionSnapshot(input.session);
    const responsibleUserId =
      input.responsibleUserId === undefined
        ? input.session.responsibleUserId
        : input.responsibleUserId;
    const currentDepartmentId =
      input.currentDepartmentId === undefined
        ? input.session.currentDepartmentId
        : input.currentDepartmentId;
    const queueId =
      input.queueId === undefined ? input.session.queueId : input.queueId;
    const priority =
      input.priority === undefined ? input.session.priority : input.priority;
    const priorityReason =
      input.priorityReason === undefined
        ? input.session.priorityReason
        : input.priorityReason;
    const prioritySource =
      input.prioritySource === undefined
        ? input.session.prioritySource
        : input.prioritySource;
    const offHoursHandoffNotifiedAt =
      input.offHoursHandoffNotifiedAt === undefined
        ? input.session.offHoursHandoffNotifiedAt
        : input.offHoursHandoffNotifiedAt;
    const conversationResolved =
      input.conversationResolved === undefined
        ? input.session.conversationResolved
        : input.conversationResolved;
    const resolutionConfirmedByCustomer =
      input.resolutionConfirmedByCustomer === undefined
        ? input.session.resolutionConfirmedByCustomer
        : input.resolutionConfirmedByCustomer;
    if (
      input.session.status === input.status &&
      input.session.controlMode === input.controlMode &&
      input.session.isForeground === input.isForeground &&
      input.session.responsibleUserId === responsibleUserId &&
      input.session.currentDepartmentId === currentDepartmentId &&
      input.session.queueId === queueId &&
      input.session.priority === priority &&
      input.session.priorityReason === priorityReason &&
      input.session.prioritySource === prioritySource &&
      input.session.offHoursHandoffNotifiedAt?.valueOf() ===
        offHoursHandoffNotifiedAt?.valueOf() &&
      input.session.conversationResolved === conversationResolved &&
      input.session.resolutionConfirmedByCustomer ===
        resolutionConfirmedByCustomer
    ) {
      return input.session;
    }

    const updated = await transaction.serviceSession.updateMany({
      where: {
        id: input.session.id,
        companyId: input.companyId,
        version: input.session.version,
      },
      data: {
        status: input.status,
        controlMode: input.controlMode,
        isForeground: input.isForeground,
        responsibleUserId,
        currentDepartmentId,
        queueId,
        priority,
        priorityReason,
        prioritySource,
        offHoursHandoffNotifiedAt,
        conversationResolved,
        resolutionConfirmedByCustomer,
        ...(input.status === ServiceSessionStatus.CLOSING
          ? {}
          : { closingStartedAt: null, closingDeadlineAt: null }),
        ...(input.status === ServiceSessionStatus.CLOSED
          ? {}
          : {
              publicContinuationCode: null,
              continuationCodeExpiresAt: null,
            }),
        closedAt:
          input.status === ServiceSessionStatus.CLOSED
            ? input.occurredAt
            : null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new AppError(
        'CONFLICT',
        'A sessão de atendimento foi alterada durante o comando.',
      );
    }
    const session = await transaction.serviceSession.findUniqueOrThrow({
      where: {
        id_companyId: { id: input.session.id, companyId: input.companyId },
      },
      select: serviceSessionAuthorizationSelect,
    });
    const after = serviceSessionSnapshot(session);
    await transaction.serviceSessionEvent.create({
      data: {
        companyId: input.companyId,
        serviceSessionId: session.id,
        commandId: input.commandId,
        commandFingerprint: commandFingerprint({
          commandId: input.commandId,
          name: input.name,
          before,
          after,
          metadata: input.metadata,
        }),
        name: input.name,
        expectedVersion: input.session.version,
        resultingVersion: session.version,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        actorAgentId: input.actorAgentId,
        beforeSnapshot: payload(before),
        afterSnapshot: payload(after),
        metadata: payload(input.metadata ?? {}),
        createdAt: input.occurredAt,
      },
    });
    return session;
  }

  private assertSessionAllowsAutomaticReply(
    conversation: Pick<
      ConversationWithRelations,
      'conversationState' | 'flowStep' | 'assignedToUserId'
    >,
    session: ServiceSessionAuthorization,
  ): void {
    if (
      automaticReplyBlocked(session) ||
      conversation.conversationState !== ConversationState.BOT_ACTIVE ||
      conversation.flowStep === FlowStep.HUMAN_SERVICE ||
      conversation.assignedToUserId !== null
    ) {
      throw new AppError(
        'CONFLICT',
        'A sessão não permite geração ou envio de resposta automática.',
        {
          serviceSessionId: session.id,
          serviceSessionVersion: session.version,
          controlMode: session.controlMode.toLowerCase(),
          status: session.status.toLowerCase(),
        },
      );
    }
  }

  async findWebhookChannel(
    channelId: string,
  ): Promise<WebhookChannelConfiguration | null> {
    return this.prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        companyId: true,
        instanceName: true,
        webhookSecretHash: true,
        ignoreGroups: true,
        ignoreFromMe: true,
        enabled: true,
      },
    });
  }

  async assertAutomaticReplyAllowed(
    companyId: string,
    conversationId: string,
  ): Promise<{
    allowed: true;
    threadId: string;
    serviceSessionId: string;
    serviceSessionVersion: number;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCommand(
        transaction,
        companyId,
        'whatsapp-conversation',
        conversationId,
      );
      const conversation = await this.findConversationOrThrow(
        transaction,
        companyId,
        conversationId,
      );
      if (!conversation.threadId) {
        throw new AppError(
          'CONFLICT',
          'A conversa ainda não possui thread para autorizar automação.',
        );
      }
      const session = await transaction.serviceSession.findFirst({
        where: {
          companyId,
          threadId: conversation.threadId,
          isForeground: true,
          status: { not: ServiceSessionStatus.CLOSED },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: serviceSessionAuthorizationSelect,
      });
      if (!session) {
        throw new AppError(
          'CONFLICT',
          'A conversa não possui sessão ativa para autorizar automação.',
        );
      }
      this.assertSessionAllowsAutomaticReply(conversation, session);
      return {
        allowed: true,
        threadId: conversation.threadId,
        serviceSessionId: session.id,
        serviceSessionVersion: session.version,
      };
    });
  }

  async getPendingContinuityClassification(
    companyId: string,
    conversationId: string,
    sourceEventId: string,
  ): Promise<ContinuityClassificationCandidate | null> {
    const anchor = await this.prisma.whatsAppMessage.findUnique({
      where: {
        companyId_correlationId: { companyId, correlationId: sourceEventId },
      },
      select: {
        id: true,
        companyId: true,
        conversationId: true,
        serviceSessionId: true,
        direction: true,
        kind: true,
        text: true,
        occurredAt: true,
      },
    });
    if (
      !anchor ||
      anchor.companyId !== companyId ||
      anchor.conversationId !== conversationId ||
      anchor.direction !== MessageDirection.INBOUND ||
      !anchor.serviceSessionId
    ) {
      return null;
    }
    const decision =
      await this.prisma.serviceSessionContinuityDecision.findFirst({
        where: {
          companyId,
          sourceServiceSessionId: anchor.serviceSessionId,
          targetServiceSessionId: anchor.serviceSessionId,
          classification: ContinuityClassification.UNCERTAIN,
          fallbackAction: ContinuityFallbackAction.REOPEN_PREVIOUS,
          agentExecutionId: null,
          createdAt: anchor.occurredAt,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, sourceServiceSessionId: true },
      });
    if (!decision) return null;

    const session = await this.prisma.serviceSession.findUnique({
      where: {
        id_companyId: {
          id: decision.sourceServiceSessionId,
          companyId,
        },
      },
      select: serviceSessionAuthorizationSelect,
    });
    if (
      !session ||
      session.status !== ServiceSessionStatus.OPEN ||
      session.controlMode !== ServiceSessionControlMode.AI ||
      !session.isForeground
    ) {
      return null;
    }

    const [previousDescending, allowedDepartments] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where: {
          companyId,
          conversationId,
          serviceSessionId: session.id,
          occurredAt: { lt: anchor.occurredAt },
          text: { not: null },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 12,
        select: { direction: true, text: true, occurredAt: true },
      }),
      this.prisma.tenantDepartment.findMany({
        where: {
          companyId,
          OR: [
            ...(session.currentDepartmentId
              ? [{ id: session.currentDepartmentId }]
              : []),
            {
              automaticTargetChannels: {
                some: { companyId, channelId: session.sourceChannelId },
              },
            },
          ],
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
    ]);

    return {
      decisionId: decision.id,
      sourceServiceSessionId: session.id,
      expectedVersion: session.version,
      currentDepartmentId: session.currentDepartmentId,
      previousMessages: previousDescending.reverse().map((message) => ({
        direction:
          message.direction === MessageDirection.INBOUND
            ? ('inbound' as const)
            : ('outbound' as const),
        text: message.text?.trim() ?? '',
        occurredAt: message.occurredAt.toISOString(),
      })),
      userMessage:
        anchor.text?.trim() ||
        `[mensagem ${anchor.kind.toLowerCase()} sem texto disponível]`,
      allowedTargetDepartments: allowedDepartments.map((department) => ({
        id: department.id,
        code: departmentFromPrisma[department.code],
        name: department.name,
      })),
    };
  }

  async applyContinuityClassification(
    input: ApplyContinuityClassificationInput,
  ): Promise<ApplyContinuityClassificationResult> {
    const reason = input.reason.trim().slice(0, 500);
    if (!reason) {
      throw validationError('A razão da classificação é obrigatória.');
    }
    if (
      input.confidence !== null &&
      (!Number.isFinite(input.confidence) ||
        input.confidence < 0 ||
        input.confidence > 1)
    ) {
      throw validationError('A confiança da classificação é inválida.');
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw validationError('A versão esperada da sessão é inválida.');
    }
    if (
      (input.actorAgentId && !input.agentExecutionId) ||
      (!input.actorAgentId && input.agentExecutionId)
    ) {
      throw validationError(
        'Agente e execução precisam ser informados em conjunto.',
      );
    }

    const fingerprint = commandFingerprint({
      decisionId: input.decisionId,
      conversationId: input.conversationId,
      sourceEventId: input.sourceEventId,
      expectedVersion: input.expectedVersion,
      classification: input.classification,
      confidence: input.confidence,
      reason,
      targetDepartmentId: input.targetDepartmentId,
      actorAgentId: input.actorAgentId,
      agentExecutionId: input.agentExecutionId,
    });

    return this.prisma.$transaction(async (transaction) => {
      await this.lockCommand(
        transaction,
        input.companyId,
        'continuity-classification',
        input.commandId,
      );
      const replay = await transaction.serviceSessionEvent.findUnique({
        where: {
          companyId_commandId: {
            companyId: input.companyId,
            commandId: input.commandId,
          },
        },
        select: {
          commandFingerprint: true,
          metadata: true,
          serviceSessionId: true,
        },
      });
      if (replay) {
        assertSameFingerprint(
          replay.commandFingerprint,
          fingerprint,
          'commandId',
        );
        const metadata = replay.metadata as Record<string, unknown>;
        const serviceSessionId =
          typeof metadata.targetServiceSessionId === 'string'
            ? metadata.targetServiceSessionId
            : replay.serviceSessionId;
        const session = await transaction.serviceSession.findUniqueOrThrow({
          where: {
            id_companyId: { id: serviceSessionId, companyId: input.companyId },
          },
          select: { id: true, version: true },
        });
        return {
          serviceSessionId: session.id,
          version: session.version,
          classification: input.classification,
          idempotent: true,
        };
      }

      await this.lockCommand(
        transaction,
        input.companyId,
        'whatsapp-conversation',
        input.conversationId,
      );
      let conversation = await this.findConversationOrThrow(
        transaction,
        input.companyId,
        input.conversationId,
      );
      if (!conversation.threadId) {
        throw new AppError(
          'CONFLICT',
          'A conversa não possui thread para classificar continuidade.',
        );
      }
      await this.lockCommand(
        transaction,
        input.companyId,
        'service-session-lifecycle',
        conversation.threadId,
      );
      await this.lockCommand(
        transaction,
        input.companyId,
        'continuity-decision',
        input.decisionId,
      );
      conversation = await this.findConversationOrThrow(
        transaction,
        input.companyId,
        input.conversationId,
      );

      const decision =
        await transaction.serviceSessionContinuityDecision.findUnique({
          where: {
            id_companyId: {
              id: input.decisionId,
              companyId: input.companyId,
            },
          },
        });
      if (
        !decision ||
        decision.classification !== ContinuityClassification.UNCERTAIN ||
        decision.fallbackAction !== ContinuityFallbackAction.REOPEN_PREVIOUS ||
        decision.agentExecutionId !== null ||
        decision.targetServiceSessionId !== decision.sourceServiceSessionId
      ) {
        throw new AppError(
          'CONFLICT',
          'A decisão de continuidade já foi concluída ou não é classificável.',
        );
      }
      const anchor = await transaction.whatsAppMessage.findUnique({
        where: {
          companyId_correlationId: {
            companyId: input.companyId,
            correlationId: input.sourceEventId,
          },
        },
        select: {
          conversationId: true,
          serviceSessionId: true,
          direction: true,
          occurredAt: true,
        },
      });
      if (
        !anchor ||
        anchor.conversationId !== input.conversationId ||
        anchor.serviceSessionId !== decision.sourceServiceSessionId ||
        anchor.direction !== MessageDirection.INBOUND ||
        anchor.occurredAt.valueOf() !== decision.createdAt.valueOf()
      ) {
        throw new AppError(
          'CONFLICT',
          'O evento de origem não corresponde à decisão de continuidade.',
        );
      }
      const source = await transaction.serviceSession.findUnique({
        where: {
          id_companyId: {
            id: decision.sourceServiceSessionId,
            companyId: input.companyId,
          },
        },
        select: serviceSessionAuthorizationSelect,
      });
      if (
        !source ||
        source.threadId !== conversation.threadId ||
        source.version !== input.expectedVersion ||
        source.status !== ServiceSessionStatus.OPEN ||
        source.controlMode !== ServiceSessionControlMode.AI ||
        !source.isForeground
      ) {
        throw new AppError(
          'CONFLICT',
          'A sessão mudou antes da classificação de continuidade.',
          { currentVersion: source?.version ?? null },
        );
      }

      let classifierExecutionStatus: AgentExecutionStatus | null = null;
      if (input.actorAgentId && input.agentExecutionId) {
        const execution = await transaction.agentExecution.findFirst({
          where: {
            id: input.agentExecutionId,
            companyId: input.companyId,
            agentId: input.actorAgentId,
            serviceSessionId: source.id,
            status: {
              in: [AgentExecutionStatus.SUCCEEDED, AgentExecutionStatus.FAILED],
            },
            agent: {
              code: 'continuity-classifier',
              type: 'SILENT_CLASSIFIER',
              customerFacing: false,
            },
          },
          select: { id: true, status: true },
        });
        if (!execution) {
          throw forbidden(
            'A execução informada não pertence ao classificador deste atendimento.',
          );
        }
        if (
          execution.status === AgentExecutionStatus.FAILED &&
          input.classification !== 'uncertain'
        ) {
          throw forbidden(
            'Uma execução falha só pode produzir o fallback UNCERTAIN.',
          );
        }
        classifierExecutionStatus = execution.status;
      }

      let targetDepartmentId = source.currentDepartmentId;
      let targetDepartment: { id: string; code: DepartmentCode } | null = null;
      if (input.classification === 'new-subject') {
        targetDepartmentId =
          input.targetDepartmentId ?? source.currentDepartmentId;
        if (targetDepartmentId) {
          targetDepartment = await transaction.tenantDepartment.findFirst({
            where: { id: targetDepartmentId, companyId: input.companyId },
            select: { id: true, code: true },
          });
          if (!targetDepartment) {
            throw forbidden(
              'O departamento de destino não pertence ao tenant.',
            );
          }
          if (targetDepartmentId !== source.currentDepartmentId) {
            const allowed =
              await transaction.whatsAppChannelAutomaticTargetDepartment.findFirst(
                {
                  where: {
                    companyId: input.companyId,
                    channelId: source.sourceChannelId,
                    departmentId: targetDepartmentId,
                  },
                  select: { id: true },
                },
              );
            if (!allowed) {
              throw forbidden(
                'O departamento não está autorizado para roteamento automático neste canal.',
              );
            }
          }
        }
      }

      const now = new Date();
      const actorType =
        classifierExecutionStatus === AgentExecutionStatus.SUCCEEDED
          ? MutationActorType.AI_AGENT
          : MutationActorType.SERVICE;
      const storedClassification =
        input.classification === 'continuation'
          ? ContinuityClassification.CONTINUATION
          : input.classification === 'new-subject'
            ? ContinuityClassification.NEW_SUBJECT
            : ContinuityClassification.UNCERTAIN;
      const fallbackAction =
        input.classification === 'continuation'
          ? null
          : input.classification === 'new-subject'
            ? ContinuityFallbackAction.CREATE_NEW
            : ContinuityFallbackAction.REOPEN_PREVIOUS;
      const before = serviceSessionSnapshot(source);
      let targetSession: ServiceSessionAuthorization;

      if (input.classification === 'new-subject') {
        const closed = await transaction.serviceSession.updateMany({
          where: {
            id: source.id,
            companyId: input.companyId,
            version: input.expectedVersion,
            status: ServiceSessionStatus.OPEN,
            controlMode: ServiceSessionControlMode.AI,
            isForeground: true,
          },
          data: {
            status: ServiceSessionStatus.CLOSED,
            isForeground: false,
            responsibleUserId: null,
            queueId: null,
            publicContinuationCode: null,
            continuationCodeExpiresAt: null,
            closingStartedAt: null,
            closingDeadlineAt: null,
            closedAt: now,
            version: { increment: 1 },
          },
        });
        if (closed.count !== 1) {
          throw new AppError(
            'CONFLICT',
            'A sessão mudou durante a classificação de continuidade.',
          );
        }
        const closedSource = await transaction.serviceSession.findUniqueOrThrow(
          {
            where: {
              id_companyId: { id: source.id, companyId: input.companyId },
            },
            select: serviceSessionAuthorizationSelect,
          },
        );
        targetSession = await transaction.serviceSession.create({
          data: {
            companyId: input.companyId,
            threadId: source.threadId,
            sourceChannelId: source.sourceChannelId,
            currentDepartmentId: targetDepartmentId,
            relatedServiceSessionId: source.id,
            status: ServiceSessionStatus.OPEN,
            controlMode: ServiceSessionControlMode.AI,
            priority: ServiceSessionPriority.NORMAL,
            prioritySource: ServiceSessionPrioritySource.SYSTEM,
            isForeground: true,
            conversationResolved: false,
            pendingActions: [],
            resolutionConfirmedByCustomer: false,
          },
          select: serviceSessionAuthorizationSelect,
        });

        const movedMessages = await transaction.whatsAppMessage.updateMany({
          where: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            serviceSessionId: source.id,
            createdAt: { gte: decision.createdAt },
          },
          data: { serviceSessionId: targetSession.id },
        });
        if (movedMessages.count < 1) {
          throw new AppError(
            'CONFLICT',
            'A mensagem que iniciou o novo assunto não pôde ser relacionada.',
          );
        }
        await transaction.whatsAppConversationTransition.updateMany({
          where: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            serviceSessionId: source.id,
            createdAt: { gte: decision.createdAt },
          },
          data: { serviceSessionId: targetSession.id },
        });
        const participants = await transaction.conversationParticipant.findMany(
          {
            where: {
              companyId: input.companyId,
              serviceSessionId: source.id,
              validUntil: null,
            },
            select: {
              whatsappContactId: true,
              registrationId: true,
              role: true,
              isPrimary: true,
              confidence: true,
              identificationSource: true,
              confirmedByUserId: true,
              confirmedAt: true,
              metadata: true,
            },
          },
        );
        if (participants.length > 0) {
          await transaction.conversationParticipant.createMany({
            data: participants.map((participant) => ({
              companyId: input.companyId,
              serviceSessionId: targetSession.id,
              ...participant,
              validFrom: now,
              metadata: payload({
                ...(participant.metadata as Record<string, unknown>),
                continuitySourceServiceSessionId: source.id,
              }),
            })),
          });
        }

        const closedAfter = serviceSessionSnapshot(closedSource);
        await transaction.serviceSessionEvent.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: source.id,
            commandId: input.commandId,
            commandFingerprint: fingerprint,
            name: 'continuity-classified-new-subject',
            expectedVersion: input.expectedVersion,
            resultingVersion: closedSource.version,
            actorType,
            actorAgentId: input.actorAgentId,
            beforeSnapshot: payload(before),
            afterSnapshot: payload(closedAfter),
            metadata: payload({
              classification: input.classification,
              confidence: input.confidence,
              reason,
              targetServiceSessionId: targetSession.id,
              targetDepartmentId,
              ...(input.agentExecutionId
                ? { agentExecutionId: input.agentExecutionId }
                : {}),
            }),
            createdAt: now,
          },
        });
        const targetAfter = serviceSessionSnapshot(targetSession);
        const createCommandId = correlation(
          'continuity-related-session-created',
          input.commandId,
        );
        await transaction.serviceSessionEvent.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: targetSession.id,
            commandId: createCommandId,
            commandFingerprint: commandFingerprint({
              commandId: createCommandId,
              sourceServiceSessionId: source.id,
              target: targetAfter,
            }),
            name: 'continuity-related-session-created',
            expectedVersion: 0,
            resultingVersion: targetSession.version,
            actorType,
            actorAgentId: input.actorAgentId,
            beforeSnapshot: payload({}),
            afterSnapshot: payload(targetAfter),
            metadata: payload({
              sourceServiceSessionId: source.id,
              continuityDecisionId: decision.id,
              ...(input.agentExecutionId
                ? { agentExecutionId: input.agentExecutionId }
                : {}),
            }),
            createdAt: now,
          },
        });

        if (
          targetDepartment &&
          conversation.department !== targetDepartment.code
        ) {
          const from = snapshot(conversation);
          const expectedConversationVersion = conversation.version;
          const updated = await transaction.whatsAppConversation.updateMany({
            where: {
              id: input.conversationId,
              companyId: input.companyId,
              version: expectedConversationVersion,
            },
            data: {
              department: targetDepartment.code,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw currentVersionConflict(expectedConversationVersion);
          }
          conversation = await this.findConversationOrThrow(
            transaction,
            input.companyId,
            input.conversationId,
          );
          const after = snapshot(conversation);
          const transitionCommandId = correlation(
            'continuity-new-subject-route',
            input.commandId,
          );
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: input.companyId,
              conversationId: input.conversationId,
              threadId: source.threadId,
              serviceSessionId: targetSession.id,
              commandId: transitionCommandId,
              commandFingerprint: commandFingerprint({
                commandId: transitionCommandId,
                from,
                after,
                continuityDecisionId: decision.id,
              }),
              name: 'continuity-new-subject-route',
              expectedVersion: expectedConversationVersion,
              resultingVersion: conversation.version,
              actorType: TransitionActorType.SYSTEM,
              fromDepartment: departmentToPrisma[from.department],
              toDepartment: targetDepartment.code,
              fromState: stateToPrisma[from.conversationState],
              toState: conversation.conversationState,
              fromFlowStep: flowToPrisma[from.flowStep],
              toFlowStep: conversation.flowStep,
              fromRequestStatus: requestToPrisma[from.requestStatus],
              toRequestStatus: conversation.requestStatus,
              metadata: payload({
                continuityDecisionId: decision.id,
                sourceServiceSessionId: source.id,
                targetServiceSessionId: targetSession.id,
                reason,
              }),
              resultSnapshot: payload(after),
              createdAt: now,
            },
          });
        }
      } else {
        const updated = await transaction.serviceSession.updateMany({
          where: {
            id: source.id,
            companyId: input.companyId,
            version: input.expectedVersion,
            status: ServiceSessionStatus.OPEN,
            controlMode: ServiceSessionControlMode.AI,
            isForeground: true,
          },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new AppError(
            'CONFLICT',
            'A sessão mudou durante a classificação de continuidade.',
          );
        }
        targetSession = await transaction.serviceSession.findUniqueOrThrow({
          where: {
            id_companyId: { id: source.id, companyId: input.companyId },
          },
          select: serviceSessionAuthorizationSelect,
        });
        const after = serviceSessionSnapshot(targetSession);
        await transaction.serviceSessionEvent.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: source.id,
            commandId: input.commandId,
            commandFingerprint: fingerprint,
            name:
              input.classification === 'continuation'
                ? 'continuity-classified-continuation'
                : 'continuity-classified-uncertain',
            expectedVersion: input.expectedVersion,
            resultingVersion: targetSession.version,
            actorType,
            actorAgentId: input.actorAgentId,
            beforeSnapshot: payload(before),
            afterSnapshot: payload(after),
            metadata: payload({
              classification: input.classification,
              confidence: input.confidence,
              reason,
              targetServiceSessionId: targetSession.id,
              targetDepartmentId,
              ...(input.agentExecutionId
                ? { agentExecutionId: input.agentExecutionId }
                : {}),
            }),
            createdAt: now,
          },
        });
      }

      const decisionUpdated =
        await transaction.serviceSessionContinuityDecision.updateMany({
          where: {
            id: decision.id,
            companyId: input.companyId,
            classification: ContinuityClassification.UNCERTAIN,
            fallbackAction: ContinuityFallbackAction.REOPEN_PREVIOUS,
            agentExecutionId: null,
          },
          data: {
            targetServiceSessionId: targetSession.id,
            targetDepartmentId,
            agentExecutionId: input.agentExecutionId,
            classification: storedClassification,
            fallbackAction,
            confidence: input.confidence,
            reason,
          },
        });
      if (decisionUpdated.count !== 1) {
        throw new AppError(
          'CONFLICT',
          'A decisão de continuidade mudou durante a classificação.',
        );
      }
      return {
        serviceSessionId: targetSession.id,
        version: targetSession.version,
        classification: input.classification,
        idempotent: false,
      };
    });
  }

  async processServiceSessionLifecycle(
    input: ProcessServiceSessionLifecycleInput,
  ): Promise<ProcessServiceSessionLifecycleResult> {
    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.min(200, Math.trunc(input.limit)))
      : 50;
    const due = await this.prisma.serviceSession.findMany({
      where: {
        status: ServiceSessionStatus.CLOSING,
        controlMode: ServiceSessionControlMode.AI,
        isForeground: true,
        closingDeadlineAt: { lte: input.now },
      },
      orderBy: [{ closingDeadlineAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, companyId: true, threadId: true },
    });

    let closed = 0;
    let skipped = 0;
    for (const candidate of due) {
      try {
        if (await this.finishAiServiceSessionClosing(candidate, input.now)) {
          closed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        if (!isPrismaUniqueError(error)) throw error;
        skipped += 1;
      }
    }

    const remaining = limit - due.length;
    let closingStarted = 0;
    if (remaining > 0) {
      const eligible = await this.prisma.serviceSession.findMany({
        where: {
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.AI,
          isForeground: true,
          conversationResolved: true,
          closingStartedAt: null,
          closingDeadlineAt: null,
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: remaining,
        select: { id: true, companyId: true, threadId: true },
      });
      for (const candidate of eligible) {
        try {
          if (await this.beginAiServiceSessionClosing(candidate, input.now)) {
            closingStarted += 1;
          } else {
            skipped += 1;
          }
        } catch (error) {
          if (!isPrismaUniqueError(error)) throw error;
          skipped += 1;
        }
      }
    }

    return { closingStarted, closed, skipped };
  }

  private async beginAiServiceSessionClosing(
    candidate: { id: string; companyId: string; threadId: string },
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      let conversation = await transaction.whatsAppConversation.findFirst({
        where: {
          companyId: candidate.companyId,
          threadId: candidate.threadId,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        include: conversationInclude,
      });
      if (!conversation) return false;
      await this.lockCommand(
        transaction,
        candidate.companyId,
        'whatsapp-conversation',
        conversation.id,
      );
      await this.lockCommand(
        transaction,
        candidate.companyId,
        'service-session-lifecycle',
        candidate.threadId,
      );
      conversation = await this.findConversationOrThrow(
        transaction,
        candidate.companyId,
        conversation.id,
      );
      const session = await transaction.serviceSession.findUnique({
        where: {
          id_companyId: { id: candidate.id, companyId: candidate.companyId },
        },
        select: serviceSessionAuthorizationSelect,
      });
      if (
        !session ||
        session.threadId !== candidate.threadId ||
        session.status !== ServiceSessionStatus.OPEN ||
        session.controlMode !== ServiceSessionControlMode.AI ||
        !session.isForeground ||
        !session.conversationResolved ||
        !pendingActionsAreEmpty(session.pendingActions) ||
        conversation.conversationState !== ConversationState.BOT_ACTIVE ||
        conversation.flowStep === FlowStep.HUMAN_SERVICE ||
        conversation.assignedToUserId !== null
      ) {
        return false;
      }
      const [pendingDeliveries, incompleteProposalDocuments] =
        await Promise.all([
          transaction.whatsAppMessage.count({
            where: {
              companyId: candidate.companyId,
              serviceSessionId: session.id,
              direction: MessageDirection.OUTBOUND,
              deliveryStatus: DeliveryStatus.PENDING,
            },
          }),
          transaction.quoteProposalDocument.count({
            where: {
              companyId: candidate.companyId,
              serviceSessionId: session.id,
              status: { not: QuoteProposalDocumentStatus.SENT },
            },
          }),
        ]);
      if (pendingDeliveries > 0 || incompleteProposalDocuments > 0) {
        return false;
      }

      const before = serviceSessionSnapshot(session);
      const deadline = new Date(now.getTime() + AI_CLOSING_WAIT_MS);
      const updated = await transaction.serviceSession.updateMany({
        where: {
          id: session.id,
          companyId: candidate.companyId,
          version: session.version,
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.AI,
          isForeground: true,
          conversationResolved: true,
        },
        data: {
          status: ServiceSessionStatus.CLOSING,
          closingStartedAt: now,
          closingDeadlineAt: deadline,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;
      const closing = await transaction.serviceSession.findUniqueOrThrow({
        where: {
          id_companyId: { id: session.id, companyId: candidate.companyId },
        },
        select: serviceSessionAuthorizationSelect,
      });
      const after = serviceSessionSnapshot(closing);
      const commandId = correlation(
        'ai-closing-started',
        `${session.id}:${session.version}`,
      );
      await transaction.serviceSessionEvent.create({
        data: {
          companyId: candidate.companyId,
          serviceSessionId: session.id,
          commandId,
          commandFingerprint: commandFingerprint({
            commandId,
            before,
            after,
          }),
          name: 'ai-closing-started',
          expectedVersion: session.version,
          resultingVersion: closing.version,
          actorType: MutationActorType.SERVICE,
          beforeSnapshot: payload(before),
          afterSnapshot: payload(after),
          metadata: payload({
            initiatedBy: 'ai-policy',
            waitMilliseconds: AI_CLOSING_WAIT_MS,
          }),
          createdAt: now,
        },
      });
      await this.createServiceSessionLifecycleOutbound(transaction, {
        conversation,
        session: closing,
        text: LUME_AI_CLOSING_QUESTION,
        purpose: 'service-session-closing-question',
        occurredAt: now,
      });
      return true;
    });
  }

  private async finishAiServiceSessionClosing(
    candidate: { id: string; companyId: string; threadId: string },
    now: Date,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          let conversation = await transaction.whatsAppConversation.findFirst({
            where: {
              companyId: candidate.companyId,
              threadId: candidate.threadId,
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            include: conversationInclude,
          });
          if (!conversation) return false;
          await this.lockCommand(
            transaction,
            candidate.companyId,
            'whatsapp-conversation',
            conversation.id,
          );
          await this.lockCommand(
            transaction,
            candidate.companyId,
            'service-session-lifecycle',
            candidate.threadId,
          );
          await this.lockCommand(
            transaction,
            candidate.companyId,
            'service-session-thread',
            candidate.threadId,
          );
          conversation = await this.findConversationOrThrow(
            transaction,
            candidate.companyId,
            conversation.id,
          );
          const session = await transaction.serviceSession.findUnique({
            where: {
              id_companyId: {
                id: candidate.id,
                companyId: candidate.companyId,
              },
            },
            select: serviceSessionAuthorizationSelect,
          });
          if (
            !session ||
            session.threadId !== candidate.threadId ||
            session.status !== ServiceSessionStatus.CLOSING ||
            session.controlMode !== ServiceSessionControlMode.AI ||
            !session.isForeground ||
            !session.conversationResolved ||
            !pendingActionsAreEmpty(session.pendingActions) ||
            session.closingStartedAt === null ||
            session.closingDeadlineAt === null ||
            session.closingDeadlineAt > now ||
            conversation.conversationState !== ConversationState.BOT_ACTIVE ||
            conversation.flowStep === FlowStep.HUMAN_SERVICE ||
            conversation.assignedToUserId !== null
          ) {
            return false;
          }
          const closingQuestion = await transaction.whatsAppMessage.findFirst({
            where: {
              companyId: candidate.companyId,
              serviceSessionId: session.id,
              automationPurpose: 'service-session-closing-question',
              direction: MessageDirection.OUTBOUND,
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            select: { deliveryStatus: true },
          });
          if (
            !closingQuestion ||
            closingQuestion.deliveryStatus === DeliveryStatus.PENDING ||
            closingQuestion.deliveryStatus === DeliveryStatus.FAILED
          ) {
            return false;
          }
          const incompleteProposalDocuments =
            await transaction.quoteProposalDocument.count({
              where: {
                companyId: candidate.companyId,
                serviceSessionId: session.id,
                status: { not: QuoteProposalDocumentStatus.SENT },
              },
            });
          if (incompleteProposalDocuments > 0) return false;

          const code = await this.allocatePublicContinuationCode(
            transaction,
            candidate.companyId,
            now,
          );
          const expiresAt = publicContinuationCodeExpiresAt(now);
          const before = serviceSessionSnapshot(session);
          const updated = await transaction.serviceSession.updateMany({
            where: {
              id: session.id,
              companyId: candidate.companyId,
              version: session.version,
              status: ServiceSessionStatus.CLOSING,
              controlMode: ServiceSessionControlMode.AI,
              isForeground: true,
              closingDeadlineAt: { lte: now },
            },
            data: {
              status: ServiceSessionStatus.CLOSED,
              isForeground: false,
              responsibleUserId: null,
              queueId: null,
              publicContinuationCode: code,
              continuationCodeExpiresAt: expiresAt,
              closingStartedAt: null,
              closingDeadlineAt: null,
              closedAt: now,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new AppError(
              'CONFLICT',
              'A sessão mudou durante o fechamento automático.',
            );
          }
          const closedSession =
            await transaction.serviceSession.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: session.id,
                  companyId: candidate.companyId,
                },
              },
              select: serviceSessionAuthorizationSelect,
            });
          const after = serviceSessionSnapshot(closedSession);
          const commandId = correlation(
            'ai-closing-finished',
            `${session.id}:${session.version}`,
          );
          await transaction.serviceSessionEvent.create({
            data: {
              companyId: candidate.companyId,
              serviceSessionId: session.id,
              commandId,
              commandFingerprint: commandFingerprint({
                commandId,
                before,
                after,
              }),
              name: 'ai-closing-finished',
              expectedVersion: session.version,
              resultingVersion: closedSession.version,
              actorType: MutationActorType.SERVICE,
              beforeSnapshot: payload(before),
              afterSnapshot: payload(after),
              metadata: payload({
                initiatedBy: 'ai-policy',
                publicContinuationCodeExpiresAt: expiresAt.toISOString(),
              }),
              createdAt: now,
            },
          });

          const predecessor = await this.findPriorityResumePredecessor(
            transaction,
            {
              companyId: candidate.companyId,
              threadId: candidate.threadId,
              interruptedBySessionId: closedSession.id,
            },
          );
          if (predecessor) {
            const predecessorBefore = serviceSessionSnapshot(
              predecessor.session,
            );
            const resumedStatus =
              priorityResumeStatusToPrisma[predecessor.previousStatus];
            const predecessorUpdated =
              await transaction.serviceSession.updateMany({
                where: {
                  id: predecessor.session.id,
                  companyId: candidate.companyId,
                  threadId: candidate.threadId,
                  version: predecessor.session.version,
                  status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
                  isForeground: false,
                },
                data: {
                  status: resumedStatus,
                  isForeground: true,
                  version: { increment: 1 },
                },
              });
            if (predecessorUpdated.count !== 1) {
              throw new AppError(
                'CONFLICT',
                'A sessão interrompida mudou durante a retomada automática.',
              );
            }
            const resumedSession =
              await transaction.serviceSession.findUniqueOrThrow({
                where: {
                  id_companyId: {
                    id: predecessor.session.id,
                    companyId: candidate.companyId,
                  },
                },
                select: serviceSessionAuthorizationSelect,
              });
            const predecessorAfter = serviceSessionSnapshot(resumedSession);
            const resumeCommandId = correlation(
              'priority-resumed',
              `${closedSession.id}:${closedSession.version}:${predecessor.session.id}:${predecessor.session.version}`,
            );
            const resumeMetadata = {
              resumedAfterSessionId: closedSession.id,
              resumeReason: 'automatic-ai-close',
              restoredStatus: predecessor.previousStatus,
              pausedAt: predecessor.pausedAt.toISOString(),
              priority: servicePriorityFromPrisma[predecessor.session.priority],
              organizationalWeight:
                predecessor.session.queue?.priorityWeight ??
                predecessor.session.currentDepartment?.serviceQueues[0]
                  ?.priorityWeight ??
                0,
              tiePolicy: 'current-foreground-wins',
            } as const;
            await transaction.serviceSessionEvent.create({
              data: {
                companyId: candidate.companyId,
                serviceSessionId: resumedSession.id,
                commandId: resumeCommandId,
                commandFingerprint: commandFingerprint({
                  commandId: resumeCommandId,
                  before: predecessorBefore,
                  after: predecessorAfter,
                  metadata: resumeMetadata,
                }),
                name: 'priority-resumed',
                expectedVersion: predecessor.session.version,
                resultingVersion: resumedSession.version,
                actorType: MutationActorType.SERVICE,
                beforeSnapshot: payload(predecessorBefore),
                afterSnapshot: payload(predecessorAfter),
                metadata: payload(resumeMetadata),
                createdAt: now,
              },
            });
            await transaction.tenantAuditLog.create({
              data: {
                companyId: candidate.companyId,
                action: 'service-session.priority-resumed',
                targetType: 'service-session',
                targetId: resumedSession.id,
                metadata: payload({
                  commandId: resumeCommandId,
                  expectedVersion: predecessor.session.version,
                  resultingVersion: resumedSession.version,
                  ...resumeMetadata,
                }),
                createdAt: now,
              },
            });

            const resumedDepartment = resumedSession.currentDepartmentId
              ? await transaction.tenantDepartment.findFirst({
                  where: {
                    id: resumedSession.currentDepartmentId,
                    companyId: candidate.companyId,
                  },
                  select: { code: true },
                })
              : null;
            if (resumedSession.currentDepartmentId && !resumedDepartment) {
              throw new AppError(
                'CONFLICT',
                'O departamento da sessão retomada não está mais disponível.',
              );
            }
            const resumedConversationState =
              resumedSession.controlMode === ServiceSessionControlMode.HUMAN
                ? resumedSession.responsibleUserId
                  ? ConversationState.HUMAN_ACTIVE
                  : ConversationState.SENT_TO_HUMAN
                : resumedSession.status ===
                    ServiceSessionStatus.WAITING_CUSTOMER
                  ? ConversationState.WAITING_FOR_CUSTOMER
                  : ConversationState.BOT_ACTIVE;
            const resumedFlowStep =
              resumedSession.controlMode === ServiceSessionControlMode.HUMAN
                ? FlowStep.HUMAN_SERVICE
                : conversation.resumeFlowStep &&
                    conversation.resumeFlowStep !== FlowStep.HUMAN_SERVICE &&
                    conversation.resumeFlowStep !== FlowStep.CLOSED
                  ? conversation.resumeFlowStep
                  : conversation.flowStep !== FlowStep.CLOSED
                    ? conversation.flowStep
                    : FlowStep.MAIN_MENU;
            const conversationUpdated =
              await transaction.whatsAppConversation.updateMany({
                where: {
                  id: conversation.id,
                  companyId: candidate.companyId,
                  threadId: candidate.threadId,
                  version: conversation.version,
                },
                data: {
                  department:
                    resumedDepartment?.code ?? conversation.department,
                  conversationState: resumedConversationState,
                  flowStep: resumedFlowStep,
                  assignedToUserId: resumedSession.responsibleUserId,
                  ...(resumedSession.controlMode ===
                  ServiceSessionControlMode.AI
                    ? { resumeState: null, resumeFlowStep: null }
                    : {}),
                  closedAt: null,
                  version: { increment: 1 },
                },
              });
            if (conversationUpdated.count !== 1) {
              throw currentVersionConflict(conversation.version);
            }
            const resumedConversation = await this.findConversationOrThrow(
              transaction,
              candidate.companyId,
              conversation.id,
            );
            const facadeCommandId = correlation(
              'priority-resumed-facade',
              resumeCommandId,
            );
            await transaction.whatsAppConversationTransition.create({
              data: {
                companyId: candidate.companyId,
                conversationId: conversation.id,
                threadId: candidate.threadId,
                serviceSessionId: resumedSession.id,
                commandId: facadeCommandId,
                commandFingerprint: commandFingerprint({
                  commandId: facadeCommandId,
                  resumedAfterSessionId: closedSession.id,
                  resumedServiceSessionId: resumedSession.id,
                  expectedVersion: conversation.version,
                  resultingVersion: resumedConversation.version,
                }),
                name: 'priority-resumed',
                expectedVersion: conversation.version,
                resultingVersion: resumedConversation.version,
                actorType: TransitionActorType.SYSTEM,
                fromDepartment: conversation.department,
                toDepartment: resumedConversation.department,
                fromState: conversation.conversationState,
                toState: resumedConversation.conversationState,
                fromFlowStep: conversation.flowStep,
                toFlowStep: resumedConversation.flowStep,
                fromRequestStatus: conversation.requestStatus,
                toRequestStatus: resumedConversation.requestStatus,
                metadata: payload({
                  resumedAfterSessionId: closedSession.id,
                  resumedServiceSessionId: resumedSession.id,
                  resumeCommandId,
                  reason: 'automatic-ai-close',
                }),
                resultSnapshot: payload({
                  id: resumedConversation.id,
                  ...snapshot(resumedConversation),
                  version: resumedConversation.version,
                }),
                createdAt: now,
              },
            });
            return true;
          }

          const conversationUpdated =
            await transaction.whatsAppConversation.updateMany({
              where: {
                id: conversation.id,
                companyId: candidate.companyId,
                version: conversation.version,
              },
              data: {
                conversationState: ConversationState.CLOSED,
                flowStep: FlowStep.CLOSED,
                assignedToUserId: null,
                resumeState: null,
                resumeFlowStep: null,
                closedAt: now,
                version: { increment: 1 },
              },
            });
          if (conversationUpdated.count !== 1) {
            throw currentVersionConflict(conversation.version);
          }
          const closedConversation = await this.findConversationOrThrow(
            transaction,
            candidate.companyId,
            conversation.id,
          );
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: candidate.companyId,
              conversationId: conversation.id,
              threadId: candidate.threadId,
              serviceSessionId: closedSession.id,
              commandId: correlation(
                'ai-session-closed',
                `${closedSession.id}:${closedSession.version}`,
              ),
              commandFingerprint: commandFingerprint({
                serviceSessionId: closedSession.id,
                resultingVersion: closedConversation.version,
              }),
              name: 'ai-session-closed',
              expectedVersion: conversation.version,
              resultingVersion: closedConversation.version,
              actorType: TransitionActorType.SYSTEM,
              fromDepartment: conversation.department,
              toDepartment: closedConversation.department,
              fromState: conversation.conversationState,
              toState: closedConversation.conversationState,
              fromFlowStep: conversation.flowStep,
              toFlowStep: closedConversation.flowStep,
              fromRequestStatus: conversation.requestStatus,
              toRequestStatus: closedConversation.requestStatus,
              metadata: payload({
                reason: 'ai-closing-timeout',
                serviceSessionId: closedSession.id,
              }),
              resultSnapshot: payload({
                id: closedConversation.id,
                ...snapshot(closedConversation),
                version: closedConversation.version,
              }),
              createdAt: now,
            },
          });
          await this.createServiceSessionLifecycleOutbound(transaction, {
            conversation: closedConversation,
            session: closedSession,
            text: formatAiClosureMessage(code),
            purpose: 'service-session-closure',
            occurredAt: now,
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2034'
      ) {
        return false;
      }
      throw error;
    }
  }

  private async findPriorityResumePredecessor(
    transaction: Prisma.TransactionClient,
    input: {
      readonly companyId: string;
      readonly threadId: string;
      readonly interruptedBySessionId: string;
    },
  ): Promise<PriorityResumePredecessor | null> {
    const pausedSessions = await transaction.serviceSession.findMany({
      where: {
        companyId: input.companyId,
        threadId: input.threadId,
        id: { not: input.interruptedBySessionId },
        status: ServiceSessionStatus.PAUSED_BY_HIGHER_PRIORITY,
        isForeground: false,
      },
      select: priorityResumeSessionSelect,
    });
    if (pausedSessions.length === 0) return null;

    const interruptionEvents = await transaction.serviceSessionEvent.findMany({
      where: {
        companyId: input.companyId,
        serviceSessionId: { in: pausedSessions.map((session) => session.id) },
        name: 'priority-interrupted',
      },
      orderBy: [{ resultingVersion: 'desc' }, { createdAt: 'desc' }],
      select: {
        serviceSessionId: true,
        beforeSnapshot: true,
        metadata: true,
        createdAt: true,
      },
    });
    const contexts = new Map<
      string,
      {
        readonly interruptedBySessionId: string;
        readonly previousStatus: RestorablePrioritySessionStatus;
        readonly pausedAt: Date;
      }
    >();
    for (const event of interruptionEvents) {
      if (contexts.has(event.serviceSessionId)) continue;
      const metadata =
        event.metadata &&
        typeof event.metadata === 'object' &&
        !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : null;
      const before =
        event.beforeSnapshot &&
        typeof event.beforeSnapshot === 'object' &&
        !Array.isArray(event.beforeSnapshot)
          ? (event.beforeSnapshot as Record<string, unknown>)
          : null;
      const previousStatus = restorablePriorityStatus(before?.status);
      if (
        typeof metadata?.interruptedBySessionId !== 'string' ||
        !previousStatus
      ) {
        continue;
      }
      contexts.set(event.serviceSessionId, {
        interruptedBySessionId: metadata.interruptedBySessionId,
        previousStatus,
        pausedAt: event.createdAt,
      });
    }

    const candidates = pausedSessions.flatMap((session) => {
      const context = contexts.get(session.id);
      return context?.interruptedBySessionId === input.interruptedBySessionId
        ? [
            {
              sessionId: session.id,
              priority: servicePriorityFromPrisma[session.priority],
              organizationalWeight:
                session.queue?.priorityWeight ??
                session.currentDepartment?.serviceQueues[0]?.priorityWeight ??
                0,
              previousStatus: context.previousStatus,
              pausedAt: context.pausedAt,
            } satisfies PausedPriorityCandidate,
          ]
        : [];
    });
    const selected = selectPriorityResumeCandidate(candidates);
    if (!selected) return null;
    const selectedSession = pausedSessions.find(
      (session) => session.id === selected.sessionId,
    );
    if (!selectedSession) return null;
    return {
      session: selectedSession,
      previousStatus: selected.previousStatus,
      pausedAt: selected.pausedAt,
    };
  }

  private async allocatePublicContinuationCode(
    transaction: Prisma.TransactionClient,
    companyId: string,
    now: Date,
  ): Promise<string> {
    await this.lockCommand(
      transaction,
      companyId,
      'public-continuation-code-pool',
      companyId,
    );
    const occupied = await transaction.serviceSession.findMany({
      where: { companyId, publicContinuationCode: { not: null } },
      select: serviceSessionAuthorizationSelect,
    });
    const byCode = new Map(
      occupied.flatMap((session) =>
        session.publicContinuationCode
          ? [[session.publicContinuationCode, session] as const]
          : [],
      ),
    );
    const start = Number(createPublicContinuationCode());
    for (let offset = 0; offset < 900; offset += 1) {
      const code = String(100 + ((start - 100 + offset) % 900));
      const owner = byCode.get(code);
      if (!owner) return code;
      if (
        owner.continuationCodeExpiresAt &&
        owner.continuationCodeExpiresAt <= now
      ) {
        const before = serviceSessionSnapshot(owner);
        const cleared = await transaction.serviceSession.updateMany({
          where: {
            id: owner.id,
            companyId,
            version: owner.version,
            publicContinuationCode: code,
            continuationCodeExpiresAt: { lte: now },
          },
          data: {
            publicContinuationCode: null,
            continuationCodeExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (cleared.count !== 1) continue;
        const expired = await transaction.serviceSession.findUniqueOrThrow({
          where: { id_companyId: { id: owner.id, companyId } },
          select: serviceSessionAuthorizationSelect,
        });
        const after = serviceSessionSnapshot(expired);
        const commandId = correlation(
          'public-continuation-code-expired',
          `${owner.id}:${owner.version}`,
        );
        await transaction.serviceSessionEvent.create({
          data: {
            companyId,
            serviceSessionId: owner.id,
            commandId,
            commandFingerprint: commandFingerprint({
              commandId,
              before,
              after,
            }),
            name: 'public-continuation-code-expired',
            expectedVersion: owner.version,
            resultingVersion: expired.version,
            actorType: MutationActorType.SERVICE,
            beforeSnapshot: payload(before),
            afterSnapshot: payload(after),
            metadata: payload({ expiredAt: now.toISOString() }),
            createdAt: now,
          },
        });
        return code;
      }
    }
    throw new AppError(
      'CONFLICT',
      'Não há código público de continuidade disponível para este tenant.',
    );
  }

  private async createServiceSessionLifecycleOutbound(
    transaction: Prisma.TransactionClient,
    input: {
      conversation: ConversationWithRelations;
      session: ServiceSessionAuthorization;
      text: string;
      purpose: 'service-session-closing-question' | 'service-session-closure';
      occurredAt: Date;
    },
  ): Promise<void> {
    const message = await transaction.whatsAppMessage.create({
      data: {
        companyId: input.conversation.companyId,
        conversationId: input.conversation.id,
        channelId: input.conversation.channelId,
        contactId: input.conversation.contactId,
        threadId: input.session.threadId,
        serviceSessionId: input.session.id,
        actorType: WhatsAppMessageActorType.SYSTEM,
        source: WhatsAppMessageSource.AUTOMATION,
        direction: MessageDirection.OUTBOUND,
        deliveryStatus: DeliveryStatus.PENDING,
        kind: MessageKind.TEXT,
        text: input.text,
        automationPurpose: input.purpose,
        recipientPhone: input.conversation.contact.phoneNormalized,
        correlationId: correlation(
          input.purpose,
          `${input.session.id}:${input.session.version}`,
        ),
        occurredAt: input.occurredAt,
      },
    });
    const attempt = await transaction.whatsAppMessageAttempt.create({
      data: {
        companyId: input.conversation.companyId,
        messageId: message.id,
        attemptNumber: 1,
        status: MessageAttemptStatus.PENDING,
      },
    });
    await transaction.whatsAppConversation.updateMany({
      where: {
        id: input.conversation.id,
        companyId: input.conversation.companyId,
      },
      data: {
        lastOutboundAt: input.occurredAt,
        lastMessagePreview: input.text.slice(0, 240),
      },
    });
    await this.createOrderedOutbox(transaction, {
      companyId: input.conversation.companyId,
      topic: 'whatsapp.outbound.requested',
      aggregateType: 'whatsapp-conversation',
      aggregateId: input.conversation.id,
      correlationId: correlation(
        `${input.purpose}-requested`,
        `${input.session.id}:${input.session.version}`,
      ),
      payload: {
        eventId: message.id,
        commandId: message.id,
        messageId: message.id,
        attemptId: attempt.id,
        conversationId: input.conversation.id,
        threadId: input.session.threadId,
        serviceSessionId: input.session.id,
        channelId: input.conversation.channelId,
        companyId: input.conversation.companyId,
        contact: {
          id: input.conversation.contact.id,
          phone: input.conversation.contact.phoneNormalized,
          displayName: input.conversation.contact.displayName,
        },
        message: {
          providerMessageId: null,
          direction: 'outbound',
          deliveryStatus: 'pending',
          kind: 'text',
          text: input.text,
          media: null,
          occurredAt: input.occurredAt.toISOString(),
        },
        conversation: {
          id: input.conversation.id,
          ...snapshot(input.conversation),
          version: input.conversation.version,
        },
        automatic: true,
        automationAllowed: false,
        canGenerateReply: false,
        canSendReply: true,
        contextualTransition: false,
        isFirstContact: false,
      },
    });
  }

  private async upsertWebhookGroupParticipant(
    transaction: Prisma.TransactionClient,
    input: {
      companyId: string;
      groupId: string;
      occurredAt: Date;
      participant: SyncWebhookGroupInput['participants'][number];
    },
  ) {
    const registrationCandidates = input.participant.phoneNormalized
      ? await transaction.registrationPhone.findMany({
          where: {
            companyId: input.companyId,
            normalizedValue: input.participant.phoneNormalized,
            AND: [
              {
                OR: [
                  { activeFrom: null },
                  { activeFrom: { lte: input.occurredAt } },
                ],
              },
              {
                OR: [
                  { activeUntil: null },
                  { activeUntil: { gte: input.occurredAt } },
                ],
              },
            ],
          },
          distinct: ['registrationId'],
          orderBy: { registrationId: 'asc' },
          take: 2,
          select: { registrationId: true },
        })
      : [];
    const linkedRegistrationId =
      registrationCandidates.length === 1
        ? registrationCandidates[0]?.registrationId
        : null;

    return transaction.whatsAppGroupParticipant.upsert({
      where: {
        companyId_groupId_whatsappId: {
          companyId: input.companyId,
          groupId: input.groupId,
          whatsappId: input.participant.whatsappId,
        },
      },
      create: {
        companyId: input.companyId,
        groupId: input.groupId,
        whatsappId: input.participant.whatsappId,
        phoneNumber: input.participant.phoneNormalized,
        displayName: input.participant.displayName,
        isAdmin: input.participant.isAdmin ?? false,
        linkedRegistrationId,
        joinedAt: input.participant.removed ? undefined : input.occurredAt,
        leftAt: input.participant.removed ? input.occurredAt : null,
      },
      update: {
        ...(input.participant.phoneNormalized
          ? { phoneNumber: input.participant.phoneNormalized }
          : {}),
        ...(input.participant.displayName
          ? { displayName: input.participant.displayName }
          : {}),
        ...(input.participant.isAdmin === undefined
          ? {}
          : { isAdmin: input.participant.isAdmin }),
        linkedRegistrationId,
        leftAt: input.participant.removed ? input.occurredAt : null,
      },
      select: { id: true, whatsappId: true },
    });
  }

  async syncWebhookGroup(input: SyncWebhookGroupInput): Promise<unknown> {
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lockCommand(
        transaction,
        input.channel.companyId,
        'whatsapp-group',
        `${input.channel.id}:${input.whatsappId}`,
      );
      const inboxKey = {
        companyId_source_externalEventId: {
          companyId: input.channel.companyId,
          source: 'evolution.group-sync',
          externalEventId: input.externalEventId,
        },
      };
      const duplicate = await transaction.integrationInbox.findUnique({
        where: inboxKey,
      });
      if (duplicate?.resultSnapshot) {
        assertSameFingerprint(
          duplicate.payloadHash,
          input.payloadHash,
          'externalEventId',
        );
        return {
          ...(duplicate.resultSnapshot as Record<string, unknown>),
          duplicate: true,
        };
      }
      if (!duplicate) {
        await transaction.integrationInbox.create({
          data: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            source: 'evolution.group-sync',
            externalEventId: input.externalEventId,
            payloadHash: input.payloadHash,
            correlationId: input.correlationId,
          },
        });
      }
      const group = await transaction.whatsAppGroup.upsert({
        where: {
          companyId_channelId_whatsappId: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            whatsappId: input.whatsappId,
          },
        },
        create: {
          companyId: input.channel.companyId,
          channelId: input.channel.id,
          whatsappId: input.whatsappId,
          displayName: input.displayName,
          aiMode: WhatsAppGroupAiMode.OFF,
          syncedAt: input.occurredAt,
        },
        update: {
          ...(input.displayName ? { displayName: input.displayName } : {}),
          aiMode: WhatsAppGroupAiMode.OFF,
          syncedAt: input.occurredAt,
          archivedAt: null,
        },
        select: { id: true, whatsappId: true, aiMode: true },
      });
      const activeWhatsappIds: string[] = [];
      for (const participant of input.participants) {
        await this.upsertWebhookGroupParticipant(transaction, {
          companyId: input.channel.companyId,
          groupId: group.id,
          occurredAt: input.occurredAt,
          participant,
        });
        if (!participant.removed)
          activeWhatsappIds.push(participant.whatsappId);
      }
      if (input.replaceParticipants) {
        await transaction.whatsAppGroupParticipant.updateMany({
          where: {
            companyId: input.channel.companyId,
            groupId: group.id,
            leftAt: null,
            ...(activeWhatsappIds.length > 0
              ? { whatsappId: { notIn: activeWhatsappIds } }
              : {}),
          },
          data: { leftAt: input.occurredAt },
        });
      }
      const snapshot = {
        accepted: true,
        duplicate: false,
        groupId: group.id,
        whatsappId: group.whatsappId,
        aiMode: group.aiMode.toLowerCase(),
        participantsSeen: input.participants.length,
      };
      await transaction.integrationInbox.update({
        where: inboxKey,
        data: {
          processedAt: new Date(),
          resultSnapshot: payload(snapshot),
        },
      });
      return snapshot;
    });
    return result;
  }

  async persistWebhookGroupMessage(
    input: PersistWebhookGroupMessageInput,
  ): Promise<PersistWebhookGroupMessageResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.channel.companyId,
          'whatsapp-group',
          `${input.channel.id}:${input.groupWhatsappId}`,
        );
        const existingMessage =
          await transaction.whatsAppGroupMessage.findUnique({
            where: {
              companyId_channelId_providerMessageId: {
                companyId: input.channel.companyId,
                channelId: input.channel.id,
                providerMessageId: input.providerMessageId,
              },
            },
            select: { id: true, groupId: true },
          });
        if (existingMessage) {
          return {
            accepted: true,
            duplicate: true,
            groupId: existingMessage.groupId,
            groupMessageId: existingMessage.id,
            conversationId: null,
            threadId: null,
            serviceSessionId: null,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: false,
          };
        }
        const inbox = await transaction.integrationInbox.create({
          data: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            source: 'evolution.group-message',
            externalEventId: input.externalEventId,
            payloadHash: input.payloadHash,
            correlationId: input.correlationId,
          },
        });
        const group = await transaction.whatsAppGroup.upsert({
          where: {
            companyId_channelId_whatsappId: {
              companyId: input.channel.companyId,
              channelId: input.channel.id,
              whatsappId: input.groupWhatsappId,
            },
          },
          create: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            whatsappId: input.groupWhatsappId,
            displayName: input.groupDisplayName,
            aiMode: WhatsAppGroupAiMode.OFF,
            syncedAt: input.occurredAt,
          },
          update: {
            ...(input.groupDisplayName
              ? { displayName: input.groupDisplayName }
              : {}),
            aiMode: WhatsAppGroupAiMode.OFF,
            syncedAt: input.occurredAt,
            archivedAt: null,
          },
          select: { id: true },
        });
        const participant = input.participant
          ? await this.upsertWebhookGroupParticipant(transaction, {
              companyId: input.channel.companyId,
              groupId: group.id,
              occurredAt: input.occurredAt,
              participant: input.participant,
            })
          : null;
        const mediaAssetId = await createWebhookMediaAsset(transaction, {
          companyId: input.channel.companyId,
          kind: input.kind,
          media: input.media,
          occurredAt: input.occurredAt,
          group: true,
        });
        const message = await transaction.whatsAppGroupMessage.create({
          data: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            groupId: group.id,
            participantId: participant?.id,
            mediaAssetId,
            providerMessageId: input.providerMessageId,
            direction:
              input.direction === 'inbound'
                ? MessageDirection.INBOUND
                : MessageDirection.OUTBOUND,
            kind: kindToPrisma[input.kind],
            text: input.text,
            media: input.media ? payload(input.media) : undefined,
            correlationId: input.correlationId,
            occurredAt: input.occurredAt,
          },
          select: { id: true },
        });
        await transaction.integrationInbox.update({
          where: { id: inbox.id },
          data: { processedAt: new Date() },
        });
        return {
          accepted: true,
          duplicate: false,
          groupId: group.id,
          groupMessageId: message.id,
          conversationId: null,
          threadId: null,
          serviceSessionId: null,
          automationAllowed: false,
          canGenerateReply: false,
          canSendReply: false,
        };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const existing = await this.prisma.whatsAppGroupMessage.findUnique({
          where: {
            companyId_channelId_providerMessageId: {
              companyId: input.channel.companyId,
              channelId: input.channel.id,
              providerMessageId: input.providerMessageId,
            },
          },
          select: { id: true, groupId: true },
        });
        if (existing) {
          return {
            accepted: true,
            duplicate: true,
            groupId: existing.groupId,
            groupMessageId: existing.id,
            conversationId: null,
            threadId: null,
            serviceSessionId: null,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: false,
          };
        }
      }
      throw error;
    }
  }

  async ensureConversationForPhone(
    companyId: string,
    phoneNormalized: string,
  ): Promise<EnsureWhatsAppConversationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const channel = await transaction.whatsAppChannel.findFirst({
        where: {
          companyId,
          enabled: true,
          provider: { enabled: true },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!channel) {
        throw validationError(
          'Nenhum canal de WhatsApp est\u00e1 dispon\u00edvel para iniciar a conversa.',
        );
      }

      const contact = await transaction.whatsAppContact.upsert({
        where: {
          companyId_phoneNormalized: { companyId, phoneNormalized },
        },
        create: {
          companyId,
          phoneNormalized,
          phoneDisplay: formatWhatsAppPhone(phoneNormalized),
          displayName: formatWhatsAppPhone(phoneNormalized),
        },
        update: {},
        select: { id: true },
      });

      const conversation = await transaction.whatsAppConversation.upsert({
        where: {
          companyId_channelId_contactId: {
            companyId,
            channelId: channel.id,
            contactId: contact.id,
          },
        },
        create: {
          companyId,
          channelId: channel.id,
          contactId: contact.id,
        },
        update: {},
        select: { id: true },
      });

      const current = await this.findConversationOrThrow(
        transaction,
        companyId,
        conversation.id,
      );
      return presentConversation(current);
    });
  }

  async startHumanConversation(
    input: StartHumanWhatsAppConversationInput,
  ): Promise<
    EnsureWhatsAppConversationResult & { readonly idempotent: boolean }
  > {
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.start-conversation',
          input.commandId,
        );
        const actor = await this.assertCurrentWhatsAppAttendant(
          transaction,
          input.companyId,
          input.actorUserId,
        );

        const duplicate = await transaction.integrationInbox.findUnique({
          where: {
            companyId_source_externalEventId: {
              companyId: input.companyId,
              source: 'panel.start-conversation',
              externalEventId: input.commandId,
            },
          },
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError(
              'CONFLICT',
              'O comando de abertura da conversa está incompleto.',
            );
          }
          return {
            ...(duplicate.resultSnapshot as unknown as EnsureWhatsAppConversationResult),
            idempotent: true,
          };
        }

        const initialDepartment = resolveInitialConversationDepartment(
          actor,
          input.targetDepartment,
        );

        const channel = await transaction.whatsAppChannel.findFirst({
          where: {
            companyId: input.companyId,
            enabled: true,
            provider: { enabled: true },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!channel) {
          throw validationError(
            'Nenhum canal de WhatsApp est\u00e1 dispon\u00edvel para iniciar a conversa.',
          );
        }

        const contact = await transaction.whatsAppContact.upsert({
          where: {
            companyId_phoneNormalized: {
              companyId: input.companyId,
              phoneNormalized: input.phoneNormalized,
            },
          },
          create: {
            companyId: input.companyId,
            phoneNormalized: input.phoneNormalized,
            phoneDisplay: formatWhatsAppPhone(input.phoneNormalized),
            displayName: formatWhatsAppPhone(input.phoneNormalized),
          },
          update: {},
          select: { id: true },
        });

        const conversation = await transaction.whatsAppConversation.upsert({
          where: {
            companyId_channelId_contactId: {
              companyId: input.companyId,
              channelId: channel.id,
              contactId: contact.id,
            },
          },
          create: {
            companyId: input.companyId,
            channelId: channel.id,
            contactId: contact.id,
            department: departmentToPrisma[initialDepartment],
          },
          update: {},
          select: { id: true },
        });

        const current = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          conversation.id,
        );
        const result =
          current.conversationState === ConversationState.HUMAN_ACTIVE &&
          current.assignedToUserId === input.actorUserId
            ? presentConversation(current)
            : await this.transition(
                {
                  companyId: input.companyId,
                  conversationId: current.id,
                  commandId: input.commandId,
                  expectedVersion: current.version,
                  name: 'take-over',
                  actorType: 'user',
                  actorUserId: input.actorUserId,
                  metadata: { source: 'panel-new-conversation' },
                },
                transaction,
              );
        const resultSnapshot = {
          ...(result as EnsureWhatsAppConversationResult),
          idempotent: false,
        };
        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: channel.id,
            source: 'panel.start-conversation',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'panel-start-conversation',
              input.commandId,
            ),
            resultSnapshot: payload(resultSnapshot),
            processedAt: new Date(),
          },
        });
        return resultSnapshot;
      });
    } catch (error) {
      if (!isPrismaUniqueError(error)) throw error;
      return (await this.replayInbox(
        input.companyId,
        'panel.start-conversation',
        input.commandId,
        fingerprint,
        'commandId',
      )) as EnsureWhatsAppConversationResult & {
        readonly idempotent: boolean;
      };
    }
  }

  async persistWebhookMessage(
    input: PersistWebhookMessageInput,
  ): Promise<PersistWebhookMessageResult> {
    try {
      return await this.persistWebhookMessageOnce(input);
    } catch (error) {
      if (!isPrismaUniqueError(error)) throw error;

      // Dois primeiros eventos do mesmo telefone podem disputar a criação do
      // contato ou da conversa. A transação perdedora foi revertida; repetir
      // uma vez permite que ela reutilize o registro confirmado pela vencedora.
      return this.persistWebhookMessageOnce(input);
    }
  }

  private async persistWebhookMessageOnce(
    input: PersistWebhookMessageInput,
  ): Promise<PersistWebhookMessageResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.integrationInbox.findUnique({
          where: {
            companyId_source_externalEventId: {
              companyId: input.channel.companyId,
              source: 'evolution',
              externalEventId: input.externalEventId,
            },
          },
        });
        if (duplicate) {
          const existingMessage = await transaction.whatsAppMessage.findUnique({
            where: {
              companyId_channelId_providerMessageId: {
                companyId: input.channel.companyId,
                channelId: input.channel.id,
                providerMessageId: input.providerMessageId,
              },
            },
          });
          return {
            accepted: true,
            duplicate: true,
            messageId: existingMessage?.id ?? null,
            conversationId: existingMessage?.conversationId ?? null,
            threadId: existingMessage?.threadId ?? null,
            serviceSessionId: existingMessage?.serviceSessionId ?? null,
          };
        }

        const inbox = await transaction.integrationInbox.create({
          data: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            source: 'evolution',
            externalEventId: input.externalEventId,
            payloadHash: input.payloadHash,
            correlationId: input.correlationId,
          },
        });

        const messageAlreadyPersisted =
          await transaction.whatsAppMessage.findUnique({
            where: {
              companyId_channelId_providerMessageId: {
                companyId: input.channel.companyId,
                channelId: input.channel.id,
                providerMessageId: input.providerMessageId,
              },
            },
          });
        if (messageAlreadyPersisted) {
          await transaction.integrationInbox.update({
            where: { id: inbox.id },
            data: { processedAt: new Date() },
          });
          return {
            accepted: true,
            duplicate: true,
            messageId: messageAlreadyPersisted.id,
            conversationId: messageAlreadyPersisted.conversationId,
            threadId: messageAlreadyPersisted.threadId,
            serviceSessionId: messageAlreadyPersisted.serviceSessionId,
          };
        }

        const contact = await transaction.whatsAppContact.upsert({
          where: {
            companyId_phoneNormalized: {
              companyId: input.channel.companyId,
              phoneNormalized: input.phoneNormalized,
            },
          },
          create: {
            companyId: input.channel.companyId,
            phoneNormalized: input.phoneNormalized,
            phoneDisplay: formatWhatsAppPhone(input.phoneNormalized),
            displayName: input.displayName,
            profilePictureUrl: input.profilePictureUrl,
          },
          update: {
            ...(input.profilePictureUrl
              ? { profilePictureUrl: input.profilePictureUrl }
              : {}),
          },
        });

        if (input.direction === 'inbound' && input.displayName) {
          await transaction.whatsAppContact.updateMany({
            where: {
              id: contact.id,
              companyId: input.channel.companyId,
              isSaved: false,
            },
            data: { displayName: input.displayName },
          });
        }

        // Serializa o primeiro contato por tenant/canal/contato. O índice
        // parcial da migration continua sendo a última linha de defesa.
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`${input.channel.companyId}:${input.channel.id}:${contact.id}`})
          )
        `;

        let conversation = await transaction.whatsAppConversation.findFirst({
          where: {
            companyId: input.channel.companyId,
            channelId: input.channel.id,
            contactId: contact.id,
          },
          orderBy: { updatedAt: 'desc' },
        });

        const isFirstContact = !conversation;
        let reopenedAfterClosure = false;
        if (!conversation) {
          const channelRouting =
            await transaction.whatsAppChannel.findFirstOrThrow({
              where: {
                id: input.channel.id,
                companyId: input.channel.companyId,
              },
              select: {
                department: { select: { code: true } },
                company: {
                  select: {
                    departments: {
                      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                      take: 1,
                      select: { code: true },
                    },
                  },
                },
              },
            });
          const initialDepartment =
            channelRouting.department?.code ??
            channelRouting.company.departments[0]?.code;
          if (!initialDepartment) {
            throw validationError(
              'O canal precisa de um departamento proprietário ou de um departamento padrão do tenant.',
            );
          }
          conversation = await transaction.whatsAppConversation.create({
            data: {
              companyId: input.channel.companyId,
              channelId: input.channel.id,
              contactId: contact.id,
              department: initialDepartment,
              conversationState: ConversationState.BOT_ACTIVE,
              flowStep: FlowStep.MAIN_MENU,
              requestStatus: RequestStatus.NOT_STARTED,
            },
          });
        }

        await this.lockCommand(
          transaction,
          input.channel.companyId,
          'whatsapp-conversation',
          conversation.id,
        );
        conversation = await transaction.whatsAppConversation.findUniqueOrThrow(
          {
            where: {
              id_companyId: {
                id: conversation.id,
                companyId: input.channel.companyId,
              },
            },
          },
        );
        let foundation = await this.ensureFoundationForConversation(
          transaction,
          conversation,
          {
            commandSeed: input.correlationId,
            occurredAt: input.occurredAt,
            direction:
              input.direction === 'inbound'
                ? MessageDirection.INBOUND
                : MessageDirection.OUTBOUND,
            messageText: input.direction === 'inbound' ? input.text : undefined,
            desiredConversationState:
              input.direction === 'outbound'
                ? ConversationState.SENT_TO_HUMAN
                : conversation.conversationState === ConversationState.CLOSED
                  ? ConversationState.BOT_ACTIVE
                  : conversation.conversationState,
          },
        );

        if (input.direction === 'inbound') {
          await this.resolveRegistrationCandidates(transaction, {
            companyId: input.channel.companyId,
            serviceSessionId: foundation.session.id,
            whatsappContactId: contact.id,
            phoneNormalized: contact.phoneNormalized,
            occurredAt: input.occurredAt,
          });
        }

        if (input.direction === 'outbound') {
          const takeoverCommandId = correlation(
            'external-human-takeover',
            `${input.channel.id}:${input.providerMessageId}`,
          );
          const session = await this.updateFoundationSession(transaction, {
            companyId: input.channel.companyId,
            session: foundation.session,
            commandId: takeoverCommandId,
            name: 'external-human-takeover',
            actorType: MutationActorType.EXTERNAL_HUMAN,
            status: ServiceSessionStatus.OPEN,
            controlMode: ServiceSessionControlMode.HUMAN,
            isForeground: true,
            responsibleUserId: null,
            occurredAt: input.occurredAt,
            metadata: {
              providerMessageId: input.providerMessageId,
              source: 'whatsapp-app',
            },
          });
          foundation = { ...foundation, session };

          if (
            conversation.conversationState !== ConversationState.HUMAN_ACTIVE &&
            conversation.conversationState !== ConversationState.SENT_TO_HUMAN
          ) {
            const from = snapshot(conversation);
            const expectedVersion = conversation.version;
            const updated = await transaction.whatsAppConversation.updateMany({
              where: {
                id: conversation.id,
                companyId: input.channel.companyId,
                version: expectedVersion,
              },
              data: {
                conversationState: ConversationState.SENT_TO_HUMAN,
                flowStep: FlowStep.HUMAN_SERVICE,
                assignedToUserId: null,
                resumeState: null,
                resumeFlowStep: null,
                closedAt: null,
                archivedAt: null,
                archiveReason: null,
                archivedByUserId: null,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) {
              throw currentVersionConflict(expectedVersion);
            }
            conversation =
              await transaction.whatsAppConversation.findUniqueOrThrow({
                where: {
                  id_companyId: {
                    id: conversation.id,
                    companyId: input.channel.companyId,
                  },
                },
              });
            await transaction.whatsAppConversationTransition.create({
              data: {
                companyId: input.channel.companyId,
                conversationId: conversation.id,
                threadId: foundation.threadId,
                serviceSessionId: foundation.session.id,
                commandId: takeoverCommandId,
                commandFingerprint: commandFingerprint({
                  commandId: takeoverCommandId,
                  conversationId: conversation.id,
                  providerMessageId: input.providerMessageId,
                }),
                name: 'external-human-takeover',
                expectedVersion,
                resultingVersion: conversation.version,
                actorType: TransitionActorType.WEBHOOK,
                fromDepartment: departmentToPrisma[from.department],
                toDepartment: conversation.department,
                fromState: stateToPrisma[from.conversationState],
                toState: conversation.conversationState,
                fromFlowStep: flowToPrisma[from.flowStep],
                toFlowStep: conversation.flowStep,
                fromRequestStatus: requestToPrisma[from.requestStatus],
                toRequestStatus: conversation.requestStatus,
                metadata: payload({
                  providerMessageId: input.providerMessageId,
                  source: 'whatsapp-app',
                }),
                resultSnapshot: payload({
                  id: conversation.id,
                  ...snapshot(conversation),
                  version: conversation.version,
                }),
                createdAt: input.occurredAt,
              },
            });
          }

          const mediaAssetId = await createWebhookMediaAsset(transaction, {
            companyId: input.channel.companyId,
            kind: input.kind,
            media: input.media,
            occurredAt: input.occurredAt,
            group: false,
          });
          const message = await transaction.whatsAppMessage.create({
            data: {
              companyId: input.channel.companyId,
              conversationId: conversation.id,
              channelId: input.channel.id,
              contactId: contact.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              mediaAssetId,
              actorType: WhatsAppMessageActorType.EXTERNAL_HUMAN,
              source: WhatsAppMessageSource.WHATSAPP_APP,
              providerMessageId: input.providerMessageId,
              direction: MessageDirection.OUTBOUND,
              deliveryStatus: DeliveryStatus.SENT,
              kind: kindToPrisma[input.kind],
              text: input.text,
              media: input.media ? payload(input.media) : undefined,
              recipientPhone: contact.phoneNormalized,
              correlationId: input.correlationId,
              occurredAt: input.occurredAt,
            },
          });

          const preview =
            input.text?.trim().slice(0, 240) ??
            (input.kind === 'text' ? null : `[${input.kind}]`);
          await transaction.whatsAppConversation.update({
            where: {
              id_companyId: {
                id: conversation.id,
                companyId: input.channel.companyId,
              },
            },
            data: {
              lastOutboundAt: input.occurredAt,
              lastMessagePreview: preview,
            },
          });
          await transaction.integrationInbox.update({
            where: { id: inbox.id },
            data: { processedAt: new Date() },
          });

          return {
            accepted: true,
            duplicate: false,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: false,
            isFirstContact,
            reopenedAfterClosure: false,
            messageId: message.id,
            conversationId: conversation.id,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            version: conversation.version,
          };
        }

        if (
          conversation.closedAt !== null ||
          conversation.conversationState === ConversationState.CLOSED
        ) {
          const from = snapshot(conversation);
          const next = resolveConversationTransition({
            current: from,
            name: 'reopen-after-customer-message',
          });
          const expectedVersion = conversation.version;
          const transitionedAt = new Date();
          conversation = await transaction.whatsAppConversation.update({
            where: {
              id_companyId: {
                id: conversation.id,
                companyId: input.channel.companyId,
              },
            },
            data: {
              department: departmentToPrisma[next.department],
              conversationState: stateToPrisma[next.conversationState],
              flowStep: flowToPrisma[next.flowStep],
              requestStatus: requestToPrisma[next.requestStatus],
              assignedToUserId: null,
              resumeState: null,
              resumeFlowStep: null,
              mainMenuPresentedAt: null,
              followUpMenuPresentedAt: null,
              contextualFollowUpAt: null,
              departmentContactOption: null,
              closedAt: null,
              version: { increment: 1 },
            },
          });
          reopenedAfterClosure = true;
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: input.channel.companyId,
              conversationId: conversation.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              commandId: correlation(
                'reopen-after-customer-message',
                `${input.channel.id}:${input.providerMessageId}`,
              ),
              commandFingerprint: commandFingerprint({
                conversationId: conversation.id,
                providerMessageId: input.providerMessageId,
                name: 'reopen-after-customer-message',
              }),
              name: 'reopen-after-customer-message',
              expectedVersion,
              resultingVersion: expectedVersion + 1,
              actorType: TransitionActorType.WEBHOOK,
              fromDepartment: departmentToPrisma[from.department],
              toDepartment: departmentToPrisma[next.department],
              fromState: stateToPrisma[from.conversationState],
              toState: stateToPrisma[next.conversationState],
              fromFlowStep: flowToPrisma[from.flowStep],
              toFlowStep: flowToPrisma[next.flowStep],
              fromRequestStatus: requestToPrisma[from.requestStatus],
              toRequestStatus: requestToPrisma[next.requestStatus],
              metadata: payload({
                providerMessageId: input.providerMessageId,
                reason: 'customer-message-after-closure',
              }),
              resultSnapshot: payload({
                id: conversation.id,
                ...next,
                version: expectedVersion + 1,
              }),
              createdAt: transitionedAt,
            },
          });
        }

        await this.lockCommand(
          transaction,
          input.channel.companyId,
          'whatsapp-conversation',
          conversation.id,
        );
        conversation = await transaction.whatsAppConversation.findUniqueOrThrow(
          {
            where: {
              id_companyId: {
                id: conversation.id,
                companyId: input.channel.companyId,
              },
            },
          },
        );

        const hasQueuedProposalDocument =
          (await transaction.quoteProposalDocument.count({
            where: {
              companyId: input.channel.companyId,
              conversationId: conversation.id,
              status: QuoteProposalDocumentStatus.QUEUED,
            },
          })) > 0;

        let contextualTransition = false;
        let automaticResumeName:
          | 'resume-awaited-reply'
          | 'resume-contextual-contact'
          | 'proposal-response-received'
          | null = null;

        if (
          input.kind === 'text' &&
          conversation.conversationState ===
            ConversationState.WAITING_FOR_CUSTOMER &&
          conversation.flowStep === FlowStep.QUOTE_SUMMARY_CONFIRMATION &&
          conversation.requestStatus === RequestStatus.WAITING_FOR_CUSTOMER &&
          conversation.resumeState === ConversationState.BOT_ACTIVE
        ) {
          automaticResumeName = 'resume-awaited-reply';
        } else if (
          input.kind === 'text' &&
          conversation.conversationState ===
            ConversationState.WAITING_FOR_CUSTOMER &&
          conversation.flowStep === FlowStep.QUOTE_SEND_PENDING &&
          conversation.requestStatus === RequestStatus.WAITING_FOR_CUSTOMER
        ) {
          automaticResumeName = 'proposal-response-received';
        } else if (
          !hasQueuedProposalDocument &&
          input.kind === 'text' &&
          conversation.contextualFollowUpAt !== null &&
          input.occurredAt >= conversation.contextualFollowUpAt &&
          (conversation.requestStatus === RequestStatus.UNDER_REVIEW ||
            conversation.requestStatus === RequestStatus.APPROVED ||
            conversation.requestStatus === RequestStatus.REJECTED) &&
          ((conversation.conversationState ===
            ConversationState.SENT_TO_HUMAN &&
            conversation.flowStep === FlowStep.QUOTE_SEND_PENDING) ||
            (conversation.conversationState === ConversationState.BOT_ACTIVE &&
              (conversation.flowStep === FlowStep.QUOTE_SEND_PENDING ||
                conversation.flowStep === FlowStep.COMMERCIAL_FOLLOW_UP_MENU)))
        ) {
          automaticResumeName = 'resume-contextual-contact';
        }

        if (automaticResumeName) {
          const next = resolveConversationTransition({
            current: snapshot(conversation),
            name: automaticResumeName,
          });
          const result = await transaction.whatsAppConversation.updateMany({
            where: {
              id: conversation.id,
              companyId: input.channel.companyId,
              version: conversation.version,
            },
            data: {
              department: departmentToPrisma[next.department],
              conversationState: stateToPrisma[next.conversationState],
              flowStep: flowToPrisma[next.flowStep],
              requestStatus: requestToPrisma[next.requestStatus],
              resumeState: next.resumeState
                ? stateToPrisma[next.resumeState]
                : null,
              resumeFlowStep: next.resumeFlowStep
                ? flowToPrisma[next.resumeFlowStep]
                : null,
              followUpMenuPresentedAt: [
                'resume-contextual-contact',
                'proposal-response-received',
              ].includes(automaticResumeName)
                ? null
                : conversation.followUpMenuPresentedAt,
              contextualFollowUpAt: [
                'resume-contextual-contact',
                'proposal-response-received',
              ].includes(automaticResumeName)
                ? null
                : conversation.contextualFollowUpAt,
              version: { increment: 1 },
            },
          });
          if (result.count !== 1) {
            throw currentVersionConflict(conversation.version);
          }
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: input.channel.companyId,
              conversationId: conversation.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              commandId: correlation(
                'inbound',
                `${input.channel.id}:${input.providerMessageId}`,
              ),
              name: automaticResumeName,
              commandFingerprint: commandFingerprint({
                conversationId: conversation.id,
                name: automaticResumeName,
                providerMessageId: input.providerMessageId,
              }),
              expectedVersion: conversation.version,
              resultingVersion: conversation.version + 1,
              actorType: TransitionActorType.WEBHOOK,
              fromDepartment: conversation.department,
              toDepartment: departmentToPrisma[next.department],
              fromState: conversation.conversationState,
              toState: stateToPrisma[next.conversationState],
              fromFlowStep: conversation.flowStep,
              toFlowStep: flowToPrisma[next.flowStep],
              fromRequestStatus: conversation.requestStatus,
              toRequestStatus: requestToPrisma[next.requestStatus],
              metadata: { providerMessageId: input.providerMessageId },
              resultSnapshot: payload({
                id: conversation.id,
                ...next,
                version: conversation.version + 1,
              }),
            },
          });
          conversation =
            await transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: conversation.id,
                  companyId: input.channel.companyId,
                },
              },
            });
          contextualTransition =
            automaticResumeName === 'resume-contextual-contact';
        }

        const desiredSession = serviceSessionStateForConversation(
          conversation.conversationState,
        );
        if (
          foundation.session.controlMode === ServiceSessionControlMode.AI ||
          desiredSession.controlMode === ServiceSessionControlMode.HUMAN
        ) {
          const currentDepartment =
            await transaction.tenantDepartment.findUnique({
              where: {
                companyId_code: {
                  companyId: input.channel.companyId,
                  code: conversation.department,
                },
              },
              select: { id: true },
            });
          const synchronized = await this.updateFoundationSession(transaction, {
            companyId: input.channel.companyId,
            session: foundation.session,
            commandId: correlation(
              'webhook-session-sync',
              `${input.channel.id}:${input.providerMessageId}`,
            ),
            name: 'webhook-conversation-synchronized',
            actorType: MutationActorType.SERVICE,
            status: desiredSession.status,
            controlMode: desiredSession.controlMode,
            isForeground: desiredSession.isForeground,
            responsibleUserId:
              desiredSession.controlMode === ServiceSessionControlMode.HUMAN
                ? conversation.assignedToUserId
                : null,
            currentDepartmentId: currentDepartment?.id ?? null,
            occurredAt: input.occurredAt,
            metadata: { providerMessageId: input.providerMessageId },
          });
          foundation = { ...foundation, session: synchronized };
        }

        const mediaAssetId = await createWebhookMediaAsset(transaction, {
          companyId: input.channel.companyId,
          kind: input.kind,
          media: input.media,
          occurredAt: input.occurredAt,
          group: false,
        });
        const message = await transaction.whatsAppMessage.create({
          data: {
            companyId: input.channel.companyId,
            conversationId: conversation.id,
            channelId: input.channel.id,
            contactId: contact.id,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            mediaAssetId,
            actorType: WhatsAppMessageActorType.CUSTOMER,
            source: WhatsAppMessageSource.WHATSAPP_APP,
            providerMessageId: input.providerMessageId,
            direction: MessageDirection.INBOUND,
            deliveryStatus: DeliveryStatus.RECEIVED,
            kind: kindToPrisma[input.kind],
            text: input.text,
            media: input.media ? payload(input.media) : undefined,
            correlationId: input.correlationId,
            occurredAt: input.occurredAt,
          },
        });

        const preview =
          input.text?.trim().slice(0, 240) ??
          (input.kind === 'text' ? null : `[${input.kind}]`);
        await transaction.whatsAppConversation.update({
          where: {
            id_companyId: {
              id: conversation.id,
              companyId: input.channel.companyId,
            },
          },
          data: {
            unreadCount: { increment: 1 },
            lastInboundAt: input.occurredAt,
            lastMessagePreview: preview,
            archivedAt: null,
            archiveReason: null,
            archivedByUserId: null,
            archiveExemptedAt: null,
          },
        });

        const humanRouted =
          hasQueuedProposalDocument ||
          foundation.session.controlMode === ServiceSessionControlMode.HUMAN ||
          conversation.conversationState === ConversationState.HUMAN_ACTIVE ||
          conversation.conversationState === ConversationState.SENT_TO_HUMAN ||
          conversation.flowStep === FlowStep.HUMAN_SERVICE;
        const automationAllowed =
          input.automationEnabled &&
          foundation.session.controlMode === ServiceSessionControlMode.AI &&
          foundation.session.status === ServiceSessionStatus.OPEN &&
          foundation.session.isForeground &&
          conversation.conversationState === ConversationState.BOT_ACTIVE &&
          !humanRouted;
        const canGenerateReply = automationAllowed;
        const canSendReply = automationAllowed;

        // A mensagem já existe quando o evento publicável é criado.
        await this.createOrderedOutbox(transaction, {
          companyId: input.channel.companyId,
          topic: humanRouted
            ? 'whatsapp.inbound.human-notification'
            : 'whatsapp.inbound.persisted',
          aggregateType: 'whatsapp-conversation',
          aggregateId: conversation.id,
          correlationId: input.correlationId,
          payload: {
            eventId: input.correlationId,
            messageId: message.id,
            conversationId: conversation.id,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            channelId: input.channel.id,
            companyId: input.channel.companyId,
            contact: {
              id: contact.id,
              phone: contact.phoneNormalized,
              displayName: contact.displayName,
            },
            message: {
              providerMessageId: input.providerMessageId,
              direction: 'inbound',
              deliveryStatus: 'received',
              kind: input.kind,
              text: input.text ?? null,
              media: input.media ?? null,
              occurredAt: input.occurredAt.toISOString(),
            },
            conversation: {
              id: conversation.id,
              ...snapshot(conversation),
              version: conversation.version,
              departmentContactOption: conversation.departmentContactOption,
            },
            automationAllowed,
            canGenerateReply,
            canSendReply,
            contextualTransition,
            isFirstContact,
            reopenedAfterClosure,
          },
        });

        await transaction.integrationInbox.update({
          where: { id: inbox.id },
          data: { processedAt: new Date() },
        });

        return {
          accepted: true,
          duplicate: false,
          automationAllowed,
          canGenerateReply,
          canSendReply,
          isFirstContact,
          reopenedAfterClosure,
          messageId: message.id,
          conversationId: conversation.id,
          threadId: foundation.threadId,
          serviceSessionId: foundation.session.id,
          version: conversation.version,
        };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const existingMessage = await this.prisma.whatsAppMessage.findUnique({
          where: {
            companyId_channelId_providerMessageId: {
              companyId: input.channel.companyId,
              channelId: input.channel.id,
              providerMessageId: input.providerMessageId,
            },
          },
        });
        if (existingMessage) {
          return {
            accepted: true,
            duplicate: true,
            messageId: existingMessage.id,
            conversationId: existingMessage.conversationId,
            threadId: existingMessage.threadId,
            serviceSessionId: existingMessage.serviceSessionId,
          };
        }
      }
      throw error;
    }
  }

  async transition(
    input: TransitionCommand,
    existingTransaction?: Prisma.TransactionClient,
  ): Promise<unknown> {
    assertTransitionActor(input.name, input.actorType);
    const fingerprint = commandFingerprint(input);
    const operation = async (transaction: Prisma.TransactionClient) => {
      await this.lockCommand(
        transaction,
        input.companyId,
        'transition',
        input.commandId,
      );
      if (input.actorType === 'user' && !input.actorUserId) {
        throw validationError(
          'Uma transição humana exige um usuário autenticado.',
        );
      }
      const currentActor =
        input.actorType === 'user' && input.actorUserId
          ? await this.assertCurrentWhatsAppAttendant(
              transaction,
              input.companyId,
              input.actorUserId,
            )
          : null;
      const duplicate =
        await transaction.whatsAppConversationTransition.findUnique({
          where: {
            companyId_commandId: {
              companyId: input.companyId,
              commandId: input.commandId,
            },
          },
        });

      if (duplicate) {
        assertSameFingerprint(
          duplicate.commandFingerprint,
          fingerprint,
          'commandId',
        );
        return {
          ...(duplicate.resultSnapshot as Record<string, unknown>),
          idempotent: true,
        };
      }

      await this.lockCommand(
        transaction,
        input.companyId,
        'whatsapp-conversation',
        input.conversationId,
      );
      const conversation = await this.findConversationOrThrow(
        transaction,
        input.companyId,
        input.conversationId,
      );
      if (conversation.version !== input.expectedVersion) {
        throw currentVersionConflict(conversation.version);
      }
      const transferReason =
        typeof input.metadata?.reason === 'string'
          ? input.metadata.reason.trim()
          : '';
      if (
        input.actorType === 'user' &&
        (input.name === 'request-transfer' ||
          input.name === 'change-department') &&
        (transferReason.length < 3 || transferReason.length > 500)
      ) {
        throw validationError(
          'Informe o motivo da transferência, entre 3 e 500 caracteres.',
        );
      }
      if (
        input.name === 'request-transfer' &&
        conversation.pendingTransferDepartment !== null
      ) {
        throw new AppError(
          'CONFLICT',
          'A conversa já possui uma transferência aguardando aceite.',
        );
      }
      if (
        input.name === 'accept-transfer' &&
        conversation.pendingTransferDepartment === null
      ) {
        throw new AppError(
          'CONFLICT',
          'A conversa não possui transferência aguardando aceite.',
        );
      }
      if (
        input.name === 'change-department' &&
        conversation.assignedToUserId !== null
      ) {
        throw new AppError(
          'CONFLICT',
          'Uma conversa atribuída deve usar solicitação e aceite de transferência.',
        );
      }
      const closing = isClosingTransition(input.name);
      let resolvedClosingReason: string | null = null;
      if (closing) {
        const rawReason = input.metadata?.reason;
        if (
          rawReason !== undefined &&
          rawReason !== null &&
          typeof rawReason !== 'string'
        ) {
          throw validationError('O motivo do encerramento deve ser um texto.');
        }
        const providedReason =
          typeof rawReason === 'string' ? rawReason.trim() || null : null;
        if (providedReason && providedReason.length < 3) {
          throw validationError(
            'O motivo do encerramento deve possuir pelo menos 3 caracteres.',
          );
        }
        if (providedReason && providedReason.length > 500) {
          throw validationError(
            'O motivo do encerramento deve possuir no máximo 500 caracteres.',
          );
        }

        const latestQuote = conversation.quoteRequests[0];
        const rejected =
          conversation.requestStatus === RequestStatus.REJECTED ||
          latestQuote?.status === RequestStatus.REJECTED;
        const decisionReason =
          latestQuote?.status === RequestStatus.REJECTED
            ? latestQuote.decisionReason?.trim() || null
            : null;
        resolvedClosingReason = providedReason ?? decisionReason;
        if (rejected && !resolvedClosingReason) {
          throw validationError(
            'Informe o motivo do encerramento da proposta recusada.',
          );
        }
      }
      if (
        [
          'take-over',
          'request-transfer',
          'accept-transfer',
          'return-to-bot',
          'forward',
          'new-quote-request',
        ].includes(input.name)
      ) {
        const queuedProposal =
          await transaction.quoteProposalDocument.findFirst({
            where: {
              companyId: input.companyId,
              conversationId: input.conversationId,
              status: QuoteProposalDocumentStatus.QUEUED,
            },
            select: { id: true },
          });
        if (queuedProposal) {
          throw new AppError(
            'CONFLICT',
            'A proposta está sendo enviada. Aguarde a confirmação do provedor antes de alterar a condução.',
            { proposalDocumentId: queuedProposal.id },
          );
        }
      }

      let actorUser: { id: string; name: string } | null = null;
      if (input.actorUserId) {
        const actor =
          currentActor ??
          (await transaction.user.findUnique({
            where: {
              id_companyId: {
                id: input.actorUserId,
                companyId: input.companyId,
              },
            },
            select: {
              id: true,
              name: true,
              isActive: true,
              departments: true,
            },
          }));
        if (!actor?.isActive) {
          throw forbidden('O ator informado não pertence ao tenant.');
        }
        actorUser = { id: actor.id, name: actor.name };
        const currentDepartment = departmentFromPrisma[conversation.department];
        const tenantWide = currentActor?.hasTenantWideAuthority ?? false;
        const belongsToCurrentDepartment = userBelongsToDepartment(
          actor.departments,
          currentDepartment,
        );
        if (
          input.name === 'take-over' &&
          !tenantWide &&
          !belongsToCurrentDepartment
        ) {
          throw forbidden(
            'Somente um usuário do departamento responsável pode assumir a conversa.',
          );
        }
        if (
          input.name === 'accept-transfer' &&
          !tenantWide &&
          !userBelongsToDepartment(
            actor.departments,
            departmentFromPrisma[conversation.pendingTransferDepartment!],
          )
        ) {
          throw forbidden(
            'Somente um usuário do departamento de destino pode aceitar a transferência.',
          );
        }
        if (
          [
            'forward',
            'request-transfer',
            'return-to-bot',
            'change-department',
            'mark-read',
            'archive',
            'unarchive',
            'close',
            'close-after-rejection',
          ].includes(input.name) &&
          !tenantWide &&
          !belongsToCurrentDepartment
        ) {
          throw forbidden(
            'Somente um usuário do departamento responsável pode executar esta ação.',
          );
        }
        if (
          ['forward', 'request-transfer', 'change-department'].includes(
            input.name,
          ) &&
          input.targetDepartment === 'client-company'
        ) {
          throw validationError(
            'Empresa cliente não pode ser o departamento responsável por um atendimento interno.',
          );
        }
      }

      if (
        input.automaticHumanHandoff &&
        (input.name !== 'forward' || input.actorType !== 'system')
      ) {
        throw validationError(
          'Handoff automático é permitido somente em forward executado pelo sistema.',
        );
      }
      const automaticHandoffMessage =
        input.automaticHumanHandoff?.customerMessage.trim() ?? null;
      if (
        input.automaticHumanHandoff &&
        (!automaticHandoffMessage || automaticHandoffMessage.length > 4096)
      ) {
        throw validationError(
          'A mensagem contextual do handoff deve possuir entre 1 e 4096 caracteres.',
        );
      }
      if (
        input.automaticHumanHandoff &&
        !Number.isFinite(input.automaticHumanHandoff.occurredAt.valueOf())
      ) {
        throw validationError('O instante do handoff é inválido.');
      }
      if (
        input.automaticHumanHandoff &&
        Boolean(input.automaticHumanHandoff.actorAgentId) !==
          Boolean(input.automaticHumanHandoff.agentExecutionId)
      ) {
        throw validationError(
          'A autoria de IA do handoff exige agente e execução correspondentes.',
        );
      }
      const automaticPriorityReason =
        input.automaticHumanHandoff?.sessionPriority?.reason.trim() ?? null;
      if (
        input.automaticHumanHandoff?.sessionPriority &&
        (!automaticPriorityReason || automaticPriorityReason.length > 500)
      ) {
        throw validationError(
          'O motivo da prioridade de IA deve possuir entre 1 e 500 caracteres.',
        );
      }
      if (
        input.automaticHumanHandoff?.sessionPriority &&
        !input.automaticHumanHandoff.actorAgentId
      ) {
        throw validationError(
          'A prioridade de IA exige autoria de agente auditável.',
        );
      }

      let resolvedTargetDepartment = input.targetDepartment;
      let automaticHandoff: {
        readonly occurredAt: Date;
        readonly humanServiceOpen: boolean;
        readonly scheduleSource: 'tenant' | 'department' | 'always-open';
        readonly targetDepartmentId: string;
        readonly targetDepartmentCode: DepartmentCode;
        readonly queueId: string;
        readonly customerMessage: string;
      } | null = null;
      if (input.automaticHumanHandoff && automaticHandoffMessage) {
        const departmentSelect = {
          id: true,
          code: true,
          humanServiceHoursOverride: true,
          serviceQueues: {
            where: { enabled: true },
            orderBy: [{ priorityWeight: 'desc' }, { name: 'asc' }],
            take: 1,
            select: { id: true },
          },
        } satisfies Prisma.TenantDepartmentSelect;
        const requestedDepartment = input.targetDepartment
          ? await transaction.tenantDepartment.findUnique({
              where: {
                companyId_code: {
                  companyId: input.companyId,
                  code: departmentToPrisma[input.targetDepartment],
                },
              },
              select: departmentSelect,
            })
          : null;
        const currentDepartment = requestedDepartment
          ? null
          : await transaction.tenantDepartment.findUnique({
              where: {
                companyId_code: {
                  companyId: input.companyId,
                  code: conversation.department,
                },
              },
              select: departmentSelect,
            });
        const channelOwnerId =
          requestedDepartment || currentDepartment
            ? null
            : await transaction.whatsAppChannel.findUnique({
                where: {
                  id_companyId: {
                    id: conversation.channelId,
                    companyId: input.companyId,
                  },
                },
                select: { departmentId: true },
              });
        const channelOwner = channelOwnerId?.departmentId
          ? await transaction.tenantDepartment.findUnique({
              where: {
                id_companyId: {
                  id: channelOwnerId.departmentId,
                  companyId: input.companyId,
                },
              },
              select: departmentSelect,
            })
          : null;
        const department =
          requestedDepartment ?? currentDepartment ?? channelOwner;
        if (!department) {
          throw validationError(
            'Configure um departamento proprietário no canal para o handoff humano.',
          );
        }
        const queue =
          department.serviceQueues[0] ??
          (await transaction.serviceQueue.upsert({
            where: {
              companyId_departmentId_name: {
                companyId: input.companyId,
                departmentId: department.id,
                name: 'Atendimento',
              },
            },
            create: {
              companyId: input.companyId,
              departmentId: department.id,
              name: 'Atendimento',
            },
            update: { enabled: true },
            select: { id: true },
          }));
        const company = await transaction.company.findUnique({
          where: { id: input.companyId },
          select: {
            humanServiceHours: true,
            offHoursHandoffMessage: true,
          },
        });
        if (!company) throw notFound('Tenant');
        const tenantSchedule = parseHumanServiceHours(
          company.humanServiceHours,
          'Horário padrão do tenant',
        );
        const departmentSchedule = parseHumanServiceHours(
          department.humanServiceHoursOverride,
          'Horário do departamento',
        );
        const humanServiceOpen = isHumanServiceOpen({
          at: input.automaticHumanHandoff.occurredAt,
          tenantDefault: tenantSchedule,
          departmentOverride: departmentSchedule,
        });
        const offHoursMessage = company.offHoursHandoffMessage.trim();
        if (!humanServiceOpen && !offHoursMessage) {
          throw validationError(
            'Configure a mensagem de encaminhamento fora do horário.',
          );
        }
        resolvedTargetDepartment = departmentFromPrisma[department.code];
        automaticHandoff = {
          occurredAt: input.automaticHumanHandoff.occurredAt,
          humanServiceOpen,
          scheduleSource: departmentSchedule
            ? 'department'
            : tenantSchedule
              ? 'tenant'
              : 'always-open',
          targetDepartmentId: department.id,
          targetDepartmentCode: department.code,
          queueId: queue.id,
          customerMessage: humanServiceOpen
            ? automaticHandoffMessage
            : offHoursMessage,
        };
      }

      const from = snapshot(conversation);
      const pendingTransferBefore =
        conversation.pendingTransferDepartment === null
          ? null
          : {
              targetDepartment:
                departmentFromPrisma[conversation.pendingTransferDepartment],
              reason: conversation.pendingTransferReason,
              requestedByUserId: conversation.pendingTransferRequestedByUserId,
              requestedAt:
                conversation.pendingTransferRequestedAt?.toISOString() ?? null,
            };
      if (input.name === 'accept-transfer' && pendingTransferBefore) {
        resolvedTargetDepartment = pendingTransferBefore.targetDepartment;
      }
      const to = resolveConversationTransition({
        current: from,
        name: input.name,
        targetDepartment: resolvedTargetDepartment,
        departmentOption:
          typeof input.metadata?.departmentOption === 'string'
            ? input.metadata.departmentOption
            : undefined,
        policy: {
          preventCloseWithApprovedQuote: this.preventCloseWithApprovedQuote,
        },
      });
      const transitionedAt = automaticHandoff?.occurredAt ?? new Date();
      const foundation = await this.ensureFoundationForConversation(
        transaction,
        conversation,
        {
          commandSeed: input.commandId,
          occurredAt: transitionedAt,
          desiredConversationState: stateToPrisma[to.conversationState],
        },
      );
      const automaticAgentAttribution =
        input.automaticHumanHandoff?.actorAgentId &&
        input.automaticHumanHandoff.agentExecutionId
          ? await transaction.agentExecution.findFirst({
              where: {
                id: input.automaticHumanHandoff.agentExecutionId,
                companyId: input.companyId,
                agentId: input.automaticHumanHandoff.actorAgentId,
                serviceSessionId: foundation.session.id,
                status: AgentExecutionStatus.SUCCEEDED,
              },
              select: { id: true, agentId: true },
            })
          : null;
      if (
        input.automaticHumanHandoff?.actorAgentId &&
        input.automaticHumanHandoff.agentExecutionId &&
        !automaticAgentAttribution
      ) {
        throw forbidden(
          'A execução de IA do handoff não pertence à sessão ou ainda não foi concluída.',
        );
      }
      const nextVersion = conversation.version + 1;
      const transitionId = randomUUID();
      const departmentContactCompleted =
        input.name === 'return-to-main-menu' &&
        input.metadata?.reason === 'department-contact-forwarded';
      const closureMessageText = departmentContactCompleted
        ? buildDepartmentContactClosureMessage(
            departmentContactLabels[
              input.targetDepartment ??
                departmentFromPrisma[conversation.department]
            ] ?? 'responsável',
          )
        : closing
          ? buildConversationClosureMessage(transitionedAt)
          : null;
      const finalizationPurpose = departmentContactCompleted
        ? 'department-contact-finalization'
        : 'conversation-closure';
      const closureMessage = closureMessageText
        ? await transaction.whatsAppMessage.create({
            data: {
              companyId: input.companyId,
              conversationId: input.conversationId,
              channelId: conversation.channelId,
              contactId: conversation.contactId,
              actorUserId: input.actorUserId,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              actorType:
                input.actorType === 'user'
                  ? WhatsAppMessageActorType.HUMAN_USER
                  : WhatsAppMessageActorType.SYSTEM,
              source:
                input.actorType === 'user'
                  ? WhatsAppMessageSource.LUME_WEB
                  : WhatsAppMessageSource.AUTOMATION,
              direction: MessageDirection.OUTBOUND,
              deliveryStatus: DeliveryStatus.PENDING,
              kind: MessageKind.TEXT,
              text: closureMessageText,
              automationPurpose: departmentContactCompleted
                ? finalizationPurpose
                : null,
              recipientPhone: conversation.contact.phoneNormalized,
              correlationId: correlation(
                `${finalizationPurpose}-outbound`,
                input.commandId,
              ),
              occurredAt: transitionedAt,
            },
          })
        : null;
      const closureAttempt = closureMessage
        ? await transaction.whatsAppMessageAttempt.create({
            data: {
              companyId: input.companyId,
              messageId: closureMessage.id,
              attemptNumber: 1,
              status: MessageAttemptStatus.PENDING,
            },
          })
        : null;
      const offHoursNotificationClaimed = Boolean(
        automaticHandoff &&
        !automaticHandoff.humanServiceOpen &&
        foundation.session.offHoursHandoffNotifiedAt === null,
      );
      const handoffMessageText =
        automaticHandoff &&
        (automaticHandoff.humanServiceOpen || offHoursNotificationClaimed)
          ? automaticHandoff.customerMessage
          : null;
      const handoffMessage = handoffMessageText
        ? await transaction.whatsAppMessage.create({
            data: {
              companyId: input.companyId,
              conversationId: input.conversationId,
              channelId: conversation.channelId,
              contactId: conversation.contactId,
              actorAgentId: automaticAgentAttribution?.agentId,
              agentExecutionId: automaticAgentAttribution?.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              actorType: automaticAgentAttribution
                ? WhatsAppMessageActorType.AI_AGENT
                : WhatsAppMessageActorType.SYSTEM,
              source: WhatsAppMessageSource.AUTOMATION,
              direction: MessageDirection.OUTBOUND,
              deliveryStatus: DeliveryStatus.PENDING,
              kind: MessageKind.TEXT,
              text: handoffMessageText,
              automationPurpose: automaticHandoff?.humanServiceOpen
                ? 'human-handoff'
                : 'off-hours-handoff',
              recipientPhone: conversation.contact.phoneNormalized,
              correlationId: correlation(
                'human-handoff-outbound',
                input.commandId,
              ),
              occurredAt: transitionedAt,
            },
          })
        : null;
      const handoffAttempt = handoffMessage
        ? await transaction.whatsAppMessageAttempt.create({
            data: {
              companyId: input.companyId,
              messageId: handoffMessage.id,
              attemptNumber: 1,
              status: MessageAttemptStatus.PENDING,
            },
          })
        : null;

      let quote = conversation.quoteRequests[0];
      let supersededQuote: {
        id: string;
        previousVersion: number;
        resultingVersion: number;
      } | null = null;
      if (
        input.name === 'new-quote-request' &&
        quote?.status === RequestStatus.UNDER_REVIEW
      ) {
        const previousVersion = quote.version;
        const cancelled = await transaction.quoteRequest.updateMany({
          where: {
            id: quote.id,
            companyId: input.companyId,
            conversationId: input.conversationId,
            status: RequestStatus.UNDER_REVIEW,
            version: previousVersion,
          },
          data: {
            status: RequestStatus.CANCELLED,
            closureClassification: CommercialClosureClassification.SUPERSEDED,
            decisionReason:
              'Substituído por uma nova solicitação de orçamento.',
            decidedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (cancelled.count !== 1) {
          const latest = await transaction.quoteRequest.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: quote.id,
                companyId: input.companyId,
              },
            },
            select: { version: true },
          });
          throw new AppError(
            'CONFLICT',
            'A solicitação anterior foi alterada durante a abertura do novo ciclo.',
            { currentVersion: latest.version },
          );
        }
        supersededQuote = {
          id: quote.id,
          previousVersion,
          resultingVersion: previousVersion + 1,
        };
      }
      if (input.name === 'new-quote-request' || input.name === 'start-quote') {
        const latest = await transaction.quoteRequest.aggregate({
          where: {
            companyId: input.companyId,
            conversationId: input.conversationId,
          },
          _max: { sequence: true },
        });
        quote = await transaction.quoteRequest.create({
          data: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            sequence: (latest._max.sequence ?? 0) + 1,
            status: RequestStatus.COLLECTING_INFORMATION,
          },
        });
      }
      if (
        ['present-quote-summary', 'correct-quote', 'confirm-quote'].includes(
          input.name,
        )
      ) {
        if (!quote) {
          throw validationError(
            'A conversa não possui uma solicitação de orçamento ativa.',
          );
        }
        if (
          input.name === 'present-quote-summary' ||
          input.name === 'confirm-quote'
        ) {
          assertQuoteComplete(quote);
        }
        quote = await transaction.quoteRequest.update({
          where: {
            id_companyId: { id: quote.id, companyId: input.companyId },
          },
          data: {
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            status: requestToPrisma[to.requestStatus],
            ...(input.name === 'confirm-quote'
              ? {
                  confirmedAt: new Date(),
                  confirmedVersion: quote.version + 1,
                  confirmedSummary: payload({
                    contactName: quote.contactName,
                    document: quote.document,
                    email: quote.email,
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
                    structuredData: quote.structuredData,
                  }),
                }
              : {}),
            version: { increment: 1 },
          },
        });
      }

      const clearsDepartmentContactOption =
        [
          'present-main-menu',
          'select-commercial',
          'return-to-main-menu',
          'take-over',
          'request-transfer',
          'accept-transfer',
          'return-to-bot',
          'forward',
        ].includes(input.name) || closing;
      const nextAssignedToUserId =
        to.conversationState === 'human-active'
          ? input.name === 'take-over' || input.name === 'accept-transfer'
            ? input.actorUserId
            : conversation.assignedToUserId
          : null;
      if (to.conversationState === 'human-active' && !nextAssignedToUserId) {
        throw validationError('Assuma a conversa antes de executar esta ação.');
      }
      const update = await transaction.whatsAppConversation.updateMany({
        where: {
          id: input.conversationId,
          companyId: input.companyId,
          version: input.expectedVersion,
        },
        data: {
          department: departmentToPrisma[to.department],
          conversationState: stateToPrisma[to.conversationState],
          flowStep: flowToPrisma[to.flowStep],
          requestStatus: requestToPrisma[to.requestStatus],
          resumeState: to.resumeState ? stateToPrisma[to.resumeState] : null,
          resumeFlowStep: to.resumeFlowStep
            ? flowToPrisma[to.resumeFlowStep]
            : null,
          departmentContactOption:
            input.name === 'start-department-contact'
              ? (input.metadata?.departmentOption as string)
              : clearsDepartmentContactOption
                ? null
                : conversation.departmentContactOption,
          followUpMenuPresentedAt: closing
            ? null
            : input.name === 'confirm-quote' ||
                ([
                  'return-to-bot',
                  'resume-contextual-contact',
                  'select-commercial',
                ].includes(input.name) &&
                  to.flowStep === 'commercial-follow-up-menu')
              ? null
              : conversation.followUpMenuPresentedAt,
          contextualFollowUpAt:
            input.name === 'confirm-quote'
              ? new Date(Date.now() + this.followUpInactivityMs)
              : closing
                ? null
                : input.name === 'return-to-bot' &&
                    to.flowStep === 'commercial-follow-up-menu'
                  ? new Date(0)
                  : input.name === 'resume-contextual-contact'
                    ? null
                    : conversation.contextualFollowUpAt,
          mainMenuPresentedAt: closing
            ? null
            : conversation.mainMenuPresentedAt,
          assignedToUserId: nextAssignedToUserId,
          ...(input.name === 'request-transfer'
            ? {
                pendingTransferDepartment:
                  departmentToPrisma[input.targetDepartment!],
                pendingTransferReason: transferReason,
                pendingTransferRequestedByUserId: input.actorUserId,
                pendingTransferRequestedAt: transitionedAt,
              }
            : input.name === 'accept-transfer' ||
                input.name === 'return-to-bot' ||
                closing
              ? {
                  pendingTransferDepartment: null,
                  pendingTransferReason: null,
                  pendingTransferRequestedByUserId: null,
                  pendingTransferRequestedAt: null,
                }
              : {}),
          ...(input.name === 'archive'
            ? {
                archivedAt: transitionedAt,
                archiveReason: 'manual',
                archivedByUserId: input.actorUserId,
                archiveExemptedAt: null,
              }
            : input.name === 'unarchive' || input.name === 'take-over'
              ? {
                  archivedAt: null,
                  archiveReason: null,
                  archivedByUserId: null,
                  archiveExemptedAt: transitionedAt,
                }
              : {}),
          unreadCount:
            input.name === 'mark-read' || closing || departmentContactCompleted
              ? 0
              : conversation.unreadCount,
          ...(closureMessageText || handoffMessageText
            ? {
                lastMessagePreview: (
                  closureMessageText ??
                  handoffMessageText ??
                  ''
                ).slice(0, 240),
                lastOutboundAt: transitionedAt,
              }
            : {}),
          closedAt:
            input.name === 'take-over'
              ? null
              : closing
                ? transitionedAt
                : conversation.closedAt,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        const latest = await transaction.whatsAppConversation.findUniqueOrThrow(
          {
            where: {
              id_companyId: {
                id: input.conversationId,
                companyId: input.companyId,
              },
            },
            select: { version: true },
          },
        );
        throw currentVersionConflict(latest.version);
      }

      const updated = await this.findConversationOrThrow(
        transaction,
        input.companyId,
        input.conversationId,
      );
      const targetDepartment = automaticHandoff
        ? { id: automaticHandoff.targetDepartmentId }
        : await transaction.tenantDepartment.findUnique({
            where: {
              companyId_code: {
                companyId: input.companyId,
                code: updated.department,
              },
            },
            select: { id: true },
          });
      const targetSessionState = serviceSessionStateForConversation(
        updated.conversationState,
      );
      const synchronizedSession = await this.updateFoundationSession(
        transaction,
        {
          companyId: input.companyId,
          session: foundation.session,
          commandId: input.commandId,
          name: `legacy-${input.name}`,
          actorType:
            automaticAgentAttribution !== null
              ? MutationActorType.AI_AGENT
              : input.actorType === 'user'
                ? MutationActorType.HUMAN_USER
                : input.actorType === 'system'
                  ? MutationActorType.SYSTEM
                  : MutationActorType.SERVICE,
          actorUserId: input.actorUserId,
          actorAgentId: automaticAgentAttribution?.agentId,
          status: targetSessionState.status,
          controlMode: targetSessionState.controlMode,
          isForeground: targetSessionState.isForeground,
          responsibleUserId:
            targetSessionState.controlMode === ServiceSessionControlMode.HUMAN
              ? updated.assignedToUserId
              : null,
          currentDepartmentId: targetDepartment?.id ?? null,
          ...(automaticHandoff
            ? {
                queueId: automaticHandoff.queueId,
                offHoursHandoffNotifiedAt: offHoursNotificationClaimed
                  ? transitionedAt
                  : undefined,
                ...(input.automaticHumanHandoff?.sessionPriority &&
                automaticPriorityReason
                  ? {
                      priority:
                        servicePriorityToPrisma[
                          input.automaticHumanHandoff.sessionPriority.priority
                        ],
                      priorityReason: automaticPriorityReason,
                      prioritySource: ServiceSessionPrioritySource.AI_AGENT,
                    }
                  : {}),
              }
            : {}),
          occurredAt: transitionedAt,
          metadata: {
            conversationId: input.conversationId,
            transitionName: input.name,
            ...(automaticHandoff
              ? {
                  humanServiceOpen: automaticHandoff.humanServiceOpen,
                  scheduleSource: automaticHandoff.scheduleSource,
                  targetDepartmentId: automaticHandoff.targetDepartmentId,
                  queueId: automaticHandoff.queueId,
                  offHoursNotificationClaimed,
                  handoffMessageId: handoffMessage?.id ?? null,
                  ...(input.automaticHumanHandoff?.sessionPriority
                    ? {
                        priority:
                          input.automaticHumanHandoff.sessionPriority.priority,
                        priorityReason: automaticPriorityReason,
                        prioritySource: 'ai-agent',
                        agentExecutionId: automaticAgentAttribution?.id ?? null,
                      }
                    : {}),
                }
              : {}),
          },
        },
      );
      if (automaticHandoff) {
        const previousAssignment =
          await transaction.serviceSessionAssignment.findFirst({
            where: {
              companyId: input.companyId,
              serviceSessionId: synchronizedSession.id,
              status: ServiceAssignmentStatus.ACTIVE,
            },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          });
        await transaction.serviceSessionAssignment.updateMany({
          where: {
            companyId: input.companyId,
            serviceSessionId: synchronizedSession.id,
            status: ServiceAssignmentStatus.ACTIVE,
          },
          data: {
            status: ServiceAssignmentStatus.RETURNED_TO_QUEUE,
            endedAt: transitionedAt,
          },
        });
        await transaction.serviceSessionAssignment.create({
          data: {
            companyId: input.companyId,
            serviceSessionId: synchronizedSession.id,
            departmentId: automaticHandoff.targetDepartmentId,
            assignedUserId: null,
            queueId: automaticHandoff.queueId,
            previousAssignmentId: previousAssignment?.id ?? null,
            status: ServiceAssignmentStatus.ACTIVE,
            source: ServiceAssignmentSource.AUTOMATIC,
            reason:
              typeof input.metadata?.reason === 'string'
                ? input.metadata.reason.slice(0, 500)
                : 'automatic-human-handoff',
            startedAt: transitionedAt,
          },
        });
      }
      if (closureMessage && closureAttempt && closureMessageText) {
        await this.createOrderedOutbox(transaction, {
          companyId: input.companyId,
          topic: 'whatsapp.outbound.requested',
          aggregateType: 'whatsapp-conversation',
          aggregateId: input.conversationId,
          correlationId: correlation(
            `${finalizationPurpose}-request`,
            input.commandId,
          ),
          payload: {
            eventId: closureMessage.id,
            commandId: closureMessage.id,
            messageId: closureMessage.id,
            attemptId: closureAttempt.id,
            conversationId: input.conversationId,
            threadId: foundation.threadId,
            serviceSessionId: synchronizedSession.id,
            channelId: conversation.channelId,
            companyId: input.companyId,
            contact: {
              id: conversation.contact.id,
              phone: conversation.contact.phoneNormalized,
              displayName: conversation.contact.displayName,
            },
            message: {
              providerMessageId: null,
              direction: 'outbound',
              deliveryStatus: 'pending',
              kind: 'text',
              text: closureMessageText,
              media: null,
              occurredAt: closureMessage.occurredAt.toISOString(),
            },
            conversation: {
              id: updated.id,
              ...snapshot(updated),
              version: updated.version,
            },
            automatic: departmentContactCompleted,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: true,
            contextualTransition: false,
            isFirstContact: false,
          },
        });
      }
      if (handoffMessage && handoffAttempt && handoffMessageText) {
        await this.createOrderedOutbox(transaction, {
          companyId: input.companyId,
          topic: 'whatsapp.outbound.requested',
          aggregateType: 'whatsapp-conversation',
          aggregateId: input.conversationId,
          correlationId: correlation('human-handoff-request', input.commandId),
          payload: {
            eventId: handoffMessage.id,
            commandId: handoffMessage.id,
            messageId: handoffMessage.id,
            attemptId: handoffAttempt.id,
            conversationId: input.conversationId,
            threadId: foundation.threadId,
            serviceSessionId: synchronizedSession.id,
            channelId: conversation.channelId,
            companyId: input.companyId,
            contact: {
              id: conversation.contact.id,
              phone: conversation.contact.phoneNormalized,
              displayName: conversation.contact.displayName,
            },
            message: {
              providerMessageId: null,
              direction: 'outbound',
              deliveryStatus: 'pending',
              kind: 'text',
              text: handoffMessageText,
              media: null,
              occurredAt: handoffMessage.occurredAt.toISOString(),
            },
            conversation: {
              id: updated.id,
              ...snapshot(updated),
              version: updated.version,
            },
            automatic: true,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: true,
            contextualTransition: false,
            isFirstContact: false,
          },
        });
      }
      const closure = closing
        ? {
            transitionId,
            transitionName: input.name,
            occurredAt: transitionedAt.toISOString(),
            reason: resolvedClosingReason,
            actor: {
              type: input.actorType,
              user: actorUser,
            },
            messageId: closureMessage?.id ?? null,
          }
        : null;
      const humanHandoff = automaticHandoff
        ? {
            serviceSessionId: synchronizedSession.id,
            targetDepartmentId: automaticHandoff.targetDepartmentId,
            queueId: automaticHandoff.queueId,
            humanServiceOpen: automaticHandoff.humanServiceOpen,
            scheduleSource: automaticHandoff.scheduleSource,
            offHoursNotificationClaimed,
            messageId: handoffMessage?.id ?? null,
            occurredAt: transitionedAt.toISOString(),
          }
        : null;
      const transferLifecycle =
        input.name === 'request-transfer'
          ? {
              status: 'requested',
              sourceDepartment: from.department,
              targetDepartment: input.targetDepartment!,
              reason: transferReason,
              requestedByUserId: input.actorUserId,
              requestedAt: transitionedAt.toISOString(),
            }
          : input.name === 'accept-transfer'
            ? {
                status: 'accepted',
                sourceDepartment: from.department,
                targetDepartment: pendingTransferBefore!.targetDepartment,
                reason: pendingTransferBefore!.reason,
                requestedByUserId: pendingTransferBefore!.requestedByUserId,
                requestedAt: pendingTransferBefore!.requestedAt,
                acceptedByUserId: input.actorUserId,
                acceptedAt: transitionedAt.toISOString(),
              }
            : pendingTransferBefore &&
                (input.name === 'return-to-bot' || closing)
              ? {
                  status: 'cancelled',
                  sourceDepartment: from.department,
                  targetDepartment: pendingTransferBefore.targetDepartment,
                  reason: pendingTransferBefore.reason,
                  requestedByUserId: pendingTransferBefore.requestedByUserId,
                  requestedAt: pendingTransferBefore.requestedAt,
                  cancelledByUserId: input.actorUserId,
                  cancelledAt: transitionedAt.toISOString(),
                  cancellationCause: input.name,
                }
              : null;
      const assignmentLifecycle =
        conversation.assignedToUserId !== nextAssignedToUserId
          ? {
              previousAssignedToUserId: conversation.assignedToUserId,
              resultingAssignedToUserId: nextAssignedToUserId,
              changedByUserId: input.actorUserId ?? null,
              cause: input.name,
            }
          : null;
      const persistedResult = {
        ...presentConversation(updated),
        ...(closing ? { closure } : {}),
        ...(humanHandoff ? { humanHandoff } : {}),
      };
      const transitionMetadata = {
        ...(input.metadata ?? {}),
        ...(closing ? { reason: resolvedClosingReason } : {}),
        ...(transferLifecycle ? { transfer: transferLifecycle } : {}),
        ...(assignmentLifecycle ? { assignment: assignmentLifecycle } : {}),
        quoteRequestId: quote?.id ?? null,
        ...(humanHandoff ? { humanHandoff } : {}),
        ...(supersededQuote
          ? {
              supersededQuoteRequest: {
                id: supersededQuote.id,
                fromStatus: 'under-review',
                toStatus: 'cancelled',
                previousVersion: supersededQuote.previousVersion,
                resultingVersion: supersededQuote.resultingVersion,
              },
            }
          : {}),
      };
      await transaction.whatsAppConversationTransition.create({
        data: {
          id: transitionId,
          companyId: input.companyId,
          conversationId: input.conversationId,
          threadId: foundation.threadId,
          serviceSessionId: synchronizedSession.id,
          commandId: input.commandId,
          commandFingerprint: fingerprint,
          name: input.name,
          expectedVersion: input.expectedVersion,
          resultingVersion: nextVersion,
          actorType: actorToPrisma[input.actorType],
          actorUserId: input.actorUserId,
          fromDepartment: conversation.department,
          toDepartment: departmentToPrisma[to.department],
          fromState: conversation.conversationState,
          toState: stateToPrisma[to.conversationState],
          fromFlowStep: conversation.flowStep,
          toFlowStep: flowToPrisma[to.flowStep],
          fromRequestStatus: conversation.requestStatus,
          toRequestStatus: requestToPrisma[to.requestStatus],
          metadata: payload(transitionMetadata),
          resultSnapshot: payload(persistedResult),
          createdAt: transitionedAt,
        },
      });
      if (assignmentLifecycle) {
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.conversation.assignment.changed',
            targetType: 'whatsapp-conversation',
            targetId: input.conversationId,
            metadata: payload({
              ...assignmentLifecycle,
              transitionId,
              commandId: input.commandId,
              expectedVersion: input.expectedVersion,
              resultingVersion: nextVersion,
            }),
            createdAt: transitionedAt,
          },
        });
      }
      if (automaticHandoff) {
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            action: 'whatsapp.service-session.handoff',
            targetType: 'service-session',
            targetId: synchronizedSession.id,
            metadata: payload({
              transitionId,
              commandId: input.commandId,
              conversationId: input.conversationId,
              expectedConversationVersion: input.expectedVersion,
              resultingConversationVersion: nextVersion,
              resultingServiceSessionVersion: synchronizedSession.version,
              targetDepartmentId: automaticHandoff.targetDepartmentId,
              queueId: automaticHandoff.queueId,
              humanServiceOpen: automaticHandoff.humanServiceOpen,
              scheduleSource: automaticHandoff.scheduleSource,
              offHoursNotificationClaimed,
              handoffMessageId: handoffMessage?.id ?? null,
              actorAgentId: automaticAgentAttribution?.agentId ?? null,
              agentExecutionId: automaticAgentAttribution?.id ?? null,
              priority:
                input.automaticHumanHandoff?.sessionPriority?.priority ?? null,
              priorityReason: automaticPriorityReason,
              occurredAt: transitionedAt.toISOString(),
            }),
            createdAt: transitionedAt,
          },
        });
      }
      if (closing) {
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.conversation.close',
            targetType: 'whatsapp-conversation',
            targetId: input.conversationId,
            metadata: payload({
              transitionId,
              transitionName: input.name,
              commandId: input.commandId,
              expectedVersion: input.expectedVersion,
              resultingVersion: nextVersion,
              reason: resolvedClosingReason,
              occurredAt: transitionedAt.toISOString(),
            }),
            createdAt: transitionedAt,
          },
        });
      }
      if (input.name === 'archive' || input.name === 'unarchive') {
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: `whatsapp.conversation.${input.name}`,
            targetType: 'whatsapp-conversation',
            targetId: input.conversationId,
            metadata: payload({
              transitionId,
              commandId: input.commandId,
              expectedVersion: input.expectedVersion,
              resultingVersion: nextVersion,
              occurredAt: transitionedAt.toISOString(),
            }),
          },
        });
      }
      if (supersededQuote && quote) {
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.quote-request.superseded',
            targetType: 'quote-request',
            targetId: supersededQuote.id,
            metadata: payload({
              conversationId: input.conversationId,
              newQuoteRequestId: quote.id,
              transitionId,
              commandId: input.commandId,
              fromStatus: 'under-review',
              toStatus: 'cancelled',
              previousVersion: supersededQuote.previousVersion,
              resultingVersion: supersededQuote.resultingVersion,
              occurredAt: transitionedAt.toISOString(),
            }),
            createdAt: transitionedAt,
          },
        });
      }
      return { ...persistedResult, idempotent: false };
    };
    try {
      return existingTransaction
        ? await operation(existingTransaction)
        : await this.prisma.$transaction(operation);
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        if (existingTransaction) throw error;
        return this.replayTransition(input, fingerprint);
      }
      throw error;
    }
  }

  async patchQuoteRequest(
    companyId: string,
    quoteRequestId: string,
    input: QuoteRequestPatch,
  ): Promise<unknown> {
    const fingerprint = commandFingerprint({
      companyId,
      quoteRequestId,
      ...input,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          companyId,
          'api.quote-patch',
          input.commandId,
        );
        const duplicate = await transaction.integrationInbox.findUnique({
          where: {
            companyId_source_externalEventId: {
              companyId,
              source: 'api.quote-patch',
              externalEventId: input.commandId,
            },
          },
        });
        const current = await transaction.quoteRequest.findUnique({
          where: { id_companyId: { id: quoteRequestId, companyId } },
        });
        if (!current) throw notFound('Solicitação de orçamento');
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Comando de orçamento incompleto.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }
        if (current.confirmedAt) {
          throw validationError(
            'Um orçamento confirmado é imutável; inicie new-quote-request.',
          );
        }
        if (current.version !== input.expectedVersion) {
          throw new AppError(
            'CONFLICT',
            'A solicitação foi alterada por outro comando.',
            { currentVersion: current.version },
          );
        }

        await transaction.integrationInbox.create({
          data: {
            companyId,
            source: 'api.quote-patch',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation('quote-patch', input.commandId),
          },
        });

        const currentStructured =
          current.structuredData &&
          typeof current.structuredData === 'object' &&
          !Array.isArray(current.structuredData)
            ? (current.structuredData as Record<string, unknown>)
            : {};
        assertQuoteScheduleConsistency({
          departureDate:
            input.departureDate === undefined
              ? current.departureDate
              : input.departureDate,
          departureAt:
            input.departureAt === undefined
              ? current.departureAt
              : input.departureAt,
          returnDate:
            input.returnDate === undefined
              ? current.returnDate
              : input.returnDate,
          returnAt:
            input.returnAt === undefined ? current.returnAt : input.returnAt,
        });
        const result = await transaction.quoteRequest.updateMany({
          where: {
            id: quoteRequestId,
            companyId,
            version: input.expectedVersion,
          },
          data: {
            ...(input.contactName === undefined
              ? {}
              : { contactName: input.contactName?.trim() || null }),
            ...(input.document === undefined
              ? {}
              : { document: input.document?.replace(/\D/g, '') || null }),
            ...(input.email === undefined
              ? {}
              : { email: input.email?.trim().toLowerCase() || null }),
            ...(input.serviceType === undefined
              ? {}
              : { serviceType: input.serviceType?.trim() || null }),
            ...(input.origin === undefined
              ? {}
              : { origin: input.origin?.trim() || null }),
            ...(input.destination === undefined
              ? {}
              : { destination: input.destination?.trim() || null }),
            ...(input.departureDate === undefined
              ? {}
              : { departureDate: input.departureDate }),
            ...(input.departureAt === undefined
              ? {}
              : { departureAt: input.departureAt }),
            ...(input.returnDate === undefined
              ? {}
              : { returnDate: input.returnDate }),
            ...(input.returnAt === undefined
              ? {}
              : { returnAt: input.returnAt }),
            ...(input.passengerCount === undefined
              ? {}
              : { passengerCount: input.passengerCount }),
            ...(input.vehicleType === undefined
              ? {}
              : { vehicleType: input.vehicleType?.trim() || null }),
            ...(input.vehicleAtDisposal === undefined
              ? {}
              : { vehicleAtDisposal: input.vehicleAtDisposal }),
            ...(input.localTransfers === undefined
              ? {}
              : { localTransfers: input.localTransfers }),
            ...(input.notes === undefined
              ? {}
              : { notes: input.notes?.trim() || null }),
            ...(input.structuredData === undefined
              ? {}
              : {
                  structuredData: payload({
                    ...currentStructured,
                    ...input.structuredData,
                  }),
                }),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          const latest = await transaction.quoteRequest.findUniqueOrThrow({
            where: { id_companyId: { id: quoteRequestId, companyId } },
            select: { version: true },
          });
          throw new AppError(
            'CONFLICT',
            'A solicitação foi alterada por outro comando.',
            { currentVersion: latest.version },
          );
        }
        const persistedResult = presentQuote(
          await transaction.quoteRequest.findUniqueOrThrow({
            where: { id_companyId: { id: quoteRequestId, companyId } },
          }),
        );
        await transaction.integrationInbox.update({
          where: {
            companyId_source_externalEventId: {
              companyId,
              source: 'api.quote-patch',
              externalEventId: input.commandId,
            },
          },
          data: {
            processedAt: new Date(),
            resultSnapshot: payload(persistedResult),
          },
        });
        return {
          ...persistedResult,
          idempotent: false,
        };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          companyId,
          'api.quote-patch',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async createOutbound(input: CreateOutboundInput): Promise<unknown> {
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'api.outbound-command',
          input.commandId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'api.outbound-command',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        const messageCorrelation = correlation('outbound', input.commandId);
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Comando outbound incompleto.');
          }
          return this.presentCurrentOutboundReplay(
            transaction,
            input.companyId,
            duplicate.resultSnapshot as Record<string, unknown>,
          );
        }

        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          input.conversationId,
        );
        const conversation = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          input.conversationId,
        );
        if (conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(conversation.version);
        }
        const outboundOccurredAt = new Date();
        let foundation = await this.ensureFoundationForConversation(
          transaction,
          conversation,
          {
            commandSeed: input.commandId,
            occurredAt: outboundOccurredAt,
            direction: MessageDirection.OUTBOUND,
          },
        );
        this.assertSessionAllowsAutomaticReply(
          conversation,
          foundation.session,
        );
        if (Boolean(input.actorAgentId) !== Boolean(input.agentExecutionId)) {
          throw validationError(
            'A autoria da IA exige agente e execução correspondentes.',
          );
        }
        const agentAttribution =
          input.actorAgentId && input.agentExecutionId
            ? await transaction.agentExecution.findFirst({
                where: {
                  id: input.agentExecutionId,
                  companyId: input.companyId,
                  agentId: input.actorAgentId,
                  serviceSessionId: foundation.session.id,
                  status: AgentExecutionStatus.SUCCEEDED,
                },
                select: { id: true, agentId: true },
              })
            : null;
        if (input.actorAgentId && input.agentExecutionId && !agentAttribution) {
          throw forbidden(
            'A execução de IA não pertence a esta sessão ou ainda não foi concluída.',
          );
        }
        if (input.conversationResolved && !agentAttribution) {
          throw validationError(
            'A resolução automática exige uma execução de agente auditável.',
          );
        }
        const sessionPriorityReason = input.sessionPriority?.reason.trim();
        if (
          input.sessionPriority &&
          (!sessionPriorityReason || sessionPriorityReason.length > 500)
        ) {
          throw validationError(
            'O motivo da prioridade de IA deve possuir entre 1 e 500 caracteres.',
          );
        }
        if (input.sessionPriority && !agentAttribution) {
          throw validationError(
            'A prioridade de IA exige uma execução de agente auditável.',
          );
        }
        if (
          input.sessionPriority &&
          sessionPriorityReason &&
          agentAttribution
        ) {
          const prioritizedSession = await this.updateFoundationSession(
            transaction,
            {
              companyId: input.companyId,
              session: foundation.session,
              commandId: correlation('ai-priority', input.commandId),
              name: 'ai-priority-classified',
              actorType: MutationActorType.AI_AGENT,
              actorAgentId: agentAttribution.agentId,
              status: foundation.session.status,
              controlMode: foundation.session.controlMode,
              isForeground: foundation.session.isForeground,
              priority: servicePriorityToPrisma[input.sessionPriority.priority],
              priorityReason: sessionPriorityReason,
              prioritySource: ServiceSessionPrioritySource.AI_AGENT,
              occurredAt: outboundOccurredAt,
              metadata: {
                conversationId: input.conversationId,
                agentExecutionId: agentAttribution.id,
                priority: input.sessionPriority.priority,
                priorityReason: sessionPriorityReason,
              },
            },
          );
          foundation = { ...foundation, session: prioritizedSession };
        }
        const unsupportedMessageKindReply =
          input.purpose === 'unsupported-message-kind';
        if (
          conversation.conversationState !== ConversationState.BOT_ACTIVE ||
          conversation.flowStep === FlowStep.HUMAN_SERVICE ||
          conversation.assignedToUserId !== null
        ) {
          throw forbidden(
            'Envio automático permitido somente em conversationState=bot-active.',
          );
        }
        if (!input.text?.trim() && !input.media) {
          throw validationError('A mensagem outbound exige texto ou mídia.');
        }
        if (unsupportedMessageKindReply) {
          const unsupportedText = input.text?.trim() ?? '';
          if (
            input.kind !== 'text' ||
            !unsupportedText.endsWith(UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT) ||
            input.media !== undefined ||
            input.recipientPhone !== undefined ||
            !input.inReplyToMessageId
          ) {
            throw validationError(
              'A resposta a conteúdo não textual exige purpose, texto fixo e inReplyToMessageId canônicos.',
            );
          }
          const inbound = await transaction.whatsAppMessage.findUnique({
            where: {
              id_companyId: {
                id: input.inReplyToMessageId,
                companyId: input.companyId,
              },
            },
            select: {
              conversationId: true,
              direction: true,
              kind: true,
            },
          });
          if (
            !inbound ||
            inbound.conversationId !== input.conversationId ||
            inbound.direction !== MessageDirection.INBOUND ||
            inbound.kind === MessageKind.TEXT
          ) {
            throw validationError(
              'inReplyToMessageId deve identificar um inbound não textual desta conversa.',
            );
          }
        } else if (input.inReplyToMessageId !== undefined) {
          throw validationError(
            'inReplyToMessageId é permitido somente para unsupported-message-kind.',
          );
        }
        const recipientPhone =
          input.purpose === 'department-notification'
            ? input.recipientPhone?.replace(/\D/g, '')
            : conversation.contact.phoneNormalized;
        if (
          input.purpose === 'department-notification' &&
          (!recipientPhone || !/^\d{10,15}$/.test(recipientPhone))
        ) {
          throw validationError(
            'A notificação de departamento exige um telefone de destinatário válido.',
          );
        }
        if (
          input.purpose !== 'department-notification' &&
          input.recipientPhone
        ) {
          throw validationError(
            'O destinatário alternativo é permitido apenas para notificações de departamento.',
          );
        }

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: conversation.channelId,
            source: 'api.outbound-command',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation('outbound-inbox', input.commandId),
          },
        });

        // O status pending e a tentativa existem antes de qualquer chamada Evolution.
        const message = await transaction.whatsAppMessage.create({
          data: {
            companyId: input.companyId,
            conversationId: input.conversationId,
            channelId: conversation.channelId,
            contactId: conversation.contactId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            actorAgentId: agentAttribution?.agentId,
            agentExecutionId: agentAttribution?.id,
            actorType: agentAttribution
              ? WhatsAppMessageActorType.AI_AGENT
              : WhatsAppMessageActorType.SYSTEM,
            source: WhatsAppMessageSource.AUTOMATION,
            direction: MessageDirection.OUTBOUND,
            deliveryStatus: DeliveryStatus.PENDING,
            kind: kindToPrisma[input.kind],
            text: input.text?.trim(),
            media: input.media ? payload(input.media) : undefined,
            automationPurpose: input.purpose,
            recipientPhone,
            correlationId: messageCorrelation,
            occurredAt: outboundOccurredAt,
          },
        });
        const attempt = await transaction.whatsAppMessageAttempt.create({
          data: {
            companyId: input.companyId,
            messageId: message.id,
            attemptNumber: 1,
            status: MessageAttemptStatus.PENDING,
          },
        });
        if (input.conversationResolved && agentAttribution) {
          const resolvedSession = await this.updateFoundationSession(
            transaction,
            {
              companyId: input.companyId,
              session: foundation.session,
              commandId: correlation(
                'ai-conversation-resolved',
                input.commandId,
              ),
              name: 'ai-conversation-resolved',
              actorType: MutationActorType.AI_AGENT,
              actorAgentId: agentAttribution.agentId,
              status: foundation.session.status,
              controlMode: foundation.session.controlMode,
              isForeground: foundation.session.isForeground,
              conversationResolved: true,
              resolutionConfirmedByCustomer: false,
              occurredAt: outboundOccurredAt,
              metadata: {
                conversationId: input.conversationId,
                messageId: message.id,
                agentExecutionId: agentAttribution.id,
                signal: 'structured-ai-completed',
              },
            },
          );
          foundation = { ...foundation, session: resolvedSession };
        }
        const persistedResult = this.presentMessage(
          { ...message, attempts: [attempt] },
          false,
        );
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: new Date(),
            resultSnapshot: payload(persistedResult),
          },
        });
        return persistedResult;
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = (await this.replayInbox(
          input.companyId,
          'api.outbound-command',
          input.commandId,
          fingerprint,
          'commandId',
        )) as Record<string, unknown>;
        return this.presentCurrentOutboundReplay(
          this.prisma,
          input.companyId,
          replay,
        );
      }
      throw error;
    }
  }

  private async inspectHumanOutboundCommand(
    transaction: Prisma.TransactionClient,
    input: CreateHumanOutboundInput,
    normalizedText: string,
    inputHash: string,
  ) {
    await this.lockCommand(
      transaction,
      input.companyId,
      'panel.outbound-command',
      input.idempotencyKey,
    );
    const currentActor = await this.assertCurrentWhatsAppAttendant(
      transaction,
      input.companyId,
      input.actorUserId,
    );
    if (!normalizedText && !input.attachment) {
      throw validationError('A mensagem humana não pode estar vazia.');
    }

    const duplicate = await transaction.integrationInbox.findUnique({
      where: {
        companyId_source_externalEventId: {
          companyId: input.companyId,
          source: 'panel.outbound-command',
          externalEventId: input.idempotencyKey,
        },
      },
    });
    if (duplicate) {
      assertSameFingerprint(duplicate.payloadHash, inputHash, 'idempotencyKey');
      if (!duplicate.resultSnapshot) {
        throw new AppError('CONFLICT', 'Comando humano incompleto.');
      }
      return {
        kind: 'duplicate' as const,
        result: {
          ...(duplicate.resultSnapshot as Record<string, unknown>),
          idempotent: true,
        },
      };
    }

    await this.lockCommand(
      transaction,
      input.companyId,
      'whatsapp-conversation',
      input.conversationId,
    );
    const conversation = await this.findConversationOrThrow(
      transaction,
      input.companyId,
      input.conversationId,
    );
    if (conversation.version !== input.expectedVersion) {
      throw currentVersionConflict(conversation.version);
    }
    if (conversation.conversationState !== ConversationState.HUMAN_ACTIVE) {
      throw forbidden(
        'A resposta exige uma conversa com atendimento humano ativo.',
      );
    }
    if (
      !currentActor.hasTenantWideAuthority &&
      !userBelongsToDepartment(
        currentActor.departments,
        departmentFromPrisma[conversation.department],
      )
    ) {
      throw forbidden(
        'A resposta exige vínculo com o departamento responsável pela conversa.',
      );
    }
    return { kind: 'new' as const, conversation, currentActor };
  }

  async authorizeHumanOutbound(input: CreateHumanOutboundInput): Promise<void> {
    const normalizedText = input.text?.trim() ?? '';
    const inputHash = commandFingerprint({ ...input, text: normalizedText });
    await this.prisma.$transaction(async (transaction) => {
      await this.inspectHumanOutboundCommand(
        transaction,
        input,
        normalizedText,
        inputHash,
      );
    });
  }

  async createHumanOutbound(input: CreateHumanOutboundInput): Promise<unknown> {
    const normalizedText = input.text?.trim() ?? '';
    const inputHash = commandFingerprint({
      ...input,
      text: normalizedText,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const inspection = await this.inspectHumanOutboundCommand(
          transaction,
          input,
          normalizedText,
          inputHash,
        );
        if (inspection.kind === 'duplicate') return inspection.result;
        const { conversation, currentActor } = inspection;
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.outbound-command',
            externalEventId: input.idempotencyKey,
          },
        };
        const messageCorrelation = correlation(
          'human-outbound',
          input.idempotencyKey,
        );
        const humanOccurredAt = new Date();
        let foundation = await this.ensureFoundationForConversation(
          transaction,
          conversation,
          {
            commandSeed: input.commandId,
            occurredAt: humanOccurredAt,
            direction: MessageDirection.OUTBOUND,
            desiredConversationState: ConversationState.HUMAN_ACTIVE,
          },
        );
        const department = await transaction.tenantDepartment.findUnique({
          where: {
            companyId_code: {
              companyId: input.companyId,
              code: conversation.department,
            },
          },
          select: { id: true },
        });
        const humanSession = await this.updateFoundationSession(transaction, {
          companyId: input.companyId,
          session: foundation.session,
          commandId: correlation(
            'human-outbound-session',
            input.idempotencyKey,
          ),
          name: 'human-user-outbound',
          actorType: MutationActorType.HUMAN_USER,
          actorUserId: input.actorUserId,
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.HUMAN,
          isForeground: true,
          responsibleUserId: input.actorUserId,
          currentDepartmentId: department?.id ?? null,
          occurredAt: humanOccurredAt,
          metadata: { conversationId: input.conversationId },
        });
        foundation = { ...foundation, session: humanSession };

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: conversation.channelId,
            source: 'panel.outbound-command',
            externalEventId: input.idempotencyKey,
            payloadHash: inputHash,
            correlationId: correlation(
              'human-outbound-inbox',
              input.idempotencyKey,
            ),
          },
        });

        const attachment = input.attachment;
        const message = await transaction.whatsAppMessage.create({
          data: {
            ...(attachment ? { id: attachment.messageId } : {}),
            companyId: input.companyId,
            conversationId: input.conversationId,
            channelId: conversation.channelId,
            contactId: conversation.contactId,
            actorUserId: input.actorUserId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            actorType: WhatsAppMessageActorType.HUMAN_USER,
            source: WhatsAppMessageSource.LUME_WEB,
            direction: MessageDirection.OUTBOUND,
            deliveryStatus: DeliveryStatus.PENDING,
            kind: attachment ? kindToPrisma[attachment.kind] : MessageKind.TEXT,
            text: normalizedText || null,
            ...(attachment
              ? {
                  media: {
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    size: attachment.sizeBytes,
                    retentionStatus: 'stored',
                  },
                  mediaStorageKey: attachment.storageKey,
                  mediaMimeType: attachment.mimeType,
                  mediaSizeBytes: attachment.sizeBytes,
                  mediaOriginalName: attachment.fileName,
                  mediaSha256: attachment.sha256,
                  mediaStoredAt: new Date(),
                }
              : {}),
            recipientPhone: conversation.contact.phoneNormalized,
            correlationId: messageCorrelation,
            occurredAt: humanOccurredAt,
          },
        });
        const attempt = await transaction.whatsAppMessageAttempt.create({
          data: {
            companyId: input.companyId,
            messageId: message.id,
            attemptNumber: 1,
            status: MessageAttemptStatus.PENDING,
          },
        });
        const updatedCount = await transaction.whatsAppConversation.updateMany({
          where: {
            id: input.conversationId,
            companyId: input.companyId,
            version: input.expectedVersion,
          },
          data: {
            lastMessagePreview: (
              normalizedText ||
              (attachment ? `Arquivo: ${attachment.fileName}` : '')
            ).slice(0, 240),
            version: { increment: 1 },
          },
        });
        if (updatedCount.count !== 1) {
          const latest =
            await transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: input.conversationId,
                  companyId: input.companyId,
                },
              },
              select: { version: true },
            });
          throw currentVersionConflict(latest.version);
        }

        const updatedConversation = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          input.conversationId,
        );
        await this.createOrderedOutbox(transaction, {
          companyId: input.companyId,
          topic: 'whatsapp.outbound.requested',
          aggregateType: 'whatsapp-conversation',
          aggregateId: input.conversationId,
          correlationId: correlation(
            'human-outbound-request',
            input.idempotencyKey,
          ),
          payload: {
            eventId: input.commandId,
            commandId: input.commandId,
            messageId: message.id,
            attemptId: attempt.id,
            conversationId: input.conversationId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            channelId: conversation.channelId,
            companyId: input.companyId,
            contact: {
              id: conversation.contact.id,
              phone: conversation.contact.phoneNormalized,
              displayName: conversation.contact.displayName,
            },
            message: {
              providerMessageId: null,
              direction: 'outbound',
              deliveryStatus: 'pending',
              kind: attachment?.kind ?? 'text',
              text: normalizedText || null,
              media: attachment
                ? {
                    storageKey: attachment.storageKey,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    size: attachment.sizeBytes,
                  }
                : null,
              occurredAt: message.occurredAt.toISOString(),
            },
            conversation: {
              id: updatedConversation.id,
              ...snapshot(updatedConversation),
              version: updatedConversation.version,
            },
            automatic: false,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: true,
            contextualTransition: false,
            isFirstContact: false,
          },
        });
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.message.send',
            targetType: 'whatsapp-message',
            targetId: message.id,
            metadata: payload({
              conversationId: input.conversationId,
              commandId: input.commandId,
              idempotencyKey: input.idempotencyKey,
              assignedToUserIdAtSend: conversation.assignedToUserId,
              responderWasAssigned:
                conversation.assignedToUserId === input.actorUserId,
            }),
          },
        });
        const persistedResult = {
          message: this.presentMessage(
            {
              ...message,
              actorUser: {
                id: currentActor.id,
                name: currentActor.name,
              },
              attempts: [attempt],
            },
            false,
          ),
          conversation: presentConversation(updatedConversation),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: new Date(),
            resultSnapshot: payload(persistedResult),
          },
        });

        return {
          ...persistedResult,
          idempotent: false,
        };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.outbound-command',
          input.idempotencyKey,
          inputHash,
          'idempotencyKey',
        );
      }
      throw error;
    }
  }

  async claimEvolutionDispatch(
    input: ClaimEvolutionDispatchInput,
  ): Promise<unknown> {
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'evolution-attempt',
          `${input.messageId}:${input.attemptId}`,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'api.evolution-claim',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (!duplicate) {
          await transaction.integrationInbox.create({
            data: {
              companyId: input.companyId,
              source: 'api.evolution-claim',
              externalEventId: input.commandId,
              payloadHash: fingerprint,
              correlationId: correlation('evolution-claim', input.commandId),
            },
          });
        }
        let dispatchRoute: Readonly<Record<string, string>> = {};
        const completeClaim = async (result: Record<string, unknown>) => {
          const routedResult = { ...result, ...dispatchRoute };
          await transaction.integrationInbox.update({
            where: inboxKey,
            data: {
              processedAt: new Date(),
              resultSnapshot: payload(routedResult),
            },
          });
          return routedResult;
        };
        const message = await transaction.whatsAppMessage.findUnique({
          where: {
            id_companyId: { id: input.messageId, companyId: input.companyId },
          },
          select: {
            id: true,
            channelId: true,
            conversationId: true,
            serviceSessionId: true,
            actorUserId: true,
            actorType: true,
            source: true,
            automationPurpose: true,
            direction: true,
            deliveryStatus: true,
            channel: { select: { instanceName: true } },
          },
        });
        if (!message) throw notFound('Mensagem');
        dispatchRoute = {
          sourceChannelId: message.channelId,
          instanceName: message.channel.instanceName,
        };
        if (message.direction !== MessageDirection.OUTBOUND) {
          throw validationError(
            'Somente mensagens outbound podem ser reservadas para envio.',
          );
        }
        const bypassSessionGate = [
          'conversation-closure',
          'department-contact-finalization',
          'quote-proposal',
        ].includes(message.automationPurpose ?? '');
        const lifecyclePurpose = message.automationPurpose as
          'service-session-closing-question' | 'service-session-closure' | null;
        if (
          lifecyclePurpose === 'service-session-closing-question' ||
          lifecyclePurpose === 'service-session-closure'
        ) {
          if (!message.serviceSessionId) {
            throw new AppError(
              'CONFLICT',
              'A mensagem de lifecycle não está vinculada à sessão.',
            );
          }
          await this.lockCommand(
            transaction,
            input.companyId,
            'whatsapp-conversation',
            message.conversationId,
          );
          const sessionBeforeLock = await transaction.serviceSession.findUnique(
            {
              where: {
                id_companyId: {
                  id: message.serviceSessionId,
                  companyId: input.companyId,
                },
              },
              select: serviceSessionAuthorizationSelect,
            },
          );
          if (!sessionBeforeLock) {
            throw new AppError('CONFLICT', 'A sessão de lifecycle não existe.');
          }
          await this.lockCommand(
            transaction,
            input.companyId,
            'service-session-lifecycle',
            sessionBeforeLock.threadId,
          );
          const lifecycleSession = await transaction.serviceSession.findUnique({
            where: {
              id_companyId: {
                id: message.serviceSessionId,
                companyId: input.companyId,
              },
            },
            select: serviceSessionAuthorizationSelect,
          });
          const lifecycleAllowed =
            lifecyclePurpose === 'service-session-closing-question'
              ? lifecycleSession?.status === ServiceSessionStatus.CLOSING &&
                lifecycleSession.controlMode === ServiceSessionControlMode.AI &&
                lifecycleSession.isForeground
              : lifecycleSession?.status === ServiceSessionStatus.CLOSED &&
                !lifecycleSession.isForeground &&
                lifecycleSession.publicContinuationCode !== null &&
                lifecycleSession.continuationCodeExpiresAt !== null &&
                lifecycleSession.continuationCodeExpiresAt >= new Date();
          if (!lifecycleAllowed) {
            throw new AppError(
              'CONFLICT',
              'A mensagem de lifecycle ficou obsoleta pelo estado atual da sessão.',
            );
          }
        }
        const automaticReply =
          !bypassSessionGate &&
          lifecyclePurpose !== 'service-session-closing-question' &&
          lifecyclePurpose !== 'service-session-closure' &&
          message.actorUserId === null &&
          (message.source === WhatsAppMessageSource.AUTOMATION ||
            message.actorType === WhatsAppMessageActorType.AI_AGENT ||
            message.actorType === WhatsAppMessageActorType.SYSTEM ||
            message.automationPurpose !== null);
        if (automaticReply) {
          await this.lockCommand(
            transaction,
            input.companyId,
            'whatsapp-conversation',
            message.conversationId,
          );
          const conversation = await this.findConversationOrThrow(
            transaction,
            input.companyId,
            message.conversationId,
          );
          const session = conversation.threadId
            ? await transaction.serviceSession.findFirst({
                where: {
                  companyId: input.companyId,
                  threadId: conversation.threadId,
                  isForeground: true,
                  status: { not: ServiceSessionStatus.CLOSED },
                },
                orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                select: serviceSessionAuthorizationSelect,
              })
            : null;
          if (
            !session ||
            (message.serviceSessionId !== null &&
              message.serviceSessionId !== session.id)
          ) {
            throw new AppError(
              'CONFLICT',
              'A resposta automática pertence a uma sessão que não está mais ativa.',
            );
          }
          this.assertSessionAllowsAutomaticReply(conversation, session);
        }

        const attempt = await transaction.whatsAppMessageAttempt.findUnique({
          where: {
            id_companyId: { id: input.attemptId, companyId: input.companyId },
          },
        });
        if (!attempt || attempt.messageId !== input.messageId) {
          throw notFound('Tentativa de envio');
        }
        const now = new Date();
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Claim Evolution incompleto.');
          }
          if (
            attempt.dispatchState === EvolutionDispatchState.LEASED &&
            attempt.dispatchLeaseUntil &&
            attempt.dispatchLeaseUntil <= now
          ) {
            const unknown = await transaction.whatsAppMessageAttempt.update({
              where: {
                id_companyId: {
                  id: attempt.id,
                  companyId: input.companyId,
                },
              },
              data: {
                dispatchState: EvolutionDispatchState.UNKNOWN,
                dispatchLeaseUntil: null,
              },
            });
            const result = await completeClaim({
              shouldSend: false,
              requiresReconciliation: true,
              state: 'unknown',
              messageId: message.id,
              attemptId: unknown.id,
              claimedAt: unknown.dispatchClaimedAt?.toISOString() ?? null,
            });
            return {
              ...result,
              alreadyClaimed: true,
              idempotent: true,
            };
          }
          if (attempt.dispatchState === EvolutionDispatchState.UNKNOWN) {
            const result = await completeClaim({
              shouldSend: false,
              requiresReconciliation: true,
              state: 'unknown',
              messageId: message.id,
              attemptId: attempt.id,
              claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
            });
            return {
              ...result,
              alreadyClaimed: true,
              idempotent: true,
            };
          }
          const currentState = attempt.dispatchState.toLowerCase();
          const result = await completeClaim({
            shouldSend: false,
            state: currentState,
            messageId: message.id,
            attemptId: attempt.id,
            claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
            ...(attempt.dispatchLeaseUntil
              ? { leaseUntil: attempt.dispatchLeaseUntil.toISOString() }
              : {}),
          });
          return {
            ...result,
            alreadyClaimed: true,
            idempotent: true,
          };
        }
        if (attempt.dispatchClaimId === input.commandId) {
          assertSameFingerprint(
            attempt.dispatchFingerprint ?? '',
            fingerprint,
            'commandId',
          );
        }
        if (
          attempt.status !== MessageAttemptStatus.PENDING ||
          message.deliveryStatus !== DeliveryStatus.PENDING
        ) {
          return completeClaim({
            shouldSend: false,
            state: attempt.dispatchState.toLowerCase(),
            messageId: message.id,
            attemptId: attempt.id,
            claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
          });
        }

        if (
          attempt.dispatchState === EvolutionDispatchState.LEASED &&
          attempt.dispatchLeaseUntil &&
          attempt.dispatchLeaseUntil <= now
        ) {
          const unknown = await transaction.whatsAppMessageAttempt.update({
            where: {
              id_companyId: { id: attempt.id, companyId: input.companyId },
            },
            data: {
              dispatchState: EvolutionDispatchState.UNKNOWN,
              dispatchLeaseUntil: null,
            },
          });
          return completeClaim({
            shouldSend: false,
            requiresReconciliation: true,
            state: 'unknown',
            messageId: message.id,
            attemptId: unknown.id,
            claimedAt: unknown.dispatchClaimedAt?.toISOString() ?? null,
          });
        }

        if (attempt.dispatchState === EvolutionDispatchState.LEASED) {
          return completeClaim({
            shouldSend: false,
            state: 'leased',
            messageId: message.id,
            attemptId: attempt.id,
            claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
            leaseUntil: attempt.dispatchLeaseUntil?.toISOString() ?? null,
          });
        }
        if (
          attempt.dispatchState === EvolutionDispatchState.UNKNOWN &&
          input.reconciliation !== 'confirmed-not-sent'
        ) {
          return completeClaim({
            shouldSend: false,
            requiresReconciliation: true,
            state: 'unknown',
            messageId: message.id,
            attemptId: attempt.id,
            claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
          });
        }
        if (
          attempt.dispatchState !== EvolutionDispatchState.READY &&
          attempt.dispatchState !== EvolutionDispatchState.UNKNOWN
        ) {
          return completeClaim({
            shouldSend: false,
            state: attempt.dispatchState.toLowerCase(),
            messageId: message.id,
            attemptId: attempt.id,
            claimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
          });
        }

        const leaseUntil = new Date(now.valueOf() + this.dispatchLeaseMs);
        const claimed = await transaction.whatsAppMessageAttempt.update({
          where: {
            id_companyId: { id: attempt.id, companyId: input.companyId },
          },
          data: {
            dispatchClaimId: input.commandId,
            dispatchFingerprint: fingerprint,
            dispatchClaimedAt: now,
            dispatchState: EvolutionDispatchState.LEASED,
            dispatchOwnerId: input.ownerId,
            dispatchLeaseUntil: leaseUntil,
            errorCode: null,
            errorMessage: null,
          },
        });
        return completeClaim({
          shouldSend: true,
          state: 'leased',
          messageId: message.id,
          attemptId: attempt.id,
          claimedAt: claimed.dispatchClaimedAt?.toISOString() ?? null,
          leaseUntil: claimed.dispatchLeaseUntil?.toISOString() ?? null,
        });
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = (await this.replayInbox(
          input.companyId,
          'api.evolution-claim',
          input.commandId,
          fingerprint,
          'commandId',
        )) as Record<string, unknown>;
        return {
          ...replay,
          shouldSend: false,
          alreadyClaimed: true,
        };
      }
      throw error;
    }
  }

  async recordEvolutionResult(input: EvolutionResultInput): Promise<unknown> {
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'evolution-attempt',
          `${input.messageId}:${input.attemptId}`,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'api.evolution-result',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        const message = await transaction.whatsAppMessage.findUnique({
          where: {
            id_companyId: { id: input.messageId, companyId: input.companyId },
          },
          include: {
            actorUser: { select: { id: true, name: true } },
            attempts: { orderBy: { attemptNumber: 'asc' } },
          },
        });
        if (!message) throw notFound('Mensagem');
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Resultado Evolution incompleto.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }
        if (message.direction !== MessageDirection.OUTBOUND) {
          throw validationError(
            'Resultados Evolution só podem atualizar mensagens outbound.',
          );
        }
        const attempt = message.attempts.find(
          (candidate) => candidate.id === input.attemptId,
        );
        if (!attempt) throw notFound('Tentativa de envio');
        if (attempt.dispatchState === EvolutionDispatchState.READY) {
          throw validationError(
            'A tentativa precisa de claim antes de registrar o resultado.',
          );
        }
        const requestedStatus = deliveryToPrisma[input.status];
        const statusRank: Readonly<Record<DeliveryStatus, number>> = {
          RECEIVED: 0,
          PENDING: 0,
          SENT: 1,
          DELIVERED: 2,
          READ: 3,
          FAILED: -1,
        };
        const finalStatus =
          message.deliveryStatus !== DeliveryStatus.PENDING &&
          (requestedStatus === DeliveryStatus.FAILED ||
            statusRank[requestedStatus] < statusRank[message.deliveryStatus])
            ? message.deliveryStatus
            : requestedStatus;
        const proposalDocument =
          message.automationPurpose === 'quote-proposal'
            ? await transaction.quoteProposalDocument.findUnique({
                where: {
                  messageId_companyId: {
                    messageId: message.id,
                    companyId: input.companyId,
                  },
                },
              })
            : null;
        if (
          proposalDocument &&
          finalStatus !== DeliveryStatus.FAILED &&
          !input.providerMessageId?.trim()
        ) {
          throw validationError(
            'A confirmação de envio da proposta exige providerMessageId.',
          );
        }

        if (
          proposalDocument &&
          proposalDocument.status !== QuoteProposalDocumentStatus.SENT
        ) {
          await this.lockCommand(
            transaction,
            input.companyId,
            'whatsapp-conversation',
            message.conversationId,
          );
          await this.lockCommand(
            transaction,
            input.companyId,
            'quote-proposal-delivery',
            proposalDocument.id,
          );
          const [conversation, quote] = await Promise.all([
            transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: message.conversationId,
                  companyId: input.companyId,
                },
              },
            }),
            transaction.quoteRequest.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: proposalDocument.quoteRequestId,
                  companyId: input.companyId,
                },
              },
            }),
          ]);
          if (
            proposalDocument.status !== QuoteProposalDocumentStatus.QUEUED ||
            quote.status !== RequestStatus.UNDER_REVIEW ||
            quote.conversationId !== conversation.id
          ) {
            throw new AppError(
              'CONFLICT',
              'A proposta não está mais no estado consistente aguardando confirmação do provedor.',
              {
                proposalDocumentStatus: proposalDocument.status.toLowerCase(),
                quoteRequestStatus: quote.status.toLowerCase(),
              },
            );
          }
          resolveConversationTransition({
            current: snapshotForProposalDelivery(conversation),
            name: 'proposal-delivery-confirmed',
          });
        }

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: message.channelId,
            source: 'api.evolution-result',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation('evolution-result', input.commandId),
          },
        });
        await transaction.whatsAppMessageAttempt.update({
          where: {
            id_companyId: { id: attempt.id, companyId: input.companyId },
          },
          data: {
            status:
              finalStatus === DeliveryStatus.FAILED
                ? MessageAttemptStatus.FAILED
                : MessageAttemptStatus.SUCCEEDED,
            providerMessageId: input.providerMessageId,
            errorCode:
              finalStatus === DeliveryStatus.FAILED
                ? input.errorCode?.slice(0, 80)
                : null,
            errorMessage:
              finalStatus === DeliveryStatus.FAILED && input.errorMessage
                ? sanitizeLogText(input.errorMessage)
                : null,
            completedAt: new Date(),
            dispatchState:
              finalStatus === DeliveryStatus.FAILED
                ? EvolutionDispatchState.FAILED
                : EvolutionDispatchState.SUCCEEDED,
            dispatchLeaseUntil: null,
          },
        });
        const updated = await transaction.whatsAppMessage.update({
          where: {
            id_companyId: { id: input.messageId, companyId: input.companyId },
          },
          data: {
            deliveryStatus: finalStatus,
            providerMessageId: input.providerMessageId,
          },
          include: {
            actorUser: { select: { id: true, name: true } },
            attempts: { orderBy: { attemptNumber: 'asc' } },
          },
        });
        if (proposalDocument) {
          if (proposalDocument.status !== QuoteProposalDocumentStatus.SENT) {
            const now = new Date();
            const documentUpdated =
              await transaction.quoteProposalDocument.updateMany({
                where: {
                  id: proposalDocument.id,
                  companyId: input.companyId,
                  messageId: message.id,
                  status: QuoteProposalDocumentStatus.QUEUED,
                },
                data:
                  finalStatus === DeliveryStatus.FAILED
                    ? {
                        status: QuoteProposalDocumentStatus.FAILED,
                        providerMessageId: null,
                        sentAt: null,
                      }
                    : {
                        status: QuoteProposalDocumentStatus.SENT,
                        providerMessageId: input.providerMessageId?.trim(),
                        sentAt: now,
                      },
              });
            if (documentUpdated.count !== 1) {
              throw new AppError(
                'CONFLICT',
                'O documento da proposta não está mais aguardando confirmação.',
              );
            }
            await this.completeQuoteProposalBatchIfReady(transaction, {
              companyId: input.companyId,
              conversationId: message.conversationId,
              quoteRequestId: proposalDocument.quoteRequestId,
              triggeringDocumentId: proposalDocument.id,
              deliveryBatchId: proposalDocument.deliveryBatchId,
            });
          }
        } else if (
          finalStatus !== DeliveryStatus.FAILED &&
          message.automationPurpose !== 'department-notification'
        ) {
          await transaction.whatsAppConversation.update({
            where: {
              id_companyId: {
                id: message.conversationId,
                companyId: input.companyId,
              },
            },
            data: {
              lastOutboundAt: new Date(),
              lastMessagePreview:
                message.text?.slice(0, 240) ??
                `[${kindFromPrisma[message.kind]}]`,
              ...(message.automationPurpose === 'main-menu'
                ? { mainMenuPresentedAt: new Date() }
                : {}),
              ...(message.automationPurpose === 'commercial-follow-up-menu'
                ? { followUpMenuPresentedAt: new Date() }
                : {}),
            },
          });
        }
        const persistedResult = this.presentMessage(updated, false);
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: new Date(),
            resultSnapshot: payload(persistedResult),
          },
        });
        return persistedResult;
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'api.evolution-result',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async markEvolutionDispatchUnknown(
    input: MarkEvolutionDispatchUnknownInput,
  ): Promise<unknown> {
    const errorMessage = sanitizeLogText(input.errorMessage).slice(0, 500);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCommand(
        transaction,
        input.companyId,
        'evolution-attempt',
        `${input.messageId}:${input.attemptId}`,
      );
      const attempt = await transaction.whatsAppMessageAttempt.findUnique({
        where: {
          id_companyId: {
            id: input.attemptId,
            companyId: input.companyId,
          },
        },
      });
      if (!attempt || attempt.messageId !== input.messageId) {
        throw notFound('Tentativa de envio');
      }
      if (attempt.dispatchState === EvolutionDispatchState.UNKNOWN) {
        return {
          messageId: input.messageId,
          attemptId: input.attemptId,
          state: 'unknown',
          idempotent: true,
        };
      }
      if (
        attempt.dispatchState !== EvolutionDispatchState.LEASED ||
        attempt.dispatchOwnerId !== input.ownerId
      ) {
        throw new AppError(
          'CONFLICT',
          'A tentativa não pertence à execução que solicitou a reconciliação.',
        );
      }
      await transaction.whatsAppMessageAttempt.update({
        where: {
          id_companyId: {
            id: input.attemptId,
            companyId: input.companyId,
          },
        },
        data: {
          dispatchState: EvolutionDispatchState.UNKNOWN,
          dispatchLeaseUntil: null,
          errorCode: input.errorCode.slice(0, 80),
          errorMessage,
        },
      });
      return {
        messageId: input.messageId,
        attemptId: input.attemptId,
        state: 'unknown',
        requiresReconciliation: true,
      };
    });
  }

  async completeOutboxExecution(
    input: CompleteOutboxExecutionInput,
  ): Promise<unknown> {
    const automationProvider = WhatsAppAutomationProvider.API;
    const completionSource = 'api.outbox-completion';
    const completionCorrelationPrefix = 'api-outbox-completion';
    const consumedSourceEventIds = [
      ...new Set(
        (input.consumedSourceEventIds ?? [])
          .map((sourceEventId) => sourceEventId.trim())
          .filter(Boolean),
      ),
    ];
    if (consumedSourceEventIds.length > 50) {
      throw validationError(
        'Uma conclusão pode incorporar no máximo 50 eventos inbound.',
      );
    }
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          `${completionSource}-command`,
          input.commandId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: completionSource,
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Conclusão de outbox incompleta.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        await this.lockCommand(
          transaction,
          input.companyId,
          'api.outbox-event',
          input.eventId,
        );
        const event = await transaction.integrationOutbox.findFirst({
          where: { id: input.eventId, companyId: input.companyId },
        });
        if (!event) throw notFound('Evento de outbox');
        if (
          event.aggregateType !== input.aggregateType ||
          event.aggregateId !== input.aggregateId
        ) {
          throw new AppError(
            'CONFLICT',
            'O agregado informado não corresponde ao evento.',
          );
        }
        if (event.status !== IntegrationOutboxStatus.PROCESSING) {
          throw new AppError(
            'CONFLICT',
            'O evento já foi concluído ou não possui execução aceita.',
            { status: event.status.toLowerCase() },
          );
        }
        if (event.executionId !== input.executionId) {
          throw new AppError(
            'CONFLICT',
            'executionId não corresponde à execução atual do evento.',
          );
        }
        if (
          event.processingProvider !== null &&
          event.processingProvider !== automationProvider
        ) {
          throw new AppError(
            'CONFLICT',
            'A execução pertence a outro provedor de automação.',
          );
        }
        if (
          consumedSourceEventIds.length > 0 &&
          (input.outcome !== 'succeeded' ||
            event.topic !== 'whatsapp.inbound.persisted')
        ) {
          throw validationError(
            'Somente uma conclusão inbound bem-sucedida pode incorporar eventos do mesmo lote.',
          );
        }
        if (
          input.outcome === 'succeeded' &&
          event.topic === 'whatsapp.outbound.requested'
        ) {
          const eventPayload =
            event.payload &&
            typeof event.payload === 'object' &&
            !Array.isArray(event.payload)
              ? (event.payload as Record<string, unknown>)
              : {};
          const messageId =
            typeof eventPayload.messageId === 'string'
              ? eventPayload.messageId
              : null;
          const attemptId =
            typeof eventPayload.attemptId === 'string'
              ? eventPayload.attemptId
              : null;
          if (!messageId || !attemptId) {
            throw new AppError(
              'CONFLICT',
              'O evento outbound não identifica a mensagem e a tentativa de envio.',
            );
          }
          const [outboundMessage, outboundAttempt] = await Promise.all([
            transaction.whatsAppMessage.findUnique({
              where: {
                id_companyId: {
                  id: messageId,
                  companyId: input.companyId,
                },
              },
              select: { direction: true, deliveryStatus: true },
            }),
            transaction.whatsAppMessageAttempt.findUnique({
              where: {
                id_companyId: {
                  id: attemptId,
                  companyId: input.companyId,
                },
              },
              select: {
                messageId: true,
                status: true,
                dispatchState: true,
              },
            }),
          ]);
          const positiveDeliveryConfirmed =
            outboundMessage?.direction === MessageDirection.OUTBOUND &&
            (
              [
                DeliveryStatus.SENT,
                DeliveryStatus.DELIVERED,
                DeliveryStatus.READ,
              ] as DeliveryStatus[]
            ).includes(outboundMessage.deliveryStatus);
          const positiveAttemptConfirmed =
            outboundAttempt?.messageId === messageId &&
            outboundAttempt.status === MessageAttemptStatus.SUCCEEDED &&
            outboundAttempt.dispatchState === EvolutionDispatchState.SUCCEEDED;
          const terminalFailureConfirmed =
            outboundMessage?.direction === MessageDirection.OUTBOUND &&
            outboundMessage.deliveryStatus === DeliveryStatus.FAILED &&
            outboundAttempt?.messageId === messageId &&
            outboundAttempt.status === MessageAttemptStatus.FAILED &&
            outboundAttempt.dispatchState === EvolutionDispatchState.FAILED;
          if (!(
            (positiveDeliveryConfirmed && positiveAttemptConfirmed) ||
            terminalFailureConfirmed
          )) {
            throw new AppError(
              'CONFLICT',
              'O workflow não pode concluir o evento antes de persistir o resultado da Evolution.',
              {
                deliveryStatus:
                  outboundMessage?.deliveryStatus.toLowerCase() ?? 'missing',
                attemptStatus:
                  outboundAttempt?.status.toLowerCase() ?? 'missing',
              },
            );
          }
        }

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            source: completionSource,
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              completionCorrelationPrefix,
              input.commandId,
            ),
          },
        });

        const attempts = event.attempts;
        const retryableFailureExhausted =
          input.outcome === 'retryable-failure' &&
          attempts >= event.maxAttempts;
        const now = new Date();
        const retryDelay = Math.min(
          this.automationRetryBaseDelayMs * 2 ** Math.max(0, attempts - 1),
          this.automationRetryMaximumDelayMs,
        );
        const failure = sanitizeLogText(
          `${input.errorCode ?? input.outcome}: ${input.errorMessage ?? ''}`,
        ).slice(0, 500);
        const updated = await transaction.integrationOutbox.update({
          where: { id: event.id },
          data:
            input.outcome === 'succeeded'
              ? {
                  status: IntegrationOutboxStatus.DELIVERED,
                  attempts,
                  deliveredAt: now,
                  executionLeaseUntil: null,
                  lockedAt: null,
                  lockId: null,
                  lastError: null,
                }
              : input.outcome === 'retryable-failure' &&
                  !retryableFailureExhausted
                ? {
                    status: IntegrationOutboxStatus.PENDING,
                    attempts,
                    availableAt: new Date(now.valueOf() + retryDelay),
                    processingProvider: null,
                    executionId: null,
                    acceptedAt: null,
                    executionLeaseUntil: null,
                    lockedAt: null,
                    lockId: null,
                    lastError: failure,
                  }
                : {
                    status: IntegrationOutboxStatus.DEAD,
                    attempts,
                    ...(retryableFailureExhausted
                      ? { executionId: null, acceptedAt: null }
                      : {}),
                    executionLeaseUntil: null,
                    lockedAt: null,
                    lockId: null,
                    lastError: failure,
                  },
        });
        const executionStatus =
          input.outcome === 'succeeded'
            ? WhatsAppAutomationExecutionStatus.SUCCEEDED
            : input.outcome === 'retryable-failure' &&
                !retryableFailureExhausted
              ? WhatsAppAutomationExecutionStatus.RETRYABLE_FAILURE
              : WhatsAppAutomationExecutionStatus.TERMINAL_FAILURE;
        const auditedExecution =
          await transaction.whatsAppAutomationExecution.updateMany({
            where: {
              companyId: input.companyId,
              executionId: input.executionId,
              provider: automationProvider,
            },
            data: {
              status: executionStatus,
              acceptedAt: event.acceptedAt ?? now,
              completedAt: now,
              errorCode:
                input.outcome === 'succeeded'
                  ? null
                  : (input.errorCode ?? input.outcome).slice(0, 80),
              errorMessage:
                input.outcome === 'succeeded' ? null : failure.slice(0, 500),
            },
          });
        if (event.processingProvider !== null && auditedExecution.count !== 1) {
          throw new AppError(
            'CONFLICT',
            'A execução não possui o registro de auditoria esperado.',
          );
        }
        const consumedEvents =
          consumedSourceEventIds.length > 0
            ? await transaction.integrationOutbox.findMany({
                where: {
                  id: { not: event.id },
                  companyId: input.companyId,
                  aggregateType: event.aggregateType,
                  aggregateId: event.aggregateId,
                  topic: 'whatsapp.inbound.persisted',
                  correlationId: { in: consumedSourceEventIds },
                  status: IntegrationOutboxStatus.PENDING,
                },
                select: { id: true, attempts: true },
              })
            : [];
        const consumed =
          consumedEvents.length > 0
            ? await transaction.integrationOutbox.updateMany({
                where: {
                  id: { in: consumedEvents.map((item) => item.id) },
                  companyId: input.companyId,
                  status: IntegrationOutboxStatus.PENDING,
                },
                data: {
                  status: IntegrationOutboxStatus.DELIVERED,
                  processingProvider: automationProvider,
                  deliveredAt: now,
                  executionId: null,
                  acceptedAt: null,
                  executionLeaseUntil: null,
                  lockedAt: null,
                  lockId: null,
                  lastError: null,
                },
              })
            : { count: 0 };
        if (consumed.count !== consumedEvents.length) {
          throw new AppError(
            'CONFLICT',
            'Os eventos incorporados ao lote foram alterados durante a conclusão.',
          );
        }
        if (consumedEvents.length > 0) {
          await transaction.whatsAppAutomationExecution.createMany({
            data: consumedEvents.map((consumedEvent) => ({
              companyId: input.companyId,
              outboxEventId: consumedEvent.id,
              executionId: deterministicCommandId(
                input.executionId,
                `consumed:${consumedEvent.id}`,
              ),
              provider: automationProvider,
              status: WhatsAppAutomationExecutionStatus.SUCCEEDED,
              attemptNumber: Math.max(1, consumedEvent.attempts),
              startedAt: now,
              acceptedAt: now,
              completedAt: now,
            })),
            skipDuplicates: true,
          });
        }
        const persistedResult = {
          eventId: updated.id,
          executionId: input.executionId,
          aggregateType: updated.aggregateType,
          aggregateId: updated.aggregateId,
          aggregateSequence: updated.aggregateSequence,
          outcome: input.outcome,
          status: updated.status.toLowerCase(),
          attempts: updated.attempts,
          consumedEventCount: consumed.count,
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: now,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          completionSource,
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async reconcileAutomationOutbox(
    input: ReconcileAutomationOutboxInput,
  ): Promise<unknown> {
    const evidence = input.evidence.trim();
    if (evidence.length < 10 || evidence.length > 500) {
      throw validationError(
        'A reconciliação exige uma evidência entre 10 e 500 caracteres.',
      );
    }
    if (
      input.resolution !== 'confirmed-sent' &&
      input.resolution !== 'confirmed-not-sent' &&
      input.resolution !== 'confirmed-processed' &&
      input.resolution !== 'confirmed-not-processed'
    ) {
      throw validationError('A resolução de reconciliação é inválida.');
    }
    const providerMessageId = input.providerMessageId?.trim();
    if (
      input.resolution !== 'confirmed-sent' &&
      providerMessageId !== undefined
    ) {
      throw validationError(
        'Somente um envio confirmado pode informar identificador do provedor.',
      );
    }
    if (
      input.resolution === 'confirmed-sent' &&
      (!providerMessageId || providerMessageId.length > 160)
    ) {
      throw validationError(
        'O envio confirmado exige um identificador válido do provedor.',
      );
    }
    const normalizedInput = {
      ...input,
      evidence,
      ...(providerMessageId ? { providerMessageId } : {}),
    };
    const fingerprint = commandFingerprint(normalizedInput);
    const inboxSource = 'whatsapp.automation-reconciliation';

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-automation-reconciliation',
          input.eventId,
        );
        const lockedEvent = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM integration_outbox
          WHERE id = CAST(${input.eventId} AS uuid)
            AND company_id = CAST(${input.companyId} AS uuid)
          FOR UPDATE
        `;
        if (lockedEvent.length !== 1) throw notFound('Evento de outbox');

        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: inboxSource,
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Reconciliação incompleta.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const event = await transaction.integrationOutbox.findUnique({
          where: {
            id_companyId: {
              id: input.eventId,
              companyId: input.companyId,
            },
          },
        });
        if (!event) throw notFound('Evento de outbox');
        if (event.status !== IntegrationOutboxStatus.DEAD) {
          throw new AppError(
            'CONFLICT',
            'Somente um evento isolado pode ser reconciliado.',
          );
        }

        const eventPayload =
          event.payload &&
          typeof event.payload === 'object' &&
          !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)
            : {};
        const inboundTopic =
          event.topic === 'whatsapp.inbound.persisted' ||
          event.topic === 'whatsapp.inbound.human-notification';
        const inboundResolution =
          input.resolution === 'confirmed-processed' ||
          input.resolution === 'confirmed-not-processed';
        if (inboundTopic) {
          if (
            !inboundResolution ||
            event.lastError !== LEGACY_AUTOMATION_RECONCILIATION_REQUIRED ||
            event.processingProvider === null
          ) {
            throw new AppError(
              'CONFLICT',
              'O evento inbound não foi isolado por uma troca de provedor.',
            );
          }
          const channelId =
            typeof eventPayload.channelId === 'string'
              ? eventPayload.channelId
              : undefined;
          await transaction.integrationInbox.create({
            data: {
              companyId: input.companyId,
              ...(channelId ? { channelId } : {}),
              source: inboxSource,
              externalEventId: input.commandId,
              payloadHash: fingerprint,
              correlationId: correlation(
                'whatsapp-automation-reconciliation',
                input.commandId,
              ),
            },
          });

          const now = new Date();
          const confirmedProcessed = input.resolution === 'confirmed-processed';
          const previousProvider =
            event.processingProvider === WhatsAppAutomationProvider.API
              ? 'api'
              : 'legacy';
          await transaction.integrationOutbox.update({
            where: {
              id_companyId: { id: event.id, companyId: input.companyId },
            },
            data: confirmedProcessed
              ? {
                  status: IntegrationOutboxStatus.DELIVERED,
                  deliveredAt: now,
                  executionId: null,
                  acceptedAt: null,
                  executionLeaseUntil: null,
                  lockedAt: null,
                  lockId: null,
                  lastError: null,
                }
              : {
                  status: IntegrationOutboxStatus.PENDING,
                  attempts: 0,
                  availableAt: now,
                  processingProvider: null,
                  executionId: null,
                  acceptedAt: null,
                  executionLeaseUntil: null,
                  deliveredAt: null,
                  lockedAt: null,
                  lockId: null,
                  lastError: null,
                },
          });
          const persistedResult = {
            eventId: event.id,
            topic: event.topic,
            resolution: input.resolution,
            status: confirmedProcessed ? 'delivered' : 'pending',
            previousProvider,
            evidence,
            reconciledBy: {
              id: input.serviceIdentityId,
              name: input.serviceIdentityName,
            },
            reconciledAt: now.toISOString(),
          };
          await transaction.integrationInbox.update({
            where: inboxKey,
            data: {
              processedAt: now,
              resultSnapshot: payload(persistedResult),
            },
          });
          return { ...persistedResult, idempotent: false };
        }
        if (
          event.topic !== 'whatsapp.outbound.requested' ||
          inboundResolution
        ) {
          throw new AppError(
            'CONFLICT',
            'A resolução não corresponde ao tipo do evento isolado.',
          );
        }
        const messageId =
          typeof eventPayload.messageId === 'string'
            ? eventPayload.messageId
            : null;
        const attemptId =
          typeof eventPayload.attemptId === 'string'
            ? eventPayload.attemptId
            : null;
        if (!messageId || !attemptId) {
          throw new AppError(
            'CONFLICT',
            'O evento isolado não identifica a mensagem e a tentativa.',
          );
        }
        await this.lockCommand(
          transaction,
          input.companyId,
          'evolution-attempt',
          `${messageId}:${attemptId}`,
        );
        await this.lockCommand(
          transaction,
          input.companyId,
          'evolution-message-attempts',
          messageId,
        );

        const [message, attempt, attemptNumbers] = await Promise.all([
          transaction.whatsAppMessage.findUnique({
            where: {
              id_companyId: { id: messageId, companyId: input.companyId },
            },
          }),
          transaction.whatsAppMessageAttempt.findUnique({
            where: {
              id_companyId: { id: attemptId, companyId: input.companyId },
            },
          }),
          transaction.whatsAppMessageAttempt.aggregate({
            where: { companyId: input.companyId, messageId },
            _max: { attemptNumber: true },
          }),
        ]);
        if (!message || message.direction !== MessageDirection.OUTBOUND) {
          throw new AppError(
            'CONFLICT',
            'O evento isolado não aponta para uma mensagem de saída válida.',
          );
        }
        if (!attempt || attempt.messageId !== message.id) {
          throw new AppError(
            'CONFLICT',
            'O evento isolado não aponta para uma tentativa válida.',
          );
        }

        const now = new Date();
        const expiredLease =
          attempt.dispatchState === EvolutionDispatchState.LEASED &&
          attempt.dispatchLeaseUntil !== null &&
          attempt.dispatchLeaseUntil <= now;
        const confirmedLocalConfigurationFailure =
          input.resolution === 'confirmed-not-sent' &&
          attempt.status === MessageAttemptStatus.FAILED &&
          attempt.dispatchState === EvolutionDispatchState.FAILED &&
          attempt.errorCode === 'EVOLUTION_CONFIGURATION_INVALID' &&
          message.deliveryStatus === DeliveryStatus.FAILED &&
          attempt.providerMessageId === null &&
          message.providerMessageId === null;
        const confirmedSentAlreadyPersisted =
          input.resolution === 'confirmed-sent' &&
          attempt.status === MessageAttemptStatus.SUCCEEDED &&
          attempt.dispatchState === EvolutionDispatchState.SUCCEEDED &&
          (
            [
              DeliveryStatus.SENT,
              DeliveryStatus.DELIVERED,
              DeliveryStatus.READ,
            ] as DeliveryStatus[]
          ).includes(message.deliveryStatus) &&
          attempt.providerMessageId === providerMessageId &&
          message.providerMessageId === providerMessageId;
        const awaitingReconciliation =
          attempt.dispatchState === EvolutionDispatchState.UNKNOWN ||
          expiredLease ||
          confirmedLocalConfigurationFailure ||
          confirmedSentAlreadyPersisted;
        if (!awaitingReconciliation) {
          throw new AppError(
            'CONFLICT',
            'A tentativa não está aguardando reconciliação.',
          );
        }
        const compatibleConfirmedSentState =
          (attempt.status === MessageAttemptStatus.PENDING &&
            (
              [
                DeliveryStatus.PENDING,
                DeliveryStatus.SENT,
                DeliveryStatus.DELIVERED,
                DeliveryStatus.READ,
              ] as DeliveryStatus[]
            ).includes(message.deliveryStatus)) ||
          confirmedSentAlreadyPersisted;
        const compatibleConfirmedNotSentState =
          (attempt.status === MessageAttemptStatus.PENDING &&
            message.deliveryStatus === DeliveryStatus.PENDING) ||
          confirmedLocalConfigurationFailure;
        if (
          (input.resolution === 'confirmed-sent' &&
            !compatibleConfirmedSentState) ||
          (input.resolution === 'confirmed-not-sent' &&
            !compatibleConfirmedNotSentState)
        ) {
          throw new AppError(
            'CONFLICT',
            'A mensagem ou a tentativa já possui um resultado incompatível.',
          );
        }
        if (
          input.resolution === 'confirmed-not-sent' &&
          (attempt.providerMessageId !== null ||
            message.providerMessageId !== null)
        ) {
          throw new AppError(
            'CONFLICT',
            'A ausência de envio não pode ser confirmada após um resultado positivo do provedor.',
          );
        }
        if (
          input.resolution === 'confirmed-sent' &&
          ((attempt.providerMessageId !== null &&
            attempt.providerMessageId !== providerMessageId) ||
            (message.providerMessageId !== null &&
              message.providerMessageId !== providerMessageId))
        ) {
          throw new AppError(
            'CONFLICT',
            'O identificador confirmado diverge do resultado já persistido.',
          );
        }

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: message.channelId,
            source: inboxSource,
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'whatsapp-automation-reconciliation',
              input.commandId,
            ),
          },
        });

        let nextAttemptId: string | null = null;
        let dispatchGeneration: string | null = null;
        if (input.resolution === 'confirmed-sent') {
          const finalDeliveryStatus = (
            [
              DeliveryStatus.SENT,
              DeliveryStatus.DELIVERED,
              DeliveryStatus.READ,
            ] as DeliveryStatus[]
          ).includes(message.deliveryStatus)
            ? message.deliveryStatus
            : DeliveryStatus.SENT;
          const proposalDocument =
            message.automationPurpose === 'quote-proposal'
              ? await transaction.quoteProposalDocument.findUnique({
                  where: {
                    messageId_companyId: {
                      messageId: message.id,
                      companyId: input.companyId,
                    },
                  },
                })
              : null;
          if (
            proposalDocument &&
            proposalDocument.status !== QuoteProposalDocumentStatus.QUEUED &&
            proposalDocument.status !== QuoteProposalDocumentStatus.SENT
          ) {
            throw new AppError(
              'CONFLICT',
              'A proposta não está mais aguardando confirmação de envio.',
            );
          }
          if (
            proposalDocument?.providerMessageId &&
            proposalDocument.providerMessageId !== providerMessageId
          ) {
            throw new AppError(
              'CONFLICT',
              'O identificador confirmado diverge da proposta persistida.',
            );
          }

          if (!confirmedSentAlreadyPersisted) {
            await transaction.whatsAppMessageAttempt.update({
              where: {
                id_companyId: { id: attempt.id, companyId: input.companyId },
              },
              data: {
                status: MessageAttemptStatus.SUCCEEDED,
                providerMessageId,
                errorCode: null,
                errorMessage: null,
                completedAt: now,
                dispatchState: EvolutionDispatchState.SUCCEEDED,
                dispatchLeaseUntil: null,
              },
            });
            await transaction.whatsAppMessage.update({
              where: {
                id_companyId: { id: message.id, companyId: input.companyId },
              },
              data: {
                deliveryStatus: finalDeliveryStatus,
                providerMessageId,
              },
            });
          }
          if (proposalDocument?.status === QuoteProposalDocumentStatus.QUEUED) {
            await this.lockCommand(
              transaction,
              input.companyId,
              'quote-proposal-delivery',
              proposalDocument.id,
            );
            const documentUpdated =
              await transaction.quoteProposalDocument.updateMany({
                where: {
                  id: proposalDocument.id,
                  companyId: input.companyId,
                  messageId: message.id,
                  status: QuoteProposalDocumentStatus.QUEUED,
                },
                data: {
                  status: QuoteProposalDocumentStatus.SENT,
                  providerMessageId,
                  sentAt: now,
                },
              });
            if (documentUpdated.count !== 1) {
              throw new AppError(
                'CONFLICT',
                'A proposta foi alterada durante a reconciliação.',
              );
            }
            await this.completeQuoteProposalBatchIfReady(transaction, {
              companyId: input.companyId,
              conversationId: message.conversationId,
              quoteRequestId: proposalDocument.quoteRequestId,
              triggeringDocumentId: proposalDocument.id,
              deliveryBatchId: proposalDocument.deliveryBatchId,
            });
          } else if (
            !confirmedSentAlreadyPersisted &&
            !proposalDocument &&
            message.automationPurpose !== 'department-notification'
          ) {
            await transaction.whatsAppConversation.update({
              where: {
                id_companyId: {
                  id: message.conversationId,
                  companyId: input.companyId,
                },
              },
              data: {
                lastOutboundAt: now,
                lastMessagePreview:
                  message.text?.slice(0, 240) ??
                  `[${kindFromPrisma[message.kind]}]`,
                ...(message.automationPurpose === 'main-menu'
                  ? { mainMenuPresentedAt: now }
                  : {}),
                ...(message.automationPurpose === 'commercial-follow-up-menu'
                  ? { followUpMenuPresentedAt: now }
                  : {}),
              },
            });
          }
          await transaction.integrationOutbox.update({
            where: {
              id_companyId: { id: event.id, companyId: input.companyId },
            },
            data: {
              status: IntegrationOutboxStatus.DELIVERED,
              deliveredAt: now,
              executionLeaseUntil: null,
              lockedAt: null,
              lockId: null,
              lastError: null,
            },
          });
        } else {
          await transaction.whatsAppMessageAttempt.update({
            where: {
              id_companyId: { id: attempt.id, companyId: input.companyId },
            },
            data: {
              status: MessageAttemptStatus.FAILED,
              errorCode: 'CONFIRMED_NOT_SENT',
              errorMessage: sanitizeLogText(evidence),
              completedAt: now,
              dispatchState: EvolutionDispatchState.FAILED,
              dispatchLeaseUntil: null,
            },
          });
          if (message.deliveryStatus === DeliveryStatus.FAILED) {
            await transaction.whatsAppMessage.update({
              where: {
                id_companyId: {
                  id: message.id,
                  companyId: input.companyId,
                },
              },
              data: { deliveryStatus: DeliveryStatus.PENDING },
            });
          }
          const nextAttempt = await transaction.whatsAppMessageAttempt.create({
            data: {
              companyId: input.companyId,
              messageId: message.id,
              attemptNumber:
                Math.max(
                  attempt.attemptNumber,
                  attemptNumbers._max.attemptNumber ?? 0,
                ) + 1,
              status: MessageAttemptStatus.PENDING,
              dispatchState: EvolutionDispatchState.READY,
            },
          });
          nextAttemptId = nextAttempt.id;
          dispatchGeneration = randomUUID();
          await transaction.integrationOutbox.update({
            where: {
              id_companyId: { id: event.id, companyId: input.companyId },
            },
            data: {
              payload: payload({
                ...eventPayload,
                eventId: dispatchGeneration,
                commandId: dispatchGeneration,
                attemptId: nextAttempt.id,
                dispatchGeneration,
              }),
              status: IntegrationOutboxStatus.PENDING,
              attempts: 0,
              availableAt: now,
              processingProvider: null,
              executionId: null,
              acceptedAt: null,
              executionLeaseUntil: null,
              deliveredAt: null,
              lockedAt: null,
              lockId: null,
              lastError: null,
            },
          });
        }

        const persistedResult = {
          eventId: event.id,
          messageId: message.id,
          previousAttemptId: attempt.id,
          ...(nextAttemptId ? { nextAttemptId } : {}),
          ...(dispatchGeneration ? { dispatchGeneration } : {}),
          resolution: input.resolution,
          status:
            input.resolution === 'confirmed-sent' ? 'delivered' : 'pending',
          providerMessageId:
            input.resolution === 'confirmed-sent' ? providerMessageId : null,
          evidence,
          reconciledBy: {
            id: input.serviceIdentityId,
            name: input.serviceIdentityName,
          },
          reconciledAt: now.toISOString(),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: now,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          inboxSource,
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async listQuoteProposals(
    companyId: string,
    query: QuoteProposalListQuery,
  ): Promise<unknown> {
    const pending = query.stage === 'pending';
    const filters = quoteProposalFilterWhere(query);
    const where: Prisma.QuoteRequestWhereInput = {
      AND: [quoteProposalStageWhere(companyId, query.stage), filters],
    };
    const stageWhere = (
      stage: QuoteProposalListQuery['stage'],
    ): Prisma.QuoteRequestWhereInput => ({
      AND: [quoteProposalStageWhere(companyId, stage), filters],
    });
    const [
      rows,
      total,
      pendingTotal,
      sentTotal,
      approvedTotal,
      cancelledTotal,
      rejectedTotal,
      commercialClosureTotal,
      cancellationReasonRows,
    ] = await this.prisma.$transaction([
      this.prisma.quoteRequest.findMany({
        where,
        include: {
          conversation: { include: conversationInclude },
          requestedByUser: { select: { id: true, name: true } },
          decidedByUser: { select: { id: true, name: true } },
          proposalDocuments: {
            ...(pending
              ? {}
              : { where: { status: QuoteProposalDocumentStatus.SENT } }),
            orderBy: pending
              ? [{ sequence: 'desc' }]
              : [{ sentAt: 'desc' }, { sequence: 'desc' }],
            include: {
              uploadedByUser: { select: { id: true, name: true } },
              sentByUser: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: pending
          ? [{ updatedAt: 'asc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.quoteRequest.count({ where }),
      this.prisma.quoteRequest.count({ where: stageWhere('pending') }),
      this.prisma.quoteRequest.count({ where: stageWhere('sent') }),
      this.prisma.quoteRequest.count({ where: stageWhere('approved') }),
      this.prisma.quoteRequest.count({ where: stageWhere('cancelled') }),
      this.prisma.quoteRequest.count({
        where: {
          AND: [stageWhere('cancelled'), { status: RequestStatus.REJECTED }],
        },
      }),
      this.prisma.quoteRequest.count({
        where: {
          AND: [stageWhere('cancelled'), { status: RequestStatus.CANCELLED }],
        },
      }),
      this.prisma.quoteRequest.groupBy({
        by: ['status', 'closureClassification', 'decisionReason'],
        where: stageWhere('cancelled'),
        orderBy: [
          { status: 'asc' },
          { closureClassification: 'asc' },
          { decisionReason: 'asc' },
        ],
        _count: { _all: true },
      }),
    ]);
    const cancellationReasonCounts = new Map<string, number>();
    const closureClassificationCounts = new Map<string, number>();
    for (const row of cancellationReasonRows) {
      const reason =
        row.decisionReason?.trim() || 'Motivo não informado (registro legado).';
      const count = typeof row._count === 'object' ? (row._count._all ?? 0) : 0;
      const classification = row.closureClassification
        ? closureFromPrisma[row.closureClassification]
        : 'legacy-unclassified';
      cancellationReasonCounts.set(
        reason,
        (cancellationReasonCounts.get(reason) ?? 0) + count,
      );
      closureClassificationCounts.set(
        classification,
        (closureClassificationCounts.get(classification) ?? 0) + count,
      );
    }
    return {
      items: rows.map((row) => ({
        id: row.id,
        stage: query.stage,
        quoteRequest: presentQuote(row),
        conversation: presentConversation(row.conversation),
        proposalDocument: row.proposalDocuments[0]
          ? presentProposalDocument(row.proposalDocuments[0])
          : null,
        documents: row.proposalDocuments.map(presentProposalDocument),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      summary: {
        pending: pendingTotal,
        sent: sentTotal,
        approved: approvedTotal,
        cancelled: cancelledTotal,
        rejected: rejectedTotal,
        commercialClosures: commercialClosureTotal,
        cancellationReasons: Array.from(
          cancellationReasonCounts,
          ([reason, count]) => ({ reason, count }),
        ).sort(
          (left, right) =>
            right.count - left.count ||
            left.reason.localeCompare(right.reason, 'pt-BR'),
        ),
        closureClassifications: Array.from(
          closureClassificationCounts,
          ([classification, count]) => ({ classification, count }),
        ).sort(
          (left, right) =>
            right.count - left.count ||
            left.classification.localeCompare(right.classification, 'pt-BR'),
        ),
      },
      filters: {
        search: query.search ?? null,
        createdFrom: query.createdFrom ?? null,
        createdTo: query.createdTo ?? null,
      },
    };
  }

  async getQuoteProposalNotificationSummary(companyId: string, userId: string) {
    const pendingQuotes = await this.prisma.quoteRequest.findMany({
      where: pendingQuoteProposalWhere(companyId),
      select: {
        version: true,
        notificationReads: {
          where: {
            companyId,
            userId,
            notificationKey: COMMERCIAL_PENDING_QUOTES_NOTIFICATION,
          },
          select: { quoteVersion: true },
        },
      },
    });
    return {
      notificationId: COMMERCIAL_PENDING_QUOTES_NOTIFICATION,
      pendingTotal: pendingQuotes.length,
      unreadTotal: pendingQuotes.filter(
        (quote) =>
          !quote.notificationReads.some(
            (receipt) => receipt.quoteVersion === quote.version,
          ),
      ).length,
    };
  }

  async markQuoteProposalNotificationRead(companyId: string, userId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const pendingQuotes = await transaction.quoteRequest.findMany({
        where: pendingQuoteProposalWhere(companyId),
        select: { id: true, version: true },
      });
      const readAt = new Date();
      const result =
        pendingQuotes.length === 0
          ? { count: 0 }
          : await transaction.quoteNotificationRead.createMany({
              data: pendingQuotes.map((quote) => ({
                companyId,
                userId,
                quoteRequestId: quote.id,
                notificationKey: COMMERCIAL_PENDING_QUOTES_NOTIFICATION,
                quoteVersion: quote.version,
                readAt,
              })),
              skipDuplicates: true,
            });
      return {
        notificationId: COMMERCIAL_PENDING_QUOTES_NOTIFICATION,
        pendingTotal: pendingQuotes.length,
        unreadTotal: 0,
        markedRead: result.count,
        readAt: readAt.toISOString(),
      };
    });
  }

  async getQuoteProposal(
    companyId: string,
    quoteRequestId: string,
  ): Promise<unknown> {
    const row = await this.prisma.quoteRequest.findUnique({
      where: { id_companyId: { id: quoteRequestId, companyId } },
      include: {
        conversation: { include: conversationInclude },
        requestedByUser: { select: { id: true, name: true } },
        decidedByUser: { select: { id: true, name: true } },
        proposalDocuments: {
          orderBy: { sequence: 'desc' },
          include: {
            uploadedByUser: { select: { id: true, name: true } },
            sentByUser: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!row || row.conversation.department !== DepartmentCode.COMMERCIAL) {
      throw notFound('Proposta comercial');
    }
    return {
      id: row.id,
      quoteRequest: presentQuote(row),
      conversation: presentConversation(row.conversation),
      proposalDocument: row.proposalDocuments[0]
        ? presentProposalDocument(row.proposalDocuments[0])
        : null,
      documents: row.proposalDocuments.map(presentProposalDocument),
    };
  }

  async createQuoteProposal(input: CreateQuoteProposalInput): Promise<unknown> {
    const normalized = {
      ...input,
      contactName: input.contactName.trim(),
      document: input.document?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      serviceType: input.serviceType.trim(),
      origin: input.origin.trim(),
      destination: input.destination.trim(),
      departureAt: input.departureAt ?? null,
      departureDate:
        input.departureDate ??
        (input.departureAt ? dateOnlyFromDateTime(input.departureAt) : null),
      returnAt: input.returnAt ?? null,
      returnDate:
        input.returnDate ??
        (input.returnAt ? dateOnlyFromDateTime(input.returnAt) : null),
      vehicleType: input.vehicleType?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    if (
      !normalized.contactName ||
      !normalized.serviceType ||
      !normalized.origin ||
      !normalized.destination
    ) {
      throw validationError(
        'Nome, tipo de serviço, origem e destino são obrigatórios.',
      );
    }
    assertQuoteScheduleConsistency(normalized, {
      requireDepartureDate: true,
    });
    if (
      normalized.departureAt &&
      normalized.returnAt &&
      normalized.returnAt < normalized.departureAt
    ) {
      throw validationError(
        'A data de retorno não pode ser anterior à data de saída.',
      );
    }
    if (
      normalized.departureDate &&
      normalized.returnDate &&
      normalized.returnDate < normalized.departureDate
    ) {
      throw validationError(
        'A data de retorno não pode ser anterior à data de saída.',
      );
    }

    const fingerprint = commandFingerprint(normalized);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.quote-proposal-create',
          input.commandId,
        );
        await this.assertCurrentCommercialOperator(
          transaction,
          input.companyId,
          input.actorUserId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.quote-proposal-create',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Criação da proposta incompleta.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          input.conversationId,
        );
        const conversation = await transaction.whatsAppConversation.findUnique({
          where: {
            id_companyId: {
              id: input.conversationId,
              companyId: input.companyId,
            },
          },
          include: {
            quoteRequests: {
              orderBy: { sequence: 'desc' },
              take: 1,
            },
          },
        });
        if (
          !conversation ||
          conversation.department !== DepartmentCode.COMMERCIAL
        ) {
          throw notFound('Conversa comercial');
        }
        if (conversation.closedAt) {
          throw quoteConversationClosed(conversation.id);
        }
        if (conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(conversation.version);
        }
        const pendingQuote =
          conversation.quoteRequests[0]?.status === RequestStatus.UNDER_REVIEW
            ? conversation.quoteRequests[0]
            : null;
        const actor = await transaction.user.findUnique({
          where: {
            id_companyId: {
              id: input.actorUserId,
              companyId: input.companyId,
            },
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!actor?.isActive) {
          throw forbidden('O atendente não pertence ao tenant.');
        }
        const requestedAt = new Date();
        let foundation = await this.ensureFoundationForConversation(
          transaction,
          conversation,
          {
            commandSeed: input.commandId,
            occurredAt: requestedAt,
            desiredConversationState: ConversationState.HUMAN_ACTIVE,
          },
        );
        const department = await transaction.tenantDepartment.findUnique({
          where: {
            companyId_code: {
              companyId: input.companyId,
              code: conversation.department,
            },
          },
          select: { id: true },
        });
        const humanSession = await this.updateFoundationSession(transaction, {
          companyId: input.companyId,
          session: foundation.session,
          commandId: correlation('quote-proposal-session', input.commandId),
          name: 'human-user-quote-proposal',
          actorType: MutationActorType.HUMAN_USER,
          actorUserId: actor.id,
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.HUMAN,
          isForeground: true,
          responsibleUserId: actor.id,
          currentDepartmentId: department?.id ?? null,
          occurredAt: requestedAt,
          metadata: { conversationId: conversation.id },
        });
        foundation = { ...foundation, session: humanSession };
        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: conversation.channelId,
            source: 'panel.quote-proposal-create',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'quote-proposal-create',
              input.commandId,
            ),
          },
        });

        const nextSequence =
          pendingQuote?.sequence ??
          (conversation.quoteRequests[0]?.sequence ?? 0) + 1;
        const confirmedSummary = {
          contactName: normalized.contactName,
          document: normalized.document,
          email: normalized.email,
          serviceType: normalized.serviceType,
          origin: normalized.origin,
          destination: normalized.destination,
          departureDate: presentDateOnly(normalized.departureDate),
          departureAt: normalized.departureAt?.toISOString() ?? null,
          returnDate: presentDateOnly(normalized.returnDate),
          returnAt: normalized.returnAt?.toISOString() ?? null,
          passengerCount: normalized.passengerCount,
          vehicleType: normalized.vehicleType,
          vehicleAtDisposal: normalized.vehicleAtDisposal,
          localTransfers: normalized.localTransfers,
          notes: normalized.notes,
          source: 'attendant-panel',
        };
        const quoteData = {
          companyId: input.companyId,
          conversationId: conversation.id,
          threadId: foundation.threadId,
          serviceSessionId: foundation.session.id,
          sequence: nextSequence,
          status: RequestStatus.UNDER_REVIEW,
          contactName: normalized.contactName,
          document: normalized.document,
          email: normalized.email,
          serviceType: normalized.serviceType,
          origin: normalized.origin,
          destination: normalized.destination,
          departureDate: normalized.departureDate,
          departureAt: normalized.departureAt,
          returnDate: normalized.returnDate,
          returnAt: normalized.returnAt,
          passengerCount: normalized.passengerCount,
          vehicleType: normalized.vehicleType,
          vehicleAtDisposal: normalized.vehicleAtDisposal,
          localTransfers: normalized.localTransfers,
          notes: normalized.notes,
          structuredData: payload({ source: 'attendant-panel' }),
          confirmedAt: requestedAt,
          confirmedSummary: payload(confirmedSummary),
          requestedByUserId: actor.id,
        };
        const quoteInclude = {
          requestedByUser: { select: { id: true, name: true } },
          decidedByUser: { select: { id: true, name: true } },
        } as const;
        const quote = pendingQuote
          ? await transaction.quoteRequest.update({
              where: {
                id_companyId: {
                  id: pendingQuote.id,
                  companyId: input.companyId,
                },
              },
              data: {
                ...quoteData,
                confirmedVersion: { increment: 1 },
              },
              include: quoteInclude,
            })
          : await transaction.quoteRequest.create({
              data: {
                ...quoteData,
                confirmedVersion: 1,
              },
              include: quoteInclude,
            });

        const updatedCount = await transaction.whatsAppConversation.updateMany({
          where: {
            id: conversation.id,
            companyId: input.companyId,
            version: input.expectedVersion,
          },
          data: {
            conversationState: ConversationState.HUMAN_ACTIVE,
            flowStep: FlowStep.QUOTE_SEND_PENDING,
            requestStatus: RequestStatus.UNDER_REVIEW,
            resumeState: null,
            resumeFlowStep: FlowStep.COMMERCIAL_FOLLOW_UP_MENU,
            assignedToUserId: actor.id,
            contextualFollowUpAt: null,
            lastMessagePreview: pendingQuote
              ? `Solicitação de orçamento #${nextSequence} atualizada.`
              : `Nova solicitação de orçamento #${nextSequence}.`,
            version: { increment: 1 },
          },
        });
        if (updatedCount.count !== 1) {
          const latest =
            await transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: conversation.id,
                  companyId: input.companyId,
                },
              },
              select: { version: true },
            });
          throw currentVersionConflict(latest.version);
        }
        const updatedConversation = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          conversation.id,
        );
        if (
          conversation.conversationState !== ConversationState.HUMAN_ACTIVE ||
          conversation.assignedToUserId !== actor.id
        ) {
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: input.companyId,
              conversationId: conversation.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              commandId: correlation(
                'quote-proposal-create-human-take-over',
                input.commandId,
              ),
              commandFingerprint: fingerprint,
              name: 'take-over',
              expectedVersion: conversation.version,
              resultingVersion: updatedConversation.version,
              actorType: TransitionActorType.USER,
              actorUserId: actor.id,
              fromDepartment: conversation.department,
              toDepartment: conversation.department,
              fromState: conversation.conversationState,
              toState: ConversationState.HUMAN_ACTIVE,
              fromFlowStep: conversation.flowStep,
              toFlowStep: FlowStep.QUOTE_SEND_PENDING,
              fromRequestStatus: conversation.requestStatus,
              toRequestStatus: RequestStatus.UNDER_REVIEW,
              metadata: payload({
                source: 'quote-proposal-create',
                quoteRequestId: quote.id,
                ...(conversation.assignedToUserId !== actor.id
                  ? {
                      assignment: {
                        previousAssignedToUserId: conversation.assignedToUserId,
                        resultingAssignedToUserId: actor.id,
                        changedByUserId: actor.id,
                        cause: 'quote-proposal-create',
                      },
                    }
                  : {}),
              }),
              resultSnapshot: payload(presentConversation(updatedConversation)),
            },
          });
        }
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: actor.id,
            action: pendingQuote
              ? 'whatsapp.quote-proposal.update'
              : 'whatsapp.quote-proposal.create',
            targetType: 'quote-request',
            targetId: quote.id,
            metadata: payload({
              conversationId: conversation.id,
              sequence: nextSequence,
              commandId: input.commandId,
              reusedPendingQuote: Boolean(pendingQuote),
              ...(conversation.assignedToUserId !== actor.id
                ? {
                    assignment: {
                      previousAssignedToUserId: conversation.assignedToUserId,
                      resultingAssignedToUserId: actor.id,
                      changedByUserId: actor.id,
                      cause: 'quote-proposal-create',
                    },
                  }
                : {}),
            }),
          },
        });
        const persistedResult = {
          id: quote.id,
          stage: 'pending',
          quoteRequest: presentQuote(quote),
          conversation: presentConversation(updatedConversation),
          proposalDocument: null,
          reusedPendingQuote: Boolean(pendingQuote),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: requestedAt,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.quote-proposal-create',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async decideQuoteProposal(input: DecideQuoteProposalInput): Promise<unknown> {
    const reason = input.reason?.trim() || null;
    if (input.decision === 'rejected' && (!reason || reason.length < 3)) {
      throw validationError(
        'Informe um breve motivo, com pelo menos 3 caracteres, para recusar a proposta.',
      );
    }
    const fingerprint = commandFingerprint({ ...input, reason });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.quote-proposal-decision',
          input.commandId,
        );
        await this.assertCurrentCommercialOperator(
          transaction,
          input.companyId,
          input.actorUserId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.quote-proposal-decision',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Decisão da proposta incompleta.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const quoteLocator = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          select: { conversationId: true },
        });
        if (!quoteLocator) throw notFound('Proposta comercial');
        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          quoteLocator.conversationId,
        );
        const quote = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          include: {
            conversation: {
              include: {
                ...conversationInclude,
                quoteRequests: {
                  orderBy: { sequence: 'desc' },
                  take: 1,
                },
              },
            },
            proposalDocuments: {
              where: { status: QuoteProposalDocumentStatus.SENT },
              orderBy: [{ sentAt: 'desc' }, { sequence: 'desc' }],
              take: 1,
              include: {
                uploadedByUser: { select: { id: true, name: true } },
                sentByUser: { select: { id: true, name: true } },
              },
            },
          },
        });
        if (
          !quote ||
          quote.conversation.department !== DepartmentCode.COMMERCIAL
        ) {
          throw notFound('Proposta comercial');
        }
        if (quote.conversation.closedAt) {
          throw quoteConversationClosed(
            quote.conversation.id,
            'Não é possível alterar uma proposta de atendimento encerrado.',
          );
        }
        if (!quote.proposalDocuments[0]) {
          throw validationError(
            'A proposta só pode ser aprovada ou recusada após a confirmação do envio.',
          );
        }
        if (
          quote.status === RequestStatus.APPROVED ||
          quote.status === RequestStatus.REJECTED ||
          quote.status === RequestStatus.CANCELLED
        ) {
          throw new AppError(
            'CONFLICT',
            'A decisão desta proposta é final e não pode ser alterada.',
          );
        }
        if (quote.conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(quote.conversation.version);
        }
        const actor = await transaction.user.findUnique({
          where: {
            id_companyId: {
              id: input.actorUserId,
              companyId: input.companyId,
            },
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!actor?.isActive) {
          throw forbidden('O atendente não pertence ao tenant.');
        }
        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: quote.conversation.channelId,
            source: 'panel.quote-proposal-decision',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'quote-proposal-decision',
              input.commandId,
            ),
          },
        });
        const decidedAt = new Date();
        const decisionStatus =
          input.decision === 'approved'
            ? RequestStatus.APPROVED
            : RequestStatus.REJECTED;
        const updatedQuote = await transaction.quoteRequest.update({
          where: {
            id_companyId: {
              id: quote.id,
              companyId: input.companyId,
            },
          },
          data: {
            status: decisionStatus,
            closureClassification:
              input.decision === 'rejected'
                ? CommercialClosureClassification.QUOTE_REJECTED
                : null,
            decisionReason: input.decision === 'rejected' ? reason : null,
            decidedAt,
            decidedByUserId: actor.id,
            version: { increment: 1 },
          },
          include: {
            requestedByUser: { select: { id: true, name: true } },
            decidedByUser: { select: { id: true, name: true } },
          },
        });

        const isCurrentRequest =
          quote.conversation.quoteRequests[0]?.id === quote.id;
        if (isCurrentRequest) {
          const updatedConversation =
            await transaction.whatsAppConversation.updateMany({
              where: {
                id: quote.conversationId,
                companyId: input.companyId,
                version: input.expectedVersion,
              },
              data: {
                requestStatus: decisionStatus,
                lastMessagePreview:
                  input.decision === 'approved'
                    ? 'Proposta aprovada.'
                    : 'Proposta recusada.',
                version: { increment: 1 },
              },
            });
          if (updatedConversation.count !== 1) {
            const latest =
              await transaction.whatsAppConversation.findUniqueOrThrow({
                where: {
                  id_companyId: {
                    id: quote.conversationId,
                    companyId: input.companyId,
                  },
                },
                select: { version: true },
              });
            throw currentVersionConflict(latest.version);
          }
        }
        const finalConversation = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          quote.conversationId,
        );
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: actor.id,
            action: `whatsapp.quote-proposal.${input.decision}`,
            targetType: 'quote-request',
            targetId: quote.id,
            metadata: payload({
              conversationId: quote.conversationId,
              commandId: input.commandId,
              closureClassification:
                input.decision === 'rejected' ? 'quote-rejected' : null,
              reason: input.decision === 'rejected' ? reason : null,
            }),
          },
        });
        const persistedResult = {
          id: updatedQuote.id,
          stage: input.decision === 'approved' ? 'approved' : 'cancelled',
          quoteRequest: presentQuote(updatedQuote),
          conversation: presentConversation(finalConversation),
          proposalDocument: presentProposalDocument(quote.proposalDocuments[0]),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: decidedAt,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.quote-proposal-decision',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async updateQuoteProposalStatus(
    input: UpdateQuoteProposalStatusInput,
  ): Promise<unknown> {
    if (input.status === 'approved' || input.status === 'rejected') {
      throw validationError(
        'Aprovação ou recusa deve usar a decisão comercial auditada.',
      );
    }
    const cancellation =
      input.status === 'cancelled'
        ? normalizeManualQuoteCancellation({
            classification: input.closureClassification,
            reason: input.reason,
          })
        : null;
    const reason = cancellation?.reason ?? input.reason?.trim() ?? null;
    const fingerprint = commandFingerprint({
      ...input,
      closureClassification: cancellation?.classification ?? null,
      reason,
    });

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.quote-proposal-status',
          input.commandId,
        );
        await this.assertCurrentCommercialOperator(
          transaction,
          input.companyId,
          input.actorUserId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.quote-proposal-status',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError(
              'CONFLICT',
              'Alteração do status comercial incompleta.',
            );
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const quoteLocator = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          select: { conversationId: true },
        });
        if (!quoteLocator) throw notFound('Orçamento comercial');

        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          quoteLocator.conversationId,
        );
        const quote = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          include: {
            conversation: {
              include: {
                ...conversationInclude,
                quoteRequests: {
                  orderBy: { sequence: 'desc' },
                  take: 1,
                },
              },
            },
            proposalDocuments: {
              where: { status: QuoteProposalDocumentStatus.SENT },
              orderBy: [{ sentAt: 'desc' }, { sequence: 'desc' }],
              include: {
                uploadedByUser: { select: { id: true, name: true } },
                sentByUser: { select: { id: true, name: true } },
              },
            },
          },
        });
        if (
          !quote ||
          quote.conversation.department !== DepartmentCode.COMMERCIAL ||
          quote.conversation.quoteRequests[0]?.id !== quote.id
        ) {
          throw notFound('Orçamento comercial atual');
        }
        if (quote.conversation.closedAt) {
          throw quoteConversationClosed(
            quote.conversation.id,
            'Não é possível alterar o status de um atendimento encerrado.',
          );
        }
        if (quote.conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(quote.conversation.version);
        }
        if (
          quote.status === RequestStatus.REJECTED ||
          quote.status === RequestStatus.CANCELLED ||
          (quote.status === RequestStatus.APPROVED && !cancellation)
        ) {
          throw new AppError(
            'CONFLICT',
            'O status final deste orçamento não pode ser alterado.',
          );
        }
        if (cancellation) {
          const confirmedService = await transaction.confirmedService.findFirst(
            {
              where: {
                companyId: input.companyId,
                sourceQuoteRequestId: quote.id,
              },
              select: { id: true },
            },
          );
          if (confirmedService) {
            throw new AppError(
              'CONFLICT',
              'Este orçamento já originou um Serviço Confirmado e não pode ser reclassificado como cancelamento de aceite.',
              {
                confirmedServiceId: confirmedService.id,
                requiredFlow: 'confirmed-service-cancellation',
              },
            );
          }
          assertManualQuoteCancellationTransition(
            requestFromPrisma[quote.status],
            cancellation.classification,
          );
        }
        if (requestFromPrisma[quote.status] === input.status) {
          throw validationError(
            'O orçamento já está no status comercial selecionado.',
          );
        }
        if (
          input.status === 'waiting-for-customer' &&
          quote.proposalDocuments.length === 0
        ) {
          throw validationError(
            'O status Aguardando cliente exige ao menos uma proposta entregue.',
          );
        }

        const actor = await transaction.user.findUnique({
          where: {
            id_companyId: {
              id: input.actorUserId,
              companyId: input.companyId,
            },
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!actor?.isActive) {
          throw forbidden('O atendente não pertence ao tenant.');
        }
        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: quote.conversation.channelId,
            source: 'panel.quote-proposal-status',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'quote-proposal-status',
              input.commandId,
            ),
          },
        });

        const changedAt = new Date();
        const targetStatus = requestToPrisma[input.status];
        const quoteUpdate = await transaction.quoteRequest.updateMany({
          where: {
            id: quote.id,
            companyId: input.companyId,
            version: quote.version,
          },
          data: {
            status: targetStatus,
            closureClassification: cancellation
              ? closureToPrisma[cancellation.classification]
              : null,
            decisionReason: cancellation ? reason : null,
            decidedAt: cancellation ? changedAt : null,
            decidedByUserId: cancellation ? input.actorUserId : null,
            version: { increment: 1 },
          },
        });
        if (quoteUpdate.count !== 1) {
          const latest = await transaction.quoteRequest.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: quote.id,
                companyId: input.companyId,
              },
            },
            select: { version: true },
          });
          throw new AppError(
            'CONFLICT',
            'O orçamento foi alterado por outro comando.',
            { currentQuoteVersion: latest.version },
          );
        }

        const conversationUpdate =
          await transaction.whatsAppConversation.updateMany({
            where: {
              id: quote.conversationId,
              companyId: input.companyId,
              version: input.expectedVersion,
            },
            data: {
              requestStatus: targetStatus,
              lastMessagePreview:
                input.status === 'cancelled'
                  ? 'Orçamento cancelado pelo atendente.'
                  : input.status === 'under-review'
                    ? 'Orçamento em análise comercial.'
                    : 'Proposta entregue; aguardando retorno do cliente.',
              version: { increment: 1 },
            },
          });
        if (conversationUpdate.count !== 1) {
          const latest =
            await transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: quote.conversationId,
                  companyId: input.companyId,
                },
              },
              select: { version: true },
            });
          throw currentVersionConflict(latest.version);
        }

        const [updatedQuote, finalConversation] = await Promise.all([
          transaction.quoteRequest.findUniqueOrThrow({
            where: {
              id_companyId: {
                id: quote.id,
                companyId: input.companyId,
              },
            },
            include: {
              requestedByUser: { select: { id: true, name: true } },
              decidedByUser: { select: { id: true, name: true } },
            },
          }),
          this.findConversationOrThrow(
            transaction,
            input.companyId,
            quote.conversationId,
          ),
        ]);
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.quote-proposal.status-change',
            targetType: 'quote-request',
            targetId: quote.id,
            metadata: payload({
              conversationId: quote.conversationId,
              commandId: input.commandId,
              fromStatus: requestFromPrisma[quote.status],
              toStatus: input.status,
              closureClassification: cancellation?.classification ?? null,
              reason,
              occurredAt: changedAt.toISOString(),
            }),
          },
        });
        const persistedResult = {
          id: updatedQuote.id,
          stage:
            input.status === 'cancelled'
              ? 'cancelled'
              : input.status === 'waiting-for-customer'
                ? 'sent'
                : 'pending',
          quoteRequest: presentQuote(updatedQuote),
          conversation: presentConversation(finalConversation),
          proposalDocument: quote.proposalDocuments[0]
            ? presentProposalDocument(quote.proposalDocuments[0])
            : null,
          documents: quote.proposalDocuments.map(presentProposalDocument),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: changedAt,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.quote-proposal-status',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async uploadQuoteProposalDocument(
    input: UploadQuoteProposalDocumentInput,
  ): Promise<unknown> {
    const validatedFile = validateQuoteProposalPdf(input.file);
    const fingerprint = commandFingerprint({
      companyId: input.companyId,
      quoteRequestId: input.quoteRequestId,
      actorUserId: input.actorUserId,
      commandId: input.commandId,
      expectedVersion: input.expectedVersion,
      fileName: validatedFile.fileName,
      mimeType: input.file.mimeType.toLowerCase(),
      sizeBytes: input.file.sizeBytes,
      sha256: validatedFile.sha256,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.quote-proposal-upload',
          input.commandId,
        );
        await this.assertCurrentCommercialOperator(
          transaction,
          input.companyId,
          input.actorUserId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.quote-proposal-upload',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Upload da proposta incompleto.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const quoteLocator = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          select: { conversationId: true },
        });
        if (!quoteLocator) {
          throw notFound('Solicitação de orçamento');
        }
        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          quoteLocator.conversationId,
        );
        const quote = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          include: {
            conversation: {
              include: {
                quoteRequests: {
                  orderBy: [{ sequence: 'desc' }, { id: 'desc' }],
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        });
        if (
          !quote ||
          quote.conversation.department !== DepartmentCode.COMMERCIAL
        ) {
          throw notFound('Solicitação de orçamento');
        }
        if (quote.conversation.closedAt) {
          throw quoteConversationClosed(quote.conversation.id);
        }
        if (
          !acceptsProposalDocumentsForCurrentCycle(
            quote,
            quote.conversation.quoteRequests[0],
          )
        ) {
          throw validationError(
            'A proposta só pode ser anexada enquanto o orçamento aguarda proposta.',
          );
        }
        if (quote.conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(quote.conversation.version);
        }
        const actor = await transaction.user.findUnique({
          where: {
            id_companyId: {
              id: input.actorUserId,
              companyId: input.companyId,
            },
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!actor?.isActive) {
          throw forbidden('O atendente não pertence ao tenant.');
        }
        const uploadedAt = new Date();
        const foundation = await this.ensureFoundationForConversation(
          transaction,
          quote.conversation,
          {
            commandSeed: input.commandId,
            occurredAt: uploadedAt,
          },
        );
        const activeBatchDocuments =
          await transaction.quoteProposalDocument.count({
            where: {
              companyId: input.companyId,
              quoteRequestId: input.quoteRequestId,
              deliveryBatchId: { not: null },
              status: {
                in: [
                  QuoteProposalDocumentStatus.UPLOADED,
                  QuoteProposalDocumentStatus.QUEUED,
                  QuoteProposalDocumentStatus.FAILED,
                ],
              },
            },
          });
        if (activeBatchDocuments > 0) {
          throw new AppError(
            'CONFLICT',
            'Conclua ou reenvie o lote atual antes de adicionar outro documento.',
          );
        }

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: quote.conversation.channelId,
            source: 'panel.quote-proposal-upload',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'quote-proposal-upload',
              input.commandId,
            ),
          },
        });
        const latest = await transaction.quoteProposalDocument.aggregate({
          where: {
            companyId: input.companyId,
            quoteRequestId: input.quoteRequestId,
          },
          _max: { sequence: true },
        });
        const document = await transaction.quoteProposalDocument.create({
          data: {
            companyId: input.companyId,
            conversationId: quote.conversationId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            quoteRequestId: input.quoteRequestId,
            uploadedByUserId: input.actorUserId,
            sequence: (latest._max.sequence ?? 0) + 1,
            fileName: validatedFile.fileName,
            mimeType: 'application/pdf',
            sizeBytes: input.file.sizeBytes,
            sha256: validatedFile.sha256,
            content: Uint8Array.from(input.file.content),
          },
          include: {
            uploadedByUser: { select: { id: true, name: true } },
            sentByUser: { select: { id: true, name: true } },
          },
        });
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.quote-proposal.upload',
            targetType: 'quote-proposal-document',
            targetId: document.id,
            metadata: payload({
              quoteRequestId: input.quoteRequestId,
              conversationId: quote.conversationId,
              commandId: input.commandId,
              fileName: document.fileName,
              sizeBytes: document.sizeBytes,
              sha256: document.sha256,
            }),
          },
        });
        const persistedResult = {
          proposalDocument: presentProposalDocument(document),
          conversation: {
            id: quote.conversation.id,
            version: quote.conversation.version,
          },
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: new Date(),
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.quote-proposal-upload',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async sendQuoteProposal(input: SendQuoteProposalInput): Promise<unknown> {
    const uniqueBatchDocumentIds = new Set(input.batchDocumentIds);
    if (
      input.batchDocumentIds.length < 1 ||
      input.batchDocumentIds.length > 10 ||
      uniqueBatchDocumentIds.size !== input.batchDocumentIds.length ||
      !uniqueBatchDocumentIds.has(input.proposalDocumentId)
    ) {
      throw validationError(
        'O lote deve informar de 1 a 10 documentos únicos e incluir o PDF enviado.',
      );
    }
    const fingerprint = commandFingerprint(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockCommand(
          transaction,
          input.companyId,
          'panel.quote-proposal-send',
          input.commandId,
        );
        await this.assertCurrentCommercialOperator(
          transaction,
          input.companyId,
          input.actorUserId,
        );
        const inboxKey = {
          companyId_source_externalEventId: {
            companyId: input.companyId,
            source: 'panel.quote-proposal-send',
            externalEventId: input.commandId,
          },
        };
        const duplicate = await transaction.integrationInbox.findUnique({
          where: inboxKey,
        });
        if (duplicate) {
          assertSameFingerprint(
            duplicate.payloadHash,
            fingerprint,
            'commandId',
          );
          if (!duplicate.resultSnapshot) {
            throw new AppError('CONFLICT', 'Envio da proposta incompleto.');
          }
          return {
            ...(duplicate.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const quoteLocator = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          select: { conversationId: true },
        });
        if (!quoteLocator) {
          throw notFound('Solicitação de orçamento');
        }
        await this.lockCommand(
          transaction,
          input.companyId,
          'whatsapp-conversation',
          quoteLocator.conversationId,
        );
        const quote = await transaction.quoteRequest.findUnique({
          where: {
            id_companyId: {
              id: input.quoteRequestId,
              companyId: input.companyId,
            },
          },
          include: {
            conversation: {
              include: {
                contact: true,
                channel: {
                  select: { id: true, name: true, phoneNumber: true },
                },
                assignedTo: { select: { id: true, name: true } },
                quoteRequests: {
                  orderBy: { sequence: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });
        if (
          !quote ||
          quote.conversation.department !== DepartmentCode.COMMERCIAL
        ) {
          throw notFound('Solicitação de orçamento');
        }
        const conversation = quote.conversation;
        if (conversation.closedAt) {
          throw quoteConversationClosed(
            conversation.id,
            'Não é possível enviar proposta em um atendimento encerrado.',
          );
        }
        if (
          !acceptsProposalDocumentsForCurrentCycle(
            quote,
            conversation.quoteRequests[0],
          )
        ) {
          throw validationError(
            'A proposta só pode ser enviada pela fila comercial Aguardando proposta.',
          );
        }
        if (conversation.version !== input.expectedVersion) {
          throw currentVersionConflict(conversation.version);
        }
        const actor = await transaction.user.findUnique({
          where: {
            id_companyId: {
              id: input.actorUserId,
              companyId: input.companyId,
            },
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!actor?.isActive) {
          throw forbidden('O atendente não pertence ao tenant.');
        }
        const occurredAt = new Date();
        const document = await transaction.quoteProposalDocument.findUnique({
          where: {
            id_companyId: {
              id: input.proposalDocumentId,
              companyId: input.companyId,
            },
          },
        });
        if (
          !document ||
          document.quoteRequestId !== input.quoteRequestId ||
          document.conversationId !== conversation.id
        ) {
          throw notFound('Documento da proposta');
        }
        if (
          document.status !== QuoteProposalDocumentStatus.UPLOADED &&
          document.status !== QuoteProposalDocumentStatus.FAILED
        ) {
          throw validationError(
            'Somente um documento ainda não enviado ou com falha pode ser confirmado.',
          );
        }
        const batchDocuments = await transaction.quoteProposalDocument.findMany(
          {
            where: {
              companyId: input.companyId,
              quoteRequestId: input.quoteRequestId,
              conversationId: conversation.id,
              id: { in: input.batchDocumentIds },
            },
            select: { id: true, deliveryBatchId: true, status: true },
          },
        );
        if (
          batchDocuments.length !== input.batchDocumentIds.length ||
          batchDocuments.some(
            (item) =>
              item.deliveryBatchId !== null &&
              item.deliveryBatchId !== input.batchId,
          )
        ) {
          throw new AppError(
            'CONFLICT',
            'Os documentos informados não pertencem integralmente a este lote.',
          );
        }
        const existingBatchDocuments =
          await transaction.quoteProposalDocument.findMany({
            where: {
              companyId: input.companyId,
              quoteRequestId: input.quoteRequestId,
              deliveryBatchId: input.batchId,
            },
            select: { id: true },
          });
        if (
          existingBatchDocuments.length === 0 &&
          batchDocuments.some(
            (item) =>
              item.status !== QuoteProposalDocumentStatus.UPLOADED &&
              item.status !== QuoteProposalDocumentStatus.FAILED,
          )
        ) {
          throw validationError(
            'Um novo lote aceita somente documentos ainda não enviados ou com falha.',
          );
        }
        if (
          existingBatchDocuments.length > 0 &&
          (existingBatchDocuments.length !== input.batchDocumentIds.length ||
            existingBatchDocuments.some(
              (item) => !uniqueBatchDocumentIds.has(item.id),
            ))
        ) {
          throw new AppError(
            'CONFLICT',
            'A composição deste lote não pode ser alterada após o primeiro envio.',
          );
        }
        const competingBatch =
          await transaction.quoteProposalDocument.findFirst({
            where: {
              companyId: input.companyId,
              quoteRequestId: input.quoteRequestId,
              deliveryBatchId: { not: null, notIn: [input.batchId] },
              status: {
                in: [
                  QuoteProposalDocumentStatus.UPLOADED,
                  QuoteProposalDocumentStatus.QUEUED,
                  QuoteProposalDocumentStatus.FAILED,
                ],
              },
            },
            select: { deliveryBatchId: true },
          });
        if (competingBatch) {
          throw new AppError(
            'CONFLICT',
            'Existe outro lote de proposta aguardando conclusão.',
          );
        }
        let foundation = await this.ensureFoundationForConversation(
          transaction,
          conversation,
          {
            commandSeed: input.commandId,
            occurredAt,
            direction: MessageDirection.OUTBOUND,
            desiredConversationState: ConversationState.HUMAN_ACTIVE,
          },
        );
        const department = await transaction.tenantDepartment.findUnique({
          where: {
            companyId_code: {
              companyId: input.companyId,
              code: conversation.department,
            },
          },
          select: { id: true },
        });
        const humanSession = await this.updateFoundationSession(transaction, {
          companyId: input.companyId,
          session: foundation.session,
          commandId: correlation(
            'quote-proposal-send-session',
            input.commandId,
          ),
          name: 'human-user-quote-proposal-send',
          actorType: MutationActorType.HUMAN_USER,
          actorUserId: actor.id,
          status: ServiceSessionStatus.OPEN,
          controlMode: ServiceSessionControlMode.HUMAN,
          isForeground: true,
          responsibleUserId: actor.id,
          currentDepartmentId: department?.id ?? null,
          occurredAt,
          metadata: {
            conversationId: conversation.id,
            quoteRequestId: quote.id,
            proposalDocumentId: document.id,
          },
        });
        foundation = { ...foundation, session: humanSession };
        await transaction.quoteProposalDocument.updateMany({
          where: {
            companyId: input.companyId,
            quoteRequestId: input.quoteRequestId,
            id: { in: input.batchDocumentIds },
            deliveryBatchId: null,
          },
          data: { deliveryBatchId: input.batchId },
        });

        await transaction.integrationInbox.create({
          data: {
            companyId: input.companyId,
            channelId: conversation.channelId,
            source: 'panel.quote-proposal-send',
            externalEventId: input.commandId,
            payloadHash: fingerprint,
            correlationId: correlation(
              'quote-proposal-send-inbox',
              input.commandId,
            ),
          },
        });
        const caption = 'Segue o orçamento solicitado.';
        const media = {
          documentId: document.id,
          fileName: document.fileName,
          mimetype: document.mimeType,
          sizeBytes: document.sizeBytes,
          sha256: document.sha256,
          caption,
        };
        const message = await transaction.whatsAppMessage.create({
          data: {
            companyId: input.companyId,
            conversationId: conversation.id,
            channelId: conversation.channelId,
            contactId: conversation.contactId,
            actorUserId: input.actorUserId,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            actorType: WhatsAppMessageActorType.HUMAN_USER,
            source: WhatsAppMessageSource.LUME_WEB,
            direction: MessageDirection.OUTBOUND,
            deliveryStatus: DeliveryStatus.PENDING,
            kind: MessageKind.DOCUMENT,
            text: caption,
            media: payload(media),
            automationPurpose: 'quote-proposal',
            recipientPhone: conversation.contact.phoneNormalized,
            correlationId: correlation(
              'quote-proposal-outbound',
              input.commandId,
            ),
            occurredAt,
          },
        });
        const attempt = await transaction.whatsAppMessageAttempt.create({
          data: {
            companyId: input.companyId,
            messageId: message.id,
            attemptNumber: 1,
            status: MessageAttemptStatus.PENDING,
          },
        });
        const queuedDocument = await transaction.quoteProposalDocument.update({
          where: {
            id_companyId: {
              id: document.id,
              companyId: input.companyId,
            },
          },
          data: {
            status: QuoteProposalDocumentStatus.QUEUED,
            messageId: message.id,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            deliveryBatchId: input.batchId,
            queuedAt: occurredAt,
            sentByUserId: input.actorUserId,
            providerMessageId: null,
            sentAt: null,
          },
          include: {
            uploadedByUser: { select: { id: true, name: true } },
            sentByUser: { select: { id: true, name: true } },
          },
        });
        if (quote.status === RequestStatus.WAITING_FOR_CUSTOMER) {
          await transaction.quoteRequest.update({
            where: {
              id_companyId: {
                id: quote.id,
                companyId: input.companyId,
              },
            },
            data: {
              status: RequestStatus.UNDER_REVIEW,
              version: { increment: 1 },
            },
          });
        }
        const updatedCount = await transaction.whatsAppConversation.updateMany({
          where: {
            id: conversation.id,
            companyId: input.companyId,
            version: input.expectedVersion,
          },
          data: {
            conversationState: ConversationState.HUMAN_ACTIVE,
            flowStep: FlowStep.QUOTE_SEND_PENDING,
            requestStatus: RequestStatus.UNDER_REVIEW,
            assignedToUserId: input.actorUserId,
            resumeState: null,
            resumeFlowStep: FlowStep.COMMERCIAL_FOLLOW_UP_MENU,
            contextualFollowUpAt: null,
            lastMessagePreview: 'Orçamento em PDF aguardando envio.',
            version: { increment: 1 },
          },
        });
        if (updatedCount.count !== 1) {
          const latest =
            await transaction.whatsAppConversation.findUniqueOrThrow({
              where: {
                id_companyId: {
                  id: conversation.id,
                  companyId: input.companyId,
                },
              },
              select: { version: true },
            });
          throw currentVersionConflict(latest.version);
        }
        const updatedConversation = await this.findConversationOrThrow(
          transaction,
          input.companyId,
          conversation.id,
        );
        if (
          conversation.conversationState !== ConversationState.HUMAN_ACTIVE ||
          conversation.assignedToUserId !== input.actorUserId
        ) {
          await transaction.whatsAppConversationTransition.create({
            data: {
              companyId: input.companyId,
              conversationId: conversation.id,
              threadId: foundation.threadId,
              serviceSessionId: foundation.session.id,
              commandId: correlation(
                'quote-proposal-human-take-over',
                input.commandId,
              ),
              commandFingerprint: fingerprint,
              name: 'take-over',
              expectedVersion: conversation.version,
              resultingVersion: updatedConversation.version,
              actorType: TransitionActorType.USER,
              actorUserId: input.actorUserId,
              fromDepartment: conversation.department,
              toDepartment: conversation.department,
              fromState: conversation.conversationState,
              toState: ConversationState.HUMAN_ACTIVE,
              fromFlowStep: conversation.flowStep,
              toFlowStep: FlowStep.QUOTE_SEND_PENDING,
              fromRequestStatus: conversation.requestStatus,
              toRequestStatus: RequestStatus.UNDER_REVIEW,
              metadata: payload({
                source: 'quote-proposal-send',
                quoteRequestId: quote.id,
                proposalDocumentId: document.id,
                ...(conversation.assignedToUserId !== input.actorUserId
                  ? {
                      assignment: {
                        previousAssignedToUserId: conversation.assignedToUserId,
                        resultingAssignedToUserId: input.actorUserId,
                        changedByUserId: input.actorUserId,
                        cause: 'quote-proposal-send',
                      },
                    }
                  : {}),
              }),
              resultSnapshot: payload(presentConversation(updatedConversation)),
            },
          });
        }
        await this.createOrderedOutbox(transaction, {
          companyId: input.companyId,
          topic: 'whatsapp.outbound.requested',
          aggregateType: 'whatsapp-conversation',
          aggregateId: conversation.id,
          correlationId: correlation(
            'quote-proposal-outbound-request',
            input.commandId,
          ),
          payload: {
            eventId: input.commandId,
            commandId: input.commandId,
            messageId: message.id,
            attemptId: attempt.id,
            conversationId: conversation.id,
            threadId: foundation.threadId,
            serviceSessionId: foundation.session.id,
            channelId: conversation.channelId,
            companyId: input.companyId,
            contact: {
              id: conversation.contact.id,
              phone: conversation.contact.phoneNormalized,
              displayName: conversation.contact.displayName,
            },
            message: {
              providerMessageId: null,
              direction: 'outbound',
              deliveryStatus: 'pending',
              kind: 'document',
              text: caption,
              media,
              occurredAt: message.occurredAt.toISOString(),
            },
            conversation: {
              id: updatedConversation.id,
              ...snapshot(updatedConversation),
              version: updatedConversation.version,
            },
            automatic: false,
            automationAllowed: false,
            canGenerateReply: false,
            canSendReply: true,
            contextualTransition: false,
            isFirstContact: false,
          },
        });
        await transaction.tenantAuditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: 'whatsapp.quote-proposal.send',
            targetType: 'quote-proposal-document',
            targetId: document.id,
            metadata: payload({
              quoteRequestId: quote.id,
              conversationId: conversation.id,
              messageId: message.id,
              commandId: input.commandId,
              sha256: document.sha256,
              ...(conversation.assignedToUserId !== input.actorUserId
                ? {
                    assignment: {
                      previousAssignedToUserId: conversation.assignedToUserId,
                      resultingAssignedToUserId: input.actorUserId,
                      changedByUserId: input.actorUserId,
                      cause: 'quote-proposal-send',
                    },
                  }
                : {}),
            }),
          },
        });
        const persistedResult = {
          message: this.presentMessage(
            { ...message, actorUser: actor, attempts: [attempt] },
            false,
          ),
          conversation: presentConversation(updatedConversation),
          proposalDocument: presentProposalDocument(queuedDocument),
        };
        await transaction.integrationInbox.update({
          where: inboxKey,
          data: {
            processedAt: occurredAt,
            resultSnapshot: payload(persistedResult),
          },
        });
        return { ...persistedResult, idempotent: false };
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        return this.replayInbox(
          input.companyId,
          'panel.quote-proposal-send',
          input.commandId,
          fingerprint,
          'commandId',
        );
      }
      throw error;
    }
  }

  async getQuoteProposalDocument(
    companyId: string,
    documentId: string,
  ): Promise<unknown> {
    const document = await this.prisma.quoteProposalDocument.findUnique({
      where: { id_companyId: { id: documentId, companyId } },
    });
    if (!document) throw notFound('Documento da proposta');
    return {
      ...presentProposalDocument(document),
      content: Buffer.from(document.content),
    };
  }

  async listConversations(
    companyId: string,
    query: ConversationListQuery,
  ): Promise<unknown> {
    const inactiveBefore = new Date();
    inactiveBefore.setUTCFullYear(inactiveBefore.getUTCFullYear() - 5);
    await this.prisma.$executeRaw`
      UPDATE "whatsapp_conversations"
      SET
        "archived_at" = CURRENT_TIMESTAMP,
        "archive_reason" = 'automatic-inactivity'
      WHERE "company_id" = ${companyId}::uuid
        AND "archived_at" IS NULL
        AND "archive_exempted_at" IS NULL
        AND COALESCE(
          GREATEST("last_inbound_at", "last_outbound_at"),
          "last_inbound_at",
          "last_outbound_at",
          "created_at"
        ) < ${inactiveBefore}
    `;
    if (
      query.requestStatus &&
      query.department &&
      query.department !== 'commercial'
    ) {
      throw validationError(
        'O status da solicitação pertence somente à fila Comercial.',
      );
    }
    if (
      query.requestStatus &&
      query.departments &&
      !query.departments.includes('commercial')
    ) {
      throw validationError(
        'O status da solicitação pertence somente à fila Comercial.',
      );
    }
    const departments = query.requestStatus
      ? [DepartmentCode.COMMERCIAL]
      : query.departments && query.departments.length > 0
        ? Array.from(
            new Set(
              query.departments.map(
                (assignedDepartment) => departmentToPrisma[assignedDepartment],
              ),
            ),
          )
        : query.department
          ? [departmentToPrisma[query.department]]
          : [];
    const state = query.state ? stateToPrisma[query.state] : undefined;
    const controlStates = query.control
      ? query.control === 'bot'
        ? [ConversationState.BOT_ACTIVE]
        : query.control === 'human'
          ? [ConversationState.HUMAN_ACTIVE]
          : query.control === 'paused'
            ? [
                ConversationState.WAITING_FOR_CUSTOMER,
                ConversationState.SENT_TO_HUMAN,
              ]
            : [ConversationState.CLOSED]
      : undefined;
    const requestStatus = query.requestStatus
      ? requestToPrisma[query.requestStatus]
      : undefined;
    const search = query.search?.trim();
    const scopedFilters: Prisma.WhatsAppConversationWhereInput[] = [];
    if (departments.length > 0) {
      scopedFilters.push({
        OR: [
          { department: { in: departments } },
          { pendingTransferDepartment: { in: departments } },
        ],
      });
    }
    if (search) {
      scopedFilters.push({
        OR: [
          {
            contact: {
              displayName: { contains: search, mode: 'insensitive' },
            },
          },
          { contact: { phoneNormalized: { contains: search } } },
          {
            lastMessagePreview: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      });
    }
    const where: Prisma.WhatsAppConversationWhereInput = {
      companyId,
      ...(query.archive === 'all'
        ? {}
        : query.archive === 'archived'
          ? { archivedAt: { not: null } }
          : { archivedAt: null }),
      ...(scopedFilters.length > 0 ? { AND: scopedFilters } : {}),
      ...(state ? { conversationState: state } : {}),
      ...(controlStates ? { conversationState: { in: controlStates } } : {}),
      ...(requestStatus ? { requestStatus } : {}),
    };
    const [
      rows,
      total,
      botActive,
      attendantActive,
      waitingForCustomer,
      sentToHuman,
      unreadTotals,
      unreadConversations,
    ] = await Promise.all([
      this.prisma.whatsAppConversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.whatsAppConversation.count({ where }),
      this.prisma.whatsAppConversation.count({
        where: {
          AND: [where, { conversationState: ConversationState.BOT_ACTIVE }],
        },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          AND: [where, { conversationState: ConversationState.HUMAN_ACTIVE }],
        },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          AND: [
            where,
            { conversationState: ConversationState.WAITING_FOR_CUSTOMER },
          ],
        },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          AND: [where, { conversationState: ConversationState.SENT_TO_HUMAN }],
        },
      }),
      this.prisma.whatsAppConversation.aggregate({
        where,
        _sum: { unreadCount: true },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          AND: [
            where,
            { conversationState: { not: ConversationState.CLOSED } },
            { unreadCount: { gt: 0 } },
          ],
        },
      }),
    ]);
    return {
      data: rows.map(presentConversation),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      summary: {
        total,
        botActive,
        attendantActive,
        automationPaused: waitingForCustomer + sentToHuman,
        unreadMessages: unreadTotals._sum.unreadCount ?? 0,
        unreadConversations,
      },
    };
  }

  async getConversation(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ): Promise<unknown> {
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: {
        id: conversationId,
        companyId,
        ...conversationDepartmentWhere(scope),
      },
      include: conversationDetailInclude,
    });
    if (!conversation) throw notFound('Conversa');
    return presentConversationDetail(conversation);
  }

  async getAutomationBatch(
    companyId: string,
    conversationId: string,
    sourceEventId: string,
    windowSeconds: number,
  ): Promise<unknown> {
    if (
      !Number.isInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > 300
    ) {
      throw validationError(
        'A janela do lote de automação deve estar entre 1 e 300 segundos.',
      );
    }
    const conversation = await this.prisma.whatsAppConversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId } },
      include: conversationDetailInclude,
    });
    if (!conversation) throw notFound('Conversa');

    const anchor = await this.prisma.whatsAppMessage.findUnique({
      where: {
        companyId_correlationId: {
          companyId,
          correlationId: sourceEventId,
        },
      },
      select: {
        id: true,
        conversationId: true,
        direction: true,
        kind: true,
        correlationId: true,
        text: true,
        occurredAt: true,
        createdAt: true,
        mediaAsset: { include: messageMediaAssetInclude },
      },
    });
    if (
      !anchor ||
      anchor.conversationId !== conversationId ||
      anchor.direction !== MessageDirection.INBOUND
    ) {
      throw notFound('Mensagem inicial do lote de automação');
    }

    const windowEndsAt = new Date(
      anchor.createdAt.valueOf() + windowSeconds * 1_000,
    );
    const messages =
      anchor.kind === MessageKind.TEXT
        ? await this.prisma.whatsAppMessage.findMany({
            where: {
              companyId,
              conversationId,
              direction: MessageDirection.INBOUND,
              kind: MessageKind.TEXT,
              createdAt: {
                gte: anchor.createdAt,
                lte: windowEndsAt,
              },
            },
            select: {
              id: true,
              correlationId: true,
              kind: true,
              text: true,
              occurredAt: true,
              createdAt: true,
              mediaAsset: { include: messageMediaAssetInclude },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 50,
          })
        : [anchor];
    const shouldRecoverPendingQuestion =
      anchor.kind !== MessageKind.TEXT &&
      (conversation.flowStep === FlowStep.QUOTE_DATA_COLLECTION ||
        conversation.flowStep === FlowStep.QUOTE_SUMMARY_CONFIRMATION);
    const pendingQuestion = shouldRecoverPendingQuestion
      ? await this.prisma.whatsAppMessage.findFirst({
          where: {
            companyId,
            conversationId,
            direction: MessageDirection.OUTBOUND,
            kind: MessageKind.TEXT,
            deliveryStatus: { not: DeliveryStatus.FAILED },
            automationPurpose: { not: 'unsupported-message-kind' },
            createdAt: { lt: anchor.createdAt },
            text: { not: null },
          },
          select: { text: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : null;

    return {
      conversation: presentConversationDetail(conversation),
      batch: {
        sourceEventId,
        windowStartedAt: anchor.createdAt.toISOString(),
        windowEndsAt: windowEndsAt.toISOString(),
        pendingQuestion: pendingQuestion?.text?.trim() || null,
        messages: messages.map((message) => {
          const mediaContext = automationMediaContext(message.mediaAsset);
          return {
            messageId: message.id,
            sourceEventId: message.correlationId,
            kind: kindFromPrisma[message.kind],
            text: message.text,
            ...mediaContext,
            occurredAt: message.occurredAt.toISOString(),
            persistedAt: message.createdAt.toISOString(),
          };
        }),
      },
    };
  }

  async listMessages(
    companyId: string,
    conversationId: string,
    query: MessageListQuery,
    scope: ConversationAccessScope,
  ): Promise<unknown> {
    const conversationWhere: Prisma.WhatsAppConversationWhereInput = {
      id: conversationId,
      companyId,
      ...conversationDepartmentWhere(scope),
    };
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: conversationWhere,
      select: { id: true },
    });
    if (!conversation) throw notFound('Conversa');
    const search = query.search?.trim();
    const where: Prisma.WhatsAppMessageWhereInput = {
      companyId,
      conversationId,
      conversation: { is: conversationWhere },
      AND: [
        {
          OR: [
            { automationPurpose: null },
            { automationPurpose: { not: 'department-notification' } },
          ],
        },
        ...(search
          ? [
              {
                OR: [
                  { text: { contains: search, mode: 'insensitive' as const } },
                  {
                    mediaOriginalName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.whatsAppMessage.findMany({
        where,
        include: {
          actorUser: { select: { id: true, name: true } },
          attempts: { orderBy: { attemptNumber: 'asc' } },
          mediaAsset: { include: messageMediaAssetInclude },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.whatsAppMessage.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.presentMessage(row, false)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async listTransitions(
    companyId: string,
    conversationId: string,
    query: TransitionListQuery,
    scope: ConversationAccessScope,
  ): Promise<unknown> {
    const conversationWhere: Prisma.WhatsAppConversationWhereInput = {
      id: conversationId,
      companyId,
      ...conversationDepartmentWhere(scope),
    };
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: conversationWhere,
      select: { id: true },
    });
    if (!conversation) throw notFound('Conversa');
    const where: Prisma.WhatsAppConversationTransitionWhereInput = {
      companyId,
      conversationId,
      conversation: { is: conversationWhere },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.whatsAppConversationTransition.findMany({
        where,
        include: {
          actorUser: { select: { id: true, name: true } },
        },
        orderBy: [{ resultingVersion: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.whatsAppConversationTransition.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        commandId: row.commandId,
        name: row.name,
        expectedVersion: row.expectedVersion,
        resultingVersion: row.resultingVersion,
        actorType: row.actorType.toLowerCase(),
        actorUserId: row.actorUserId,
        actor: {
          type: row.actorType.toLowerCase(),
          user: row.actorUser
            ? { id: row.actorUser.id, name: row.actorUser.name }
            : null,
        },
        from: {
          department: departmentFromPrisma[row.fromDepartment],
          conversationState: stateFromPrisma[row.fromState],
          flowStep: flowFromPrisma[row.fromFlowStep],
          requestStatus: requestFromPrisma[row.fromRequestStatus],
        },
        to: {
          department: departmentFromPrisma[row.toDepartment],
          conversationState: stateFromPrisma[row.toState],
          flowStep: flowFromPrisma[row.toFlowStep],
          requestStatus: requestFromPrisma[row.toRequestStatus],
        },
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getCurrentQuoteRequest(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ): Promise<unknown> {
    const conversationWhere: Prisma.WhatsAppConversationWhereInput = {
      id: conversationId,
      companyId,
      ...conversationDepartmentWhere(scope),
    };
    const conversation = await this.prisma.whatsAppConversation.findFirst({
      where: conversationWhere,
      select: { id: true },
    });
    if (!conversation) throw notFound('Conversa');
    const quote = await this.prisma.quoteRequest.findFirst({
      where: {
        companyId,
        conversationId,
        conversation: { is: conversationWhere },
      },
      orderBy: { sequence: 'desc' },
    });
    if (!quote) throw notFound('Solicitação de orçamento');
    return presentQuote(quote);
  }

  private async completeQuoteProposalBatchIfReady(
    transaction: Prisma.TransactionClient,
    input: {
      companyId: string;
      conversationId: string;
      quoteRequestId: string;
      triggeringDocumentId: string;
      deliveryBatchId: string | null;
    },
  ): Promise<void> {
    if (!input.deliveryBatchId) {
      throw new AppError(
        'CONFLICT',
        'O documento da proposta não possui lote de entrega.',
      );
    }
    const pendingTotal = await transaction.quoteProposalDocument.count({
      where: {
        companyId: input.companyId,
        quoteRequestId: input.quoteRequestId,
        deliveryBatchId: input.deliveryBatchId,
        status: {
          in: [
            QuoteProposalDocumentStatus.UPLOADED,
            QuoteProposalDocumentStatus.QUEUED,
          ],
        },
      },
    });
    if (pendingTotal > 0) return;
    const failedTotal = await transaction.quoteProposalDocument.count({
      where: {
        companyId: input.companyId,
        quoteRequestId: input.quoteRequestId,
        deliveryBatchId: input.deliveryBatchId,
        status: QuoteProposalDocumentStatus.FAILED,
      },
    });
    if (failedTotal > 0) return;

    const [conversation, quote] = await Promise.all([
      transaction.whatsAppConversation.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: input.conversationId,
            companyId: input.companyId,
          },
        },
      }),
      transaction.quoteRequest.findUniqueOrThrow({
        where: {
          id_companyId: {
            id: input.quoteRequestId,
            companyId: input.companyId,
          },
        },
      }),
    ]);
    if (
      quote.conversationId !== conversation.id ||
      quote.status !== RequestStatus.UNDER_REVIEW
    ) {
      return;
    }

    const sentDocuments = await transaction.quoteProposalDocument.findMany({
      where: {
        companyId: input.companyId,
        quoteRequestId: quote.id,
        deliveryBatchId: input.deliveryBatchId,
        status: QuoteProposalDocumentStatus.SENT,
      },
      orderBy: [{ sentAt: 'desc' }, { sequence: 'desc' }],
      select: {
        id: true,
        messageId: true,
        providerMessageId: true,
        sentAt: true,
      },
    });
    if (sentDocuments.length === 0) return;

    const next = resolveConversationTransition({
      current: snapshotForProposalDelivery(conversation),
      name: 'proposal-delivery-confirmed',
    });
    const completedAt = sentDocuments[0].sentAt ?? new Date();
    let foundation = await this.ensureFoundationForConversation(
      transaction,
      conversation,
      {
        commandSeed: correlation(
          'quote-proposal-batch-delivered',
          input.triggeringDocumentId,
        ),
        occurredAt: completedAt,
        desiredConversationState: stateToPrisma[next.conversationState],
      },
    );
    const department = await transaction.tenantDepartment.findUnique({
      where: {
        companyId_code: {
          companyId: input.companyId,
          code: departmentToPrisma[next.department],
        },
      },
      select: { id: true },
    });
    const resumedSession = await this.updateFoundationSession(transaction, {
      companyId: input.companyId,
      session: foundation.session,
      commandId: correlation(
        'quote-proposal-delivery-session',
        input.triggeringDocumentId,
      ),
      name: 'quote-proposal-delivery-return-to-ai',
      actorType: MutationActorType.SERVICE,
      status: ServiceSessionStatus.WAITING_CUSTOMER,
      controlMode: ServiceSessionControlMode.AI,
      isForeground: true,
      responsibleUserId: null,
      currentDepartmentId: department?.id ?? null,
      occurredAt: completedAt,
      metadata: {
        conversationId: conversation.id,
        quoteRequestId: quote.id,
        deliveryBatchId: input.deliveryBatchId,
      },
    });
    foundation = { ...foundation, session: resumedSession };
    const quoteUpdated = await transaction.quoteRequest.updateMany({
      where: {
        id: quote.id,
        companyId: input.companyId,
        conversationId: conversation.id,
        version: quote.version,
        status: RequestStatus.UNDER_REVIEW,
      },
      data: {
        status: RequestStatus.WAITING_FOR_CUSTOMER,
        version: { increment: 1 },
      },
    });
    if (quoteUpdated.count !== 1) {
      throw new AppError(
        'CONFLICT',
        'A solicitação vinculada à proposta foi alterada durante a confirmação.',
        { currentVersion: quote.version },
      );
    }

    const nextVersion = conversation.version + 1;
    const transitioned = await transaction.whatsAppConversation.updateMany({
      where: {
        id: conversation.id,
        companyId: input.companyId,
        version: conversation.version,
        department: DepartmentCode.COMMERCIAL,
        conversationState: {
          in: [
            ConversationState.BOT_ACTIVE,
            ConversationState.SENT_TO_HUMAN,
            ConversationState.HUMAN_ACTIVE,
          ],
        },
        flowStep: {
          in: [FlowStep.QUOTE_SEND_PENDING, FlowStep.COMMERCIAL_FOLLOW_UP_MENU],
        },
        requestStatus: RequestStatus.UNDER_REVIEW,
      },
      data: {
        conversationState: stateToPrisma[next.conversationState],
        flowStep: flowToPrisma[next.flowStep],
        requestStatus: requestToPrisma[next.requestStatus],
        resumeState: null,
        resumeFlowStep: null,
        assignedToUserId: null,
        contextualFollowUpAt: null,
        lastOutboundAt: completedAt,
        lastMessagePreview:
          sentDocuments.length === 1
            ? 'Orçamento em PDF enviado.'
            : `${sentDocuments.length} PDFs de orçamento enviados.`,
        version: { increment: 1 },
      },
    });
    if (transitioned.count !== 1) {
      throw currentVersionConflict(conversation.version);
    }

    const resultSnapshot = {
      id: conversation.id,
      ...next,
      version: nextVersion,
    };
    await transaction.whatsAppConversationTransition.create({
      data: {
        companyId: input.companyId,
        conversationId: conversation.id,
        threadId: foundation.threadId,
        serviceSessionId: foundation.session.id,
        commandId: correlation(
          'quote-proposal-batch-delivered',
          input.triggeringDocumentId,
        ),
        commandFingerprint: commandFingerprint({
          quoteRequestId: quote.id,
          proposalDocumentIds: sentDocuments.map((document) => document.id),
          triggeringDocumentId: input.triggeringDocumentId,
        }),
        name: 'proposal-delivery-confirmed',
        expectedVersion: conversation.version,
        resultingVersion: nextVersion,
        actorType: TransitionActorType.SYSTEM,
        fromDepartment: conversation.department,
        toDepartment: departmentToPrisma[next.department],
        fromState: conversation.conversationState,
        toState: stateToPrisma[next.conversationState],
        fromFlowStep: conversation.flowStep,
        toFlowStep: flowToPrisma[next.flowStep],
        fromRequestStatus: conversation.requestStatus,
        toRequestStatus: requestToPrisma[next.requestStatus],
        metadata: payload({
          quoteRequestId: quote.id,
          proposalDocumentIds: sentDocuments.map((document) => document.id),
          messageIds: sentDocuments.map((document) => document.messageId),
          providerMessageIds: sentDocuments.map(
            (document) => document.providerMessageId,
          ),
        }),
        resultSnapshot: payload(resultSnapshot),
      },
    });
  }

  private async lockCommand(
    transaction: Prisma.TransactionClient,
    companyId: string,
    namespace: string,
    key: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`${companyId}:${namespace}:${key}`})
      )
    `;
  }

  private async assertCurrentWhatsAppAttendant(
    transaction: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string,
  ) {
    const lockedActor = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM users
      WHERE id = CAST(${actorUserId} AS uuid)
        AND company_id = CAST(${companyId} AS uuid)
      FOR SHARE
    `;
    if (lockedActor.length !== 1) {
      throw new AppError(
        'FORBIDDEN',
        'O usuário não está autorizado a atender conversas deste tenant.',
        { reasonCode: 'WHATSAPP_ATTENDANCE_PERMISSION_REQUIRED' },
      );
    }

    const actor = await transaction.user.findUnique({
      where: { id_companyId: { id: actorUserId, companyId } },
      select: {
        id: true,
        name: true,
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
      !actor ||
      !actor.isActive ||
      actor.status !== UserAccountStatus.ACTIVE ||
      actor.deletedAt !== null
    ) {
      throw new AppError(
        'FORBIDDEN',
        'O usuário não está autorizado a atender conversas deste tenant.',
        { reasonCode: 'WHATSAPP_ATTENDANCE_PERMISSION_REQUIRED' },
      );
    }

    const permissionCodes = actor.permissionCodes.filter(isPermissionCode);
    const documentAccessMode =
      actor.documentAccessMode === DocumentAccessMode.DOCUMENT_PORTAL
        ? 'document-portal'
        : actor.documentAccessMode === DocumentAccessMode.CLIENT
          ? 'client'
          : 'standard';
    const permissions = resolveEffectivePermissions(
      actor.departments as SupportedUserDepartment[],
      permissionCodes,
      actor.isAdministrator,
      documentAccessMode,
    );
    const authority = {
      isAdministrator: actor.isAdministrator,
      departments: actor.departments,
      permissionCodes,
      permissions,
      documentAccessMode,
    };
    if (
      !canExercisePermission(authority, 'whatsapp-conversations:attend') &&
      !canExercisePermission(authority, 'whatsapp-conversations:manage')
    ) {
      throw new AppError(
        'FORBIDDEN',
        'O usuário não possui a capacidade individual de atendimento.',
        { reasonCode: 'WHATSAPP_ATTENDANCE_PERMISSION_REQUIRED' },
      );
    }

    return {
      ...actor,
      permissionCodes,
      permissions,
      hasTenantWideAuthority: hasTenantWideAuthority(authority),
    };
  }

  private async assertCurrentCommercialOperator(
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
      throw forbidden('O usuário não está autorizado a operar propostas.');
    }

    const actor = await transaction.user.findUnique({
      where: { id_companyId: { id: actorUserId, companyId } },
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
      !actor ||
      !actor.isActive ||
      actor.status !== UserAccountStatus.ACTIVE ||
      actor.deletedAt !== null
    ) {
      throw forbidden('O usuário não está autorizado a operar propostas.');
    }

    const authority = {
      isAdministrator: actor.isAdministrator,
      departments: actor.departments,
      permissionCodes: actor.permissionCodes,
      permissions: actor.permissionCodes,
      documentAccessMode: actor.documentAccessMode,
    };
    const tenantWide = hasTenantWideAuthority(authority);
    const canManageProposal =
      canExercisePermission(authority, 'commercial:manage') ||
      canExercisePermission(authority, 'whatsapp-conversations:manage');
    if (
      !canManageProposal ||
      (!tenantWide && !actor.departments.includes('commercial'))
    ) {
      throw forbidden(
        'A operação exige acesso comercial vigente dentro deste tenant.',
      );
    }
  }

  private async createOrderedOutbox(
    transaction: Prisma.TransactionClient,
    input: {
      companyId: string;
      topic: string;
      aggregateType: string;
      aggregateId: string;
      correlationId: string;
      payload: unknown;
    },
  ): Promise<void> {
    await this.lockCommand(
      transaction,
      input.companyId,
      'integration-outbox',
      `${input.aggregateType}:${input.aggregateId}`,
    );
    const latest = await transaction.integrationOutbox.aggregate({
      where: {
        companyId: input.companyId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
      },
      _max: { aggregateSequence: true },
    });
    await transaction.integrationOutbox.create({
      data: {
        ...input,
        aggregateSequence: (latest._max.aggregateSequence ?? 0) + 1,
        payload: payload(input.payload),
      },
    });
  }

  private async replayTransition(
    input: TransitionCommand,
    fingerprint: string,
  ): Promise<unknown> {
    const transition =
      await this.prisma.whatsAppConversationTransition.findUnique({
        where: {
          companyId_commandId: {
            companyId: input.companyId,
            commandId: input.commandId,
          },
        },
      });
    if (!transition) {
      throw new AppError(
        'CONFLICT',
        'Não foi possível reconciliar a concorrência da transição.',
      );
    }
    assertSameFingerprint(
      transition.commandFingerprint,
      fingerprint,
      'commandId',
    );
    return {
      ...(transition.resultSnapshot as Record<string, unknown>),
      idempotent: true,
    };
  }

  private async replayInbox(
    companyId: string,
    source: string,
    externalEventId: string,
    fingerprint: string,
    keyName: string,
  ): Promise<unknown> {
    const inbox = await this.prisma.integrationInbox.findUnique({
      where: {
        companyId_source_externalEventId: {
          companyId,
          source,
          externalEventId,
        },
      },
    });
    if (!inbox) {
      throw new AppError(
        'CONFLICT',
        'Não foi possível reconciliar a concorrência do comando.',
      );
    }
    assertSameFingerprint(inbox.payloadHash, fingerprint, keyName);
    if (!inbox.resultSnapshot) {
      throw new AppError('CONFLICT', 'O comando concorrente está incompleto.');
    }
    return {
      ...(inbox.resultSnapshot as Record<string, unknown>),
      idempotent: true,
    };
  }

  private async presentCurrentOutboundReplay(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
    snapshot: Record<string, unknown>,
  ): Promise<unknown> {
    const messageId = snapshot.id;
    if (typeof messageId !== 'string') {
      throw new AppError(
        'CONFLICT',
        'O snapshot do comando outbound não contém a mensagem.',
      );
    }
    const message = await client.whatsAppMessage.findUnique({
      where: { id_companyId: { id: messageId, companyId } },
      include: {
        actorUser: { select: { id: true, name: true } },
        attempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });
    if (!message) throw notFound('Mensagem outbound');
    return this.presentMessage(message, true);
  }

  private async findConversationOrThrow(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
    conversationId: string,
  ): Promise<ConversationWithRelations> {
    const conversation = await client.whatsAppConversation.findUnique({
      where: { id_companyId: { id: conversationId, companyId } },
      include: conversationInclude,
    });
    if (!conversation) throw notFound('Conversa');
    return conversation;
  }

  private presentMessage(
    row: {
      id: string;
      conversationId: string;
      mediaAssetId?: string | null;
      actorUserId: string | null;
      providerMessageId: string | null;
      direction: MessageDirection;
      deliveryStatus: DeliveryStatus;
      kind: MessageKind;
      text: string | null;
      media: unknown;
      automationPurpose: string | null;
      recipientPhone: string | null;
      correlationId: string;
      occurredAt: Date;
      createdAt: Date;
      updatedAt: Date;
      actorUser?: { id: string; name: string } | null;
      mediaAsset?: MessageMediaAssetRow | null;
      attempts: Array<{
        id: string;
        attemptNumber: number;
        status: MessageAttemptStatus;
        providerMessageId: string | null;
        errorCode: string | null;
        errorMessage: string | null;
        dispatchClaimId: string | null;
        dispatchFingerprint: string | null;
        dispatchClaimedAt: Date | null;
        dispatchState: EvolutionDispatchState;
        dispatchOwnerId: string | null;
        dispatchLeaseUntil: Date | null;
        startedAt: Date;
        completedAt: Date | null;
      }>;
    },
    idempotent: boolean,
  ) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      providerMessageId: row.providerMessageId,
      direction:
        row.direction === MessageDirection.INBOUND ? 'inbound' : 'outbound',
      deliveryStatus: deliveryFromPrisma[row.deliveryStatus],
      kind: kindFromPrisma[row.kind],
      text: row.text,
      media: row.media,
      mediaAssetId: row.mediaAssetId ?? row.mediaAsset?.id ?? null,
      mediaAsset: presentMessageMediaAsset(row.mediaAsset ?? null),
      automationPurpose: row.automationPurpose,
      recipientPhone: row.recipientPhone,
      sentBy: row.actorUser
        ? { id: row.actorUser.id, name: row.actorUser.name }
        : null,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt.toISOString(),
      attempts: row.attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status.toLowerCase(),
        providerMessageId: attempt.providerMessageId,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        dispatchState: attempt.dispatchState.toLowerCase(),
        dispatchClaimedAt: attempt.dispatchClaimedAt?.toISOString() ?? null,
        dispatchLeaseUntil: attempt.dispatchLeaseUntil?.toISOString() ?? null,
        startedAt: attempt.startedAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() ?? null,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      idempotent,
    };
  }
}
