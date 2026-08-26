import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { OpenRouteServiceRoutingProvider } from './open-route-service-routing.provider';

function config() {
  return new ConfigService({
    HEIGIT_BASE_URL: 'https://api.heigit.test',
    HEIGIT_API_KEY: 'test-key',
    ROUTING_TIMEOUT_MS: 1_000,
    ORS_VERSION: '',
    ORS_MAP_DATA_VERSION: 'osm-fixture',
  });
}

describe('OpenRouteServiceRoutingProvider', () => {
  it('converte GeoJSON do ORS e usa o perfil de ônibus', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          metadata: { engine: { version: '9.9.0' } },
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-48.2772, -18.9186],
                  [-43.9345, -19.9167],
                ],
              },
              properties: {
                summary: { distance: 540_250, duration: 25_200 },
                segments: [
                  {
                    steps: [
                      {
                        distance: 540_250,
                        duration: 25_200,
                        instruction: 'Siga pela BR-050.',
                        name: 'BR-050',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new OpenRouteServiceRoutingProvider(config(), fetcher);

    const result = await provider.calculateRoute({
      direction: 'outbound',
      locations: [
        { lat: -18.9186, lng: -48.2772 },
        { lat: -19.9167, lng: -43.9345 },
      ],
      vehicle: {
        type: 'bus',
        axles: 3,
        fuelType: 'diesel',
        consumptionKmPerLiter: 3.1,
      },
      travelDate: new Date('2026-08-18T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      distanceKm: 540.25,
      durationMinutes: 420,
      engine: 'openrouteservice',
      engineVersion: '9.9.0',
      mapDataVersion: 'osm-fixture',
    });
    expect(result.segments[0]).toMatchObject({
      distanceKm: 540.25,
      durationMinutes: 420,
      roadName: 'BR-050',
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      '/openrouteservice/v2/directions/driving-hgv/geojson',
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: 'application/geo+json',
    });
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo ausente.');
    expect(JSON.parse(body)).toMatchObject({
      coordinates: [
        [-48.2772, -18.9186],
        [-43.9345, -19.9167],
      ],
      options: { vehicle_type: 'bus' },
    });
  });
});
