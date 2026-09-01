import type { Department } from '../access/access.constants';
import {
  ACTIVE_QUOTE_REQUEST_STATUSES,
  QUOTE_REQUEST_STATUSES,
  type QuoteRequestStatus,
} from '../commercial/quote-status';

export { ACTIVE_QUOTE_REQUEST_STATUSES };

export const CONVERSATION_STATES = [
  'bot-active',
  'waiting-for-customer',
  'sent-to-human',
  'human-active',
  'closed',
] as const;

export const FLOW_STEPS = [
  'main-menu',
  'commercial-menu',
  'quote-data-collection',
  'quote-summary-confirmation',
  'quote-send-pending',
  'commercial-follow-up-menu',
  'human-service',
  'closed',
] as const;

/** @deprecated Importe QUOTE_REQUEST_STATUSES do contexto Comercial. */
export const REQUEST_STATUSES = QUOTE_REQUEST_STATUSES;

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;

export const DELIVERY_STATUSES = [
  'received',
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

export const MESSAGE_KINDS = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contact',
  'unknown',
] as const;

export const UNSUPPORTED_MESSAGE_KIND_REPLY_TEXT =
  'Ainda não consigo interpretar esse tipo de arquivo. Por favor, envie sua resposta em texto.';

export const TRANSITION_NAMES = [
  'present-main-menu',
  'select-commercial',
  'start-department-contact',
  'start-quote',
  'present-quote-summary',
  'correct-quote',
  'confirm-quote',
  'proposal-delivery-confirmed',
  'proposal-response-received',
  'new-quote-request',
  'return-to-main-menu',
  'take-over',
  'request-transfer',
  'accept-transfer',
  'return-to-bot',
  'forward',
  'change-department',
  'mark-read',
  'archive',
  'unarchive',
  'close',
  'close-after-rejection',
  'resume-awaited-reply',
  'resume-contextual-contact',
  'reopen-after-customer-message',
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];
export type FlowStep = (typeof FLOW_STEPS)[number];
/** @deprecated Importe QuoteRequestStatus do contexto Comercial. */
export type RequestStatus = QuoteRequestStatus;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type TransitionName = (typeof TRANSITION_NAMES)[number];

export interface ConversationSnapshot {
  department: Department;
  conversationState: ConversationState;
  flowStep: FlowStep;
  requestStatus: RequestStatus;
  resumeState: ConversationState | null;
  resumeFlowStep: FlowStep | null;
}
