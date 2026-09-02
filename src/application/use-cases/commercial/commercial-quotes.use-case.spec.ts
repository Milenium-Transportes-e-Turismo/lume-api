import { describe, expect, it } from 'vitest';

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
import {
  PatchQuoteRequestUseCase,
  QuoteProposalUseCase,
} from './commercial-quotes.use-case';

class RecordingCommercialQuoteRepository extends CommercialQuoteRepository {
  calls: string[] = [];

  async getCurrentQuoteRequest(
    _companyId: string,
    _conversationId: string,
    _scope: ConversationAccessScope,
  ) {
    this.calls.push('getCurrentQuoteRequest');
    return { operation: 'getCurrentQuoteRequest' };
  }

  async patchQuoteRequest(
    _companyId: string,
    _quoteRequestId: string,
    _input: QuoteRequestPatch,
  ) {
    this.calls.push('patchQuoteRequest');
    return { operation: 'patchQuoteRequest' };
  }

  async listQuoteProposals(_companyId: string, _query: QuoteProposalListQuery) {
    this.calls.push('listQuoteProposals');
    return { operation: 'listQuoteProposals' };
  }

  async getQuoteProposalNotificationSummary(
    _companyId: string,
    _userId: string,
  ) {
    this.calls.push('getQuoteProposalNotificationSummary');
    return {
      notificationId: 'commercial.pending-quote-proposals' as const,
      pendingTotal: 0,
      unreadTotal: 0,
    };
  }

  async markQuoteProposalNotificationRead(_companyId: string, _userId: string) {
    this.calls.push('markQuoteProposalNotificationRead');
    return {
      notificationId: 'commercial.pending-quote-proposals' as const,
      pendingTotal: 0,
      unreadTotal: 0,
      markedRead: 0,
      readAt: new Date(0).toISOString(),
    };
  }

  async getQuoteProposal(_companyId: string, _quoteRequestId: string) {
    this.calls.push('getQuoteProposal');
    return { operation: 'getQuoteProposal' };
  }

  async createQuoteProposal(_input: CreateQuoteProposalInput) {
    this.calls.push('createQuoteProposal');
    return { operation: 'createQuoteProposal' };
  }

  async decideQuoteProposal(_input: DecideQuoteProposalInput) {
    this.calls.push('decideQuoteProposal');
    return { operation: 'decideQuoteProposal' };
  }

  async updateQuoteProposalStatus(_input: UpdateQuoteProposalStatusInput) {
    this.calls.push('updateQuoteProposalStatus');
    return { operation: 'updateQuoteProposalStatus' };
  }

  async uploadQuoteProposalDocument(_input: UploadQuoteProposalDocumentInput) {
    this.calls.push('uploadQuoteProposalDocument');
    return { operation: 'uploadQuoteProposalDocument' };
  }

  async sendQuoteProposal(_input: SendQuoteProposalInput) {
    this.calls.push('sendQuoteProposal');
    return { operation: 'sendQuoteProposal' };
  }

  async getQuoteProposalDocument(_companyId: string, _documentId: string) {
    this.calls.push('getQuoteProposalDocument');
    return { operation: 'getQuoteProposalDocument' };
  }
}

describe('casos de uso comerciais', () => {
  it('delega a correção versionada ao repositório comercial', async () => {
    const repository = new RecordingCommercialQuoteRepository();

    await new PatchQuoteRequestUseCase(repository).execute('company', 'quote', {
      commandId: 'command',
      expectedVersion: 1,
    });

    expect(repository.calls).toEqual(['patchQuoteRequest']);
  });

  it('delega proposta, documento e notificações sem acessar o canal', async () => {
    const repository = new RecordingCommercialQuoteRepository();
    const proposals = new QuoteProposalUseCase(repository);

    await proposals.currentForConversation('company', 'conversation', {
      departments: ['commercial'],
    });
    await proposals.list('company', {
      page: 1,
      pageSize: 20,
      stage: 'pending',
    });
    await proposals.get('company', 'quote');
    await proposals.create({
      companyId: 'company',
      conversationId: 'conversation',
      actorUserId: 'user',
      commandId: 'command',
      expectedVersion: 1,
      contactName: 'Cliente',
      serviceType: 'Fretamento eventual',
      origin: 'Uberlândia',
      destination: 'Goiânia',
      departureAt: new Date(),
      passengerCount: 20,
      vehicleAtDisposal: false,
      localTransfers: false,
    });
    await proposals.decide({
      companyId: 'company',
      quoteRequestId: 'quote',
      actorUserId: 'user',
      commandId: 'decision',
      expectedVersion: 2,
      decision: 'approved',
    });
    await proposals.updateStatus({
      companyId: 'company',
      quoteRequestId: 'quote',
      actorUserId: 'user',
      commandId: 'status',
      expectedVersion: 3,
      status: 'under-review',
    });
    await proposals.upload({
      companyId: 'company',
      quoteRequestId: 'quote',
      actorUserId: 'user',
      commandId: 'upload',
      expectedVersion: 1,
      file: {
        originalName: 'orcamento.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 9,
        content: Buffer.from('%PDF-EOF'),
      },
    });
    await proposals.send({
      companyId: 'company',
      quoteRequestId: 'quote',
      proposalDocumentId: 'document',
      batchId: 'batch',
      batchDocumentIds: ['document'],
      actorUserId: 'user',
      commandId: 'send',
      expectedVersion: 1,
    });
    await proposals.getDocument('company', 'document');
    await proposals.notificationSummary('company', 'user');
    await proposals.markNotificationRead('company', 'user');

    expect(repository.calls).toEqual([
      'getCurrentQuoteRequest',
      'listQuoteProposals',
      'getQuoteProposal',
      'createQuoteProposal',
      'decideQuoteProposal',
      'updateQuoteProposalStatus',
      'uploadQuoteProposalDocument',
      'sendQuoteProposal',
      'getQuoteProposalDocument',
      'getQuoteProposalNotificationSummary',
      'markQuoteProposalNotificationRead',
    ]);
  });

  it('encaminha aprovação e recusa para a decisão auditável', async () => {
    const repository = new RecordingCommercialQuoteRepository();
    const proposals = new QuoteProposalUseCase(repository);

    await proposals.updateStatus({
      companyId: 'company',
      quoteRequestId: 'quote',
      actorUserId: 'user',
      commandId: 'approval',
      expectedVersion: 4,
      status: 'approved',
      reason: 'Conferido',
    });

    expect(repository.calls).toEqual(['decideQuoteProposal']);
  });
});
