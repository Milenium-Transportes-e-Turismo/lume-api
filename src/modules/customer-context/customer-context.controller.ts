import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CustomerContextUseCase } from '../../application/use-cases/customer-context/customer-context.use-case';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreateCustomerProfileSuggestionDto,
  CustomerContextDetailQueryDto,
  CustomerProfileSuggestionQueryDto,
  DecideCustomerProfileSuggestionDto,
} from './dto/customer-context.dto';

@ApiTags('Contexto e perfil do cliente')
@ApiBearerAuth()
@Controller('customer-context')
export class CustomerContextController {
  constructor(private readonly context: CustomerContextUseCase) {}

  @Get('sessions/:serviceSessionId')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('service:view')
  @ApiOperation({ summary: 'Obtém contexto curto e aprovado do cliente' })
  summary(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
  ) {
    return this.context.summary({
      companyId: current.companyId,
      serviceSessionId,
      audience: 'human',
    });
  }

  @Get('sessions/:serviceSessionId/details')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('service:view')
  @ApiOperation({ summary: 'Recupera uma seção de contexto sob demanda' })
  details(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Query() query: CustomerContextDetailQueryDto,
  ) {
    return this.context.details({
      companyId: current.companyId,
      serviceSessionId,
      audience: 'human',
      section: query.section,
      limit: query.limit,
    });
  }

  @Post('sessions/:serviceSessionId/suggestions')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('service:respond')
  @ApiOperation({
    summary: 'Cria sugestão pendente; não altera o perfil permanente',
  })
  suggest(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Body() body: CreateCustomerProfileSuggestionDto,
  ) {
    return this.context.suggestFromHuman({
      companyId: current.companyId,
      serviceSessionId,
      actorUserId: current.id,
      ...body,
    });
  }

  @Get('profile-suggestions')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('service:view')
  listSuggestions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: CustomerProfileSuggestionQueryDto,
  ) {
    return this.context.listSuggestions({
      companyId: current.companyId,
      ...query,
    });
  }

  @Post('profile-suggestions/:suggestionId/decision')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('service:respond')
  @ApiOperation({
    summary: 'Aprova ou ignora sugestão mediante decisão humana auditada',
  })
  decide(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('suggestionId', new ParseUUIDPipe({ version: '4' }))
    suggestionId: string,
    @Body() body: DecideCustomerProfileSuggestionDto,
  ) {
    return this.context.decide({
      companyId: current.companyId,
      actorUserId: current.id,
      suggestionId,
      ...body,
    });
  }
}
