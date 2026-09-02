import {
  CommercialQuoteRepository,
  type CreateQuoteProposalInput,
  type DecideQuoteProposalInput,
  type QuoteProposalListQuery,
  type QuoteRequestPatch,
  type SendQuoteProposalInput,
  type UpdateQuoteProposalStatusInput,
  type UploadQuoteProposalDocumentInput,
} from '../../contracts/commercial-quote.repository';
import type { ConversationAccessScope } from '../../contracts/whatsapp.repository';

export class PatchQuoteRequestUseCase {
  constructor(private readonly repository: CommercialQuoteRepository) {}

  execute(companyId: string, quoteRequestId: string, input: QuoteRequestPatch) {
    return this.repository.patchQuoteRequest(companyId, quoteRequestId, input);
  }
}

export class QuoteProposalUseCase {
  constructor(private readonly repository: CommercialQuoteRepository) {}

  currentForConversation(
    companyId: string,
    conversationId: string,
    scope: ConversationAccessScope,
  ) {
    return this.repository.getCurrentQuoteRequest(
      companyId,
      conversationId,
      scope,
    );
  }

  list(companyId: string, query: QuoteProposalListQuery) {
    return this.repository.listQuoteProposals(companyId, query);
  }

  notificationSummary(companyId: string, userId: string) {
    return this.repository.getQuoteProposalNotificationSummary(
      companyId,
      userId,
    );
  }

  markNotificationRead(companyId: string, userId: string) {
    return this.repository.markQuoteProposalNotificationRead(companyId, userId);
  }

  get(companyId: string, quoteRequestId: string) {
    return this.repository.getQuoteProposal(companyId, quoteRequestId);
  }

  create(input: CreateQuoteProposalInput) {
    return this.repository.createQuoteProposal(input);
  }

  decide(input: DecideQuoteProposalInput) {
    return this.repository.decideQuoteProposal(input);
  }

  updateStatus(input: UpdateQuoteProposalStatusInput) {
    if (input.status === 'approved' || input.status === 'rejected') {
      return this.repository.decideQuoteProposal({
        companyId: input.companyId,
        quoteRequestId: input.quoteRequestId,
        actorUserId: input.actorUserId,
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        decision: input.status,
        reason: input.reason,
      });
    }

    return this.repository.updateQuoteProposalStatus(input);
  }

  upload(input: UploadQuoteProposalDocumentInput) {
    return this.repository.uploadQuoteProposalDocument(input);
  }

  send(input: SendQuoteProposalInput) {
    return this.repository.sendQuoteProposal(input);
  }

  getDocument(companyId: string, documentId: string) {
    return this.repository.getQuoteProposalDocument(companyId, documentId);
  }
}
