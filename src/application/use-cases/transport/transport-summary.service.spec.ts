import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TransportSummaryService } from './transport-summary.service';
import { TransportImportService } from './transport-import.service';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { Prisma } from '../../../infra/database/prisma/generated/client';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

const tenant = '11111111-1111-4111-8111-111111111111';
const contractId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const current = { id: 'user-a', companyId: tenant } as AuthenticatedPrincipal;
const decimal = (value: number) => new Prisma.Decimal(value);
const condition = (overrides = {}) => ({
  id: 'condition-a',
  validFrom: new Date('2026-01-01'),
  validUntil: null,
  period: 'daily',
  allowanceKm: decimal(100),
  transitionMonth: null,
  transitionAllowanceKm: null,
  ...overrides,
});
function harness() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([
        { day: '2026-09-01', count: 2n, missing: 0n, registered: decimal(150) },
      ])
      .mockResolvedValue([{ count: 0n }]),
    transportImportCommand: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    tenantAuditLog: { create: vi.fn().mockResolvedValue({}) },
    transportIntegration: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ settings: { sequenceComplete: true } }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    transportContractProfile: {
      findFirst: vi.fn().mockResolvedValue({ contractId }),
    },
    transportContractCondition: {
      findMany: vi.fn().mockResolvedValue([condition()]),
    },
    transportPeriodState: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...data, version: 1 }),
        ),
      update: vi.fn().mockResolvedValue({ state: 'CLOSED', version: 2 }),
    },
    transportImport: { count: vi.fn().mockResolvedValue(0) },
  };
  const prisma = {
    ...tx,
    $transaction: vi
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
  };
  const imports = new TransportImportService(
    prisma as unknown as PrismaService,
    new ConfigService(),
  );
  return {
    tx,
    service: new TransportSummaryService(
      prisma as unknown as PrismaService,
      imports,
    ),
  };
}
const range = { contractId, from: '2026-09-01', to: '2026-09-01' };
describe('contract mileage accounting safeguards', () => {
  it('compares daily reported kilometers against the contract allowance and scopes all reads to the tenant', async () => {
    const { service, tx } = harness();
    const result = await service.summary(tenant, range);
    expect(result).toMatchObject({
      contractId,
      source: 'DRIVER_REPORTED',
      unmappedRecords: 0,
      periods: [
        {
          periodicity: 'DAILY',
          contractedKm: '100',
          registeredKm: '150',
          differenceKm: '50',
          dataStatus: 'SUFFICIENT',
          recordCount: 2,
        },
      ],
    });
    expect(tx.transportContractProfile.findFirst).toHaveBeenCalledWith({
      where: { companyId: tenant, contractId },
      include: { contract: true },
    });
    expect(tx.transportImport.count.mock.calls[0][0].where).toMatchObject({
      companyId: tenant,
      supersededByImportId: null,
    });
    expect(tx.$queryRaw.mock.calls[0]).toContain(tenant);
    expect(tx.$queryRaw.mock.calls[0]).toContain(contractId);
  });
  it.each([
    ['IMPORT_PENDING', 'unfinished'],
    ['MAPPING_PENDING', 'unmapped'],
    ['COVERAGE_UNCONFIRMED', 'coverage'],
    ['INSUFFICIENT_MEASUREMENTS', 'missing'],
    ['NO_RECORDS', 'empty'],
    ['CONDITION_REQUIRED', 'condition'],
  ])(
    'does not present a billable difference for %s',
    async (expected, variant) => {
      const { service, tx } = harness();
      if (variant === 'unfinished')
        tx.transportImport.count.mockResolvedValue(1);
      if (variant === 'unmapped')
        tx.$queryRaw
          .mockReset()
          .mockResolvedValueOnce([
            {
              day: range.from,
              count: 2n,
              missing: 0n,
              registered: decimal(150),
            },
          ])
          .mockResolvedValue([{ count: 1n }]);
      if (variant === 'coverage')
        tx.transportIntegration.findUnique.mockResolvedValue({
          settings: { sequenceComplete: false },
        });
      if (variant === 'missing')
        tx.$queryRaw
          .mockReset()
          .mockResolvedValueOnce([
            { day: range.from, count: 2n, missing: 1n, registered: null },
          ])
          .mockResolvedValue([{ count: 0n }]);
      if (variant === 'empty')
        tx.$queryRaw
          .mockReset()
          .mockResolvedValueOnce([])
          .mockResolvedValue([]);
      if (variant === 'condition')
        tx.transportContractCondition.findMany.mockResolvedValue([]);
      const result = await service.summary(tenant, range);
      expect(result.periods[0]).toMatchObject({
        dataStatus: expected,
        differenceKm: null,
      });
      if (variant === 'missing' || variant === 'condition')
        expect(result.periods[0].registeredKm).toBeNull();
    },
  );
  it('keeps an absent allowance unknown instead of treating it as zero', async () => {
    const { service, tx } = harness();
    tx.transportContractCondition.findMany.mockResolvedValue([
      condition({ allowanceKm: null }),
    ]);
    expect((await service.summary(tenant, range)).periods[0]).toMatchObject({
      contractedKm: null,
      differenceKm: null,
      dataStatus: 'SUFFICIENT',
    });
  });
  it.each(['OPEN', 'CLOSED'])(
    'compares a complete monthly period only when CLOSED, currently %s',
    async (state) => {
      const { service, tx } = harness();
      tx.transportContractCondition.findMany.mockResolvedValue([
        condition({ period: 'monthly' }),
      ]);
      tx.transportPeriodState.findMany.mockResolvedValue([
        { period: '2026-09', state, version: 4 },
      ]);
      const result = await service.summary(tenant, {
        ...range,
        to: '2026-09-30',
      });
      expect(result.periods).toHaveLength(1);
      expect(result.periods[0]).toMatchObject({
        periodicity: 'MONTHLY',
        state,
        version: 4,
        differenceKm: state === 'CLOSED' ? '50' : null,
      });
    },
  );
  it('does not compare a partial month against a full month allowance', async () => {
    const { service, tx } = harness();
    tx.transportContractCondition.findMany.mockResolvedValue([
      condition({ period: 'monthly' }),
    ]);
    expect((await service.summary(tenant, range)).periods[0]).toMatchObject({
      dataStatus: 'PARTIAL_PERIOD',
      differenceKm: null,
    });
  });
  it.each([false, true])(
    'requires an explicit transition allowance when monthly conditions change: %s',
    async (hasTransition) => {
      const { service, tx } = harness();
      tx.transportContractCondition.findMany.mockResolvedValue([
        condition({ period: 'monthly', validUntil: new Date('2026-09-15') }),
        condition({
          id: 'condition-b',
          period: 'monthly',
          validFrom: new Date('2026-09-16'),
          allowanceKm: decimal(200),
          transitionMonth: '2026-09',
          transitionAllowanceKm: hasTransition ? decimal(125) : null,
        }),
      ]);
      tx.transportPeriodState.findMany.mockResolvedValue([
        { period: '2026-09', state: 'CLOSED' },
      ]);
      const result = await service.summary(tenant, {
        ...range,
        to: '2026-09-30',
      });
      expect(result.periods[0]).toMatchObject({
        contractedKm: hasTransition ? '125' : null,
        differenceKm: hasTransition ? '25' : null,
        dataStatus: hasTransition
          ? 'SUFFICIENT'
          : 'TRANSITION_CONDITION_REQUIRED',
      });
    },
  );
  it('rejects a missing tenant contract and an unbounded query before aggregation', async () => {
    const { service, tx } = harness();
    tx.transportContractProfile.findFirst.mockResolvedValue(null);
    await expect(service.summary(tenant, range)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.summary(tenant, { ...range, from: '2020-01-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('records period closure with an idempotent command and tenant audit', async () => {
    const { service, tx } = harness();
    const result = await service.setState(current, {
      commandId,
      contractId,
      period: '2026-09',
      state: 'CLOSED',
      expectedVersion: 0,
    });
    expect(result).toMatchObject({
      companyId: tenant,
      contractId,
      period: '2026-09',
      state: 'CLOSED',
      version: 1,
    });
    expect(tx.tenantAuditLog.create).toHaveBeenCalledOnce();
    expect(tx.transportImportCommand.create).toHaveBeenCalledOnce();
  });
  it('rejects stale closure commands and does not modify the period', async () => {
    const { service, tx } = harness();
    tx.transportPeriodState.findUnique.mockResolvedValue({
      id: 'period',
      version: 3,
    });
    await expect(
      service.setState(current, {
        commandId,
        contractId,
        period: '2026-09',
        state: 'CLOSED',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.transportPeriodState.update).not.toHaveBeenCalled();
  });
  it('reopens the existing period and increments its version without creating another', async () => {
    const { service, tx } = harness();
    tx.transportPeriodState.findUnique.mockResolvedValue({
      id: 'period',
      version: 3,
    });
    await service.setState(current, {
      commandId,
      contractId,
      period: '2026-09-01',
      state: 'OPEN',
      expectedVersion: 3,
    });
    expect(tx.transportPeriodState.update).toHaveBeenCalledWith({
      where: { id: 'period' },
      data: { state: 'OPEN', version: { increment: 1 } },
    });
    expect(tx.transportPeriodState.create).not.toHaveBeenCalled();
  });
});
