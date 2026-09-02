import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ConversationRegistrationUseCase,
  IdentifyConversationParticipantUseCase,
} from '../../application/use-cases/registrations/conversation-registration.use-case';
import {
  CurrentService,
  type ServicePrincipal,
} from '../../shared/http/decorators/current-service.decorator';
import { Public } from '../../shared/http/decorators/public.decorator';
import { ServiceIdentityGuard } from '../../shared/http/guards/service-identity.guard';
import {
  AbandonRegistrationDraftDto,
  ConfirmRegistrationDraftDto,
  PreviewRegistrationDraftDto,
  StartRegistrationDraftDto,
  UpdateRegistrationDraftDto,
} from './dto/registration-conversation.dto';

@ApiTags('Cadastro pela conversa interno')
@ApiBearerAuth('serviceBearer')
@Public()
@UseGuards(ServiceIdentityGuard)
@Controller('internal/registration-conversations')
export class InternalRegistrationConversationsController {
  constructor(
    private readonly identity: IdentifyConversationParticipantUseCase,
    private readonly registration: ConversationRegistrationUseCase,
  ) {}

  @Post('sessions/:serviceSessionId/identity-resolution')
  @ApiOperation({
    summary: 'Resolve identidade antes da primeira resposta do agente',
    description:
      'Nunca retorna nomes, CPF/CNPJ ou valores salvos; telefone compartilhado exige desambiguação.',
  })
  resolveIdentity(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
  ) {
    return this.identity.resolveBeforeResponse({
      companyId: service.companyId,
      serviceSessionId,
    });
  }

  @Post('sessions/:serviceSessionId/drafts')
  start(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Body() body: StartRegistrationDraftDto,
  ) {
    return this.registration.start({
      companyId: service.companyId,
      serviceSessionId,
      ...body,
    });
  }

  @Patch('sessions/:serviceSessionId/drafts/:draftId')
  update(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) draftId: string,
    @Body() body: UpdateRegistrationDraftDto,
  ) {
    const { person, company, relationship, ...command } = body;
    return this.registration.update({
      companyId: service.companyId,
      serviceSessionId,
      draftId,
      ...command,
      patch: { person, company, relationship },
    });
  }

  @Post('sessions/:serviceSessionId/drafts/:draftId/preview')
  @ApiOperation({
    summary: 'Mostra o resumo final apenas com valores fornecidos no draft',
  })
  preview(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) draftId: string,
    @Body() body: PreviewRegistrationDraftDto,
  ) {
    return this.registration.preview({
      companyId: service.companyId,
      serviceSessionId,
      draftId,
      ...body,
    });
  }

  @Post('sessions/:serviceSessionId/drafts/:draftId/confirm')
  @ApiOperation({
    summary: 'Confirma e persiste PF/PJ/vínculo em uma única transação',
  })
  confirm(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) draftId: string,
    @Body() body: ConfirmRegistrationDraftDto,
  ) {
    return this.registration.confirm({
      companyId: service.companyId,
      serviceSessionId,
      draftId,
      ...body,
    });
  }

  @Post('sessions/:serviceSessionId/abandon')
  @ApiOperation({
    summary: 'Abandona/recusa cadastro sem bloquear orçamento',
  })
  abandon(
    @CurrentService() service: ServicePrincipal,
    @Param('serviceSessionId', new ParseUUIDPipe({ version: '4' }))
    serviceSessionId: string,
    @Body() body: AbandonRegistrationDraftDto,
  ) {
    return this.registration.abandon({
      companyId: service.companyId,
      serviceSessionId,
      ...body,
    });
  }
}
