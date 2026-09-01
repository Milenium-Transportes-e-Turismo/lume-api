import { describe, expect, it } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { IdentityController } from './identity.controller';

describe('IdentityController permissions', () => {
  it('keeps match previews restricted to access managers', () => {
    const handler = Object.getOwnPropertyDescriptor(
      IdentityController.prototype,
      'previewUserPersonMatch',
    )?.value as object;
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
      'users:manage',
    ]);
  });

  it('restricts association commands and their history to access managers', () => {
    for (const method of [
      'associateUserPerson',
      'userPersonHistory',
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        IdentityController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
        'users:manage',
      ]);
    }
  });
});
