import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { ValhallaRoutingProvider } from './valhalla-routing.provider';

describe('ValhallaRoutingProvider', () => {
  it('converte a resposta mockada em uma rota GeoJSON sem acessar a internet', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          trip: {
            status: 0,
            summary: { length: 100, time: 7_200 },
            legs: [
              {
                shape: '??AA',
                maneuvers: [
                  {
                    instruction: 'Siga em frente.',
                    length: 100,
                    time: 7_200,
                    street_names: ['BR-050'],
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new ValhallaRoutingProvider(
      new ConfigService({
        VALHALLA_URL: 'http://valhalla.test',
        ROUTING_TIMEOUT_MS: 1_000,
        VALHALLA_VERSION: 'test',
        VALHALLA_MAP_DATA_VERSION: 'fixture',
      }),
      fetcher,
    );

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

    expect(result.distanceKm).toBe(100);
    expect(result.durationMinutes).toBe(120);
    expect(result.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.000001, 0.000001],
      ],
    });
    expect(result.segments[0]?.roadName).toBe('BR-050');
    const requestBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Corpo JSON ausente.');
    const request = JSON.parse(requestBody) as {
      costing: string;
      locations: unknown[];
    };
    expect(request.costing).toBe('auto');
    expect(request.locations).toHaveLength(2);
  });
});
