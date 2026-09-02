import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { InterpretWhatsAppMediaUseCase } from '../../application/use-cases/whatsapp/interpret-whatsapp-media.use-case';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import { CorrectMediaInterpretationDto } from './dto/media-interpretation.dto';

@ApiTags('Painel WhatsApp')
@ApiBearerAuth()
@RequireAnyPermission(
  'whatsapp-conversations:view',
  'whatsapp-conversations:manage',
)
@Controller('whatsapp/conversations')
export class WhatsAppMediaInterpretationController {
  constructor(
    private readonly interpretations: InterpretWhatsAppMediaUseCase,
  ) {}

  @Get(':conversationId/messages/:messageId/media-interpretation')
  @ApiOkResponse({
    description:
      'Retorna interpretação, provenance e correção humana efetiva da mídia.',
  })
  get(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ) {
    return this.interpretations.getMessage({
      companyId: current.companyId,
      conversationId,
      messageId,
    });
  }

  @Post(':conversationId/messages/:messageId/actions/analyze-media')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiOkResponse({
    description:
      'Executa a única análise permitida para a mídia usando o agente media-specialist.',
  })
  analyze(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ) {
    return this.interpretations.analyzeMessage({
      companyId: current.companyId,
      conversationId,
      messageId,
      actorUserId: current.id,
    });
  }

  @Post(':conversationId/messages/:messageId/media-interpretation/correction')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiOkResponse({
    description:
      'Registra uma correção humana imutável e prioritária sem reanalisar a mídia.',
  })
  correct(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body() body: CorrectMediaInterpretationDto,
  ) {
    return this.interpretations.correctMessage({
      companyId: current.companyId,
      conversationId,
      messageId,
      actorUserId: current.id,
      correction: body.correction,
      feedback: body.feedback,
    });
  }
}
