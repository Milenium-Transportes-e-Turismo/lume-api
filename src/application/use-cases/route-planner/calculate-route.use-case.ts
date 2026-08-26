import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { GeocodingProvider } from '../../contracts/geocoding.provider';
import { RoutingProvider } from '../../contracts/routing.provider';
import { TollMatcherRepository } from '../../contracts/toll-matcher.repository';
import { TollIntelligenceAgent } from '../../contracts/toll-intelligence.agent';
import { AppError } from '../../../core/errors/app-error';
import { CostEngineService } from '../../../domain/route-planner/cost-engine.service';
import { FuelCostService } from '../../../domain/route-planner/fuel-cost.service';
import type {
  ResolvedRouteLocation,
  RouteLocationInput,
  RoutingVehicleConfiguration,
} from '../../../domain/route-planner/route-planner.types';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

export interface CalculateRouteInput {
  readonly origin: RouteLocationInput;
  readonly destination: RouteLocationInput;
  readonly waypoints: readonly RouteLocationInput[];
  readonly roundTrip: boolean;
  readonly vehicle: RoutingVehicleConfiguration;
  readonly fuelPricePerLiter: number;
  readonly travelDate: string;
}

function validCoordinate(
  value: number | undefined,
  minimum: number,
  maximum: number,
) {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function totalMoney(values: readonly number[]): number {
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100,
    ) / 100
  );
}

export class CalculateRouteUseCase {
  private readonly logger = new Logger(CalculateRouteUseCase.name);

  constructor(
    private readonly geocoding: GeocodingProvider,
    private readonly routing: RoutingProvider,
    private readonly tollMatcher: TollMatcherRepository,
    private readonly tollIntelligence: TollIntelligenceAgent,
    private readonly fuel: FuelCostService,
    private readonly costs: CostEngineService,
  ) {}

  async execute(current: AuthenticatedPrincipal, input: CalculateRouteInput) {
    const calculationId = randomUUID();
    const startedAt = Date.now();
    this.assertInput(input);
    this.logger.log({
      event: 'routing.request',
      calculationId,
      companyId: current.companyId,
      waypointCount: input.waypoints.length,
      roundTrip: input.roundTrip,
      vehicleType: input.vehicle.type,
    });

    try {
      const travelDate = new Date(`${input.travelDate}T12:00:00.000Z`);
      const resolved = await Promise.all(
        [input.origin, ...input.waypoints, input.destination].map((location) =>
          this.resolveLocation(location),
        ),
      );
      const coordinates = resolved.map((location) => location.coordinates);
      const legs = await Promise.all([
        this.routing.calculateRoute({
          direction: 'outbound',
          locations: coordinates,
          vehicle: input.vehicle,
          travelDate,
        }),
        ...(input.roundTrip
          ? [
              this.routing.calculateRoute({
                direction: 'return' as const,
                locations: [...coordinates].reverse(),
                vehicle: input.vehicle,
                travelDate,
              }),
            ]
          : []),
      ]);
      const tollsByLeg = await Promise.all(
        legs.map((route) =>
          this.tollMatcher.match({ route, vehicle: input.vehicle, travelDate }),
        ),
      );
      const tollIntelligenceByLeg = await Promise.all(
        legs.map((route, index) => {
          const outbound = route.direction === 'outbound';
          return this.tollIntelligence.assess({
            route,
            origin: outbound
              ? resolved[0]
              : (resolved.at(-1) as ResolvedRouteLocation),
            destination: outbound
              ? (resolved.at(-1) as ResolvedRouteLocation)
              : resolved[0],
            vehicle: input.vehicle,
            travelDate,
            verified: tollsByLeg[index],
          });
        }),
      );
      const distanceKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
      const durationMinutes = legs.reduce(
        (sum, leg) => sum + leg.durationMinutes,
        0,
      );
      const fuel = this.fuel.calculate(
        distanceKm,
        input.vehicle.consumptionKmPerLiter,
        input.fuelPricePerLiter,
      );
      const tollTotal = totalMoney(tollsByLeg.map((tolls) => tolls.total));
      const tollComplete = tollsByLeg.every((tolls) => tolls.complete);
      const cost = this.costs.calculate({
        fuelCost: fuel.estimatedCost,
        tollCost: tollTotal,
        tollDataComplete: tollComplete,
      });
      const result = {
        calculationId,
        calculatedAt: new Date().toISOString(),
        tenant: { companyId: current.companyId },
        locations: {
          origin: resolved[0],
          waypoints: resolved.slice(1, -1),
          destination: resolved.at(-1) as ResolvedRouteLocation,
        },
        vehicle: input.vehicle,
        travelDate: input.travelDate,
        roundTrip: input.roundTrip,
        route: {
          outbound: legs[0],
          return: legs[1] ?? null,
          total: {
            distanceKm: Math.round(distanceKm * 1000) / 1000,
            durationMinutes: Math.round(durationMinutes * 10) / 10,
            distanceEstimated: true,
            durationEstimated: true,
          },
        },
        tolls: {
          outbound: tollsByLeg[0],
          return: tollsByLeg[1] ?? null,
          count: tollsByLeg.reduce((sum, tolls) => sum + tolls.count, 0),
          total: tollTotal,
          complete: tollComplete,
          dataStatus: tollsByLeg.every(
            (tolls) => tolls.dataStatus === 'available',
          )
            ? ('available' as const)
            : ('unavailable' as const),
          intelligence: {
            usedInVerifiedTotal: false,
            outbound: tollIntelligenceByLeg[0],
            return: tollIntelligenceByLeg[1] ?? null,
          },
        },
        fuel,
        cost,
        versioning: {
          routingEngine: legs[0].engine,
          routingEngineVersion: legs[0].engineVersion,
          mapDataVersion: legs[0].mapDataVersion,
          tollDataVersion:
            tollsByLeg.find((tolls) => tolls.dataVersion)?.dataVersion ?? null,
          tollTariffDate: input.travelDate,
        },
      };
      this.logger.log({
        event: 'routing.success',
        calculationId,
        companyId: current.companyId,
        durationMs: Date.now() - startedAt,
        distanceKm: result.route.total.distanceKm,
        tollCount: result.tolls.count,
      });
      return result;
    } catch (error) {
      this.logger.error({
        event: 'routing.error',
        calculationId,
        companyId: current.companyId,
        durationMs: Date.now() - startedAt,
        code: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
      });
      throw error;
    }
  }

  private assertInput(input: CalculateRouteInput): void {
    if (input.waypoints.length > 10) {
      throw new AppError('VALIDATION_ERROR', 'Informe no máximo 10 paradas.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.travelDate)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Informe uma data de viagem válida.',
      );
    }
    const date = new Date(`${input.travelDate}T12:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Informe uma data de viagem válida.',
      );
    }
    if (
      !Number.isInteger(input.vehicle.axles) ||
      input.vehicle.axles < 2 ||
      input.vehicle.axles > 9
    ) {
      throw new AppError(
        'INVALID_VEHICLE_CONFIGURATION',
        'Informe entre 2 e 9 eixos para o veículo.',
      );
    }
  }

  private async resolveLocation(
    input: RouteLocationInput,
  ): Promise<ResolvedRouteLocation> {
    const hasLat = input.lat !== undefined;
    const hasLng = input.lng !== undefined;
    if (hasLat || hasLng) {
      if (
        !validCoordinate(input.lat, -90, 90) ||
        !validCoordinate(input.lng, -180, 180)
      ) {
        throw new AppError(
          'INVALID_COORDINATES',
          'Latitude e longitude devem ser informadas juntas e dentro dos limites válidos.',
        );
      }
      return {
        coordinates: { lat: input.lat as number, lng: input.lng as number },
        label:
          input.address?.trim() ||
          `${(input.lat as number).toFixed(6)}, ${(input.lng as number).toFixed(6)}`,
        address: input.address?.trim() || null,
        source: 'coordinates',
      };
    }
    const address = input.address?.trim();
    if (!address || address.length < 3 || address.length > 300) {
      throw new AppError(
        'GEOCODING_NOT_FOUND',
        'Informe um endereço entre 3 e 300 caracteres ou coordenadas válidas.',
      );
    }
    return this.geocoding.geocode(address);
  }
}
