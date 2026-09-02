import { describe, expect, it } from 'vitest';

import {
  ACTIVE_QUOTE_REQUEST_STATUSES,
  isQuoteRequestStatus,
} from './quote-status';

describe('quote request status', () => {
  it('reconhece somente estados comerciais publicados', () => {
    expect(isQuoteRequestStatus('under-review')).toBe(true);
    expect(isQuoteRequestStatus('human-active')).toBe(false);
  });

  it('mantém estados ativos separados de recusa e cancelamento', () => {
    expect(ACTIVE_QUOTE_REQUEST_STATUSES).toEqual([
      'collecting-information',
      'waiting-for-customer',
      'under-review',
      'approved',
    ]);
  });
});
