import { createHash, randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import type { ConversationAccessScope } from '../../application/contracts/whatsapp.repository';
import { WhatsAppMediaStorage } from '../../application/contracts/whatsapp-media.storage';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { QuoteProposalUseCase } from '../../application/use-cases/commercial/commercial-quotes.use-case';
import {
  CreateHumanOutboundWhatsAppUseCase,
  EnsureWhatsAppConversationUseCase,
  QueryWhatsAppUseCase,
  TransitionWhatsAppConversationUseCase,
} from '../../application/use-cases/whatsapp/whatsapp.use-cases';
import { forbidden, validationError } from '../../core/errors/app-error';
import { normalizeUserDepartment } from '../../domain/access/access.constants';
import {
  MAXIMUM_PANEL_ATTACHMENT_BYTES,
  PANEL_ARCHIVE_MIME_TYPES,
} from '../../domain/whatsapp/whatsapp-media-policy';
import { EvolutionMediaContentService } from '../../infra/integrations/evolution/evolution-media-content.service';
import { normalizeWhatsAppPhone } from '../../shared/utils/normalization';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CloseConversationDto,
  ConversationListQueryDto,
  CreateHumanOutboundMessageDto,
  CreateHumanOutboundMediaDto,
  ForwardConversationDto,
  MessageListQueryDto,
  RequestConversationTransferDto,
  StartHumanConversationDto,
  TransitionListQueryDto,
  VersionedCommandDto,
} from './dto/whatsapp.dto';

function contentDisposition(fileName: string): string {
  const fallback =
    fileName
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\\r\n]/g, '_')
      .slice(0, 180) || 'midia-whatsapp';
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags('Painel WhatsApp')
@ApiBearerAuth()
@RequireAnyPermission(
  'whatsapp-conversations:view',
  'whatsapp-conversations:manage',
)
@Controller('whatsapp/conversations')
export class WhatsAppPanelController {
  constructor(
    private readonly queryUseCase: QueryWhatsAppUseCase,
    private readonly commercialQuotes: QuoteProposalUseCase,
    private readonly ensureConversation: EnsureWhatsAppConversationUseCase,
    private readonly transition: TransitionWhatsAppConversationUseCase,
    private readonly createHumanOutbound: CreateHumanOutboundWhatsAppUseCase,
    private readonly mediaContent: EvolutionMediaContentService,
    private readonly mediaStorage: WhatsAppMediaStorage,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiCreatedResponse({
    description:
      'Cria ou reutiliza a conversa can\u00f4nica do n\u00famero e inicia o atendimento humano.',
  })
  async startConversation(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: StartHumanConversationDto,
  ) {
    let phoneNormalized: string;
    try {
      phoneNormalized = normalizeWhatsAppPhone(body.phone);
    } catch {
      throw validationError(
        'Informe um n\u00famero de WhatsApp v\u00e1lido com DDD.',
      );
    }

    const conversation = await this.ensureConversation.execute(
      current.companyId,
      phoneNormalized,
    );
    if (conversation.conversationState === 'human-active') {
      if (conversation.assignedTo?.id === current.id) return conversation;
    }

    return this.transition.execute({
      companyId: current.companyId,
      conversationId: conversation.id,
      commandId: body.commandId,
      expectedVersion: conversation.version,
      name: 'take-over',
      actorType: 'user',
      actorUserId: current.id,
      metadata: { source: 'panel-new-conversation' },
    });
  }

  @Get()
  list(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ConversationListQueryDto,
  ) {
    return this.scopedConversationList(current, query);
  }

  @Get('dashboard')
  @RequireAnyPermission('dashboard:view')
  @ApiOkResponse({
    description:
      'Indicadores operacionais limitados aos departamentos atribuídos ao usuário autenticado.',
  })
  dashboard(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ConversationListQueryDto,
  ) {
    return this.scopedConversationList(current, query);
  }

  private scopedConversationList(
    current: AuthenticatedPrincipal,
    query: ConversationListQueryDto,
  ) {
    const { departments: assignedDepartments } =
      this.conversationAccessScope(current);
    if (assignedDepartments === null) {
      return this.queryUseCase.listConversations(current.companyId, query);
    }

    if (query.department) {
      if (!assignedDepartments.includes(query.department)) {
        throw forbidden(
          'O departamento solicitado não está atribuído ao seu perfil.',
        );
      }

      return this.queryUseCase.listConversations(current.companyId, query);
    }

    if (query.requestStatus && !assignedDepartments.includes('commercial')) {
      throw forbidden(
        'A situação da solicitação pertence somente à fila Comercial.',
      );
    }

    return this.queryUseCase.listConversations(current.companyId, {
      ...query,
      ...(assignedDepartments.length === 1
        ? { department: assignedDepartments[0] }
        : { departments: assignedDepartments }),
    });
  }

  private conversationAccessScope(
    current: AuthenticatedPrincipal,
  ): ConversationAccessScope {
    const departments = Array.from(
      new Set(current.departments.map(normalizeUserDepartment)),
    );
    if (departments.length > 0) return { departments };
    if (current.permissions.includes('whatsapp-conversations:manage')) {
      return { departments: null };
    }
    throw forbidden(
      'Seu perfil não possui departamento atribuído para consultar esta fila.',
    );
  }

  @Get(':conversationId')
  detail(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ) {
    return this.queryUseCase.getConversation(
      current.companyId,
      conversationId,
      this.conversationAccessScope(current),
    );
  }

  @Get(':conversationId/messages')
  messages(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: MessageListQueryDto,
  ) {
    return this.queryUseCase.listMessages(
      current.companyId,
      conversationId,
      query,
      this.conversationAccessScope(current),
    );
  }

  @Get(':conversationId/messages/:messageId/content')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({
    description: 'Conteúdo da mídia disponível para visualização segura.',
  })
  async messageContent(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const media = await this.mediaContent.getContent(
      current.companyId,
      conversationId,
      messageId,
      this.conversationAccessScope(current).departments,
    );
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Content-Length', String(media.content.byteLength));
    response.setHeader(
      'Content-Disposition',
      contentDisposition(media.fileName),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'X-WhatsApp-Media-Filename',
      encodeURIComponent(media.fileName),
    );
    response.setHeader('X-WhatsApp-Media-Kind', media.kind);
    return new StreamableFile(media.content);
  }

  @Post(':conversationId/messages/:messageId/content/retain')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiOkResponse({
    description:
      'Armazena de forma idempotente uma mídia histórica que ainda esteja disponível.',
  })
  async retainMessageContent(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ) {
    const result = await this.mediaContent.retainInbound(
      current.companyId,
      conversationId,
      messageId,
      this.conversationAccessScope(current).departments,
    );
    return {
      available: ['stored', 'already-stored'].includes(result.status),
      message:
        result.status === 'unavailable'
          ? 'Este arquivo antigo não está mais disponível.'
          : result.status === 'too-large'
            ? 'Este arquivo excede o limite permitido para armazenamento.'
            : 'Arquivo armazenado com segurança.',
      ...(result.sizeBytes ? { sizeBytes: result.sizeBytes } : {}),
      ...(result.mimeType ? { mimeType: result.mimeType } : {}),
    };
  }

  @Get(':conversationId/transitions')
  transitions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: TransitionListQueryDto,
  ) {
    return this.queryUseCase.listTransitions(
      current.companyId,
      conversationId,
      query,
      this.conversationAccessScope(current),
    );
  }

  @Post(':conversationId/messages')
  @RequireAnyPermission('whatsapp-conversations:manage')
  createMessage(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: CreateHumanOutboundMessageDto,
  ) {
    return this.createHumanOutbound.execute({
      ...body,
      companyId: current.companyId,
      conversationId,
      actorUserId: current.id,
    });
  }

  @Post(':conversationId/media-messages')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: MAXIMUM_PANEL_ATTACHMENT_BYTES,
      },
    }),
  )
  async createMediaMessage(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: CreateHumanOutboundMediaDto,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
  ) {
    if (!file?.buffer?.length || file.size !== file.buffer.byteLength) {
      throw validationError('Selecione um arquivo válido para enviar.');
    }
    const mimeType = file.mimetype.trim().toLowerCase().split(';')[0];
    const allowed = new Set([
      ...(this.config.get<string>('WHATSAPP_ALLOWED_MIME_TYPES') ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      'text/vcard',
      'text/x-vcard',
      ...PANEL_ARCHIVE_MIME_TYPES,
    ]);
    if (!allowed.has(mimeType)) {
      throw validationError('Este formato de arquivo não pode ser enviado.');
    }
    const configuredMaximum =
      this.config.get<number>('WHATSAPP_PANEL_MAX_ATTACHMENT_BYTES') ??
      MAXIMUM_PANEL_ATTACHMENT_BYTES;
    if (
      file.size > Math.min(configuredMaximum, MAXIMUM_PANEL_ATTACHMENT_BYTES)
    ) {
      throw validationError(
        'O arquivo ultrapassa o tamanho aceito pelo WhatsApp.',
      );
    }

    const fileName = (file.originalname.split(/[\\/]/).pop() ?? 'arquivo')
      .split('')
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 ? '_' : character;
      })
      .join('')
      .replace(/[<>:"|?*]/g, '_')
      .slice(0, 200);
    const messageId = randomUUID();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = [
      'v1',
      current.companyId,
      conversationId,
      messageId,
      sha256,
    ].join('/');
    if (body.mediaKind === 'sticker' && mimeType !== 'image/webp') {
      throw validationError('Figurinhas devem ser enviadas no formato WebP.');
    }
    const kind =
      body.mediaKind === 'sticker'
        ? 'sticker'
        : mimeType.startsWith('image/')
          ? 'image'
          : mimeType.startsWith('video/')
            ? 'video'
            : mimeType.startsWith('audio/')
              ? 'audio'
              : mimeType === 'text/vcard' || mimeType === 'text/x-vcard'
                ? 'contact'
                : 'document';

    await this.mediaStorage.write({ storageKey, content: file.buffer });
    try {
      return await this.createHumanOutbound.execute({
        commandId: body.commandId,
        idempotencyKey: body.idempotencyKey,
        expectedVersion: body.expectedVersion,
        companyId: current.companyId,
        conversationId,
        actorUserId: current.id,
        text: body.caption,
        attachment: {
          messageId,
          kind,
          fileName,
          mimeType,
          sizeBytes: file.size,
          sha256,
          storageKey,
        },
      });
    } catch (error) {
      await this.mediaStorage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  @Get(':conversationId/quote-request')
  quote(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ) {
    return this.commercialQuotes.currentForConversation(
      current.companyId,
      conversationId,
      this.conversationAccessScope(current),
    );
  }

  @Post(':conversationId/actions/take-over')
  @RequireAnyPermission('whatsapp-conversations:manage')
  takeOver(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'take-over');
  }

  @Post(':conversationId/actions/return-to-bot')
  @RequireAnyPermission('whatsapp-conversations:manage')
  returnToBot(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'return-to-bot');
  }

  @Post(':conversationId/actions/forward')
  @RequireAnyPermission('whatsapp-conversations:manage')
  forward(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: ForwardConversationDto,
  ) {
    return this.panelTransition(
      current,
      conversationId,
      body,
      'request-transfer',
      {
        targetDepartment: body.targetDepartment,
        metadata: {
          source: 'panel-legacy-forward',
          reason: body.reason,
        },
      },
    );
  }

  @Post(':conversationId/actions/request-transfer')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiCreatedResponse({
    description:
      'Registra uma transferência pendente na fila do destino, mantendo a origem responsável até o aceite.',
  })
  requestTransfer(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: RequestConversationTransferDto,
  ) {
    return this.panelTransition(
      current,
      conversationId,
      body,
      'request-transfer',
      {
        targetDepartment: body.targetDepartment,
        metadata: {
          source: 'panel-transfer-request',
          reason: body.reason,
        },
      },
    );
  }

  @Post(':conversationId/actions/accept-transfer')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiCreatedResponse({
    description:
      'Aceita uma transferência pendente e atribui a conversa ao usuário autenticado do departamento de destino.',
  })
  acceptTransfer(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(
      current,
      conversationId,
      body,
      'accept-transfer',
    );
  }

  @Post(':conversationId/actions/change-department')
  @RequireAnyPermission('whatsapp-conversations:manage')
  changeDepartment(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: ForwardConversationDto,
  ) {
    return this.panelTransition(
      current,
      conversationId,
      body,
      'change-department',
      {
        targetDepartment: body.targetDepartment,
        metadata: {
          source: 'panel-department-change',
          reason: body.reason,
        },
      },
    );
  }

  @Post(':conversationId/actions/archive')
  @RequireAnyPermission('whatsapp-conversations:manage')
  archive(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'archive');
  }

  @Post(':conversationId/actions/unarchive')
  @RequireAnyPermission('whatsapp-conversations:manage')
  unarchive(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'unarchive');
  }

  @Post(':conversationId/actions/mark-read')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiOkResponse({ description: 'Contador zerado com concorrência otimista.' })
  markRead(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: VersionedCommandDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'mark-read');
  }

  @Post(':conversationId/actions/close')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiCreatedResponse({
    description:
      'Encerra uma conversa sem proposta ativa e registra motivo, ator e data na transição e na auditoria.',
  })
  close(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: CloseConversationDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'close', {
      metadata: { reason: body.reason ?? null },
    });
  }

  @Post(':conversationId/actions/close-after-rejection')
  @RequireAnyPermission('whatsapp-conversations:manage')
  @ApiOperation({
    deprecated: true,
    summary: 'Alias compatível da ação canônica de encerramento',
  })
  @ApiCreatedResponse({
    description:
      'Alias legado da ação canônica de encerramento; aplica as mesmas regras e produz a transição close.',
  })
  closeAfterRejection(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() body: CloseConversationDto,
  ) {
    return this.panelTransition(current, conversationId, body, 'close', {
      metadata: { reason: body.reason ?? null },
    });
  }

  private panelTransition(
    current: AuthenticatedPrincipal,
    conversationId: string,
    body: VersionedCommandDto,
    name:
      | 'take-over'
      | 'request-transfer'
      | 'accept-transfer'
      | 'return-to-bot'
      | 'forward'
      | 'change-department'
      | 'mark-read'
      | 'archive'
      | 'unarchive'
      | 'close',
    extra: {
      targetDepartment?: ForwardConversationDto['targetDepartment'];
      metadata?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    return this.transition.execute({
      companyId: current.companyId,
      conversationId,
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      name,
      actorType: 'user',
      actorUserId: current.id,
      ...extra,
    });
  }
}
