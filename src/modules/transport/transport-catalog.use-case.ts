import { canExercisePermission } from '../../domain/access/tenant-authority';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { forbidden, validationError } from '../../core/errors/app-error';
import type { PermissionCode } from '../../domain/access/access.constants';
import { TransportCatalogRepository } from './transport-catalog.repository';
import {
  resources,
  type TransportResource,
  parseInput,
  parse,
  commandSchema,
  conditionSchema,
  assignmentSchema,
  closePeriodSchema,
  fleetOwnershipSchema,
  assertDepartmentForSupplierDeactivation,
} from './transport-catalog.rules';

@Injectable()
export class TransportCatalogUseCase {
  constructor(private readonly repository: TransportCatalogRepository) {}
  private resource(value: string): TransportResource {
    if (!resources.includes(value as TransportResource))
      throw validationError('Recurso de transporte inválido.');
    return value as TransportResource;
  }
  private authorize(
    current: AuthenticatedPrincipal,
    resource: TransportResource,
    action: 'view' | 'create' | 'update',
  ) {
    const domain =
      resource === 'companies' || resource === 'affiliations'
        ? 'clients'
        : resource === 'contracts' || resource === 'routes'
          ? 'contracts'
          : 'trips';
    if (
      !current.isActive ||
      (!canExercisePermission(
        current,
        `${domain}:${action}` as PermissionCode,
      ) &&
        !canExercisePermission(current, `${domain}:manage` as PermissionCode))
    )
      throw forbidden();
  }
  list(
    current: AuthenticatedPrincipal,
    value: string,
    query: Record<string, string>,
  ) {
    const resource = this.resource(value);
    this.authorize(current, resource, 'view');
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (page - 1) * pageSize > 2147483647
    )
      throw validationError(
        'Paginação inválida; máximo 100 registros por página.',
      );
    return this.repository.list(current.companyId, resource, {
      page,
      pageSize,
      search: (query.search ?? '').slice(0, 160),
      kind: query.kind,
      ...(query.registrationId !== undefined
        ? { registrationId: parse(z.uuid(), query.registrationId) }
        : {}),
    });
  }
  get(current: AuthenticatedPrincipal, value: string, id: string) {
    const resource = this.resource(value);
    this.authorize(current, resource, 'view');
    return this.repository.get(current.companyId, resource, id);
  }
  save(
    current: AuthenticatedPrincipal,
    value: string,
    input: unknown,
    id?: string,
  ) {
    const resource = this.resource(value);
    this.authorize(current, resource, id ? 'update' : 'create');
    const parsed = parseInput(resource, input, Boolean(id));
    if (!id && parsed.expectedVersion !== 0)
      throw validationError('Cadastro novo exige expectedVersion=0.');
    if (id && parsed.expectedVersion < 1)
      throw validationError('Edição exige versão atual.');
    if (resource === 'companies' && parsed.active === false)
      assertDepartmentForSupplierDeactivation(current);
    return this.repository.save(current, resource, parsed, id);
  }
  deactivate(current: AuthenticatedPrincipal, id: string, input: unknown) {
    this.authorize(current, 'companies', 'update');
    assertDepartmentForSupplierDeactivation(current);
    return this.repository.save(
      current,
      'companies',
      { ...parse(commandSchema.strict(), input), active: false },
      id,
    );
  }
  initialize(current: AuthenticatedPrincipal, input: unknown) {
    this.authorize(current, 'catalogs', 'create');
    return this.repository.initialize(
      current,
      parse(commandSchema.strict(), input),
    );
  }
  addPeriod(
    current: AuthenticatedPrincipal,
    resource: 'contracts' | 'routes',
    id: string,
    input: unknown,
  ) {
    this.authorize(current, resource, 'update');
    const parsed =
      resource === 'contracts'
        ? parse(conditionSchema.strict(), input)
        : parse(assignmentSchema.strict(), input);
    return this.repository.addPeriod(current, resource, id, parsed);
  }
  closePeriod(
    current: AuthenticatedPrincipal,
    resource: 'contracts' | 'routes',
    id: string,
    periodId: string,
    input: unknown,
  ) {
    this.authorize(current, resource, 'update');
    return this.repository.closePeriod(
      current,
      resource,
      id,
      periodId,
      parse(closePeriodSchema.strict(), input),
    );
  }
  history(
    current: AuthenticatedPrincipal,
    value: string,
    id: string,
    query: Record<string, string>,
  ) {
    const resource = this.resource(value);
    this.authorize(current, resource, 'view');
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (page - 1) * pageSize > 2147483647
    )
      throw validationError(
        'Paginação inválida; máximo 100 registros por página.',
      );
    return this.repository.history(
      current.companyId,
      resource,
      id,
      pageSize,
      page,
    );
  }
  fleetOwnership(
    current: AuthenticatedPrincipal,
    id: string,
    input: unknown,
    periodId?: string,
  ) {
    this.authorize(current, 'fleet', 'update');
    return this.repository.fleetOwnership(
      current,
      id,
      periodId
        ? parse(closePeriodSchema.strict(), input)
        : parse(fleetOwnershipSchema.strict(), input),
      periodId,
    );
  }
  contractCandidates(
    current: AuthenticatedPrincipal,
    query: Record<string, string>,
  ) {
    this.authorize(current, 'contracts', 'view');
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (page - 1) * pageSize > 2147483647
    )
      throw validationError(
        'Paginação inválida; máximo 100 registros por página.',
      );
    return this.repository.contractCandidates(current.companyId, {
      page,
      pageSize,
      search: (query.search ?? '').slice(0, 160),
      ...(query.registrationId !== undefined
        ? { registrationId: parse(z.uuid(), query.registrationId) }
        : {}),
    });
  }
}
