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
const disabledIntelligence = {
  status: 'disabled' as const,
  estimatedCount: null,
  estimatedTotalMin: null,
  estimatedTotalLikely: null,
  estimatedTotalMax: null,
  confidence: null,
  sources: [],
  assumptions: [],
  explanation: 'Desabilitado.',
  provider: null,
  model: null,
  researchedAt: null,
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
      { geocode } as unknown as GeocodingProvider,
      { calculateRoute },
      { match: tolls },
      { assess: vi.fn().mockResolvedValue(disabledIntelligence) },
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
      { geocode } as unknown as GeocodingProvider,
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
      { assess: vi.fn().mockResolvedValue(disabledIntelligence) },
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

  it('mantém a estimativa da IA separada do total verificado', async () => {
    const assess = vi.fn().mockResolvedValue({
      status: 'estimated',
      estimatedCount: 2,
      estimatedTotalMin: 20,
      estimatedTotalLikely: 25,
      estimatedTotalMax: 30,
      confidence: 0.7,
      sources: [
        {
          title: 'Concessionária de teste',
          url: 'https://concessionaria.example.test/tarifas',
          effectiveDate: '2026-08-01',
        },
      ],
      assumptions: ['Tarifa para ônibus de três eixos.'],
      explanation: 'Estimativa assistida.',
      provider: 'test-agent',
      model: 'test-model',
      researchedAt: '2026-08-18T12:00:00.000Z',
    });
    const useCase = new CalculateRouteUseCase(
      { geocode: vi.fn() } as unknown as GeocodingProvider,
      {
        calculateRoute: vi.fn().mockResolvedValue({
          direction: 'outbound',
          distanceKm: 100,
          durationMinutes: 60,
          geometry,
          encodedPolylines: [],
          segments: [],
          engine: 'openrouteservice',
          engineVersion: 'test',
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
      { assess },
      new FuelCostService(),
      new CostEngineService(),
    );

    const result = await useCase.execute(principal, {
      origin: { lat: -18.91, lng: -48.27 },
      destination: { lat: -19.92, lng: -43.94 },
      waypoints: [],
      roundTrip: false,
      vehicle: {
        type: 'bus',
        axles: 3,
        fuelType: 'diesel',
        consumptionKmPerLiter: 5,
      },
      fuelPricePerLiter: 6,
      travelDate: '2026-08-18',
    });

    expect(result.tolls.total).toBe(0);
    expect(result.cost.tolls).toBe(0);
    expect(result.tolls.intelligence.usedInVerifiedTotal).toBe(false);
    expect(result.tolls.intelligence.outbound).toMatchObject({
      status: 'estimated',
      estimatedTotalLikely: 25,
    });
  });
});
