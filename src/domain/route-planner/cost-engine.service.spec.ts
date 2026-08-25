import { describe, expect, it } from 'vitest';

import { CostEngineService } from './cost-engine.service';

describe('CostEngineService', () => {
  it('agrega combustível e pedágios sem ocultar incompletude tarifária', () => {
    expect(
      new CostEngineService().calculate({
        fuelCost: 120,
        tollCost: 28.5,
        tollDataComplete: false,
      }),
    ).toMatchObject({
      fuel: 120,
      tolls: 28.5,
      total: 148.5,
      estimated: true,
      complete: false,
    });
  });
});
