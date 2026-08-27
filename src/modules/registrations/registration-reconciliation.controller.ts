import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { RegistrationReconciliationService } from '../../application/use-cases/registrations/registration-reconciliation.service';
import { validationError } from '../../core/errors/app-error';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  ListRegistrationCandidatesQueryDto,
  PromoteRegistrationCandidateDto,
  ReviewRegistrationCandidateDto,
} from './dto/registrations.dto';
import type {
  RegistrationCandidateStatus,
  RoutingClientType,
} from '../../infra/database/prisma/generated/client';

interface UploadedRegistrationWorkbook {
  originalname: string;
  buffer: Buffer;
}

function toCandidateStatus(value: string): RegistrationCandidateStatus {
  return value
    .replaceAll('-', '_')
    .toUpperCase() as RegistrationCandidateStatus;
}

@ApiTags('Conciliação de Cadastros')
@ApiBearerAuth()
@Controller('registration-reconciliation')
export class RegistrationReconciliationController {
  constructor(
    private readonly reconciliation: RegistrationReconciliationService,
  ) {}

  @Post('imports')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @RequireAnyPermission('clients:manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 25 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  import(
    @CurrentUser() current: AuthenticatedPrincipal,
    @UploadedFile() file: UploadedRegistrationWorkbook | undefined,
  ) {
    if (!file) throw validationError('Envie a planilha em file.');
    return this.reconciliation.import(current, {
      fileName: file.originalname,
      content: file.buffer,
    });
  }

  @Get('imports')
  @RequireAnyPermission('clients:history', 'clients:manage')
  batches(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.reconciliation.listBatches(current);
  }

  @Get('candidates')
  @RequireAnyPermission('clients:history', 'clients:manage')
  candidates(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ListRegistrationCandidatesQueryDto,
  ) {
    const statuses = query.statuses?.map(toCandidateStatus);
    const type = query.type?.toUpperCase() as RoutingClientType | undefined;
    return this.reconciliation.listCandidates(current, {
      ...query,
      statuses,
      type,
    });
  }

  @Get('candidates/:candidateId')
  @RequireAnyPermission('clients:history', 'clients:manage')
  candidate(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('candidateId', new ParseUUIDPipe({ version: '4' }))
    candidateId: string,
  ) {
    return this.reconciliation.getCandidate(current, candidateId);
  }

  @Patch('candidates/:candidateId/review')
  @RequireAnyPermission('clients:manage')
  review(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('candidateId', new ParseUUIDPipe({ version: '4' }))
    candidateId: string,
    @Body() body: ReviewRegistrationCandidateDto,
  ) {
    return this.reconciliation.review(current, candidateId, body);
  }

  @Post('candidates/:candidateId/promote')
  @RequireAnyPermission('clients:manage')
  promote(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('candidateId', new ParseUUIDPipe({ version: '4' }))
    candidateId: string,
    @Body() body: PromoteRegistrationCandidateDto,
  ) {
    return this.reconciliation.promote(current, candidateId, body);
  }
}
