import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import {
  CurrentService,
  type ServicePrincipal,
} from '../../shared/http/decorators/current-service.decorator';
import { Public } from '../../shared/http/decorators/public.decorator';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';
import {
  CreateAgentCustomerProfileSuggestionDto,
  CustomerContextDetailQueryDto,
} from './dto/customer-context.dto';

@ApiTags('Contexto do cliente interno')
@ApiBearerAuth('serviceBearer')
@Public()
@UseGuards(ServiceIdentityGuard)
@Controller('internal/customer-context')
export class InternalCustomerContextController {
  constructor(private readonly context: CustomerContextUseCase) {}

  @Get('sessions/:serviceSessionId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Retorna contexto limitado com perfil exclusivamente aprovado',
  })
  summary(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
  ) {
    return this.context.summary({
      companyId: service.companyId,
      serviceSessionId,
      audience: 'agent',
    });
  }

  @Get('sessions/:serviceSessionId/details')
  @Header('Cache-Control', 'private, no-store')
  details(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Query() query: CustomerContextDetailQueryDto,
  ) {
    return this.context.details({
      companyId: service.companyId,
      serviceSessionId,
      audience: 'agent',
      section: query.section,
      limit: query.limit,
    });
  }

  @Post('sessions/:serviceSessionId/suggestions')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Registra somente uma sugestão PENDING com provenance do agente',
  })
  suggest(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Body() body: CreateAgentCustomerProfileSuggestionDto,
  ) {
    return this.context.suggestFromAgent({
      companyId: service.companyId,
      serviceSessionId,
      serviceIdentityId: service.id,
      ...body,
    });
  }
}
