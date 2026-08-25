import type {
  Coordinates,
  ResolvedRouteLocation,
} from '../../domain/route-planner/route-planner.types';

export abstract class GeocodingProvider {
  abstract geocode(address: string): Promise<ResolvedRouteLocation>;

  abstract reverseGeocode(
    coordinates: Coordinates,
  ): Promise<ResolvedRouteLocation>;
}
