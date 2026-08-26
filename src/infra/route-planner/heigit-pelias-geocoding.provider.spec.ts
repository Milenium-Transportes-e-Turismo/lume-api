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
