import { Module } from '@nestjs/common';

import { GeocodingProvider } from '../../application/contracts/geocoding.provider';
import { RoutingProvider } from '../../application/contracts/routing.provider';
import { TollMatcherRepository } from '../../application/contracts/toll-matcher.repository';
import { CalculateRouteUseCase } from '../../application/use-cases/route-planner/calculate-route.use-case';
import { CostEngineService } from '../../domain/route-planner/cost-engine.service';
import { FuelCostService } from '../../domain/route-planner/fuel-cost.service';
import { NominatimGeocodingProvider } from '../../infra/route-planner/nominatim-geocoding.provider';
import { PrismaTollMatcherRepository } from '../../infra/route-planner/prisma-toll-matcher.repository';
import { ValhallaRoutingProvider } from '../../infra/route-planner/valhalla-routing.provider';
import { RoutePlannerController } from './route-planner.controller';

@Module({
  controllers: [RoutePlannerController],
  providers: [
    { provide: GeocodingProvider, useClass: NominatimGeocodingProvider },
    { provide: RoutingProvider, useClass: ValhallaRoutingProvider },
    { provide: TollMatcherRepository, useClass: PrismaTollMatcherRepository },
    FuelCostService,
    CostEngineService,
    {
      provide: CalculateRouteUseCase,
      useFactory: (
        geocoding: GeocodingProvider,
        routing: RoutingProvider,
        tolls: TollMatcherRepository,
        fuel: FuelCostService,
        costs: CostEngineService,
      ) => new CalculateRouteUseCase(geocoding, routing, tolls, fuel, costs),
      inject: [
        GeocodingProvider,
        RoutingProvider,
        TollMatcherRepository,
        FuelCostService,
        CostEngineService,
      ],
    },
  ],
})
export class RoutePlannerModule {}
