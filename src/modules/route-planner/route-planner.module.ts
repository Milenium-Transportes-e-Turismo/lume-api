import { Module } from '@nestjs/common';

import { GeocodingProvider } from '../../application/contracts/geocoding.provider';
import { RoutingProvider } from '../../application/contracts/routing.provider';
import { TollMatcherRepository } from '../../application/contracts/toll-matcher.repository';
import { TollIntelligenceAgent } from '../../application/contracts/toll-intelligence.agent';
import { CalculateRouteUseCase } from '../../application/use-cases/route-planner/calculate-route.use-case';
import { CostEngineService } from '../../domain/route-planner/cost-engine.service';
import { FuelCostService } from '../../domain/route-planner/fuel-cost.service';
import { HeigitPeliasGeocodingProvider } from '../../infra/route-planner/heigit-pelias-geocoding.provider';
import { OpenAiTollIntelligenceAgent } from '../../infra/route-planner/openai-toll-intelligence.agent';
import { OpenRouteServiceRoutingProvider } from '../../infra/route-planner/open-route-service-routing.provider';
import { PrismaTollMatcherRepository } from '../../infra/route-planner/prisma-toll-matcher.repository';
import { ROUTE_PLANNER_FETCHER } from '../../infra/route-planner/route-planner.tokens';
import { RouteLocationSearchProvider } from '../../application/contracts/route-location-search.provider';
import { RouteLocationSearchController } from './route-location-search.controller';
import { RoutePlannerController } from './route-planner.controller';

@Module({
  controllers: [RoutePlannerController, RouteLocationSearchController],
  providers: [
    {
      provide: ROUTE_PLANNER_FETCHER,
      useValue: globalThis.fetch.bind(globalThis),
    },
    HeigitPeliasGeocodingProvider,
    { provide: GeocodingProvider, useExisting: HeigitPeliasGeocodingProvider },
    {
      provide: RouteLocationSearchProvider,
      useExisting: HeigitPeliasGeocodingProvider,
    },
    { provide: RoutingProvider, useClass: OpenRouteServiceRoutingProvider },
    { provide: TollMatcherRepository, useClass: PrismaTollMatcherRepository },
    {
      provide: TollIntelligenceAgent,
      useClass: OpenAiTollIntelligenceAgent,
    },
    FuelCostService,
    CostEngineService,
    {
      provide: CalculateRouteUseCase,
      useFactory: (
        geocoding: GeocodingProvider,
        routing: RoutingProvider,
        tolls: TollMatcherRepository,
        tollIntelligence: TollIntelligenceAgent,
        fuel: FuelCostService,
        costs: CostEngineService,
      ) =>
        new CalculateRouteUseCase(
          geocoding,
          routing,
          tolls,
          tollIntelligence,
          fuel,
          costs,
        ),
      inject: [
        GeocodingProvider,
        RoutingProvider,
        TollMatcherRepository,
        TollIntelligenceAgent,
        FuelCostService,
        CostEngineService,
      ],
    },
  ],
})
export class RoutePlannerModule {}
