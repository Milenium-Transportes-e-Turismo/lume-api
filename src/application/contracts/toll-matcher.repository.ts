import type {
  CalculatedRouteLeg,
  RoutingVehicleConfiguration,
  TollCalculation,
} from '../../domain/route-planner/route-planner.types';

export interface TollMatcherInput {
  readonly route: CalculatedRouteLeg;
  readonly vehicle: RoutingVehicleConfiguration;
  readonly travelDate: Date;
}

export abstract class TollMatcherRepository {
  abstract match(input: TollMatcherInput): Promise<TollCalculation>;
}
