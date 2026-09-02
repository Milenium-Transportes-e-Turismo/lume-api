import type {
  ConversationRegistrationKind,
  RegistrationIdentityResolution,
} from '../../domain/registrations/conversation-registration';

export const CONVERSATION_RELATIONSHIP_TYPES = [
  'owner',
  'partner',
  'employee',
  'department-responsible',
  'buyer',
  'service-provider',
  'third-party',
  'other',
] as const;

export type ConversationRelationshipType =
  (typeof CONVERSATION_RELATIONSHIP_TYPES)[number];
export type PersonalDivergenceDecision = 'replace' | 'keep-existing';
export type RegistrationDataReviewStatus = 'pending' | 'approved' | 'rejected';

export type ConversationIdentityResult = RegistrationIdentityResolution & {
  /** Safe, non-PII context that can be supplied to the model. */
  readonly modelContext: string;
  readonly requiresDisambiguation: boolean;
  readonly candidateCount: number;
};

export interface RegistrationConversationSource {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly whatsappContactId: string;
  readonly agentExecutionId: string | null;
}

export interface ConversationRegistrationMutation extends RegistrationConversationSource {
  readonly commandId: string;
}

export interface ConversationRegistrationPatch {
  readonly person?: {
    readonly name?: string;
    readonly cpf?: string;
    readonly email?: string | null;
    readonly phone?: string;
  };
  readonly company?: {
    readonly legalName?: string;
    readonly cnpj?: string;
  };
  readonly relationship?: {
    readonly type?: ConversationRelationshipType;
    readonly jobTitle?: string | null;
    readonly department?: string | null;
  };
}

export interface RegistrationDraftPublicState {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly kind: ConversationRegistrationKind;
  readonly status: 'draft' | 'awaiting-confirmation';
  readonly providedFields: readonly string[];
  readonly missingFields: readonly string[];
  readonly registrationRequiredForQuote: false;
  readonly continueOriginalDemand: true;
  readonly idempotent?: boolean;
}

export interface RegistrationDraftPreview extends RegistrationDraftPublicState {
  /** Contains only values supplied in this draft by the customer. */
  readonly customerProvidedSummary: readonly string[];
  readonly requiredFieldDecisions: readonly {
    readonly field: 'name' | 'email' | 'phone';
    readonly message: string;
  }[];
  readonly organizationReviewsToCreate: readonly {
    readonly field: 'legalName';
    readonly message: string;
  }[];
}

export interface RegistrationConfirmationResult {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly status: 'confirmed';
  readonly personRegistrationId: string;
  readonly companyRegistrationId: string | null;
  readonly relationshipId: string | null;
  readonly reviewIds: readonly string[];
  readonly confirmedByCustomer: true;
  readonly relationshipGrantsAuthorization: false;
  readonly registrationRequiredForQuote: false;
  readonly continueOriginalDemand: true;
  readonly idempotent?: boolean;
}

export interface RegistrationAbandonmentResult {
  readonly draftId: string | null;
  readonly status: 'abandoned' | 'declined';
  readonly incompleteRegistrationPersisted: false;
  readonly registrationRequiredForQuote: false;
  readonly continueOriginalDemand: true;
  readonly idempotent?: boolean;
}

export interface RegistrationDataReviewRecord {
  readonly id: string;
  readonly registrationId: string;
  readonly whatsappContactId: string | null;
  readonly serviceSessionId: string | null;
  readonly agentExecutionId: string | null;
  readonly field: string;
  readonly currentValue: unknown;
  readonly proposedValue: unknown;
  readonly source: 'whatsapp' | 'internal' | 'automation';
  readonly status: RegistrationDataReviewStatus;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistrationReviewDecisionResult {
  readonly reviewId: string;
  readonly registrationId: string;
  readonly status: 'approved' | 'rejected';
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly idempotent?: boolean;
}

export abstract class ConversationRegistrationRepository {
  abstract resolveIdentity(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }): Promise<ConversationIdentityResult>;

  abstract startDraft(
    input: ConversationRegistrationMutation & {
      readonly kind: ConversationRegistrationKind;
    },
  ): Promise<RegistrationDraftPublicState>;

  abstract updateDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string;
      readonly expectedDraftVersion: number;
      readonly patch: ConversationRegistrationPatch;
    },
  ): Promise<RegistrationDraftPublicState>;

  abstract readDraftState(
    input: RegistrationConversationSource & { readonly draftId: string },
  ): Promise<RegistrationDraftPublicState>;

  abstract previewDraft(
    input: RegistrationConversationSource & { readonly draftId: string },
  ): Promise<RegistrationDraftPreview>;

  abstract confirmDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string;
      readonly expectedDraftVersion: number;
      readonly customerConfirmedFinalSummary: true;
      readonly fieldDecisions: Readonly<
        Partial<Record<'name' | 'email' | 'phone', PersonalDivergenceDecision>>
      >;
    },
  ): Promise<RegistrationConfirmationResult>;

  abstract abandonDraft(
    input: ConversationRegistrationMutation & {
      readonly draftId: string | null;
      readonly expectedDraftVersion: number | null;
    },
  ): Promise<RegistrationAbandonmentResult>;

  abstract listDataReviews(input: {
    readonly companyId: string;
    readonly status?: RegistrationDataReviewStatus;
  }): Promise<readonly RegistrationDataReviewRecord[]>;

  abstract decideDataReview(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly reviewId: string;
    readonly decision: 'approved' | 'rejected';
    readonly reason: string | null;
  }): Promise<RegistrationReviewDecisionResult>;
}

/**
 * Pre-model identity boundary. Implementations must not return customer PII and
 * must treat a shared phone as ambiguous unless the current session confirms a
 * single registration.
 */
export abstract class ConversationIdentityResolver {
  abstract resolveBeforeResponse(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }): Promise<ConversationIdentityResult>;
}
