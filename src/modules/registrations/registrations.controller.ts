import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { RegistrationsService } from '../../application/use-cases/registrations/registrations.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreateCatalogItemDto,
  CreateRegistrationDto,
  ListRegistrationsQueryDto,
  RegistrationConsolidationPreviewQueryDto,
  RegistrationRelationshipDto,
  RemoveRegistrationRelationshipDto,
  UpdateRegistrationDto,
  UpdateRegistrationRelationshipDto,
} from './dto/registrations.dto';

@ApiTags('Cadastro')
@ApiBearerAuth()
@Controller('registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get('catalog')
  @RequireAnyPermission('clients:view')
  catalog(@CurrentUser() current: AuthenticatedPrincipal) {
    return this.registrations.catalog(current);
  }

  @Post('catalog/roles')
  @RequireAnyPermission('clients:manage')
  createRole(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateCatalogItemDto,
  ) {
    return this.registrations.createRole(current, body);
  }

  @Post('catalog/tags')
  @RequireAnyPermission('clients:manage')
  createTag(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateCatalogItemDto,
  ) {
    return this.registrations.createTag(current, body);
  }

  @Post()
  @RequireAnyPermission('clients:create')
  @ApiCreatedResponse({ description: 'Cadastro criado.' })
  create(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: CreateRegistrationDto,
  ) {
    return this.registrations.create(current, body);
  }

  @Get()
  @RequireAnyPermission('clients:view')
  list(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: ListRegistrationsQueryDto,
  ) {
    return this.registrations.list(current, query);
  }

  @Get(':registrationId')
  @RequireAnyPermission('clients:view')
  get(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
  ) {
    return this.registrations.get(current, registrationId);
  }

  @Patch(':registrationId')
  @RequireAnyPermission('clients:update')
  update(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Body() body: UpdateRegistrationDto,
  ) {
    return this.registrations.update(current, registrationId, body);
  }

  @Post(':registrationId/regularize')
  @RequireAnyPermission('clients:update')
  regularize(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Body() body: UpdateRegistrationDto,
  ) {
    return this.registrations.regularize(current, registrationId, body);
  }

  @Get(':registrationId/history')
  @RequireAnyPermission('clients:history')
  history(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
  ) {
    return this.registrations.history(current, registrationId);
  }

  @Get(':registrationId/consolidation-preview')
  @RequireAnyPermission('clients:manage')
  consolidationPreview(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Query() query: RegistrationConsolidationPreviewQueryDto,
  ) {
    return this.registrations.consolidationPreview(
      current,
      registrationId,
      query.duplicateRegistrationId,
    );
  }

  @Post(':registrationId/relationships')
  @RequireAnyPermission('clients:update')
  createRelationship(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Body() body: RegistrationRelationshipDto,
  ) {
    return this.registrations.createRelationship(current, registrationId, body);
  }

  @Patch(':registrationId/relationships/:relationshipId')
  @RequireAnyPermission('clients:update')
  updateRelationship(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Param('relationshipId', new ParseUUIDPipe({ version: '4' }))
    relationshipId: string,
    @Body() body: UpdateRegistrationRelationshipDto,
  ) {
    return this.registrations.updateRelationship(
      current,
      registrationId,
      relationshipId,
      body,
    );
  }

  @Delete(':registrationId/relationships/:relationshipId')
  @RequireAnyPermission('clients:update')
  removeRelationship(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('registrationId', new ParseUUIDPipe({ version: '4' }))
    registrationId: string,
    @Param('relationshipId', new ParseUUIDPipe({ version: '4' }))
    relationshipId: string,
    @Body() body: RemoveRegistrationRelationshipDto,
  ) {
    return this.registrations.removeRelationship(
      current,
      registrationId,
      relationshipId,
      body,
    );
  }
}
