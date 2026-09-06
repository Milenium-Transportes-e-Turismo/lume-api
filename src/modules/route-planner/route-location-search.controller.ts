import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Type, Transform } from 'class-transformer';
import {
  IsString,
  MaxLength,
  MinLength,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RouteLocationSearchProvider } from '../../application/contracts/route-location-search.provider';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';

export class SearchRouteLocationsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  q!: string;
}

export class ReverseRouteLocationDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
}

@ApiTags('Núcleo de roteirização')
@ApiBearerAuth()
@Controller('routing/locations')
export class RouteLocationSearchController {
  constructor(
    @Inject(RouteLocationSearchProvider)
    private readonly search: RouteLocationSearchProvider,
  ) {}
  @Get('reverse')
  @RequireAnyPermission('route-planner:view', 'route-planner:calculate')
  reverse(@Query() query: ReverseRouteLocationDto) {
    return this.search.reverseLocation(query.lat, query.lng);
  }
  @Get()
  @RequireAnyPermission('route-planner:view', 'route-planner:calculate')
  list(@Query() query: SearchRouteLocationsDto) {
    return this.search.searchLocations(query.q);
  }
}
