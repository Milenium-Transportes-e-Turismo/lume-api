import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { RegistrationDataReviewUseCase } from '../../application/use-cases/registrations/conversation-registration.use-case';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  DecideRegistrationDataReviewDto,
  RegistrationDataReviewQueryDto,
} from './dto/registration-conversation.dto';

@ApiTags('Revisões de dados cadastrais')
@ApiBearerAuth()
@Controller('registration-data-reviews')
export class RegistrationDataReviewsController {
  constructor(private readonly reviews: RegistrationDataReviewUseCase) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('clients:manage')
  @ApiOperation({
    summary: 'Lista divergências cadastrais para decisão humana',
  })
  list(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: RegistrationDataReviewQueryDto,
  ) {
    return this.reviews.list(current.companyId, query.status);
  }

  @Post(':reviewId/decision')
  @Header('Cache-Control', 'private, no-store')
  @RequireAnyPermission('clients:manage')
  @ApiOperation({
    summary: 'Aprova ou rejeita uma divergência com auditoria humana',
  })
  decide(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() body: DecideRegistrationDataReviewDto,
  ) {
    return this.reviews.decide({
      companyId: current.companyId,
      actorUserId: current.id,
      reviewId,
      ...body,
    });
  }
}
