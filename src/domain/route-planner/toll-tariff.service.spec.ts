import { describe, expect, it } from 'vitest';

import { TollTariffService } from './toll-tariff.service';

describe('TollTariffService', () => {
  it('seleciona a tarifa vigente na data histórica informada', () => {
    const service = new TollTariffService();
    const selected = service.select(
      [
        {
          id: 'old',
          axles: 3,
          price: 28.5,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-09-30T23:59:59.999Z'),
        },
        {
          id: 'current',
          axles: 3,
          price: 30.2,
          validFrom: new Date('2026-10-01T00:00:00.000Z'),
          validUntil: null,
        },
      ],
      new Date('2026-08-18T12:00:00.000Z'),
      3,
    );

    expect(selected?.id).toBe('old');
    expect(selected?.price).toBe(28.5);
  });
});
