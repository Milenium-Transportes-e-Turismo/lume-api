import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { ConfirmedServicesController } from './confirmed-services.controller';

describe('ConfirmedServicesController', () => {
  it('exige gestão comercial para confirmar um serviço', () => {
    const handler = Object.getOwnPropertyDescriptor(
      ConfirmedServicesController.prototype,
      'confirm',
    )?.value as object;

    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
      'commercial:manage',
    ]);
  });

  it('separa as permissões dos atestes Financeiro e Operacional', () => {
    const financial = Object.getOwnPropertyDescriptor(
      ConfirmedServicesController.prototype,
      'attestFinancial',
    )?.value as object;
    const operational = Object.getOwnPropertyDescriptor(
      ConfirmedServicesController.prototype,
      'attestOperational',
    )?.value as object;

    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, financial)).toEqual([
      'financial:approve',
    ]);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, operational)).toEqual([
      'operations:manage',
    ]);
  });

  it('deriva tenant e ator do token autenticado', async () => {
    const confirmedServices = { confirm: vi.fn().mockResolvedValue({}) };
    const controller = new ConfirmedServicesController(
      confirmedServices as never,
    );
    const current = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    } as AuthenticatedPrincipal;
    const body = {
      commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expectedVersion: 4,
      confirmationBasis: 'Requisitos aplicáveis conferidos manualmente.',
    };

    await controller.confirm(
      current,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      body,
    );

    expect(confirmedServices.confirm).toHaveBeenCalledWith(
      current,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      body,
    );
  });
});
