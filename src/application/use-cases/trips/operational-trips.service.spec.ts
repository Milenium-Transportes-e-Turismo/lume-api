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

  it('detects a contract changed since the operator loaded it', async () => {
    const transaction = {
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
});
