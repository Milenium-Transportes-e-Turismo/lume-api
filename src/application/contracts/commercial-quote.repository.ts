import type { ManualQuoteCancellationClassification } from '../../domain/commercial/quote-closure';
import type { ConversationAccessScope } from './whatsapp.repository';

export interface QuoteRequestPatch {
  commandId: string;
  expectedVersion: number;
  contactName?: string | null;
  document?: string | null;
  email?: string | null;
  serviceType?: string | null;
  origin?: string | null;
  destination?: string | null;
  departureDate?: Date | null;
  departureAt?: Date | null;
  returnDate?: Date | null;
  returnAt?: Date | null;
  passengerCount?: number | null;
  vehicleType?: string | null;
  vehicleAtDisposal?: boolean | null;
  localTransfers?: boolean | null;
  notes?: string | null;
  structuredData?: Readonly<Record<string, unknown>>;
}

export interface QuoteProposalListQuery {
  page: number;
  pageSize: number;
  stage: 'pending' | 'sent' | 'approved' | 'cancelled';
  search?: string;
  conversationId?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface QuoteProposalNotificationSummary {
  notificationId: 'commercial.pending-quote-proposals';
  pendingTotal: number;
  unreadTotal: number;
}

export interface QuoteProposalPdf {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
}

export interface UploadQuoteProposalDocumentInput {
  companyId: string;
  quoteRequestId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  file: QuoteProposalPdf;
}

export interface SendQuoteProposalInput {
  companyId: string;
  quoteRequestId: string;
  proposalDocumentId: string;
  batchId: string;
  batchDocumentIds: string[];
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
}

export interface CreateQuoteProposalInput {
  companyId: string;
  conversationId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  contactName: string;
  document?: string | null;
  email?: string | null;
  serviceType: string;
  origin: string;
  destination: string;
  departureDate?: Date | null;
  departureAt?: Date | null;
  returnDate?: Date | null;
  returnAt?: Date | null;
  passengerCount: number;
  vehicleType?: string | null;
  vehicleAtDisposal: boolean;
  localTransfers: boolean;
  notes?: string | null;
}

export interface DecideQuoteProposalInput {
  companyId: string;
  quoteRequestId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  decision: 'approved' | 'rejected';
  reason?: string | null;
}

export type ManuallyAssignableQuoteStatus =
  | 'waiting-for-customer'
  | 'under-review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface UpdateQuoteProposalStatusInput {
  companyId: string;
  quoteRequestId: string;
  actorUserId: string;
  commandId: string;
  expectedVersion: number;
  status: ManuallyAssignableQuoteStatus;
  closureClassification?: ManualQuoteCancellationClassification | null;
  reason?: string | null;
}

export abstract class CommercialQuoteRepository {
  abstract getCurrentQuoteRequest(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ): Promise<unknown>;
  abstract patchQuoteRequest(
    companyId: string,
    quoteRequestId: string,
    input: QuoteRequestPatch,
  ): Promise<unknown>;
  abstract listQuoteProposals(
    companyId: string,
    query: QuoteProposalListQuery,
  ): Promise<unknown>;
  abstract getQuoteProposalNotificationSummary(
    companyId: string,
    userId: string,
  ): Promise<QuoteProposalNotificationSummary>;
  abstract markQuoteProposalNotificationRead(
    companyId: string,
    userId: string,
  ): Promise<
    QuoteProposalNotificationSummary & {
      readAt: string;
      markedRead: number;
    }
  >;
  abstract getQuoteProposal(
    companyId: string,
    quoteRequestId: string,
  ): Promise<unknown>;
  abstract createQuoteProposal(
    input: CreateQuoteProposalInput,
  ): Promise<unknown>;
  abstract decideQuoteProposal(
    input: DecideQuoteProposalInput,
  ): Promise<unknown>;
  abstract updateQuoteProposalStatus(
    input: UpdateQuoteProposalStatusInput,
  ): Promise<unknown>;
  abstract uploadQuoteProposalDocument(
    input: UploadQuoteProposalDocumentInput,
  ): Promise<unknown>;
  abstract sendQuoteProposal(input: SendQuoteProposalInput): Promise<unknown>;
  abstract getQuoteProposalDocument(
    companyId: string,
    documentId: string,
  ): Promise<unknown>;
}
