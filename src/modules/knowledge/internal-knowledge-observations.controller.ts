import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import {
  CurrentService,
  type ServicePrincipal,
} from '../../shared/http/decorators/current-service.decorator';
import { Public } from '../../shared/http/decorators/public.decorator';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';
import {
  CreateAgentKnowledgeSuggestionDto,
  ObserveAgentKnowledgeGapDto,
} from './dto/knowledge.dto';

@ApiTags('Knowledge Base interna')
@ApiBearerAuth('serviceBearer')
@Public()
@UseGuards(ServiceIdentityGuard)
@Controller('internal/knowledge')
export class InternalKnowledgeObservationsController {
  constructor(private readonly knowledge: KnowledgeManagementUseCase) {}

  @Post('suggestions')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Registra sugestão PENDING proveniente de execução de agente autenticada',
  })
  suggestion(
    @CurrentService() service: ServicePrincipal,
    @Body() body: CreateAgentKnowledgeSuggestionDto,
  ) {
    return this.knowledge.createAgentSuggestion({
      companyId: service.companyId,
      serviceIdentityId: service.id,
      ...body,
    });
  }

  @Post('gaps')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Registra ou incrementa lacuna recorrente sem criar conhecimento',
  })
  gap(
    @CurrentService() service: ServicePrincipal,
    @Body() body: ObserveAgentKnowledgeGapDto,
  ) {
    return this.knowledge.observeAgentGap({
      companyId: service.companyId,
      serviceIdentityId: service.id,
      ...body,
    });
  }
}
