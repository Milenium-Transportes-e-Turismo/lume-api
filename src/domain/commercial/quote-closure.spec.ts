import { describe, expect, it } from 'vitest';

import {
  assertManualQuoteCancellationTransition,
  normalizeManualQuoteCancellation,
} from './quote-closure';

describe('encerramento comercial', () => {
  it('exige classificação explícita e motivo em novos cancelamentos', () => {
    expect(() =>
      normalizeManualQuoteCancellation({ reason: 'Cliente desistiu.' }),
    ).toThrow('Classifique o encerramento');
    expect(() =>
      normalizeManualQuoteCancellation({
        classification: 'opportunity-abandoned',
        reason: '  ',
      }),
    ).toThrow('entre 3 e 500 caracteres');
  });

  it('normaliza uma oportunidade abandonada sem inferir sua etapa', () => {
    expect(
      normalizeManualQuoteCancellation({
        classification: 'opportunity-abandoned',
        reason: '  Cliente não seguirá com a cotação.  ',
      }),
    ).toEqual({
      classification: 'opportunity-abandoned',
      reason: 'Cliente não seguirá com a cotação.',
    });
  });

  it('reserva aceite cancelado para um orçamento já aprovado', () => {
    expect(() =>
      assertManualQuoteCancellationTransition(
        'waiting-for-customer',
        'acceptance-cancelled',
      ),
    ).toThrow('depois da aprovação');
    expect(() =>
      assertManualQuoteCancellationTransition(
        'approved',
        'opportunity-abandoned',
      ),
    ).toThrow('aceite cancelado');
    expect(() =>
      assertManualQuoteCancellationTransition(
        'approved',
        'acceptance-cancelled',
      ),
    ).not.toThrow();
  });
});
