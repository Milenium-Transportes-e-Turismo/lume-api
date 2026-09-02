import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  OperationalTripsService,
  type CreateOperationalTripInput,
  type OperationalTripActionInput,
} from '../../application/use-cases/trips/operational-trips.service';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  ApplyOperationalTripCommandDto,
  CreateOperationalTripDto,
  ListOperationalTripsQueryDto,
  SelectOperationalTripRoutePlanDto,
} from './operational-trips.dto';

@ApiTags('Viagens operacionais')
@ApiBearerAuth()
@RequireAnyPermission('trips:view', 'routes:view')
@Controller('trips')
export class OperationalTripsController {
  constructor(private readonly trips: OperationalTripsService) {}

  @Post()
  @RequireAnyPermission(
    'trips:create',
    'trips:manage',
    'routes:create',
    'routes:manage',
  )
  @ApiCreatedResponse({
    description:
      'Cria manualmente uma viagem em rascunho a partir de contrato contínuo vigente ou Serviço Confirmado elegível.',
  })
  create(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateOperationalTripDto,
  ) {
    return this.trips.create(current, {
      ...body,
      serviceDate: body.serviceDate ?? null,
    } as CreateOperationalTripInput);
  }

  @Get()
  @ApiOkResponse({ description: 'Lista viagens operacionais do tenant.' })
  list(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ListOperationalTripsQueryDto,
  ) {
    return this.trips.list(current, query);
  }

  @Get(':tripId')
  detail(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
  ) {
    return this.trips.get(current, tripId);
  }

  @Get(':tripId/history')
  history(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
  ) {
    return this.trips.history(current, tripId);
  }

  @Get(':tripId/route-plans')
  @ApiOkResponse({
    description:
      'Lista as seleções históricas do Plano de Rota, sem expor dados pessoais do snapshot legado.',
  })
  routePlans(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
  ) {
    return this.trips.routePlans(current, tripId);
  }

  @Post(':tripId/route-plan')
  @RequireAnyPermission(
    'trips:update',
    'trips:manage',
    'routes:update',
    'routes:manage',
  )
  @ApiCreatedResponse({
    description:
      'Seleciona para uma viagem contínua uma versão aprovada do Plano de Rota e preserva as seleções anteriores.',
  })
  selectRoutePlan(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
    @Body() body: SelectOperationalTripRoutePlanDto,
  ) {
    return this.trips.selectRoutePlan(current, tripId, body);
  }

  @Post(':tripId/commands')
  @RequireAnyPermission(
    'trips:update',
    'trips:manage',
    'routes:update',
    'routes:manage',
  )
  @ApiOkResponse({
    description:
      'Aplica uma ação versionada da máquina de estados da viagem e registra seu histórico.',
  })
  apply(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
    @Body() body: ApplyOperationalTripCommandDto,
  ) {
    const input = {
      ...body,
      ...(body.plan
        ? {
            plan: {
              ...body.plan,
              serviceDate: body.plan.serviceDate ?? null,
              legs: body.plan.legs,
            },
          }
        : {}),
    };
    return this.trips.apply(
      current,
      tripId,
      input as OperationalTripActionInput & {
        commandId: string;
        expectedVersion: number;
      },
    );
  }
}
