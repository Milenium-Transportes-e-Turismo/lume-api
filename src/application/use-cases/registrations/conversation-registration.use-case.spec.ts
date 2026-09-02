/* eslint-disable @typescript-eslint/unbound-method -- repository methods are Vitest mocks in this unit harness */
import { describe, expect, it, vi } from 'vitest';

import {
  ConversationRegistrationRepository,
  type RegistrationAbandonmentResult,
  type RegistrationDraftPublicState,
} from '../../contracts/conversation-registration.repository';
import {
  ConversationRegistrationUseCase,
  IdentifyConversationParticipantUseCase,
  RegistrationDataReviewUseCase,
} from './conversation-registration.use-case';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DRAFT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COMMAND_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const REVIEW_ID = '11111111-1111-4111-8111-111111111111';

function repository() {
  const state: RegistrationDraftPublicState = {
    draftId: DRAFT_ID,
    draftVersion: 1,
    kind: 'personal',
    status: 'draft',
    providedFields: [],
    missingFields: ['person.name', 'person.cpf', 'person.phone'],
    registrationRequiredForQuote: false,
    continueOriginalDemand: true,
  };
  return {
    resolveIdentity: vi.fn(async () => ({
      status: 'unknown' as const,
      registrationId: null,
      modelContext: 'Atenda normalmente; cadastro é opcional.',
      requiresDisambiguation: false,
      candidateCount: 0,
    })),
    startDraft: vi.fn(async () => state),
    updateDraft: vi.fn(async () => ({ ...state, draftVersion: 2 })),
    readDraftState: vi.fn(async () => state),
    previewDraft: vi.fn(),
    confirmDraft: vi.fn(),
    abandonDraft: vi.fn(async (): Promise<RegistrationAbandonmentResult> => ({
      draftId: DRAFT_ID,
      status: 'abandoned',
      incompleteRegistrationPersisted: false,
      registrationRequiredForQuote: false,
      continueOriginalDemand: true,
    })),
    listDataReviews: vi.fn(async () => []),
    decideDataReview: vi.fn(async () => ({
      reviewId: REVIEW_ID,
      registrationId: DRAFT_ID,
      status: 'rejected' as const,
      reviewedByUserId: USER_ID,
      reviewedAt: '2026-08-29T12:00:00.000Z',
    })),
  } as unknown as ConversationRegistrationRepository;
}

describe('conversation registration application boundary', () => {
  it('delegates pre-response identity without accepting client-provided identity', async () => {
    const repo = repository();
    const subject = new IdentifyConversationParticipantUseCase(repo);

    const result = await subject.resolveBeforeResponse({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
    });

    expect(result).toMatchObject({ status: 'unknown', candidateCount: 0 });
    expect(repo.resolveIdentity).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
    });
  });

  it('starts a personal/company draft without persisting a Registration', async () => {
    const repo = repository();
    const subject = new ConversationRegistrationUseCase(repo);

    const result = await subject.start({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      commandId: COMMAND_ID,
      kind: 'personal',
    });

    expect(result.registrationRequiredForQuote).toBe(false);
    expect(repo.startDraft).toHaveBeenCalledOnce();
    expect(repo.confirmDraft).not.toHaveBeenCalled();
  });

  it('rejects final persistence without the explicit customer confirmation', async () => {
    const subject = new ConversationRegistrationUseCase(repository());

    expect(() =>
      subject.confirm({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        commandId: COMMAND_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 2,
        customerConfirmedFinalSummary: false,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('reads only the public versioned state of a draft', async () => {
    const repo = repository();
    const subject = new ConversationRegistrationUseCase(repo);

    await expect(
      subject.read({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        draftId: DRAFT_ID,
      }),
    ).resolves.toMatchObject({ draftId: DRAFT_ID, draftVersion: 1 });
    expect(repo.readDraftState).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      serviceSessionId: SESSION_ID,
      whatsappContactId: CONTACT_ID,
      agentExecutionId: null,
      draftId: DRAFT_ID,
    });
  });

  it('keeps refusal and abandonment compatible with quote continuation', async () => {
    const subject = new ConversationRegistrationUseCase(repository());

    expect(subject.declineWithoutDraft()).toEqual({
      draftId: null,
      status: 'declined',
      incompleteRegistrationPersisted: false,
      registrationRequiredForQuote: false,
      continueOriginalDemand: true,
    });
    await expect(
      subject.abandon({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        commandId: COMMAND_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 2,
      }),
    ).resolves.toMatchObject({
      status: 'abandoned',
      incompleteRegistrationPersisted: false,
      continueOriginalDemand: true,
    });
  });

  it('validates relationship types before the repository sees the patch', async () => {
    const repo = repository();
    const subject = new ConversationRegistrationUseCase(repo);

    expect(() =>
      subject.update({
        companyId: COMPANY_ID,
        serviceSessionId: SESSION_ID,
        whatsappContactId: CONTACT_ID,
        commandId: COMMAND_ID,
        draftId: DRAFT_ID,
        expectedDraftVersion: 1,
        patch: {
          relationship: {
            type: 'administrator' as never,
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(repo.updateDraft).not.toHaveBeenCalled();
  });
});

describe('RegistrationDataReviewUseCase', () => {
  it('passes tenant and human actor into an audited approve/reject decision', async () => {
    const repo = repository();
    const subject = new RegistrationDataReviewUseCase(repo);

    await subject.decide({
      companyId: COMPANY_ID,
      actorUserId: USER_ID,
      commandId: COMMAND_ID,
      reviewId: REVIEW_ID,
      decision: 'rejected',
      reason: 'Documento oficial não confirma a proposta.',
    });

    expect(repo.decideDataReview).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      actorUserId: USER_ID,
      commandId: COMMAND_ID,
      reviewId: REVIEW_ID,
      decision: 'rejected',
      reason: 'Documento oficial não confirma a proposta.',
    });
  });
});
