export interface CostLineItem {
  readonly code: string;
  readonly label: string;
  readonly amount: number;
  readonly estimated: boolean;
}

export interface RouteCostEstimate {
  readonly fuel: number;
  readonly tolls: number;
  readonly total: number;
  readonly estimated: true;
  readonly complete: boolean;
  readonly items: readonly CostLineItem[];
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class CostEngineService {
  calculate(input: {
    fuelCost: number;
    tollCost: number;
    tollDataComplete: boolean;
    additionalItems?: readonly CostLineItem[];
  }): RouteCostEstimate {
    const items: CostLineItem[] = [
      {
        code: 'fuel',
        label: 'Combustível',
        amount: money(input.fuelCost),
        estimated: true,
      },
      {
        code: 'tolls',
        label: 'Pedágios',
        amount: money(input.tollCost),
        estimated: false,
      },
      ...(input.additionalItems ?? []),
    ];
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return {
      fuel: money(input.fuelCost),
      tolls: money(input.tollCost),
      total: money(total),
      estimated: true,
      complete: input.tollDataComplete,
      items,
    };
  }
}
