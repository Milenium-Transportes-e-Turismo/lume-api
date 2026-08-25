import { describe, expect, it } from 'vitest';

import { FuelCostService } from './fuel-cost.service';

describe('FuelCostService', () => {
  it('calcula litros e custo de forma determinística', () => {
    expect(new FuelCostService().calculate(100, 5, 6)).toEqual({
      consumptionKmPerLiter: 5,
      estimatedLiters: 20,
      pricePerLiter: 6,
      estimatedCost: 120,
      estimated: true,
    });
  });

  it('recusa consumo igual a zero', () => {
    expect(() => new FuelCostService().calculate(100, 0, 6)).toThrow(
      'O consumo do veículo deve ser maior que zero.',
    );
  });
});
