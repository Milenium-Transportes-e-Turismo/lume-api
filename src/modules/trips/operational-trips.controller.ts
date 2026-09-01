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
  type OperationalTripActionInput,
} from '../../application/use-cases/trips/operational-trips.service';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  ApplyOperationalTripCommandDto,
  CreateOperationalTripDto,
  ListOperationalTripsQueryDto,
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
      'Cria manualmente uma viagem em rascunho a partir de contrato ativo e vigente.',
  })
  create(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateOperationalTripDto,
  ) {
    return this.trips.create(current, {
      ...body,
      serviceDate: body.serviceDate ?? null,
    });
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
