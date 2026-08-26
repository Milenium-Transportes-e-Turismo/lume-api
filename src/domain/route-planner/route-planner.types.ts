export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}

export interface GeoJsonLineString {
  readonly type: 'LineString';
  readonly coordinates: readonly (readonly [number, number])[];
}

export interface RouteLocationInput {
  readonly address?: string;
  readonly lat?: number;
  readonly lng?: number;
}

export interface ResolvedRouteLocation {
  readonly coordinates: Coordinates;
  readonly label: string;
  readonly address: string | null;
  readonly source: 'coordinates' | 'pelias' | 'nominatim';
}

export const ROUTING_VEHICLE_TYPES = [
  'car',
  'van',
  'minibus',
  'bus',
  'truck',
] as const;

export type RoutingVehicleType = (typeof ROUTING_VEHICLE_TYPES)[number];

export interface RoutingVehicleConfiguration {
  readonly id?: string | null;
  readonly type: RoutingVehicleType;
  readonly axles: number;
  readonly fuelType: string;
  readonly consumptionKmPerLiter: number;
}

export interface RouteSegment {
  readonly sequence: number;
  readonly instruction: string;
  readonly distanceKm: number;
  readonly durationMinutes: number;
  readonly roadName: string | null;
}

export interface CalculatedRouteLeg {
  readonly direction: 'outbound' | 'return';
  readonly distanceKm: number;
  readonly durationMinutes: number;
  readonly geometry: GeoJsonLineString;
  readonly encodedPolylines: readonly string[];
  readonly segments: readonly RouteSegment[];
  readonly engine: string;
  readonly engineVersion: string | null;
  readonly mapDataVersion: string | null;
}

export interface TollCalculationItem {
  readonly tollPointId: string;
  readonly sequence: number;
  readonly name: string;
  readonly type: 'physical-plaza' | 'free-flow';
  readonly road: string;
  readonly kilometer: number | null;
  readonly state: string;
  readonly direction: string;
  readonly concessionaire: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly tariffStatus: 'found' | 'missing';
  readonly price: number | null;
  readonly tariffValidFrom: string | null;
  readonly tariffValidUntil: string | null;
  readonly source: string;
}

export interface TollCalculation {
  readonly count: number;
  readonly total: number;
  readonly complete: boolean;
  readonly dataStatus: 'available' | 'unavailable';
  readonly dataVersion: string | null;
  readonly items: readonly TollCalculationItem[];
  readonly matcherStrategy: string;
}

export interface TollIntelligenceSource {
  readonly title: string;
  readonly url: string;
  readonly effectiveDate: string | null;
}

export type TollIntelligenceStatus =
  'not-required' | 'disabled' | 'estimated' | 'unavailable';

export interface TollIntelligenceAssessment {
  readonly status: TollIntelligenceStatus;
  readonly estimatedCount: number | null;
  readonly estimatedTotalMin: number | null;
  readonly estimatedTotalLikely: number | null;
  readonly estimatedTotalMax: number | null;
  readonly confidence: number | null;
  readonly sources: readonly TollIntelligenceSource[];
  readonly assumptions: readonly string[];
  readonly explanation: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly researchedAt: string | null;
}
