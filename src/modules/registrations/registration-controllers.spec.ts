import { describe, expect, it } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { RegistrationReconciliationController } from './registration-reconciliation.controller';
import { RegistrationsController } from './registrations.controller';

function permissionsFor<T extends object>(
  controller: T,
  method: keyof T,
): readonly string[] {
  const handler = Object.getOwnPropertyDescriptor(controller, method)
    ?.value as object;
  return Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as string[];
}

describe('Registration controller permissions', () => {
  it('reuses the existing Cadastro permission boundaries', () => {
    expect(permissionsFor(RegistrationsController.prototype, 'list')).toEqual([
      'clients:view',
    ]);
    expect(permissionsFor(RegistrationsController.prototype, 'create')).toEqual(
      ['clients:create'],
    );
    expect(permissionsFor(RegistrationsController.prototype, 'update')).toEqual(
      ['clients:update'],
    );
    expect(
      permissionsFor(RegistrationsController.prototype, 'history'),
    ).toEqual(['clients:history']);
    expect(
      permissionsFor(RegistrationsController.prototype, 'createTag'),
    ).toEqual(['clients:manage']);
  });

  it('allows evidence consultation separately from review and promotion', () => {
    expect(
      permissionsFor(
        RegistrationReconciliationController.prototype,
        'candidates',
      ),
    ).toEqual(['clients:history', 'clients:manage']);
    expect(
      permissionsFor(RegistrationReconciliationController.prototype, 'import'),
    ).toEqual(['clients:manage']);
    expect(
      permissionsFor(RegistrationReconciliationController.prototype, 'review'),
    ).toEqual(['clients:manage']);
    expect(
      permissionsFor(RegistrationReconciliationController.prototype, 'promote'),
    ).toEqual(['clients:manage']);
  });
});
