import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import {
  CreateWhatsAppChannelUseCase,
  ManageWhatsAppChannelUseCase,
  QueryWhatsAppChannelsUseCase,
} from '../../application/use-cases/whatsapp/manage-whatsapp-channels.use-case';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreateWhatsAppChannelDto,
  UpdateWhatsAppChannelDto,
  WhatsAppChannelCommandDto,
} from './dto/whatsapp-channel.dto';

@ApiTags('Canais WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp/channels')
export class WhatsAppChannelsController {
  constructor(
    private readonly queryChannels: QueryWhatsAppChannelsUseCase,
    private readonly createChannel: CreateWhatsAppChannelUseCase,
    private readonly manageChannel: ManageWhatsAppChannelUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('whatsapp-channels:view')
  @ApiOkResponse({ description: 'Lista os canais do tenant autenticado.' })
  list(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.queryChannels.list(current.companyId);
  }

  @Get('departments')
  @RequireAnyPermission(
    'whatsapp-channels:view',
    'whatsapp-channels:create',
    'whatsapp-channels:manage',
  )
  departments(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.queryChannels.listDepartments(current.companyId);
  }

  @Get(':channelId')
  @RequireAnyPermission('whatsapp-channels:view')
  get(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
  ) {
    return this.queryChannels.get(current.companyId, channelId);
  }

  @Post()
  @RequireAnyPermission('whatsapp-channels:create')
  @ApiCreatedResponse({
    description:
      'Cria o registro pendente antes de provisionar a instância Evolution.',
  })
  create(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateWhatsAppChannelDto,
  ) {
    return this.createChannel.execute({
      companyId: current.companyId,
      actorUserId: current.id,
      commandId: body.commandId,
      displayName: body.displayName,
      phoneNumber: body.phoneNumber,
      departmentId: body.departmentId ?? null,
      routingMode: body.routingMode,
      allowedAutomaticTargetDepartmentIds:
        body.allowedAutomaticTargetDepartmentIds,
    });
  }

  @Patch(':channelId')
  @RequireAnyPermission('whatsapp-channels:manage')
  update(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: UpdateWhatsAppChannelDto,
  ) {
    return this.manageChannel.updateConfiguration({
      companyId: current.companyId,
      channelId,
      actorUserId: current.id,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      displayName: body.displayName,
      departmentId: body.departmentId ?? null,
      routingMode: body.routingMode,
      allowedAutomaticTargetDepartmentIds:
        body.allowedAutomaticTargetDepartmentIds,
    });
  }

  @Get(':channelId/pairing')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('whatsapp-channels:connect')
  pairing(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
  ) {
    return this.manageChannel.pairing(current.companyId, channelId);
  }

  @Post(':channelId/actions/request-qr')
  @RequireAnyPermission('whatsapp-channels:connect')
  requestQr(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.requestQr(this.command(current, channelId, body));
  }

  @Post(':channelId/actions/reconnect')
  @RequireAnyPermission('whatsapp-channels:connect')
  reconnect(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.reconnect(this.command(current, channelId, body));
  }

  @Post(':channelId/actions/synchronize-connection')
  @RequireAnyPermission('whatsapp-channels:connect')
  synchronizeConnection(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.synchronizeConnection(
      this.command(current, channelId, body),
    );
  }

  @Post(':channelId/actions/disconnect')
  @RequireAnyPermission('whatsapp-channels:disconnect')
  disconnect(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.disconnect(
      this.command(current, channelId, body),
    );
  }

  @Post(':channelId/actions/cancel-setup')
  @RequireAnyPermission('whatsapp-channels:manage')
  cancelSetup(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.cancelSetup(
      this.command(current, channelId, body),
    );
  }

  @Post(':channelId/actions/disable')
  @RequireAnyPermission('whatsapp-channels:manage')
  disable(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('channelId', new ParseUUIDPipe()) channelId: string,
    @Body() body: WhatsAppChannelCommandDto,
  ) {
    return this.manageChannel.disable(this.command(current, channelId, body));
  }

  private command(
    current: AuthenticatedPrincipal,
    channelId: string,
    body: WhatsAppChannelCommandDto,
  ) {
    return {
      companyId: current.companyId,
      channelId,
      actorUserId: current.id,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      isAdministrator: current.isAdministrator,
      now: new Date(),
    };
  }
}
