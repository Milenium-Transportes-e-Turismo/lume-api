import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { KnowledgeManagementUseCase } from '../../application/use-cases/knowledge/knowledge-management.use-case';
import { validationError } from '../../core/errors/app-error';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreateKnowledgeArticleDto,
  CreateKnowledgeBaseDto,
  CreateNextKnowledgeDraftDto,
  KnowledgeGapQueryDto,
  KnowledgeSuggestionQueryDto,
  ListKnowledgeDocumentsQueryDto,
  ReviewKnowledgeGapDto,
  ReviewKnowledgeSuggestionDto,
  UpdateKnowledgeDraftDto,
  UploadKnowledgeOriginalDto,
  VersionedKnowledgeCommandDto,
} from './dto/knowledge.dto';

interface KnowledgeUpload {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

function date(value?: string): Date | null {
  return value ? new Date(value) : null;
}

function contentDisposition(fileName: string): string {
  const fallback =
    fileName
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/gu, '')
      .replace(/["\\\r\n]/gu, '_')
      .slice(0, 180) || 'knowledge-original';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeManagementUseCase) {}

  @Get('departments')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  @ApiOperation({
    summary: 'Lista departamentos válidos para o scope de conhecimento',
  })
  departments(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.knowledge.listScopeDepartments(current.companyId);
  }

  @Get('bases')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  bases(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.knowledge.listBases(current.companyId);
  }

  @Post('bases')
  @RequireAnyPermission('knowledge:manage')
  createBase(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateKnowledgeBaseDto,
  ) {
    return this.knowledge.createBase({
      companyId: current.companyId,
      actorUserId: current.id,
      ...body,
    });
  }

  @Get('documents')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  documents(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ListKnowledgeDocumentsQueryDto,
  ) {
    return this.knowledge.listDocuments({
      companyId: current.companyId,
      ...(query.knowledgeBaseId
        ? { knowledgeBaseId: query.knowledgeBaseId }
        : {}),
    });
  }

  @Get('documents/:documentId')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  detail(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
  ) {
    return this.knowledge.detail(current.companyId, documentId);
  }

  @Post('articles')
  @RequireAnyPermission('knowledge:manage')
  createArticle(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateKnowledgeArticleDto,
  ) {
    return this.knowledge.createArticle({
      companyId: current.companyId,
      actorUserId: current.id,
      ...body,
      effectiveFrom: date(body.effectiveFrom),
      effectiveUntil: date(body.effectiveUntil),
    });
  }

  @Post('files')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @RequireAnyPermission('knowledge:manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'file',
        'commandId',
        'knowledgeBaseId',
        'title',
        'scope',
        'visibility',
      ],
      properties: {
        file: { type: 'string', format: 'binary' },
        commandId: { type: 'string', format: 'uuid' },
        knowledgeBaseId: { type: 'string', format: 'uuid' },
        title: { type: 'string', maxLength: 240 },
        description: { type: 'string', maxLength: 4000 },
        scope: { enum: ['tenant', 'department', 'multi-department'] },
        visibility: { enum: ['customer-safe', 'internal'] },
        departmentIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        },
        effectiveFrom: { type: 'string', format: 'date-time' },
        effectiveUntil: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Preserva original e cria draft com extração segura quando suportada',
    description:
      'TXT, CSV, XLSX, DOCX e PDF textual possuem extração local limitada. PDF somente com imagem exige OCR e permanece sem conteúdo indexável.',
  })
  upload(
    @CurrentUser() current: AuthenticatedPrincipal,
    @UploadedFile() file: KnowledgeUpload | undefined,
    @Body() body: UploadKnowledgeOriginalDto,
  ) {
    if (!file) throw validationError('Envie exatamente um arquivo em file.');
    return this.knowledge.uploadOriginal({
      companyId: current.companyId,
      actorUserId: current.id,
      ...body,
      effectiveFrom: date(body.effectiveFrom),
      effectiveUntil: date(body.effectiveUntil),
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      content: file.buffer,
    });
  }

  @Post('documents/:documentId/drafts')
  @RequireAnyPermission('knowledge:manage')
  createNextDraft(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Body() body: CreateNextKnowledgeDraftDto,
  ) {
    return this.knowledge.createNextDraft({
      companyId: current.companyId,
      actorUserId: current.id,
      documentId,
      ...body,
      effectiveFrom: date(body.effectiveFrom),
      effectiveUntil: date(body.effectiveUntil),
    });
  }

  @Patch('documents/:documentId/versions/:versionId/draft')
  @RequireAnyPermission('knowledge:manage')
  updateDraft(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body() body: UpdateKnowledgeDraftDto,
  ) {
    return this.knowledge.updateDraft({
      companyId: current.companyId,
      actorUserId: current.id,
      documentId,
      versionId,
      ...body,
      effectiveFrom: date(body.effectiveFrom),
      effectiveUntil: date(body.effectiveUntil),
    });
  }

  @Post('documents/:documentId/versions/:versionId/publish')
  @RequireAnyPermission('knowledge:publish')
  publish(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body() body: VersionedKnowledgeCommandDto,
  ) {
    return this.knowledge.publish({
      companyId: current.companyId,
      actorUserId: current.id,
      documentId,
      versionId,
      ...body,
    });
  }

  @Post('documents/:documentId/versions/:versionId/archive')
  @RequireAnyPermission('knowledge:manage', 'knowledge:publish')
  archiveVersion(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body() body: VersionedKnowledgeCommandDto,
  ) {
    return this.knowledge.archiveVersion({
      companyId: current.companyId,
      actorUserId: current.id,
      documentId,
      versionId,
      ...body,
    });
  }

  @Post('documents/:documentId/archive')
  @RequireAnyPermission('knowledge:manage')
  archiveDocument(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Body() body: VersionedKnowledgeCommandDto,
  ) {
    return this.knowledge.archiveDocument({
      companyId: current.companyId,
      actorUserId: current.id,
      documentId,
      ...body,
    });
  }

  @Get('documents/:documentId/versions/:versionId/original')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  @Header('Cache-Control', 'private, no-store')
  async original(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const original = await this.knowledge.original(
      current.companyId,
      documentId,
      versionId,
    );
    response.setHeader('Content-Type', original.mimeType);
    response.setHeader('Content-Length', String(original.sizeBytes));
    response.setHeader(
      'Content-Disposition',
      contentDisposition(original.fileName),
    );
    response.setHeader('x-content-sha256', original.sha256);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
    return new StreamableFile(original.content);
  }

  @Get('suggestions')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  suggestions(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: KnowledgeSuggestionQueryDto,
  ) {
    return this.knowledge.listSuggestions(current.companyId, query.status);
  }

  @Post('suggestions/:suggestionId/review')
  @RequireAnyPermission('knowledge:manage')
  reviewSuggestion(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('suggestionId', new ParseUUIDPipe({ version: '4' }))
    suggestionId: string,
    @Body() body: ReviewKnowledgeSuggestionDto,
  ) {
    return this.knowledge.reviewSuggestion({
      companyId: current.companyId,
      actorUserId: current.id,
      suggestionId,
      ...body,
    });
  }

  @Get('gaps')
  @RequireAnyPermission(
    'knowledge:view',
    'knowledge:manage',
    'knowledge:publish',
  )
  gaps(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: KnowledgeGapQueryDto,
  ) {
    return this.knowledge.listGaps(current.companyId, query.status);
  }

  @Post('gaps/:gapId/review')
  @RequireAnyPermission('knowledge:manage')
  reviewGap(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('gapId', new ParseUUIDPipe({ version: '4' })) gapId: string,
    @Body() body: ReviewKnowledgeGapDto,
  ) {
    return this.knowledge.reviewGap({
      companyId: current.companyId,
      actorUserId: current.id,
      gapId,
      ...body,
    });
  }
}
