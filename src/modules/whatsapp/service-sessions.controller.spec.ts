import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type {
  ManageServiceSessionUseCase,
  QueryServiceSessionsUseCase,
} from '../../application/use-cases/whatsapp/manage-service-sessions.use-case';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import {
  ServiceSessionCommandDto,
  ServiceSessionListQueryDto,
  TransferServiceSessionDto,
} from './dto/service-session.dto';
import { ServiceSessionsController } from './service-sessions.controller';

function principal(): AuthenticatedPrincipal {
  return {
    companyId: '00000000-0000-4000-8000-000000000010',
    tokenVersion: 1,
    id: '00000000-0000-4000-8000-000000000011',
    routingCompanyId: null,
    name: 'Atendente',
    username: 'atendente',
    email: 'atendente@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator: false,
    jobTitle: null,
    maritalStatus: null,
    militaryDocumentStatus: 'not-applicable',
    dependents: [],
    departments: ['commercial'],
    permissionCodes: ['service:view', 'service:assume', 'service:transfer'],
    permissions: ['service:view', 'service:assume', 'service:transfer'],
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-08-29T12:00:00.000Z',
  };
}

function handler(name: keyof ServiceSessionsController): object {
  return Object.getOwnPropertyDescriptor(
    ServiceSessionsController.prototype,
    name,
  )?.value as object;
}

describe('ServiceSessionsController', () => {
  it('protege consultas e cada comando com a permissão operacional específica', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('list'))).toEqual([
      'service:view',
    ]);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('assume')),
    ).toEqual(['service:assume']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('transfer')),
    ).toEqual(['service:transfer']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('assignmentTargets')),
    ).toEqual(['service:transfer']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('changePriority')),
    ).toEqual(['service:priority']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('close'))).toEqual(
      ['service:close'],
    );
  });

  it('delimita a listagem pelo tenant e departamentos do usuário autenticado', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new ServiceSessionsController(
      { list } as unknown as QueryServiceSessionsUseCase,
      {} as ManageServiceSessionUseCase,
    );
    const query = Object.assign(new ServiceSessionListQueryDto(), {
      search: 'cliente',
    });

    await controller.list(principal(), query);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: '00000000-0000-4000-8000-000000000010',
        actorUserId: '00000000-0000-4000-8000-000000000011',
        accessibleDepartments: ['commercial'],
      }),
      expect.objectContaining({ search: 'cliente' }),
    );
  });

  it('sempre assume para o próprio usuário autenticado', async () => {
    const assume = vi.fn().mockResolvedValue({});
    const controller = new ServiceSessionsController(
      {} as QueryServiceSessionsUseCase,
      { assume } as unknown as ManageServiceSessionUseCase,
    );
    const body = Object.assign(new ServiceSessionCommandDto(), {
      commandId: '00000000-0000-4000-8000-000000000020',
      expectedVersion: 4,
    });

    await controller.assume(
      principal(),
      '00000000-0000-4000-8000-000000000030',
      body,
    );

    expect(assume).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: '00000000-0000-4000-8000-000000000011',
        expectedVersion: 4,
      }),
    );
  });

  it('preserva o alvo explícito da transferência sem aceitar tenant do payload', async () => {
    const transfer = vi.fn().mockResolvedValue({});
    const controller = new ServiceSessionsController(
      {} as QueryServiceSessionsUseCase,
      { transfer } as unknown as ManageServiceSessionUseCase,
    );
    const body = Object.assign(new TransferServiceSessionDto(), {
      commandId: '00000000-0000-4000-8000-000000000020',
      expectedVersion: 4,
      departmentId: '00000000-0000-4000-8000-000000000040',
      queueId: '00000000-0000-4000-8000-000000000050',
      reason: 'Encaminhamento especializado',
    });

    await controller.transfer(
      principal(),
      '00000000-0000-4000-8000-000000000030',
      body,
    );

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: '00000000-0000-4000-8000-000000000010',
        departmentId: '00000000-0000-4000-8000-000000000040',
        queueId: '00000000-0000-4000-8000-000000000050',
      }),
    );
  });
});
