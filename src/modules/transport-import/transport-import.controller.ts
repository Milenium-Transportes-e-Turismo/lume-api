import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { TransportSummaryService } from '../../application/use-cases/transport/transport-summary.service';
import { TransportImportService } from '../../application/use-cases/transport/transport-import.service';
import { CurrentUser } from '../../shared/http/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../shared/http/decorators/require-permissions.decorator';

@ApiTags('Transportes: importação e conferência')
@ApiBearerAuth()
@RequireAnyPermission('trips:view', 'trips:manage')
@Controller('transport')
export class TransportImportController {
  constructor(
    private readonly service: TransportImportService,
    private readonly summaries: TransportSummaryService,
  ) {}
  @Get('summary') summary(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query() q: unknown,
  ) {
    return this.summaries.summary(p.companyId, q);
  }
  @Post('summary/period-state')
  @RequireAnyPermission('trips:manage')
  periodState(@CurrentUser() p: AuthenticatedPrincipal, @Body() body: unknown) {
    return this.summaries.setState(p, body);
  }
  @Get('integration') integration(@CurrentUser() p: AuthenticatedPrincipal) {
    return this.service.integration(p.companyId);
  }
  @Patch('integration') @RequireAnyPermission('trips:manage') configure(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.service.configure(p, body);
  }
  @Get('imports') imports(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query() query: unknown,
  ) {
    return this.service.listImports(p.companyId, query);
  }
  @Get('imports/:id') importDetail(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.importDetail(p.companyId, id);
  }
  @Get('imports/:id/rejections') rejections(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: unknown,
  ) {
    return this.service.rejections(p.companyId, id, q);
  }
  @Post('imports') @RequireAnyPermission('trips:manage') createImport(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.service.createImport(p, body);
  }
  @Post('imports/:id/resume') @RequireAnyPermission('trips:manage') resume(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.resume(p, id, body);
  }
  @Get('analysis') analyses(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query() query: unknown,
  ) {
    return this.service.listAnalysis(p.companyId, query);
  }
  @Post('analysis') @RequireAnyPermission('trips:manage') analyze(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() body: unknown,
  ) {
    return this.service.analysis(p, body);
  }
  @Get('records') records(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query() query: unknown,
  ) {
    return this.service.records(p.companyId, query);
  }
  @Get('records/:id') record(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.record(p.companyId, id);
  }
  @Get('issues') issues(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Query() query: unknown,
  ) {
    return this.service.issues(p.companyId, query);
  }
  @Get('issues/:id') issue(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.issue(p.companyId, id);
  }
  @Post('issues/:id/justifications')
  @RequireAnyPermission('trips:manage')
  justify(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.justify(p, id, body);
  }
}
