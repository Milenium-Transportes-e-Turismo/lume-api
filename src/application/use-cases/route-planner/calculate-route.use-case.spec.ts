import { describe, expect, it, vi } from 'vitest';

import type { GeocodingProvider } from '../../contracts/geocoding.provider';
import { CostEngineService } from '../../../domain/route-planner/cost-engine.service';
import { FuelCostService } from '../../../domain/route-planner/fuel-cost.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { CalculateRouteUseCase } from './calculate-route.use-case';

const principal = { companyId: 'tenant-a' } as AuthenticatedPrincipal;
const geometry = {
  type: 'LineString' as const,
  coordinates: [
    [-48.27, -18.91],
    [-43.94, -19.92],
  ] as const,
};

describe('CalculateRouteUseCase', () => {
  it('calcula ida e volta em duas chamadas independentes e mantém o tenant', async () => {
    const geocode = vi
      .fn()
      .mockResolvedValueOnce({
        coordinates: { lat: -18.91, lng: -48.27 },
        label: 'Uberlândia',
        address: 'Uberlândia - MG',
        source: 'nominatim',
      })
      .mockResolvedValueOnce({
        coordinates: { lat: -19.92, lng: -43.94 },
        label: 'Belo Horizonte',
        address: 'Belo Horizonte - MG',
        source: 'nominatim',
      });
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        direction: 'outbound',
        distanceKm: 540,
        durationMinutes: 420,
        geometry,
        encodedPolylines: ['outbound'],
        segments: [],
        engine: 'valhalla',
        engineVersion: 'test',
        mapDataVersion: 'test-map',
      })
      .mockResolvedValueOnce({
        direction: 'return',
        distanceKm: 550,
        durationMinutes: 430,
        geometry,
        encodedPolylines: ['return'],
        segments: [],
        engine: 'valhalla',
        engineVersion: 'test',
        mapDataVersion: 'test-map',
      });
    const tolls = vi.fn().mockResolvedValue({
      count: 0,
      total: 0,
      complete: true,
      dataStatus: 'available',
      dataVersion: '2026-08-01T00:00:00.000Z',
      items: [],
      matcherStrategy: 'test',
    });
    const useCase = new CalculateRouteUseCase(
      { geocode } as GeocodingProvider,
      { calculateRoute },
      { match: tolls },
      new FuelCostService(),
      new CostEngineService(),
    );

    const result = await useCase.execute(principal, {
      origin: { address: 'Uberlândia - MG' },
      destination: { address: 'Belo Horizonte - MG' },
      waypoints: [],
      roundTrip: true,
      vehicle: {
        type: 'bus',
        axles: 3,
        fuelType: 'diesel',
        consumptionKmPerLiter: 5,
      },
      fuelPricePerLiter: 6,
      travelDate: '2026-08-18',
    });

    expect(calculateRoute).toHaveBeenCalledTimes(2);
    expect(calculateRoute.mock.calls[0][0].locations).toEqual([
      { lat: -18.91, lng: -48.27 },
      { lat: -19.92, lng: -43.94 },
    ]);
    expect(calculateRoute.mock.calls[1][0].locations).toEqual([
      { lat: -19.92, lng: -43.94 },
      { lat: -18.91, lng: -48.27 },
    ]);
    expect(result.route.total.distanceKm).toBe(1090);
    expect(result.tenant.companyId).toBe('tenant-a');
  });

  it('não chama geocoding quando recebe coordenadas', async () => {
    const geocode = vi.fn();
    const useCase = new CalculateRouteUseCase(
      { geocode } as GeocodingProvider,
      {
        calculateRoute: vi.fn().mockResolvedValue({
          direction: 'outbound',
          distanceKm: 100,
          durationMinutes: 60,
          geometry,
          encodedPolylines: [],
          segments: [],
          engine: 'valhalla',
          engineVersion: null,
          mapDataVersion: null,
        }),
      },
      {
        match: vi.fn().mockResolvedValue({
          count: 0,
          total: 0,
          complete: false,
          dataStatus: 'unavailable',
          dataVersion: null,
          items: [],
          matcherStrategy: 'test',
        }),
      },
      new FuelCostService(),
      new CostEngineService(),
    );

    await useCase.execute(principal, {
      origin: { lat: -18.91, lng: -48.27 },
      destination: { lat: -19.92, lng: -43.94 },
      waypoints: [],
      roundTrip: false,
      vehicle: {
        type: 'bus',
        axles: 3,
        fuelType: 'diesel',
        consumptionKmPerLiter: 3.1,
      },
      fuelPricePerLiter: 6.2,
      travelDate: '2026-08-18',
    });

    expect(geocode).not.toHaveBeenCalled();
  });
});
