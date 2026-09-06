import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
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

@ApiTags('Núcleo de roteirização')
@ApiBearerAuth()
@Controller('routing/locations')
export class RouteLocationSearchController {
  constructor(
    @Inject(RouteLocationSearchProvider)
    private readonly search: RouteLocationSearchProvider,
  ) {}
  @Get()
  @RequireAnyPermission('route-planner:view', 'route-planner:calculate')
  list(@Query() query: SearchRouteLocationsDto) {
    return this.search.searchLocations(query.q);
  }
}
