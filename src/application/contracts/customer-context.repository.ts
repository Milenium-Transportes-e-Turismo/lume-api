import type {
  CustomerContextSummary,
  CustomerProfileKey,
} from '../../domain/customer-context/customer-context';

export {
  CUSTOMER_PROFILE_KEYS,
  type ApprovedCustomerProfileItem,
  type ConfirmedCustomerIdentityContext,
  type CustomerContextSummary,
  type CustomerPendingContext,
  type CustomerProfileKey,
  type RecentCustomerQuoteContext,
  type RecentCustomerServiceContext,
  type RelatedCompanyContext,
} from '../../domain/customer-context/customer-context';

export type CustomerProfileSuggestionStatus =
  'pending' | 'approved' | 'ignored';
export type CustomerContextAudience = 'agent' | 'human';
export type CustomerContextDetailSection =
  'relationships' | 'profile' | 'services' | 'quotes' | 'pending';

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
