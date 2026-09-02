export const CUSTOMER_PROFILE_KEYS = [
  'proposal-delivery-preference',
  'preferred-contact-channel',
  'accessibility-need',
  'language',
  'service-preference',
  'communication-style',
  'travel-preference',
  'billing-preference',
  'other-confirmed-preference',
] as const;

export type CustomerProfileKey = (typeof CUSTOMER_PROFILE_KEYS)[number];
export type CustomerProfileSuggestionStatus =
  'pending' | 'approved' | 'ignored';
export type CustomerContextAudience = 'agent' | 'human';
export type CustomerContextDetailSection =
  'relationships' | 'profile' | 'services' | 'quotes' | 'pending';

export interface ConfirmedCustomerIdentityContext {
  readonly registrationId: string;
  readonly kind: 'personal' | 'company';
  readonly displayName: string;
  readonly confirmedAt: string;
}

export interface RelatedCompanyContext {
  readonly registrationId: string;
  readonly displayName: string;
  readonly relationshipType: string;
  readonly jobTitle: string | null;
  readonly department: string | null;
}

export interface ApprovedCustomerProfileItem {
  readonly suggestionId: string;
  readonly key: CustomerProfileKey;
  readonly value: string;
  readonly approvedAt: string;
}

export interface RecentCustomerServiceContext {
  readonly serviceSessionId: string;
  readonly status: string;
  readonly controlMode: string;
  readonly departmentId: string | null;
  readonly priority: string;
  readonly pendingActionCount: number;
  readonly updatedAt: string;
}

export interface RecentCustomerQuoteContext {
  readonly quoteRequestId: string;
  readonly status: string;
  readonly serviceType: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly departureDate: string | null;
  readonly updatedAt: string;
}

export interface CustomerPendingContext {
  readonly kind: 'service' | 'quote' | 'case';
  readonly id: string;
  readonly status: string;
  readonly updatedAt: string;
}

export interface CustomerContextSummary {
  readonly serviceSessionId: string;
  readonly whatsappContactId: string;
  readonly identity: ConfirmedCustomerIdentityContext | null;
  readonly relatedCompanies: readonly RelatedCompanyContext[];
  readonly approvedProfile: readonly ApprovedCustomerProfileItem[];
  readonly recentServices: readonly RecentCustomerServiceContext[];
  readonly recentQuotes: readonly RecentCustomerQuoteContext[];
  readonly pending: readonly CustomerPendingContext[];
  readonly limits: {
    readonly relatedCompanies: number;
    readonly approvedProfile: number;
    readonly recentServices: number;
    readonly recentQuotes: number;
    readonly pending: number;
  };
}

export interface CustomerContextDetailPage {
  readonly section: CustomerContextDetailSection;
  readonly items: readonly unknown[];
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface CustomerProfileSuggestionRecord {
  readonly id: string;
  readonly whatsappContactId: string;
  readonly registrationId: string | null;
  readonly serviceSessionId: string | null;
  readonly agentExecutionId: string | null;
  readonly profileKey: CustomerProfileKey;
  readonly suggestedValue: string;
  readonly rationale: string | null;
  readonly origin: unknown;
  readonly status: CustomerProfileSuggestionStatus;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerProfileSuggestionCreationResult {
  readonly suggestionId: string;
  readonly status: 'pending';
  readonly createdAt: string;
  readonly idempotent?: boolean;
  readonly deduplicated?: boolean;
}

export interface CustomerProfileSuggestionDecisionResult {
  readonly suggestionId: string;
  readonly status: 'approved' | 'ignored';
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly idempotent?: boolean;
}

export interface CreateCustomerProfileSuggestionInput {
  readonly companyId: string;
  readonly serviceSessionId: string;
  readonly commandId: string;
  readonly actor:
    | {
        readonly type: 'agent';
        readonly agentExecutionId: string;
        readonly serviceIdentityId: string;
      }
    | {
        /** Trusted in-process agent runtime; never accepted by an HTTP DTO. */
        readonly type: 'agent-runtime';
        readonly agentExecutionId: string;
      }
    | { readonly type: 'human'; readonly userId: string };
  readonly profileKey: CustomerProfileKey;
  readonly suggestedValue: string;
  readonly rationale: string | null;
  readonly evidenceMessageId: string | null;
}

export abstract class CustomerContextRepository {
  abstract loadSummary(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: CustomerContextAudience;
  }): Promise<CustomerContextSummary>;

  abstract loadDetails(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
    readonly audience: CustomerContextAudience;
    readonly section: CustomerContextDetailSection;
    readonly limit: number;
  }): Promise<CustomerContextDetailPage>;

  abstract createSuggestion(
    input: CreateCustomerProfileSuggestionInput,
  ): Promise<CustomerProfileSuggestionCreationResult>;

  abstract listSuggestions(input: {
    readonly companyId: string;
    readonly status?: CustomerProfileSuggestionStatus;
    readonly serviceSessionId?: string;
    readonly limit: number;
  }): Promise<readonly CustomerProfileSuggestionRecord[]>;

  abstract decideSuggestion(input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly commandId: string;
    readonly suggestionId: string;
    readonly expectedUpdatedAt: Date;
    readonly decision: 'approved' | 'ignored';
    readonly reason: string | null;
  }): Promise<CustomerProfileSuggestionDecisionResult>;
}

export interface ResolvedAgentCustomerContext {
  readonly modelContext: string;
  readonly modelContextSha256: string;
  readonly approvedProfileItemCount: number;
  readonly byteLength: number;
}

/** Provides a bounded, approved-only, non-secret context before model access. */
export abstract class CustomerContextResolver {
  abstract resolveForAgent(input: {
    readonly companyId: string;
    readonly serviceSessionId: string;
  }): Promise<ResolvedAgentCustomerContext>;
}
