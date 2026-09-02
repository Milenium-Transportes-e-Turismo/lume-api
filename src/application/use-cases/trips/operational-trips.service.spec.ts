import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { OperationalTripsService } from './operational-trips.service';

function fingerprint(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

const current = {
  id: 'actor-1',
  companyId: 'company-1',
  routingCompanyId: null,
} as never;

const activeActor = {
  isActive: true,
  status: 'ACTIVE',
  deletedAt: null,
  isAdministrator: true,
  departments: [],
  permissionCodes: [],
};

function actorRowLock() {
  return vi.fn().mockResolvedValue([{ id: current.id }]);
}

function continuousTripRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'trip-1',
    companyId: 'company-1',
    sourceKind: 'CONTINUOUS_CONTRACT',
    contractId: 'contract-1',
    confirmedServiceId: null,
    code: 'TRIP-1',
    sourceVersion: 1,
    status: 'DRAFT',
    serviceDate: new Date('2026-09-10T00:00:00.000Z'),
    planVersion: 0,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    version: 1,
    createdByUserId: 'actor-1',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    legs: [{ id: 'leg-1', sequence: 1, label: 'Ida' }],
    contract: {
      routingCompanyId: 'customer-1',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: null,
    },
    confirmedService: null,
    ...overrides,
  };
}

function routePlanSelectionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'selection-1',
    companyId: 'company-1',
    tripId: 'trip-1',
    sourceRouteId: 'route-1',
    sourceRouteVersion: 7,
    sourcePlanVersion: 3,
    routeAggregateVersionAtSelection: 8,
    sourceSnapshot: {
      route: { code: 'ROTA-1', name: 'Centro → Fábrica' },
      points: [],
    },
    commandId: '00000000-0000-4000-8000-000000000010',
    selectedByUserId: 'actor-1',
    reason: null,
    selectedAt: new Date('2026-09-01T11:00:00.000Z'),
    supersededAt: null,
    usedForExecutionAt: null,
    ...overrides,
  };
}

describe('OperationalTripsService', () => {
  it('replays a command with omitted leg IDs using the original HTTP payload fingerprint', async () => {
    const tripId = 'trip-1';
    const input = {
      type: 'edit-draft' as const,
      commandId: '00000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      plan: {
        serviceDate: '2026-09-10',
        legs: [{ sequence: 1, label: 'Ida' }],
      },
    };
    const repeated = {
      tripId,
      commandFingerprint: fingerprint({
        companyId: 'company-1',
        tripId,
        actorUserId: 'actor-1',
        ...input,
      }),
      resultSnapshot: { trip: { id: tripId } },
    };
    const prisma = {
      $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
        operation({
          $queryRaw: actorRowLock(),
          user: { findUnique: vi.fn().mockResolvedValue(activeActor) },
          operationalTripHistory: {
            findUnique: vi.fn().mockResolvedValue(repeated),
          },
        }),
      ),
    };
    const service = new OperationalTripsService(prisma as never);

    await expect(service.apply(current, tripId, input)).resolves.toEqual({
      trip: { id: tripId },
      idempotent: true,
    });
  });

  it('revalidates trip mutations for Admin without departments and tenant-wide Directorate', async () => {
    const tripId = 'trip-1';
    const input = {
      type: 'start' as const,
      commandId: '00000000-0000-4000-8000-000000000021',
      expectedVersion: 1,
    };
    const repeated = {
      tripId,
      commandFingerprint: fingerprint({
        companyId: 'company-1',
        tripId,
        actorUserId: 'actor-1',
        ...input,
      }),
      resultSnapshot: { trip: { id: tripId, status: 'in-execution' } },
    };

    for (const actor of [
      { ...activeActor, isAdministrator: true, departments: [] },
      {
        ...activeActor,
        isAdministrator: false,
        departments: ['DIRECTORATE'],
        permissionCodes: ['tenant:manage'],
      },
    ]) {
      const service = new OperationalTripsService({
        $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
          operation({
            $queryRaw: actorRowLock(),
            user: { findUnique: vi.fn().mockResolvedValue(actor) },
            operationalTripHistory: {
              findUnique: vi.fn().mockResolvedValue(repeated),
            },
          }),
        ),
      } as never);

      await expect(service.apply(current, tripId, input)).resolves.toEqual({
        trip: { id: tripId, status: 'in-execution' },
        idempotent: true,
      });
    }
  });

  it('rejects trip mutations from Directorate without tenant authority', async () => {
    const historyLookup = vi.fn();
    const service = new OperationalTripsService({
      $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
        operation({
          $queryRaw: actorRowLock(),
          user: {
            findUnique: vi.fn().mockResolvedValue({
              ...activeActor,
              isAdministrator: false,
              departments: ['DIRECTORATE'],
              permissionCodes: [],
            }),
          },
          operationalTripHistory: { findUnique: historyLookup },
        }),
      ),
    } as never);

    await expect(
      service.apply(current, 'trip-1', {
        type: 'start',
        commandId: '00000000-0000-4000-8000-000000000022',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(historyLookup).not.toHaveBeenCalled();
  });

  it('rejects an invalid expected contract version before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new OperationalTripsService({
      $transaction: transaction,
    } as never);

    await expect(
      service.create(current, {
        contractId: 'contract-1',
        expectedContractVersion: 0,
        code: 'TRIP-1',
        serviceDate: '2026-09-10',
        legs: [],
        commandId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('revalidates the actor before a trip mutation', async () => {
    const callOrder: string[] = [];
    const historyLookup = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        callOrder.push('lock');
        return [{ id: current.id }];
      }),
      user: {
        findUnique: vi.fn().mockImplementation(async () => {
          callOrder.push('read');
          return {
            ...activeActor,
            isActive: false,
          };
        }),
      },
      operationalTripHistory: { findUnique: historyLookup },
    };
    const service = new OperationalTripsService({
      $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
        operation(transaction),
      ),
    } as never);

    await expect(
      service.create(current, {
        contractId: 'contract-1',
        expectedContractVersion: 1,
        code: 'TRIP-1',
        serviceDate: '2026-09-10',
        legs: [],
        commandId: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(callOrder).toEqual(['lock', 'read']);
    expect(historyLookup).not.toHaveBeenCalled();
  });

  it('detects a contract changed since the operator loaded it', async () => {
    const transaction = {
      $queryRaw: actorRowLock(),
      user: { findUnique: vi.fn().mockResolvedValue(activeActor) },
      operationalTripHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      routingContract: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'contract-1',
          routingCompanyId: 'customer-1',
          status: 'ACTIVE',
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: null,
          version: 3,
        }),
      },
    };
    const service = new OperationalTripsService({
      $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
        operation(transaction),
      ),
      operationalTripHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(
      service.create(current, {
        contractId: 'contract-1',
        expectedContractVersion: 2,
        code: 'TRIP-1',
        serviceDate: '2026-09-10',
        legs: [],
        commandId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a route that changes while its authoritative lock is acquired', async () => {
    const trip = continuousTripRow();
    let route = {
      id: 'route-1',
      contractId: 'contract-1',
      routingCompanyId: 'customer-1',
      version: 8,
      approvedVersion: 7,
    };
    const transaction = {
      user: { findUnique: vi.fn().mockResolvedValue(activeActor) },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: current.id }])
        .mockImplementationOnce(() => {
          route = { ...route, version: 9 };
          return Promise.resolve([{ id: route.id }]);
        }),
      operationalTripHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      operationalTrip: {
        findUnique: vi.fn().mockResolvedValue(trip),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue(continuousTripRow({ version: 2 })),
      },
      routingRoute: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(route)),
      },
      routingRouteApproval: {
        findUnique: vi.fn().mockResolvedValue({ id: 'approval-1' }),
      },
      routingRouteVersion: {
        findUnique: vi.fn().mockResolvedValue({
          version: 7,
          planVersion: 3,
          snapshot: { route: { code: 'ROTA-1' }, points: [] },
        }),
      },
      operationalTripRoutePlanSelection: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(routePlanSelectionRow()),
      },
    };
    const service = new OperationalTripsService({
      $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
        operation(transaction),
      ),
      operationalTripHistory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(
      service.selectRoutePlan(current, 'trip-1', {
        routeId: 'route-1',
        expectedRouteVersion: 8,
        expectedVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000011',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('applies the domain freeze rule before starting the trip', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    try {
      const trip = continuousTripRow({
        status: 'SCHEDULED',
        scheduledAt: new Date('2026-09-01T11:30:00.000Z'),
        version: 3,
      });
      const transaction = {
        $queryRaw: actorRowLock(),
        user: { findUnique: vi.fn().mockResolvedValue(activeActor) },
        operationalTripHistory: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        operationalTrip: {
          findUnique: vi.fn().mockResolvedValue(trip),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(
            continuousTripRow({
              status: 'IN_EXECUTION',
              scheduledAt: new Date('2026-09-01T11:30:00.000Z'),
              startedAt: new Date('2026-09-01T12:00:00.000Z'),
              version: 4,
            }),
          ),
        },
        operationalTripRoutePlanSelection: {
          findFirst: vi.fn().mockResolvedValue(
            routePlanSelectionRow({
              selectedAt: new Date('2026-09-01T13:00:00.000Z'),
            }),
          ),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const service = new OperationalTripsService({
        $transaction: vi.fn((operation: (tx: unknown) => unknown) =>
          operation(transaction),
        ),
      } as never);

      await expect(
        service.apply(current, 'trip-1', {
          type: 'start',
          expectedVersion: 3,
          commandId: '00000000-0000-4000-8000-000000000012',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      vi.useRealTimers();
    }
  });
});
