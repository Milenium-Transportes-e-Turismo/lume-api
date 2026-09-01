import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_ROUTE } from '../../shared/http/decorators/public.decorator';
import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { PreAdmissionController } from './pre-admission.controller';

describe('PreAdmissionController', () => {
  it('requires the specific document permission for every management mutation', () => {
    for (const method of ['create', 'renew', 'revoke'] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        PreAdmissionController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
        'documents:manage',
      ]);
    }
  });

  it('makes only token resolution public', () => {
    const resolve = Object.getOwnPropertyDescriptor(
      PreAdmissionController.prototype,
      'resolve',
    )?.value as object;
    const create = Object.getOwnPropertyDescriptor(
      PreAdmissionController.prototype,
      'create',
    )?.value as object;

    expect(Reflect.getMetadata(IS_PUBLIC_ROUTE, resolve)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_ROUTE, create)).not.toBe(true);
  });

  it('maps requested documents into the deep use-case interface', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ id: 'access-id' }),
    };
    const controller = new PreAdmissionController(service as never);
    const principal = { id: 'actor-id' } as never;

    await controller.create(principal, {
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 0,
      personRegistrationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestedDocuments: [
        {
          documentTypeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          instructions: 'Envie frente e verso.',
        },
      ],
    });

    expect(service.create).toHaveBeenCalledWith(principal, {
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 0,
      personRegistrationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      documentTypeIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      instructions: {
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc': 'Envie frente e verso.',
      },
    });
  });
});
