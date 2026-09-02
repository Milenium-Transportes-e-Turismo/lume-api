import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import { AgentAdministrationService } from './agent-administration.service';
import {
  ListAgentExecutionsQueryDto,
  RollbackTenantAgentInstructionsDto,
  UpdateTenantAgentInstructionsDto,
} from './dto/agent-administration.dto';

@ApiTags('Agentes de IA')
@ApiBearerAuth()
@Controller('agents')
export class AgentAdministrationController {
  constructor(private readonly agents: AgentAdministrationService) {}

  @Get()
  @RequireAnyPermission('ai-agents:view')
  @ApiOperation({
    summary: 'Lista agentes e configuração técnica somente leitura',
    description:
      'Nunca retorna credentialRef ou API key. Provider, modelo e credencial técnica não são mutáveis pela Tenant API.',
  })
  list(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.agents.listAgents(current);
  }

  @Get(':agentId/executions')
  @RequireAnyPermission('ai-agents:view')
  @ApiOperation({ summary: 'Consulta execuções auditáveis do agente' })
  executions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query() query: ListAgentExecutionsQueryDto,
  ) {
    return this.agents.listExecutions(current, agentId, query);
  }

  @Get(':agentId/tenant-instructions')
  @RequireAnyPermission('ai-agents:manage')
  @ApiOperation({
    summary: 'Lista o histórico versionado das instruções do tenant',
  })
  tenantInstructionVersions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ) {
    return this.agents.listTenantInstructionVersions(current, agentId);
  }

  @Post(':agentId/tenant-instructions')
  @RequireAnyPermission('ai-agents:manage')
  @ApiOperation({
    summary: 'Cria nova versão das instruções do tenant',
    description:
      'Não altera system/platform prompt, provider, modelo ou referência de credencial.',
  })
  updateTenantInstructions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: UpdateTenantAgentInstructionsDto,
  ) {
    return this.agents.updateTenantInstructions(current, agentId, body);
  }

  @Post(':agentId/tenant-instructions/:versionId/rollback')
  @RequireAnyPermission('ai-agents:manage')
  @ApiOperation({
    summary: 'Cria uma nova versão a partir de instruções anteriores',
    description:
      'O histórico é imutável: rollback copia o conteúdo selecionado para uma nova versão ativa e audita a operação.',
  })
  rollbackTenantInstructions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body() body: RollbackTenantAgentInstructionsDto,
  ) {
    return this.agents.rollbackTenantInstructions(
      current,
      agentId,
      versionId,
      body,
    );
  }
}
