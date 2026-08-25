import type { Coordinates } from '../../domain/route-planner/route-planner.types';

export interface RoutingMatrixResult {
  readonly distancesKm: readonly (readonly (number | null)[])[];
  readonly durationsMinutes: readonly (readonly (number | null)[])[];
}

/** Fronteira para o endpoint /matrix do Valhalla, usada futuramente pelo OR-Tools. */
export abstract class RoutingMatrixProvider {
  abstract calculateMatrix(
    locations: readonly Coordinates[],
  ): Promise<RoutingMatrixResult>;
}
