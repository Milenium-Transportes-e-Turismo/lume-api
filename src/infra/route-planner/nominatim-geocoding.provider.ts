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

interface NominatimPlace {
  readonly lat?: string;
  readonly lon?: string;
  readonly display_name?: string;
}

@Injectable()
export class NominatimGeocodingProvider extends GeocodingProvider {
  private readonly logger = new Logger(NominatimGeocodingProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService,
    @Inject(ROUTE_PLANNER_FETCHER)
    private readonly fetcher: RoutePlannerFetcher,
  ) {
    super();
    this.baseUrl = config
      .getOrThrow<string>('NOMINATIM_URL')
      .replace(/\/+$/, '');
    this.timeoutMs = config.getOrThrow<number>('ROUTING_TIMEOUT_MS');
  }

  async geocode(address: string): Promise<ResolvedRouteLocation> {
    const startedAt = Date.now();
    this.logger.log({ event: 'geocoding.request', operation: 'search' });
    const query = new URLSearchParams({
      q: address,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'br',
    });
    const value = await this.request<NominatimPlace[]>(`/search?${query}`);
    const place = value[0];
    const lat = Number(place?.lat);
    const lng = Number(place?.lon);
    if (!place || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.logger.warn({
        event: 'geocoding.not_found',
        operation: 'search',
        durationMs: Date.now() - startedAt,
      });
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        'Não foi possível localizar o endereço informado.',
      );
    }
    return {
      coordinates: { lat, lng },
      label: place.display_name ?? address,
      address: place.display_name ?? address,
      source: 'nominatim',
    };
  }

  async reverseGeocode(
    coordinates: Coordinates,
  ): Promise<ResolvedRouteLocation> {
    this.logger.log({ event: 'geocoding.request', operation: 'reverse' });
    const query = new URLSearchParams({
      lat: String(coordinates.lat),
      lon: String(coordinates.lng),
      format: 'jsonv2',
      addressdetails: '1',
      layer: 'address',
    });
    const place = await this.request<NominatimPlace>(`/reverse?${query}`);
    if (!place.display_name) {
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        'Não foi possível localizar um endereço para as coordenadas informadas.',
      );
    }
    return {
      coordinates,
      label: place.display_name,
      address: place.display_name,
      source: 'nominatim',
    };
  }

  private async request<T>(path: string): Promise<T> {
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'User-Agent': 'Lume-Routing-Core/0.1',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({
        event: 'geocoding.error',
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O serviço interno de geocodificação está indisponível.',
        { provider: 'nominatim' },
      );
    }
  }
}
