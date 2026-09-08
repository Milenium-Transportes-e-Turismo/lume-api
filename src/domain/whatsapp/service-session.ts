import { randomInt } from 'node:crypto';

import { forbidden, validationError } from '../../core/errors/app-error';

export const SERVICE_SESSION_STATUSES = [
  'open',
  'waiting-customer',
  'waiting-human',
  'paused-by-higher-priority',
  'closing',
  'closed',
] as const;

export const SERVICE_CONTROL_MODES = ['ai', 'human'] as const;
export const SERVICE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const SERVICE_PRIORITY_SOURCES = [
  'ai-agent',
  'human-user',
  'system',
  'import',
] as const;
export const SERVICE_CONTINUITY_CLASSIFICATIONS = [
  'continuation',
  'new-subject',
  'uncertain',
] as const;
export const SERVICE_MESSAGE_ACTORS = [
  'customer',
  'human-user',
  'external-human',
  'ai-agent',
  'system',
] as const;
export const SERVICE_MESSAGE_SOURCES = [
  'lume-web',
  'whatsapp-app',
  'automation',
] as const;

export const CONTINUITY_WINDOW_MS = 2 * 60 * 60 * 1_000;
export const PUBLIC_CONTINUATION_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AI_CLOSING_WAIT_MS = 30 * 60 * 1_000;
export const LUME_AI_CLOSING_QUESTION = 'Precisa de mais alguma coisa?';
export const LUME_AI_CLOSURE_MESSAGE =
  'Este atendimento foi encerrado. Se precisar retomar este assunto nos próximos 7 dias, envie CONTINUAR {code}.';

export type ServiceSessionStatus = (typeof SERVICE_SESSION_STATUSES)[number];
export type ServiceControlMode = (typeof SERVICE_CONTROL_MODES)[number];
export type ServicePriority = (typeof SERVICE_PRIORITIES)[number];
export type ServicePrioritySource = (typeof SERVICE_PRIORITY_SOURCES)[number];
export type ServiceContinuityClassification =
  (typeof SERVICE_CONTINUITY_CLASSIFICATIONS)[number];
export type ServiceMessageActor = (typeof SERVICE_MESSAGE_ACTORS)[number];
export type ServiceMessageSource = (typeof SERVICE_MESSAGE_SOURCES)[number];

export interface ServiceSessionSnapshot {
  readonly status: ServiceSessionStatus;
  readonly controlMode: ServiceControlMode;
  readonly currentDepartmentId: string | null;
  readonly responsibleUserId: string | null;
  readonly queueId: string | null;
  readonly priority: ServicePriority;
  readonly priorityReason: string | null;
  readonly prioritySource: ServicePrioritySource;
  readonly conversationResolved: boolean;
  readonly pendingActions: readonly string[];
  readonly resolutionConfirmedByCustomer: boolean;
  readonly aiClosingStartedAt: Date | null;
  readonly closedAt: Date | null;
  readonly version: number;
}

export type ServiceSessionCommand =
  | { readonly type: 'request-human'; readonly queueId: string }
  | { readonly type: 'external-human-message' }
  | { readonly type: 'assume'; readonly userId: string }
  | { readonly type: 'return-to-queue'; readonly queueId: string }
  | { readonly type: 'return-to-ai' }
  | {
      readonly type: 'transfer';
      readonly departmentId: string;
      readonly queueId?: string;
      readonly userId?: string;
    }
  | {
      readonly type: 'change-priority';
      readonly priority: ServicePriority;
      readonly reason: string;
      readonly source: Exclude<ServicePrioritySource, 'system' | 'import'>;
    }
  | { readonly type: 'pause-for-higher-priority' }
  | { readonly type: 'resume-after-higher-priority' }
  | { readonly type: 'begin-ai-closing'; readonly at: Date }
  | { readonly type: 'customer-replied-during-closing' }
  | { readonly type: 'finish-ai-closing'; readonly at: Date }
  | { readonly type: 'close-human'; readonly at: Date };

export interface ContinuityDecisionInput {
  readonly now: Date;
  readonly previousClosedAt: Date;
  readonly classification?: ServiceContinuityClassification;
  readonly confidence?: number;
  readonly reason?: string;
  readonly validPublicContinuationCode?: boolean;
}

export interface ContinuityDecision {
  readonly action: 'reopen-previous' | 'create-new';
  readonly classification: ServiceContinuityClassification | 'public-code';
  readonly fallbackAction: 'none' | 'reopen-on-uncertain';
  readonly confidence: number | null;
  readonly reason: string;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw validationError(`${field} é obrigatório.`);
  return normalized;
}

function assertMutable(snapshot: ServiceSessionSnapshot): void {
  if (snapshot.status === 'closed') {
    throw validationError(
      'O atendimento está encerrado. Abra ou reabra uma sessão antes de alterá-lo.',
    );
  }
}

function next(
  snapshot: ServiceSessionSnapshot,
  patch: Partial<ServiceSessionSnapshot>,
): ServiceSessionSnapshot {
  return { ...snapshot, ...patch, version: snapshot.version + 1 };
}

export function evolveServiceSession(
  snapshot: ServiceSessionSnapshot,
  command: ServiceSessionCommand,
): ServiceSessionSnapshot {
  assertMutable(snapshot);

  switch (command.type) {
    case 'request-human':
      return next(snapshot, {
        status: 'waiting-human',
        controlMode: 'human',
        responsibleUserId: null,
        queueId: requireNonEmpty(command.queueId, 'Fila'),
        aiClosingStartedAt: null,
      });

    case 'external-human-message':
      return next(snapshot, {
        status: 'open',
        controlMode: 'human',
        responsibleUserId: null,
        aiClosingStartedAt: null,
      });

    case 'assume':
      return next(snapshot, {
        status: 'open',
        controlMode: 'human',
        responsibleUserId: requireNonEmpty(command.userId, 'Responsável'),
        aiClosingStartedAt: null,
      });

    case 'return-to-queue':
      if (snapshot.controlMode !== 'human') {
        throw validationError(
          'Somente atendimento humano pode retornar à fila.',
        );
      }
      return next(snapshot, {
        status: 'waiting-human',
        responsibleUserId: null,
        queueId: requireNonEmpty(command.queueId, 'Fila'),
      });

    case 'return-to-ai':
      if (snapshot.controlMode !== 'human') {
        throw validationError('A IA já controla este atendimento.');
      }
      return next(snapshot, {
        status: 'open',
        controlMode: 'ai',
        responsibleUserId: null,
        queueId: null,
        aiClosingStartedAt: null,
      });

    case 'transfer': {
      const userId = command.userId
        ? requireNonEmpty(command.userId, 'Responsável')
        : null;
      const queueId = command.queueId
        ? requireNonEmpty(command.queueId, 'Fila')
        : null;
      return next(snapshot, {
        currentDepartmentId: requireNonEmpty(
          command.departmentId,
          'Departamento',
        ),
        status: userId === null ? 'waiting-human' : 'open',
        controlMode: 'human',
        responsibleUserId: userId,
        queueId,
        aiClosingStartedAt: null,
      });
    }

    case 'change-priority':
      return next(snapshot, {
        priority: command.priority,
        priorityReason: requireNonEmpty(command.reason, 'Motivo da prioridade'),
        prioritySource: command.source,
      });

    case 'pause-for-higher-priority':
      if (snapshot.status !== 'open') {
        throw validationError(
          'Somente um atendimento em andamento pode ser pausado.',
        );
      }
      return next(snapshot, { status: 'paused-by-higher-priority' });

    case 'resume-after-higher-priority':
      if (snapshot.status !== 'paused-by-higher-priority') {
        throw validationError('O atendimento não está pausado por prioridade.');
      }
      return next(snapshot, { status: 'open' });

    case 'begin-ai-closing':
      if (snapshot.controlMode !== 'ai') {
        throw validationError(
          'Somente a IA pode iniciar o encerramento automático.',
        );
      }
      if (
        !snapshot.conversationResolved ||
        snapshot.pendingActions.length > 0
      ) {
        throw validationError(
          'O atendimento ainda possui uma demanda ou ação relevante pendente.',
        );
      }
      return next(snapshot, {
        status: 'closing',
        aiClosingStartedAt: command.at,
      });

    case 'customer-replied-during-closing':
      if (snapshot.status !== 'closing') {
        return snapshot;
      }
      return next(snapshot, {
        status: 'open',
        conversationResolved: false,
        resolutionConfirmedByCustomer: false,
        aiClosingStartedAt: null,
      });

    case 'finish-ai-closing': {
      if (
        snapshot.status !== 'closing' ||
        snapshot.controlMode !== 'ai' ||
        snapshot.aiClosingStartedAt === null
      ) {
        throw validationError(
          'O encerramento automático não foi iniciado pela IA.',
        );
      }
      const elapsed =
        command.at.getTime() - snapshot.aiClosingStartedAt.getTime();
      if (elapsed < AI_CLOSING_WAIT_MS) {
        throw validationError(
          'O período de espera do encerramento ainda não terminou.',
        );
      }
      return next(snapshot, {
        status: 'closed',
        closedAt: command.at,
        aiClosingStartedAt: null,
      });
    }

    case 'close-human':
      if (snapshot.controlMode !== 'human') {
        throw validationError(
          'Use o fluxo formal da IA para este encerramento.',
        );
      }
      return next(snapshot, {
        status: 'closed',
        closedAt: command.at,
        aiClosingStartedAt: null,
      });
  }
}

export function assertAiCustomerFacingDispatchAllowed(
  snapshot: Pick<ServiceSessionSnapshot, 'status' | 'controlMode'>,
): void {
  if (snapshot.controlMode !== 'ai') {
    throw forbidden(
      'A resposta da IA foi bloqueada porque o controle está com atendimento humano.',
    );
  }
  if (snapshot.status !== 'open') {
    throw forbidden(
      'A resposta da IA foi bloqueada pelo estado atual do atendimento.',
    );
  }
}

export function decideServiceContinuity(
  input: ContinuityDecisionInput,
): ContinuityDecision {
  if (input.validPublicContinuationCode) {
    return {
      action: 'reopen-previous',
      classification: 'public-code',
      fallbackAction: 'none',
      confidence: null,
      reason:
        'Código público válido apresentado pelo mesmo contato dentro de 7 dias.',
    };
  }

  const rawElapsed = input.now.getTime() - input.previousClosedAt.getTime();
  if (rawElapsed <= -1_000) {
    throw validationError('A data de fechamento não pode estar no futuro.');
  }
  // Evolution timestamps have second precision while closedAt preserves
  // milliseconds. Clamp only that lost sub-second precision to zero.
  const elapsed = Math.max(0, rawElapsed);
  if (elapsed > CONTINUITY_WINDOW_MS) {
    return {
      action: 'create-new',
      classification: 'new-subject',
      fallbackAction: 'none',
      confidence: input.confidence ?? null,
      reason:
        input.reason?.trim() || 'Janela de continuidade de 2 horas encerrada.',
    };
  }

  const classification = input.classification ?? 'uncertain';
  if (classification === 'new-subject') {
    return {
      action: 'create-new',
      classification,
      fallbackAction: 'none',
      confidence: input.confidence ?? null,
      reason: input.reason?.trim() || 'A mensagem iniciou um novo assunto.',
    };
  }

  return {
    action: 'reopen-previous',
    classification,
    fallbackAction:
      classification === 'uncertain' ? 'reopen-on-uncertain' : 'none',
    confidence: input.confidence ?? null,
    reason:
      input.reason?.trim() ||
      (classification === 'uncertain'
        ? 'Classificação incerta; aplicado o fallback seguro de continuidade.'
        : 'A mensagem continua o atendimento anterior.'),
  };
}

export function createPublicContinuationCode(): string {
  return randomInt(100, 1_000).toString();
}

export function publicContinuationCodeExpiresAt(closedAt: Date): Date {
  return new Date(closedAt.getTime() + PUBLIC_CONTINUATION_CODE_TTL_MS);
}

export function formatAiClosureMessage(code: string): string {
  const normalized = code.trim();
  if (!/^\d{3}$/u.test(normalized)) {
    throw validationError('Código público de continuidade inválido.');
  }
  return LUME_AI_CLOSURE_MESSAGE.replace('{code}', normalized);
}

export function parsePublicContinuationCommand(text: string): string | null {
  return /^CONTINUAR\s+([0-9]{3})$/iu.exec(text.trim())?.[1] ?? null;
}
