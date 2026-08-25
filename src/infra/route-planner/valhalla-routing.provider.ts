import { Injectable, Logger } from '@nestjs/common';
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
import { decodePolyline6 } from './polyline6';

type Fetcher = typeof fetch;

interface ValhallaManeuver {
  readonly instruction?: string;
  readonly length?: number;
  readonly time?: number;
  readonly street_names?: readonly string[];
}

interface ValhallaLeg {
  readonly shape?: string;
  readonly maneuvers?: readonly ValhallaManeuver[];
}

interface ValhallaResponse {
  readonly trip?: {
    readonly status?: number;
    readonly status_message?: string;
    readonly summary?: { readonly length?: number; readonly time?: number };
    readonly legs?: readonly ValhallaLeg[];
  };
}

function costing(
  type: RoutingProviderRequest['vehicle']['type'],
): 'auto' | 'truck' {
  return type === 'truck' ? 'truck' : 'auto';
}

@Injectable()
export class ValhallaRoutingProvider extends RoutingProvider {
  private readonly logger = new Logger(ValhallaRoutingProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly engineVersion: string | null;
  private readonly mapDataVersion: string | null;

  constructor(
    config: ConfigService,
    private readonly fetcher: Fetcher = fetch,
  ) {
    super();
    this.baseUrl = config
      .getOrThrow<string>('VALHALLA_URL')
      .replace(/\/+$/, '');
    this.timeoutMs = config.getOrThrow<number>('ROUTING_TIMEOUT_MS');
    this.engineVersion = config.get<string>('VALHALLA_VERSION') || null;
    this.mapDataVersion =
      config.get<string>('VALHALLA_MAP_DATA_VERSION') || null;
  }

  async calculateRoute(
    request: RoutingProviderRequest,
  ): Promise<CalculatedRouteLeg> {
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locations: request.locations.map((location) => ({
            lat: location.lat,
            lon: location.lng,
            type: 'break',
          })),
          costing: costing(request.vehicle.type),
          units: 'kilometers',
          shape_format: 'polyline6',
          directions_options: { language: 'pt-BR', units: 'kilometers' },
          date_time: {
            type: 3,
            value: `${request.travelDate.toISOString().slice(0, 10)}T12:00`,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Valhalla HTTP ${response.status}: ${body.slice(0, 160)}`,
        );
      }
      const value = (await response.json()) as ValhallaResponse;
      const summary = value.trip?.summary;
      const legs = value.trip?.legs ?? [];
      if (
        value.trip?.status !== 0 ||
        !summary ||
        !Number.isFinite(summary.length) ||
        !Number.isFinite(summary.time) ||
        legs.length === 0
      ) {
        throw new AppError(
          'ROUTE_NOT_FOUND',
          value.trip?.status_message ||
            'Não foi encontrada uma rota para os locais informados.',
        );
      }
      const encodedPolylines = legs.flatMap((leg) =>
        leg.shape ? [leg.shape] : [],
      );
      if (encodedPolylines.length !== legs.length) {
        throw new Error('Valhalla retornou uma rota sem geometria.');
      }
      const coordinates = encodedPolylines.flatMap((shape, index) => {
        const decoded = [...decodePolyline6(shape).coordinates];
        return index === 0 ? decoded : decoded.slice(1);
      });
      let sequence = 0;
      const segments: RouteSegment[] = legs.flatMap((leg) =>
        (leg.maneuvers ?? []).map((maneuver) => ({
          sequence: ++sequence,
          instruction: maneuver.instruction ?? 'Siga pela rota indicada.',
          distanceKm: Number(maneuver.length ?? 0),
          durationMinutes:
            Math.round((Number(maneuver.time ?? 0) / 60) * 10) / 10,
          roadName: maneuver.street_names?.[0] ?? null,
        })),
      );
      this.logger.log({
        event: 'routing.provider.success',
        provider: 'valhalla',
        direction: request.direction,
        durationMs: Date.now() - startedAt,
      });
      return {
        direction: request.direction,
        distanceKm: Math.round(Number(summary.length) * 1000) / 1000,
        durationMinutes: Math.round((Number(summary.time) / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates },
        encodedPolylines,
        segments,
        engine: 'valhalla',
        engineVersion: this.engineVersion,
        mapDataVersion: this.mapDataVersion,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({
        event: 'routing.provider.error',
        provider: 'valhalla',
        direction: request.direction,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O motor interno de roteirização está indisponível.',
        { provider: 'valhalla' },
      );
    }
  }
}
