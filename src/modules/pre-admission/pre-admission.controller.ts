import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { PreAdmissionAccessService } from '../../application/use-cases/pre-admission/pre-admission-access.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { Public } from '../../shared/http/decorators/public.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreatePreAdmissionAccessDto,
  ResolvePreAdmissionAccessDto,
  VersionedPreAdmissionAccessDto,
} from './pre-admission.dto';

@ApiTags('Pré-admissão')
@ApiBearerAuth()
@Controller('pre-admission')
export class PreAdmissionController {
  constructor(private readonly accesses: PreAdmissionAccessService) {}

  @Post('accesses')
  @RequireAnyPermission('documents:manage')
  @ApiOperation({
    summary: 'Cria link de pré-admissão por 30 dias',
    description:
      'Retorna o token bruto somente nesta resposta. O candidato não recebe uma conta de usuário.',
  })
  create(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreatePreAdmissionAccessDto,
  ) {
    return this.accesses.create(current, {
      commandId: body.commandId,
      expectedVersion: body.expectedVersion,
      personRegistrationId: body.personRegistrationId,
      documentTypeIds: body.requestedDocuments.map(
        (item) => item.documentTypeId,
      ),
      instructions: Object.fromEntries(
        body.requestedDocuments.flatMap((item) =>
          item.instructions
            ? [[item.documentTypeId, item.instructions] as const]
            : [],
        ),
      ),
    });
  }

  @Post('accesses/:accessId/renew')
  @RequireAnyPermission('documents:manage')
  @ApiOperation({
    summary: 'Rotaciona o token e renova a validade por 30 dias',
  })
  renew(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('accessId', new ParseUUIDPipe({ version: '4' })) accessId: string,
    @Body() body: VersionedPreAdmissionAccessDto,
  ) {
    return this.accesses.renew(current, accessId, body);
  }

  @Post('accesses/:accessId/revoke')
  @RequireAnyPermission('documents:manage')
  @ApiOperation({ summary: 'Revoga o link antes do vencimento' })
  revoke(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('accessId', new ParseUUIDPipe({ version: '4' })) accessId: string,
    @Body() body: VersionedPreAdmissionAccessDto,
  ) {
    return this.accesses.revoke(current, accessId, body);
  }

  @Post('public/resolve')
  @Public()
  @ApiOperation({
    summary: 'Valida um token e apresenta somente o escopo documental',
    description:
      'Não expõe arquivos nem aceita identificadores públicos de documentos.',
  })
  resolve(@Body() body: ResolvePreAdmissionAccessDto) {
    return this.accesses.resolve(body.token);
  }
}
