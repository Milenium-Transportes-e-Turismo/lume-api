import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { ConfirmedServicesService } from '../../application/use-cases/commercial/confirmed-services.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  AttestCommercialServiceRequirementDto,
  ConfirmServiceDto,
  MarkCommercialServiceRequirementNotApplicableDto,
} from './confirmed-services.dto';

@ApiTags('Serviços comerciais confirmados')
@ApiBearerAuth()
@Controller('commercial/quote-requests')
export class ConfirmedServicesController {
  constructor(private readonly confirmedServices: ConfirmedServicesService) {}

  @Post(':quoteRequestId/financial-attestation')
  @RequireAnyPermission('financial:approve')
  @ApiCreatedResponse({
    description:
      'Registra o ateste financeiro do orçamento aceito, sem conceder esse poder ao Comercial.',
  })
  attestFinancial(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('quoteRequestId', new ParseUUIDPipe()) quoteRequestId: string,
    @Body() body: AttestCommercialServiceRequirementDto,
  ) {
    return this.confirmedServices.attestRequirement(
      current,
      quoteRequestId,
      'financial',
      body,
    );
  }

  @Post(':quoteRequestId/operational-attestation')
  @RequireAnyPermission('operations:manage')
  @ApiCreatedResponse({
    description:
      'Registra o ateste operacional do orçamento aceito, sem conceder esse poder ao Comercial.',
  })
  attestOperational(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('quoteRequestId', new ParseUUIDPipe()) quoteRequestId: string,
    @Body() body: AttestCommercialServiceRequirementDto,
  ) {
    return this.confirmedServices.attestRequirement(
      current,
      quoteRequestId,
      'operational',
      body,
    );
  }

  @Post(':quoteRequestId/requirements/:requirement/not-applicable')
  @RequireAnyPermission('service-confirmations:approve')
  @ApiCreatedResponse({
    description:
      'Registra, com motivo e evidência, que o requisito financeiro ou operacional não se aplica ao orçamento aceito.',
  })
  markRequirementNotApplicable(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('quoteRequestId', new ParseUUIDPipe()) quoteRequestId: string,
    @Param('requirement') requirement: string,
    @Body() body: MarkCommercialServiceRequirementNotApplicableDto,
  ) {
    return this.confirmedServices.markRequirementNotApplicable(
      current,
      quoteRequestId,
      requirement,
      body,
    );
  }

  @Get(':quoteRequestId/confirmed-service-readiness')
  @RequireAnyPermission(
    'commercial:view',
    'commercial:manage',
    'financial:view',
    'financial:approve',
    'operations:view',
    'operations:manage',
    'service-confirmations:approve',
  )
  @ApiOkResponse({
    description:
      'Consulta aceite, atestes separados e o Serviço Confirmado resultante.',
  })
  readiness(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('quoteRequestId', new ParseUUIDPipe()) quoteRequestId: string,
  ) {
    return this.confirmedServices.readiness(current, quoteRequestId);
  }

  @Post(':quoteRequestId/confirmed-services')
  @RequireAnyPermission('commercial:manage')
  @ApiCreatedResponse({
    description:
      'Confirma o serviço singular legado somente depois do aceite e dos atestes Financeiro e Operacional.',
  })
  confirm(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('quoteRequestId', new ParseUUIDPipe()) quoteRequestId: string,
    @Body() body: ConfirmServiceDto,
  ) {
    return this.confirmedServices.confirm(current, quoteRequestId, body);
  }
}
