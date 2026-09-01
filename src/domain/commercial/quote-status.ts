export const QUOTE_REQUEST_STATUSES = [
  'not-started',
  'collecting-information',
  'waiting-for-customer',
  'under-review',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export const ACTIVE_QUOTE_REQUEST_STATUSES = [
  'collecting-information',
  'waiting-for-customer',
  'under-review',
  'approved',
] as const satisfies readonly QuoteRequestStatus[];

export function isQuoteRequestStatus(
  value: string,
): value is QuoteRequestStatus {
  return QUOTE_REQUEST_STATUSES.includes(value as QuoteRequestStatus);
}
