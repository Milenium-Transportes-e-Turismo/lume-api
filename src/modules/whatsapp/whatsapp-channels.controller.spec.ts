import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import type {
  CreateWhatsAppChannelUseCase,
  ManageWhatsAppChannelUseCase,
  QueryWhatsAppChannelsUseCase,
} from '../../application/use-cases/whatsapp/manage-whatsapp-channels.use-case';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import {
  CreateWhatsAppChannelDto,
  WhatsAppChannelCommandDto,
} from './dto/whatsapp-channel.dto';
import { WhatsAppChannelsController } from './whatsapp-channels.controller';

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    companyId: '00000000-0000-4000-8000-000000000010',
    tokenVersion: 1,
    id: '00000000-0000-4000-8000-000000000011',
    routingCompanyId: null,
    name: 'Administrador',
    username: 'admin',
    email: 'admin@example.test',
    cpf: null,
    type: 'employee',
    isAdministrator: true,
    jobTitle: null,
    maritalStatus: null,
    militaryDocumentStatus: 'not-applicable',
    dependents: [],
    departments: ['information-technology'],
    permissionCodes: ['whatsapp-channels:manage'],
    permissions: ['whatsapp-channels:manage'],
    clientCategory: null,
    isActive: true,
    status: 'active',
    suspendedUntil: null,
    suspensionReason: null,
    mustChangePassword: false,
    hasProfilePicture: false,
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-08-29T12:00:00.000Z',
    ...overrides,
  };
}

function handler(name: keyof WhatsAppChannelsController): object {
  return Object.getOwnPropertyDescriptor(
    WhatsAppChannelsController.prototype,
    name,
  )?.value as object;
}

describe('WhatsAppChannelsController', () => {
  it('declara permissões específicas por operação', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('list'))).toEqual([
      'whatsapp-channels:view',
    ]);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('create')),
    ).toEqual(['whatsapp-channels:create']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('requestQr')),
    ).toEqual(['whatsapp-channels:connect']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('disconnect')),
    ).toEqual(['whatsapp-channels:disconnect']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, handler('disable')),
    ).toEqual(['whatsapp-channels:manage']);
  });

  it('sempre delimita criação pelo tenant e ator autenticados', async () => {
    const execute = vi.fn().mockResolvedValue({});
    const controller = new WhatsAppChannelsController(
      {} as QueryWhatsAppChannelsUseCase,
      { execute } as unknown as CreateWhatsAppChannelUseCase,
      {} as ManageWhatsAppChannelUseCase,
    );
    const body = Object.assign(new CreateWhatsAppChannelDto(), {
      commandId: '00000000-0000-4000-8000-000000000020',
      displayName: 'Canal Financeiro',
      phoneNumber: '(34) 99999-9999',
      departmentId: '00000000-0000-4000-8000-000000000030',
      routingMode: 'department-owned' as const,
      allowedAutomaticTargetDepartmentIds: [],
    });

    await controller.create(principal(), body);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: '00000000-0000-4000-8000-000000000010',
        actorUserId: '00000000-0000-4000-8000-000000000011',
      }),
    );
  });

  it('propaga a condição de administrador somente para a regra de domínio', async () => {
    const disable = vi.fn().mockResolvedValue({});
    const controller = new WhatsAppChannelsController(
      {} as QueryWhatsAppChannelsUseCase,
      {} as CreateWhatsAppChannelUseCase,
      { disable } as unknown as ManageWhatsAppChannelUseCase,
    );
    const body = Object.assign(new WhatsAppChannelCommandDto(), {
      commandId: '00000000-0000-4000-8000-000000000021',
      expectedVersion: 3,
    });

    await controller.disable(
      principal({ isAdministrator: false }),
      '00000000-0000-4000-8000-000000000040',
      body,
    );

    expect(disable).toHaveBeenCalledWith(
      expect.objectContaining({ isAdministrator: false, expectedVersion: 3 }),
    );
  });
});
