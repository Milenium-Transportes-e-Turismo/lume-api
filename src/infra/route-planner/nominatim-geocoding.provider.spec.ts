import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { NominatimGeocodingProvider } from './nominatim-geocoding.provider';
import { ROUTE_PLANNER_FETCHER } from './route-planner.tokens';

function config() {
  return new ConfigService({
    NOMINATIM_URL: 'http://nominatim.test',
    ROUTING_TIMEOUT_MS: 1_000,
  });
}

describe('NominatimGeocodingProvider', () => {
  it('resolve o cliente HTTP pelo container de injeção do Nest', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config() },
        { provide: ROUTE_PLANNER_FETCHER, useValue: fetcher },
        NominatimGeocodingProvider,
      ],
    }).compile();

    expect(moduleRef.get(NominatimGeocodingProvider)).toBeInstanceOf(
      NominatimGeocodingProvider,
    );

    await moduleRef.close();
  });

  it('encapsula a busca de endereço sem expor o provider ao consumidor', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            lat: '-18.9186',
            lon: '-48.2772',
            display_name: 'Uberlândia, Minas Gerais, Brasil',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new NominatimGeocodingProvider(config(), fetcher);

    const result = await provider.geocode('Uberlândia - MG');

    expect(result.coordinates).toEqual({ lat: -18.9186, lng: -48.2772 });
    expect(result.source).toBe('nominatim');
    expect(fetcher).toHaveBeenCalledOnce();
    const requestedUrl = fetcher.mock.calls[0]?.[0];
    expect(typeof requestedUrl).toBe('string');
    expect(requestedUrl).toContain('/search?');
  });
});
