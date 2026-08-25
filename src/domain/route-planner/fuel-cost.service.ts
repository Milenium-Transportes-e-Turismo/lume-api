import { AppError } from '../../core/errors/app-error';

export interface FuelEstimate {
  readonly consumptionKmPerLiter: number;
  readonly estimatedLiters: number;
  readonly pricePerLiter: number;
  readonly estimatedCost: number;
  readonly estimated: true;
}

function round(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export class FuelCostService {
  calculate(
    distanceKm: number,
    consumptionKmPerLiter: number,
    pricePerLiter: number,
  ): FuelEstimate {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new AppError(
        'INVALID_FUEL_CONSUMPTION',
        'A distância deve ser maior ou igual a zero.',
      );
    }
    if (!Number.isFinite(consumptionKmPerLiter) || consumptionKmPerLiter <= 0) {
      throw new AppError(
        'INVALID_FUEL_CONSUMPTION',
        'O consumo do veículo deve ser maior que zero.',
      );
    }
    if (!Number.isFinite(pricePerLiter) || pricePerLiter < 0) {
      throw new AppError(
        'INVALID_FUEL_CONSUMPTION',
        'O preço do combustível deve ser maior ou igual a zero.',
      );
    }

    const estimatedLiters = distanceKm / consumptionKmPerLiter;
    return {
      consumptionKmPerLiter,
      estimatedLiters: round(estimatedLiters, 3),
      pricePerLiter,
      estimatedCost: round(estimatedLiters * pricePerLiter, 2),
      estimated: true,
    };
  }
}
