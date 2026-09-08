import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Response } from 'express';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { RegistrationContactExportService } from '../../application/use-cases/registrations/registration-contact-export.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';

export class ContactExportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  batch?: number;
}
export class ContactExportCommandDto extends ContactExportQueryDto {
  @IsUUID('4') commandId!: string;
}

@ApiTags('Cadastro')
@ApiBearerAuth()
@RequireAnyPermission('clients:view')
@Controller('registrations/contact-export')
export class RegistrationContactExportController {
  constructor(private readonly contacts: RegistrationContactExportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  preview(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ContactExportQueryDto,
  ) {
    return this.contacts.preview(current, query.batch);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async export(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: ContactExportCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contacts.export(
      current,
      body.commandId,
      body.batch,
    );
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="' + file.fileName + '"',
    );
    response.setHeader('Content-Length', String(file.sizeBytes));
    return new StreamableFile(file.content);
  }
}
