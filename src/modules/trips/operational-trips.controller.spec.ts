import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../../shared/http/decorators/require-permissions.decorator';
import { OperationalTripsController } from './operational-trips.controller';

function permissionsFor(method: keyof OperationalTripsController) {
  const handler = Object.getOwnPropertyDescriptor(
    OperationalTripsController.prototype,
    method,
  )?.value as object;
  return Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as string[];
}

describe('OperationalTripsController permissions', () => {
  it('accepts canonical trip permissions while preserving route compatibility', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, OperationalTripsController),
    ).toEqual(['trips:view', 'routes:view']);
    expect(permissionsFor('create')).toEqual([
      'trips:create',
      'trips:manage',
      'routes:create',
      'routes:manage',
    ]);
    expect(permissionsFor('apply')).toEqual([
      'trips:update',
      'trips:manage',
      'routes:update',
      'routes:manage',
    ]);
  });

  it('does not add random leg IDs before the idempotency fingerprint', () => {
    const apply = vi.fn();
    const controller = new OperationalTripsController({ apply } as never);

    void controller.apply(
      { id: 'actor-1', companyId: 'company-1' } as never,
      'trip-1',
      {
        type: 'edit-draft',
        commandId: '00000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        plan: {
          serviceDate: '2026-09-10',
          legs: [{ sequence: 1, label: 'Ida' }],
        },
      },
    );

    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      'trip-1',
      expect.objectContaining({
        plan: {
          serviceDate: '2026-09-10',
          legs: [{ sequence: 1, label: 'Ida' }],
        },
      }),
    );
  });
});
