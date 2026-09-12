import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GeocodingProvider } from '../../application/contracts/geocoding.provider';
import type {
  RouteLocationSearchProvider,
  RouteLocationSuggestion,
} from '../../application/contracts/route-location-search.provider';
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
    readonly gid?: string;
    readonly label?: string;
    readonly name?: string;
  };
}

interface PeliasResponse {
  readonly features?: readonly PeliasFeature[];
}

@Injectable()
export class HeigitPeliasGeocodingProvider
  extends GeocodingProvider
  implements RouteLocationSearchProvider
{
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
    if (/^\d{5}-?\d{3}$/.test(address.trim())) {
      const result = (
        await this.searchPostalCode(address.replace(/\D/g, ''))
      )[0];
      if (!result)
        throw new AppError('GEOCODING_NOT_FOUND', 'CEP não encontrado.');
      return {
        coordinates: { lat: result.lat, lng: result.lng },
        label: result.label,
        address: result.label,
        source: 'pelias',
      };
    }
    const query = new URLSearchParams({
      text: address,
      'boundary.country': 'BR',
      size: '1',
      lang: 'pt',
    });
    const value = await this.request(`/pelias/v1/search?${query}`, 'search');
    return this.resolveFeature(value.features?.[0], address);
  }

  async searchLocations(
    text: string,
  ): Promise<readonly RouteLocationSuggestion[]> {
    if (/^\d{5}-?\d{3}$/.test(text.trim()))
      return this.searchPostalCode(text.replace(/\D/g, ''));
    if (/^[\d-]+$/.test(text.trim())) return [];
    const query = new URLSearchParams({
      text,
      'boundary.country': 'BR',
      size: '6',
      lang: 'pt',
    });
    const value = await this.request(
      '/pelias/v1/autocomplete?' + query.toString(),
      'autocomplete',
    );
    if (!Array.isArray(value.features)) {
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O serviço de busca retornou uma resposta inválida.',
      );
    }
    const items: RouteLocationSuggestion[] = [];
    const seen = new Set<string>();
    const features: readonly PeliasFeature[] = value.features;
    for (const feature of features) {
      if (!feature) continue;
      const coordinates = feature.geometry?.coordinates;
      const lng = coordinates?.[0];
      const lat = coordinates?.[1];
      const label = feature.properties?.label ?? feature.properties?.name;
      if (
        feature.geometry?.type !== 'Point' ||
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        typeof label !== 'string' ||
        !label.trim()
      )
        continue;
      const key = lat + ',' + lng + ':' + label;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id:
          typeof feature.properties?.gid === 'string'
            ? feature.properties.gid
            : key,
        label,
        lat,
        lng,
      });
      if (items.length === 6) break;
    }
    return items;
  }

  async reverseLocation(
    lat: number,
    lng: number,
  ): Promise<RouteLocationSuggestion> {
    const location = await this.reverseGeocode({ lat, lng });
    return { id: 'point:' + lat + ',' + lng, label: location.label, lat, lng };
  }

  private async searchPostalCode(
    cep: string,
  ): Promise<readonly RouteLocationSuggestion[]> {
    let data: Record<string, unknown>;
    try {
      const response = await this.fetcher(
        'https://viacep.com.br/ws/' + cep + '/json/',
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) throw new Error('Postal service unavailable');
      data = (await response.json()) as Record<string, unknown>;
      if (!data || typeof data !== 'object')
        throw new Error('Invalid postal response');
    } catch {
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'Não foi possível consultar o CEP. Tente novamente.',
      );
    }
    if (data.erro === true || data.erro === 'true') return [];
    if (typeof data.localidade !== 'string' || typeof data.uf !== 'string') {
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'A consulta de CEP retornou um endereço inválido.',
      );
    }
    const address = [data.logradouro, data.bairro, data.localidade, data.uf]
      .filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      )
      .join(', ');
    const location = await this.geocode(address + ', Brasil');
    return [
      {
        id: 'cep:' + cep,
        label: address + ' · CEP ' + cep.slice(0, 5) + '-' + cep.slice(5),
        lat: location.coordinates.lat,
        lng: location.coordinates.lng,
      },
    ];
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
    const lng = rawCoordinates?.[0];
    const lat = rawCoordinates?.[1];
    if (
      feature?.geometry?.type !== 'Point' ||
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        expectedCoordinates
          ? 'Não foi possível localizar um endereço para as coordenadas informadas.'
          : 'Não foi possível localizar o endereço informado.',
      );
    }
    const label =
      feature.properties?.label?.trim() ||
      feature.properties?.name?.trim() ||
      fallbackAddress?.trim();
    if (!label)
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        'Não foi possível identificar o nome desse local. Pesquise um endereço ou selecione outro ponto.',
      );
    return {
      coordinates: expectedCoordinates ?? { lat, lng },
      label,
      address: label,
      source: 'pelias',
    };
  }

  private async request(
    path: string,
    operation: 'search' | 'reverse' | 'autocomplete',
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
        causeCode:
          error instanceof Error &&
          error.cause &&
          typeof error.cause === 'object' &&
          'code' in error.cause &&
          typeof error.cause.code === 'string'
            ? error.cause.code
            : undefined,
      });
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        'O serviço de geocodificação está indisponível.',
        { provider: 'heigit-pelias' },
      );
    }
  }
}
