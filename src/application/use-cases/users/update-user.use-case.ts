import { createHash } from 'node:crypto';

import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  allowedPermissionsForDepartments,
  isPermissionCode,
  normalizeUserDepartments,
  TENANT_WIDE_PERMISSION,
  type PermissionCode,
  type SupportedUserDepartment,
} from '../../../domain/access/access.constants';
import { isValidCpf } from '../../../shared/utils/brazilian-documents';
import type {
  DocumentAccessMode,
  MaritalStatus,
  MilitaryDocumentStatus,
  UserClientCategory,
  UserDependent,
} from '../../../domain/entities/user';
import {
  normalizeCpf,
  normalizeEmail,
} from '../../../shared/utils/normalization';
import { UsersRepository } from '../../contracts/repositories';
import { presentUser } from '../../presenters/user.presenter';
import {
  assertCanAccessUserTarget,
  userMutationAuthorizationFingerprint,
} from '../../../domain/access/user-management-policy';
import { hasTenantWideAuthority } from '../../../domain/access/tenant-authority';
import { RoutingRepository } from '../../contracts/routing.repository';

export interface UpdateUserInput {
  companyId: string;
  commandId: string;
  expectedVersion: number;
  currentUserId?: string;
  actorUserId?: string;
  userId: string;
  routingCompanyId?: string | null;
  name?: string;
  email?: string;
  cpf?: string | null;
  isAdministrator?: boolean;
  documentAccessMode?: DocumentAccessMode;
  clientCategory?: UserClientCategory | null;
  jobTitle?: string | null;
  maritalStatus?: MaritalStatus | null;
  militaryDocumentStatus?: MilitaryDocumentStatus;
  dependents?: UserDependent[];
  departments?: SupportedUserDepartment[];
  permissionCodes?: PermissionCode[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function updateCommandFingerprint(input: UpdateUserInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          operation: 'USER_UPDATED',
          companyId: input.companyId,
          actorUserId: input.actorUserId ?? input.currentUserId ?? null,
          userId: input.userId,
          expectedVersion: input.expectedVersion,
          changes: {
            routingCompanyId: input.routingCompanyId,
            name: input.name?.trim(),
            email: input.email?.trim(),
            cpf: input.cpf === undefined ? undefined : normalizeCpf(input.cpf),
            isAdministrator: input.isAdministrator,
            documentAccessMode: input.documentAccessMode,
            clientCategory: input.clientCategory,
            jobTitle:
              input.jobTitle === undefined
                ? undefined
                : input.jobTitle?.trim() || null,
            maritalStatus: input.maritalStatus,
            militaryDocumentStatus: input.militaryDocumentStatus,
            dependents: input.dependents,
            departments: input.departments
              ? [...normalizeUserDepartments(input.departments)].sort()
              : undefined,
            permissionCodes: input.permissionCodes
              ? [...new Set(input.permissionCodes)].sort()
              : undefined,
          },
        }),
      ),
    )
    .digest('hex');
}

export class UpdateUserUseCase {
  constructor(
    private readonly users: UsersRepository,
    private readonly routing?: RoutingRepository,
  ) {}

  async execute(input: UpdateUserInput) {
    const target = await this.users.findById(input.companyId, input.userId);

    if (!target) {
      throw notFound('Usuário');
    }

    const actorId = input.actorUserId ?? input.currentUserId;
    if (!actorId) {
      throw forbidden('Informe o usuário responsável pela alteração.');
    }
    const actor = await this.users.findById(input.companyId, actorId);
    if (
      !actor ||
      !actor.companyIsActive ||
      !actor.user.props.isActive ||
      actor.user.props.status !== 'active'
    ) {
      throw forbidden(
        'Somente uma conta ativa pode realizar alterações em usuários.',
      );
    }
    const actorRole = assertCanAccessUserTarget(
      actor.user.props,
      target.user.props,
    );
    const requestFingerprint = updateCommandFingerprint(input);
    if (
      actorRole === 'people-operations' &&
      (input.cpf !== undefined ||
        input.isAdministrator !== undefined ||
        input.routingCompanyId !== undefined ||
        input.documentAccessMode !== undefined ||
        input.clientCategory !== undefined ||
        input.departments !== undefined ||
        input.permissionCodes !== undefined)
    ) {
      throw forbidden(
        'RH e Departamento Pessoal não podem alterar acessos ou permissões de usuários existentes.',
      );
    }
    if (
      actorRole === 'information-technology' &&
      input.permissionCodes?.some((permission) =>
        permission.startsWith('license:'),
      )
    ) {
      throw forbidden(
        'Somente administradores podem conceder acesso à licença.',
      );
    }
    if (
      input.permissionCodes !== undefined &&
      !actor.user.props.isAdministrator &&
      (input.permissionCodes.includes('clients:history') ||
        target.user.props.permissionCodes.includes('clients:history'))
    ) {
      throw forbidden(
        'Somente administradores podem conceder ou remover a permissão de visualizar o histórico de clientes.',
      );
    }
    const replayed = await this.users.findUpdateReplay(input.companyId, {
      userId: input.userId,
      actorUserId: actorId,
      commandId: input.commandId,
      requestFingerprint,
    });
    if (replayed) {
      return { ...presentUser(replayed.record), idempotent: true };
    }
    const emailNormalized = input.email
      ? normalizeEmail(input.email)
      : undefined;

    const cpfNormalized =
      input.cpf !== undefined ? normalizeCpf(input.cpf) : undefined;

    if (cpfNormalized && !isValidCpf(cpfNormalized)) {
      throw validationError('Informe um CPF válido.');
    }

    const departments = input.departments
      ? normalizeUserDepartments(input.departments)
      : undefined;
    const permissionCodes = input.permissionCodes
      ? Array.from(new Set(input.permissionCodes)).sort()
      : undefined;

    const identifierConflict = await this.users.loginIdentifierExists({
      emailNormalized,
      cpfNormalized,
      exceptUserId: input.userId,
    });

    if (identifierConflict) {
      throw conflict(
        `Já existe um usuário cadastrado com este ${identifierConflict}.`,
        identifierConflict,
      );
    }

    const finalIsAdministrator =
      input.isAdministrator ?? target.user.props.isAdministrator;
    const finalDocumentAccessMode =
      input.documentAccessMode ?? target.user.props.documentAccessMode;
    const administratorChanged =
      finalIsAdministrator !== target.user.props.isAdministrator;
    const documentPortalOnly =
      !finalIsAdministrator && finalDocumentAccessMode === 'document-portal';

    if (target.user.props.isAdministrator || administratorChanged) {
      if (!actor.user.props.isAdministrator) {
        throw forbidden(
          'Somente outro administrador pode alterar uma conta administradora.',
        );
      }
      if (actorId === input.userId && !finalIsAdministrator) {
        throw forbidden(
          'Você não pode remover o próprio acesso de administrador.',
        );
      }
    }

    if (
      target.user.props.isAdministrator &&
      !finalIsAdministrator &&
      (input.departments === undefined || input.permissionCodes === undefined)
    ) {
      throw validationError(
        'Ao remover o acesso de administrador, informe departamentos e permissões diretas.',
      );
    }

    if (
      documentPortalOnly &&
      ((departments?.length ?? 0) > 0 || (permissionCodes?.length ?? 0) > 0)
    ) {
      throw validationError(
        'O Portal de documentos não aceita departamentos nem permissões de negócio.',
      );
    }

    const finalDepartments =
      finalIsAdministrator || documentPortalOnly
        ? []
        : (departments ?? target.user.props.departments);
    const finalPermissionCodes =
      finalIsAdministrator || documentPortalOnly
        ? []
        : (permissionCodes ?? target.user.props.permissionCodes);
    const tenantWideGrantChanged =
      finalPermissionCodes.includes(TENANT_WIDE_PERMISSION) !==
      target.user.props.permissionCodes.includes(TENANT_WIDE_PERMISSION);
    const tenantWideAuthorityChanged =
      hasTenantWideAuthority({
        isAdministrator: finalIsAdministrator,
        departments: finalDepartments,
        permissionCodes: finalPermissionCodes,
        documentAccessMode: finalDocumentAccessMode,
      }) !==
      hasTenantWideAuthority({
        isAdministrator: target.user.props.isAdministrator,
        departments: target.user.props.departments,
        permissionCodes: target.user.props.permissionCodes,
        documentAccessMode: target.user.props.documentAccessMode,
      });
    if (
      (tenantWideGrantChanged || tenantWideAuthorityChanged) &&
      !actor.user.props.isAdministrator
    ) {
      throw forbidden(
        'Somente administradores podem conceder ou remover o acesso amplo da Diretoria.',
      );
    }
    const requestedRoutingCompanyId =
      input.routingCompanyId === undefined
        ? target.user.props.routingCompanyId
        : input.routingCompanyId;
    const requestedClientCategory =
      input.clientCategory === undefined
        ? target.user.props.clientCategory
        : input.clientCategory;
    const finalRoutingCompanyId =
      !finalIsAdministrator && finalDocumentAccessMode === 'client'
        ? requestedRoutingCompanyId
        : null;
    const finalClientCategory =
      !finalIsAdministrator && finalDocumentAccessMode === 'client'
        ? requestedClientCategory
        : null;

    if (finalDocumentAccessMode === 'client') {
      if (
        finalDepartments.length !== 1 ||
        finalDepartments[0] !== 'client-company' ||
        !finalClientCategory
      ) {
        throw validationError(
          'O acesso Cliente deve informar o tipo PF ou PJ e usar exclusivamente o perfil Empresa cliente.',
        );
      }

      if (!finalRoutingCompanyId) {
        throw validationError(
          'Selecione o cliente PF ou PJ vinculado a este acesso.',
        );
      }
      const routingCompany = await this.routing?.findCompany(
        input.companyId,
        finalRoutingCompanyId,
      );
      if (!routingCompany || routingCompany.status !== 'active') {
        throw validationError('Selecione um cliente ativo.');
      }
    } else if (finalDepartments.includes('client-company')) {
      throw validationError(
        'O perfil Empresa cliente e o vinculo com cliente atendido exigem o modo de acesso Cliente.',
      );
    }

    if (
      !finalIsAdministrator &&
      finalDocumentAccessMode === 'standard' &&
      finalDepartments.length === 0
    ) {
      throw validationError('Informe ao menos um departamento para o usuário.');
    }
    const allowedPermissions = new Set(
      allowedPermissionsForDepartments(finalDepartments),
    );
    if (
      !finalIsAdministrator &&
      finalPermissionCodes.some(
        (permission) =>
          !isPermissionCode(permission) || !allowedPermissions.has(permission),
      )
    ) {
      throw validationError(
        'Uma ou mais permissões não são permitidas para os departamentos selecionados.',
      );
    }

    const isActiveAdministrator =
      target.user.props.isActive &&
      target.user.props.status === 'active' &&
      target.user.props.isAdministrator;

    const changedFields = [
      'name',
      'routingCompanyId',
      'email',
      'cpf',
      'isAdministrator',
      'documentAccessMode',
      'clientCategory',
      'jobTitle',
      'maritalStatus',
      'militaryDocumentStatus',
      'dependents',
      'departments',
      'permissionCodes',
    ].filter((field) => input[field as keyof UpdateUserInput] !== undefined);
    const persistenceInput = {
      command: {
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        requestFingerprint,
        actorUserId: actorId,
        changedFields,
      },
      mutationSnapshot: {
        actorUserId: actor.user.props.id,
        actorUpdatedAt: actor.user.props.updatedAt,
        actorVersion: actor.user.props.version,
        actorAuthorizationFingerprint: userMutationAuthorizationFingerprint({
          ...actor.user.props,
          companyIsActive: actor.companyIsActive,
        }),
        targetUpdatedAt: target.user.props.updatedAt,
      },
      routingCompanyId:
        finalRoutingCompanyId === target.user.props.routingCompanyId
          ? undefined
          : finalRoutingCompanyId,
      name: input.name?.trim(),
      email: input.email?.trim(),
      emailNormalized,
      cpfNormalized,
      isAdministrator:
        input.isAdministrator === undefined ? undefined : finalIsAdministrator,
      documentAccessMode: input.documentAccessMode,
      clientCategory:
        finalClientCategory === target.user.props.clientCategory
          ? undefined
          : finalClientCategory,
      jobTitle:
        input.jobTitle === undefined
          ? undefined
          : input.jobTitle?.trim() || null,
      maritalStatus: input.maritalStatus,
      militaryDocumentStatus: input.militaryDocumentStatus,
      dependents: input.dependents,
      departments:
        finalIsAdministrator || documentPortalOnly ? [] : departments,
      permissionCodes:
        finalIsAdministrator || documentPortalOnly ? [] : permissionCodes,
    };
    const updated =
      isActiveAdministrator && !finalIsAdministrator
        ? await this.users.updateWithAdministratorInvariant(
            input.companyId,
            input.userId,
            persistenceInput,
          )
        : await this.users.update(
            input.companyId,
            input.userId,
            persistenceInput,
          );
    if (!updated) {
      throw conflict('A empresa deve manter ao menos um administrador ativo.');
    }
    return { ...presentUser(updated.record), idempotent: updated.idempotent };
  }
}
