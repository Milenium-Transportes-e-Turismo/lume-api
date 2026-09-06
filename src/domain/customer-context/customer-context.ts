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
  readonly registrationInstructions?: {
    readonly registrationId: string;
    readonly version: number;
    readonly content: string;
  } | null;
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
