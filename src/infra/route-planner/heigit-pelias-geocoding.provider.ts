import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GeocodingProvider } from '../../application/contracts/geocoding.provider';
import { AppError } from '../../core/errors/app-error';
import type {
  Coordinates,
  ResolvedRouteLocation,
} from '../../domain/route-planner/route-planner.types';
import {
  ROUTE_PLANNER_FETCHER,
  type RoutePlannerFetcher,
} from './route-planner.tokens';

interface PeliasFeature {
  readonly geometry?: {
    readonly type?: string;
    readonly coordinates?: readonly [number, number];
  };
  readonly properties?: {
    readonly label?: string;
    readonly name?: string;
  };
}

interface PeliasResponse {
  readonly features?: readonly PeliasFeature[];
}

@Injectable()
export class HeigitPeliasGeocodingProvider extends GeocodingProvider {
  private readonly logger = new Logger(HeigitPeliasGeocodingProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

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
  }

  async geocode(address: string): Promise<ResolvedRouteLocation> {
    const query = new URLSearchParams({
      text: address,
      'boundary.country': 'BR',
      size: '1',
      lang: 'pt',
    });
    const value = await this.request(`/pelias/v1/search?${query}`, 'search');
    return this.resolveFeature(value.features?.[0], address);
  }

  async reverseGeocode(
    coordinates: Coordinates,
  ): Promise<ResolvedRouteLocation> {
    const query = new URLSearchParams({
      'point.lat': String(coordinates.lat),
      'point.lon': String(coordinates.lng),
      size: '1',
      lang: 'pt',
    });
    const value = await this.request(`/pelias/v1/reverse?${query}`, 'reverse');
    return this.resolveFeature(value.features?.[0], null, coordinates);
  }

  private resolveFeature(
    feature: PeliasFeature | undefined,
    fallbackAddress: string | null,
    expectedCoordinates?: Coordinates,
  ): ResolvedRouteLocation {
    const rawCoordinates = feature?.geometry?.coordinates;
    const lng = Number(rawCoordinates?.[0]);
    const lat = Number(rawCoordinates?.[1]);
    if (
      feature?.geometry?.type !== 'Point' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        expectedCoordinates
          ? 'Não foi possível localizar um endereço para as coordenadas informadas.'
          : 'Não foi possível localizar o endereço informado.',
      );
    }
    const label =
      feature.properties?.label ??
      feature.properties?.name ??
      fallbackAddress ??
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    return {
      coordinates: expectedCoordinates ?? { lat, lng },
      label,
      address: label,
      source: 'pelias',
    };
  }

  private async request(
    path: string,
    operation: 'search' | 'reverse',
  ): Promise<PeliasResponse> {
    const startedAt = Date.now();
    this.logger.log({ event: 'geocoding.request', operation });
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: {
          Accept: 'application/geo+json, application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          Authorization: this.apiKey,
          'User-Agent': 'Lume-Routing-Core/0.2',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HeiGIT Pelias HTTP ${response.status}`);
      }
      return (await response.json()) as PeliasResponse;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({
        event: 'geocoding.error',
        provider: 'heigit-pelias',
        operation,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O serviço de geocodificação está indisponível.',
        { provider: 'heigit-pelias' },
      );
    }
  }
}
