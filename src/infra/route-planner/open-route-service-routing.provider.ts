import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  RoutingProvider,
  type RoutingProviderRequest,
} from '../../application/contracts/routing.provider';
import { AppError } from '../../core/errors/app-error';
import type {
  CalculatedRouteLeg,
  RouteSegment,
} from '../../domain/route-planner/route-planner.types';
import {
  ROUTE_PLANNER_FETCHER,
  type RoutePlannerFetcher,
} from './route-planner.tokens';

interface OrsStep {
  readonly distance?: number;
  readonly duration?: number;
  readonly instruction?: string;
  readonly name?: string;
}

interface OrsSegment {
  readonly steps?: readonly OrsStep[];
}

interface OrsFeature {
  readonly geometry?: {
    readonly type?: string;
    readonly coordinates?: readonly (readonly [number, number])[];
  };
  readonly properties?: {
    readonly summary?: {
      readonly distance?: number;
      readonly duration?: number;
    };
    readonly segments?: readonly OrsSegment[];
  };
}

interface OrsGeoJsonResponse {
  readonly features?: readonly OrsFeature[];
  readonly metadata?: {
    readonly engine?: { readonly version?: string };
  };
}

function routingProfile(
  type: RoutingProviderRequest['vehicle']['type'],
): 'driving-car' | 'driving-hgv' {
  return ['minibus', 'bus', 'truck'].includes(type)
    ? 'driving-hgv'
    : 'driving-car';
}

function hgvVehicleType(
  type: RoutingProviderRequest['vehicle']['type'],
): 'bus' | 'hgv' {
  return type === 'truck' ? 'hgv' : 'bus';
}

@Injectable()
export class OpenRouteServiceRoutingProvider extends RoutingProvider {
  private readonly logger = new Logger(OpenRouteServiceRoutingProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly configuredVersion: string | null;
  private readonly mapDataVersion: string | null;

  constructor(
    config: ConfigService,
    @Inject(ROUTE_PLANNER_FETCHER)
    private readonly fetcher: RoutePlannerFetcher,
  ) {
    super();
    this.baseUrl = config
      .getOrThrow<string>('HEIGIT_BASE_URL')
      .replace(/\/+$/, '');
    this.apiKey = config.getOrThrow<string>('HEIGIT_API_KEY');
    this.timeoutMs = config.getOrThrow<number>('ROUTING_TIMEOUT_MS');
    this.configuredVersion = config.get<string>('ORS_VERSION') || null;
    this.mapDataVersion = config.get<string>('ORS_MAP_DATA_VERSION') || null;
  }

  async calculateRoute(
    request: RoutingProviderRequest,
  ): Promise<CalculatedRouteLeg> {
    const startedAt = Date.now();
    const profile = routingProfile(request.vehicle.type);
    try {
      const response = await this.fetcher(
        `${this.baseUrl}/openrouteservice/v2/directions/${profile}/geojson`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/geo+json',
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            coordinates: request.locations.map((location) => [
              location.lng,
              location.lat,
            ]),
            instructions: true,
            instructions_format: 'text',
            language: 'pt',
            preference: 'recommended',
            units: 'm',
            ...(profile === 'driving-hgv'
              ? {
                  options: {
                    vehicle_type: hgvVehicleType(request.vehicle.type),
                  },
                }
              : {}),
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) {
        throw new Error(`OpenRouteService HTTP ${response.status}`);
      }
      const value = (await response.json()) as OrsGeoJsonResponse;
      const feature = value.features?.[0];
      const summary = feature?.properties?.summary;
      const coordinates = feature?.geometry?.coordinates;
      if (
        feature?.geometry?.type !== 'LineString' ||
        !coordinates ||
        coordinates.length < 2 ||
        !summary ||
        !Number.isFinite(summary.distance) ||
        !Number.isFinite(summary.duration)
      ) {
        throw new AppError(
          'ROUTE_NOT_FOUND',
          'Não foi encontrada uma rota para os locais informados.',
        );
      }
      let sequence = 0;
      const segments: RouteSegment[] = (
        feature.properties?.segments ?? []
      ).flatMap((segment) =>
        (segment.steps ?? []).map((step) => ({
          sequence: ++sequence,
          instruction: step.instruction ?? 'Siga pela rota indicada.',
          distanceKm:
            Math.round((Number(step.distance ?? 0) / 1000) * 1000) / 1000,
          durationMinutes:
            Math.round((Number(step.duration ?? 0) / 60) * 10) / 10,
          roadName: step.name?.trim() || null,
        })),
      );
      this.logger.log({
        event: 'routing.provider.success',
        provider: 'openrouteservice',
        profile,
        direction: request.direction,
        durationMs: Date.now() - startedAt,
      });
      return {
        direction: request.direction,
        distanceKm: Math.round((Number(summary.distance) / 1000) * 1000) / 1000,
        durationMinutes: Math.round((Number(summary.duration) / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates },
        encodedPolylines: [],
        segments,
        engine: 'openrouteservice',
        engineVersion:
          value.metadata?.engine?.version ?? this.configuredVersion,
        mapDataVersion: this.mapDataVersion,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({
        event: 'routing.provider.error',
        provider: 'openrouteservice',
        profile,
        direction: request.direction,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O serviço de roteirização está indisponível.',
        { provider: 'openrouteservice' },
      );
    }
  }
}
