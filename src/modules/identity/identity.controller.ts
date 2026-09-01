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
import { UserPersonMatchingService } from '../../application/use-cases/identity/user-person-matching.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import { AssociateUserPersonDto } from './identity.dto';

@ApiTags('Identidade')
@ApiBearerAuth()
@Controller('identity')
export class IdentityController {
  constructor(private readonly matching: UserPersonMatchingService) {}

  @Get('users/:userId/person-match-preview')
  @RequireAnyPermission('users:manage')
  @ApiOkResponse({
    description:
      'Simula a associação conservadora entre Usuário e Pessoa sem persistir vínculo.',
  })
  previewUserPersonMatch(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.matching.preview(current, userId);
  }

  @Post('users/:userId/person-association')
  @RequireAnyPermission('users:manage')
  @ApiOkResponse({
    description:
      'Associa o Usuário à Pessoa por CPF único ou por confirmação humana auditada.',
  })
  associateUserPerson(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() body: AssociateUserPersonDto,
  ) {
    return this.matching.associate(current, userId, body);
  }

  @Get('users/:userId/person-association-history')
  @RequireAnyPermission('users:manage')
  @ApiOkResponse({
    description: 'Histórico auditável da associação do Usuário.',
  })
  userPersonHistory(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    return this.matching.history(current, userId);
  }
}
