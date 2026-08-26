import type {
  CalculatedRouteLeg,
  ResolvedRouteLocation,
  RoutingVehicleConfiguration,
  TollCalculation,
  TollIntelligenceAssessment,
} from '../../domain/route-planner/route-planner.types';

export interface TollIntelligenceInput {
  readonly route: CalculatedRouteLeg;
  readonly origin: ResolvedRouteLocation;
  readonly destination: ResolvedRouteLocation;
  readonly vehicle: RoutingVehicleConfiguration;
  readonly travelDate: Date;
  readonly verified: TollCalculation;
}

/**
 * Researches gaps in toll coverage. Implementations must never publish or
 * overwrite official toll data and must label every non-deterministic result.
 */
export abstract class TollIntelligenceAgent {
  abstract assess(
    input: TollIntelligenceInput,
  ): Promise<TollIntelligenceAssessment>;
}
