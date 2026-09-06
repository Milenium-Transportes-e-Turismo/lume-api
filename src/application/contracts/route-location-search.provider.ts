export interface RouteLocationSuggestion {
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}
export abstract class RouteLocationSearchProvider {
  abstract searchLocations(
    query: string,
  ): Promise<readonly RouteLocationSuggestion[]>;
}
