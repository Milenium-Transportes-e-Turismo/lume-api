import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { TransportCatalogUseCase } from './transport-catalog.use-case';

@ApiTags('Transporte - cadastros e contratos')
@ApiBearerAuth()
@Controller('transport')
export class TransportCatalogController {
  constructor(private readonly catalog: TransportCatalogUseCase) {}
  @Get('contracts/candidates')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  contractCandidates(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.contractCandidates(current, query);
  }
  @Post('fleet/:id/ownerships')
  @RequireAnyPermission('trips:update', 'trips:manage')
  ownership(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.fleetOwnership(current, id, body);
  }
  @Patch('fleet/:id/ownerships/:periodId')
  @RequireAnyPermission('trips:update', 'trips:manage')
  closeOwnership(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.fleetOwnership(current, id, body, periodId);
  }
  @Post('catalogs/initialize')
  @RequireAnyPermission('trips:create', 'trips:manage')
  initialize(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.initialize(current, body);
  }
  @Post('contracts/:id/conditions')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  condition(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.addPeriod(current, 'contracts', id, body);
  }
  @Patch('contracts/:id/conditions/:periodId')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  closeCondition(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.closePeriod(current, 'contracts', id, periodId, body);
  }
  @Post('routes/:id/assignments')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  assignment(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.addPeriod(current, 'routes', id, body);
  }
  @Patch('routes/:id/assignments/:periodId')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  closeAssignment(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.closePeriod(current, 'routes', id, periodId, body);
  }
  @Get('companies')
  @RequireAnyPermission('clients:view', 'clients:manage')
  listCompanies(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'companies', query);
  }
  @Get('companies/:id/history')
  @RequireAnyPermission('clients:view', 'clients:manage')
  historyCompanies(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'companies', id, query);
  }
  @Get('companies/:id')
  @RequireAnyPermission('clients:view', 'clients:manage')
  getCompanies(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'companies', id);
  }
  @Post('companies')
  @RequireAnyPermission('clients:create', 'clients:manage')
  createCompanies(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'companies', body);
  }
  @Patch('companies/:id')
  @RequireAnyPermission('clients:update', 'clients:manage')
  updateCompanies(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'companies', body, id);
  }
  @Get('fleet')
  @RequireAnyPermission('trips:view', 'trips:manage')
  listFleet(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'fleet', query);
  }
  @Get('fleet/:id/history')
  @RequireAnyPermission('trips:view', 'trips:manage')
  historyFleet(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'fleet', id, query);
  }
  @Get('fleet/:id')
  @RequireAnyPermission('trips:view', 'trips:manage')
  getFleet(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'fleet', id);
  }
  @Post('fleet')
  @RequireAnyPermission('trips:create', 'trips:manage')
  createFleet(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'fleet', body);
  }
  @Patch('fleet/:id')
  @RequireAnyPermission('trips:update', 'trips:manage')
  updateFleet(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'fleet', body, id);
  }
  @Get('catalogs')
  @RequireAnyPermission('trips:view', 'trips:manage')
  listCatalogs(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'catalogs', query);
  }
  @Get('catalogs/:id/history')
  @RequireAnyPermission('trips:view', 'trips:manage')
  historyCatalogs(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'catalogs', id, query);
  }
  @Get('catalogs/:id')
  @RequireAnyPermission('trips:view', 'trips:manage')
  getCatalogs(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'catalogs', id);
  }
  @Post('catalogs')
  @RequireAnyPermission('trips:create', 'trips:manage')
  createCatalogs(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'catalogs', body);
  }
  @Patch('catalogs/:id')
  @RequireAnyPermission('trips:update', 'trips:manage')
  updateCatalogs(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'catalogs', body, id);
  }
  @Get('affiliations')
  @RequireAnyPermission('clients:view', 'clients:manage')
  listAffiliations(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'affiliations', query);
  }
  @Get('affiliations/:id/history')
  @RequireAnyPermission('clients:view', 'clients:manage')
  historyAffiliations(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'affiliations', id, query);
  }
  @Get('affiliations/:id')
  @RequireAnyPermission('clients:view', 'clients:manage')
  getAffiliations(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'affiliations', id);
  }
  @Post('affiliations')
  @RequireAnyPermission('clients:create', 'clients:manage')
  createAffiliations(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'affiliations', body);
  }
  @Patch('affiliations/:id')
  @RequireAnyPermission('clients:update', 'clients:manage')
  updateAffiliations(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'affiliations', body, id);
  }
  @Get('contracts')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  listContracts(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'contracts', query);
  }
  @Get('contracts/:id/history')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  historyContracts(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'contracts', id, query);
  }
  @Get('contracts/:id')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  getContracts(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'contracts', id);
  }
  @Post('contracts')
  @RequireAnyPermission('contracts:create', 'contracts:manage')
  createContracts(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'contracts', body);
  }
  @Patch('contracts/:id')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  updateContracts(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'contracts', body, id);
  }
  @Get('routes')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  listRoutes(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.list(current, 'routes', query);
  }
  @Get('routes/:id/history')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  historyRoutes(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.catalog.history(current, 'routes', id, query);
  }
  @Get('routes/:id')
  @RequireAnyPermission('contracts:view', 'contracts:manage')
  getRoutes(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalog.get(current, 'routes', id);
  }
  @Post('routes')
  @RequireAnyPermission('contracts:create', 'contracts:manage')
  createRoutes(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'routes', body);
  }
  @Patch('routes/:id')
  @RequireAnyPermission('contracts:update', 'contracts:manage')
  updateRoutes(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.save(current, 'routes', body, id);
  }
  @Delete('companies/:id')
  @RequireAnyPermission('clients:update', 'clients:manage')
  deactivate(
    @CurrentUser() current: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.deactivate(current, id, body);
  }
}
