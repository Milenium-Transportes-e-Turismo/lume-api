import { validationError } from '../../core/errors/app-error';

import type { QuoteRequestStatus } from './quote-status';

export const COMMERCIAL_CLOSURE_CLASSIFICATIONS = [
  'opportunity-abandoned',
  'quote-rejected',
  'acceptance-cancelled',
  'superseded',
  'legacy-unclassified',
] as const;

export const MANUAL_QUOTE_CANCELLATION_CLASSIFICATIONS = [
  'opportunity-abandoned',
  'acceptance-cancelled',
] as const;

export type CommercialClosureClassification =
  (typeof COMMERCIAL_CLOSURE_CLASSIFICATIONS)[number];
export type ManualQuoteCancellationClassification =
  (typeof MANUAL_QUOTE_CANCELLATION_CLASSIFICATIONS)[number];

export function normalizeManualQuoteCancellation(input: {
  classification?: ManualQuoteCancellationClassification | null;
  reason?: string | null;
}): {
  classification: ManualQuoteCancellationClassification;
  reason: string;
} {
  if (
    !input.classification ||
    !MANUAL_QUOTE_CANCELLATION_CLASSIFICATIONS.includes(input.classification)
  ) {
    throw validationError(
      'Classifique o encerramento como oportunidade abandonada ou aceite cancelado.',
    );
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3 || reason.length > 500) {
    throw validationError(
      'Informe um breve motivo, entre 3 e 500 caracteres, para encerrar o orçamento.',
    );
  }
  return { classification: input.classification, reason };
}

export function assertManualQuoteCancellationTransition(
  currentStatus: QuoteRequestStatus,
  classification: ManualQuoteCancellationClassification,
): void {
  if (
    classification === 'acceptance-cancelled' &&
    currentStatus !== 'approved'
  ) {
    throw validationError(
      'Aceite cancelado só pode ser usado depois da aprovação e antes da confirmação operacional ou do pagamento.',
    );
  }
  if (
    classification === 'opportunity-abandoned' &&
    currentStatus === 'approved'
  ) {
    throw validationError(
      'Um orçamento já aprovado deve ser encerrado como aceite cancelado.',
    );
  }
}
