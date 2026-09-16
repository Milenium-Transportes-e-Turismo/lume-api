export interface RouteLocationSuggestion {
  readonly layer?: string;
  readonly name?: string;
  readonly region?: string;
  readonly regionCode?: string;
  readonly localityId?: string;
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
