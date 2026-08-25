import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CalculateRouteUseCase } from '../../application/use-cases/route-planner/calculate-route.use-case';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import { CalculateRouteDto } from './dto/calculate-route.dto';

@ApiTags('Núcleo de roteirização')
@ApiBearerAuth()
@Controller('routing/calculations')
export class RoutePlannerController {
  constructor(private readonly calculateRoute: CalculateRouteUseCase) {}

  @Post()
  @RequireAnyPermission('route-planner:calculate')
  @ApiCreatedResponse({
    description:
      'Rota técnica calculada com distância, duração, geometria, pedágios e combustível.',
  })
  calculate(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CalculateRouteDto,
  ) {
    return this.calculateRoute.execute(current, body);
  }
}
