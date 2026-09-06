import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { HeigitPeliasGeocodingProvider } from './heigit-pelias-geocoding.provider';

function config() {
  return new ConfigService({
    HEIGIT_BASE_URL: 'https://api.heigit.test',
    HEIGIT_API_KEY: 'test-key',
    ROUTING_TIMEOUT_MS: 1_000,
  });
}

describe('HeigitPeliasGeocodingProvider', () => {
  it('resolve endereço brasileiro pelo Pelias hospedado', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [-48.2772, -18.9186],
              },
              properties: {
                label: 'Uberlândia, Minas Gerais, Brasil',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new HeigitPeliasGeocodingProvider(config(), fetcher);

    const result = await provider.geocode('Uberlândia - MG');

    expect(result).toEqual({
      coordinates: { lat: -18.9186, lng: -48.2772 },
      label: 'Uberlândia, Minas Gerais, Brasil',
      address: 'Uberlândia, Minas Gerais, Brasil',
      source: 'pelias',
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain('/pelias/v1/search?');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'test-key',
    });
  });
});

describe('location autocomplete', () => {
  it('uses Brazilian autocomplete and keeps distinct valid points only', async () => {
    const feature = {
      properties: { gid: 'place:1', label: 'Uberlândia, MG, Brasil' },
      geometry: { type: 'Point', coordinates: [-48.27, -18.91] },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            feature,
            feature,
            {
              ...feature,
              geometry: { type: 'Point', coordinates: [200, 100] },
            },
            { geometry: { type: 'Point', coordinates: [null, null] } },
          ],
        }),
      ),
    );
    const results = await new HeigitPeliasGeocodingProvider(
      config(),
      fetcher,
    ).searchLocations('Uberlan');
    expect(results).toEqual([
      {
        id: 'place:1',
        label: 'Uberlândia, MG, Brasil',
        lat: -18.91,
        lng: -48.27,
      },
    ]);
    const rawUrl = fetcher.mock.calls[0]?.[0];
    if (typeof rawUrl !== 'string') throw new Error('Expected URL string');
    const url = new URL(rawUrl);
    expect(url.pathname).toBe('/pelias/v1/autocomplete');
    expect(url.searchParams.get('boundary.country')).toBe('BR');
    expect(url.searchParams.get('size')).toBe('6');
  });
  it('distinguishes no matches from malformed provider data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true })),
      );
    const provider = new HeigitPeliasGeocodingProvider(config(), fetcher);
    await expect(provider.searchLocations('xyzxyz')).resolves.toEqual([]);
    await expect(provider.searchLocations('Uberlan')).rejects.toMatchObject({
      code: 'ROUTING_UNAVAILABLE',
    });
  });
  it('reports provider unavailability without inventing suggestions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(
      new HeigitPeliasGeocodingProvider(config(), fetcher).searchLocations(
        'Uberlan',
      ),
    ).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
  });
});
