import type {
  CalculatedRouteLeg,
  Coordinates,
  RoutingVehicleConfiguration,
} from '../../domain/route-planner/route-planner.types';

export interface RoutingProviderRequest {
  readonly direction: 'outbound' | 'return';
  readonly locations: readonly Coordinates[];
  readonly vehicle: RoutingVehicleConfiguration;
  readonly travelDate: Date;
}

export abstract class RoutingProvider {
  abstract calculateRoute(
    request: RoutingProviderRequest,
  ): Promise<CalculatedRouteLeg>;
}
