import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import {
  ManageServiceSessionUseCase,
  QueryServiceSessionsUseCase,
} from '../../application/use-cases/whatsapp/manage-service-sessions.use-case';
import { forbidden } from '../../core/errors/app-error';
import { hasTenantWideAuthority } from '../../domain/access/tenant-authority';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  ChangeServiceSessionPriorityDto,
  CloseServiceSessionDto,
  ReturnServiceSessionToQueueDto,
  ServiceSessionCommandDto,
  ServiceSessionListQueryDto,
  TransferServiceSessionDto,
} from './dto/service-session.dto';

@ApiTags('Atendimento')
@ApiBearerAuth()
@Controller('service/sessions')
export class ServiceSessionsController {
  constructor(
    private readonly querySessions: QueryServiceSessionsUseCase,
    private readonly manageSession: ManageServiceSessionUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('service:view')
  @ApiOkResponse({
    description:
      'Lista atendimentos somente dos departamentos atribuídos ao usuário.',
  })
  list(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ServiceSessionListQueryDto,
  ) {
    return this.querySessions.list(this.actor(current), query);
  }

  @Get('assignment-targets')
  @RequireAnyPermission('service:transfer')
  @ApiOkResponse({
    description:
      'Lista departamentos, filas habilitadas e atendentes elegíveis do tenant.',
  })
  assignmentTargets(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.querySessions.assignmentTargets(this.actor(current));
  }

  @Get(':sessionId')
  @RequireAnyPermission('service:view')
  get(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.querySessions.get(this.actor(current), sessionId);
  }

  @Post(':sessionId/actions/assume')
  @RequireAnyPermission('service:assume')
  assume(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: ServiceSessionCommandDto,
  ) {
    return this.manageSession.assume({
      ...this.command(current, sessionId, body),
    });
  }

  @Post(':sessionId/actions/return-to-queue')
  @RequireAnyPermission('service:transfer')
  returnToQueue(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: ReturnServiceSessionToQueueDto,
  ) {
    return this.manageSession.returnToQueue({
      ...this.command(current, sessionId, body),
      queueId: body.queueId,
    });
  }

  @Post(':sessionId/actions/return-to-ai')
  @RequireAnyPermission('service:transfer')
  returnToAi(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: ServiceSessionCommandDto,
  ) {
    return this.manageSession.returnToAi(
      this.command(current, sessionId, body),
    );
  }

  @Post(':sessionId/actions/transfer')
  @RequireAnyPermission('service:transfer')
  transfer(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: TransferServiceSessionDto,
  ) {
    return this.manageSession.transfer({
      ...this.command(current, sessionId, body),
      departmentId: body.departmentId,
      ...(body.queueId ? { queueId: body.queueId } : {}),
      ...(body.userId ? { userId: body.userId } : {}),
      ...(body.reason ? { reason: body.reason } : {}),
    });
  }

  @Post(':sessionId/actions/change-priority')
  @RequireAnyPermission('service:priority')
  changePriority(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: ChangeServiceSessionPriorityDto,
  ) {
    return this.manageSession.changePriority({
      ...this.command(current, sessionId, body),
      priority: body.priority,
      reason: body.reason,
    });
  }

  @Post(':sessionId/actions/close')
  @RequireAnyPermission('service:close')
  close(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: CloseServiceSessionDto,
  ) {
    return this.manageSession.close({
      ...this.command(current, sessionId, body),
      reason: body.reason,
    });
  }

  private actor(current: AuthenticatedPrincipal) {
    if (
      current.documentAccessMode === 'client' ||
      current.departments.includes('client-company')
    ) {
      throw forbidden(
        'Perfis de empresa cliente não podem acessar filas internas de atendimento.',
      );
    }

    return {
      companyId: current.companyId,
      actorUserId: current.id,
      accessibleDepartments: hasTenantWideAuthority(current)
        ? null
        : current.departments,
    };
  }

  private command(
    current: AuthenticatedPrincipal,
    sessionId: string,
    body: ServiceSessionCommandDto,
  ) {
    return {
      ...this.actor(current),
      sessionId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
    };
  }
}
