export interface RouteLocationSuggestion {
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}
export abstract class RouteLocationSearchProvider {
  abstract reverseLocation(
    lat: number,
    lng: number,
  ): Promise<RouteLocationSuggestion>;
  abstract searchLocations(
    query: string,
  ): Promise<readonly RouteLocationSuggestion[]>;
}
