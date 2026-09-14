import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  TransportImportService,
  transportHash,
} from './transport-import.service';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
const tenant = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const cursor = '33333333-3333-4333-8333-333333333333';
const current = { id: 'user-a', companyId: tenant } as AuthenticatedPrincipal;
const settings = {
  externalIdField: 'RegistroViagemId',
  sourceUtcOffset: '-03:00',
};
function harness() {
  const model = () => ({
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'created', ...data }),
      ),
    update: vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'updated', ...data }),
      ),
    upsert: vi.fn().mockResolvedValue({}),
  });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([
      {
        start: new Date('2026-09-01T03:00:00Z'),
        end: new Date('2026-09-02T03:00:00Z'),
      },
    ]),
    transportImportCommand: model(),
    transportIntegration: model(),
    transportImport: model(),
    transportImportRejection: model(),
    transportAnalysis: model(),
    transportRecord: model(),
    transportRecordHistory: model(),
    transportIssue: model(),
    transportIssueHistory: model(),
    transportExternalRoute: model(),
    transportFleet: model(),
    tenantAuditLog: model(),
  };
  const prisma = {
    ...tx,
    $transaction: vi
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
  };
  const service = new TransportImportService(
    prisma as unknown as PrismaService,
    new ConfigService({
      AVIC_API_BASE_URL: 'https://avic.example.test',
      TRANSPORT_WORKER_ENABLED: false,
    }),
  );
  return { tx, service };
}
describe('transport import commands and tenant isolation', () => {
  it('replays an identical command without repeating the effect or audit', async () => {
    const { service, tx } = harness();
    const input = { commandId };
    const action = 'transport.import.create';
    tx.transportImportCommand.findUnique.mockResolvedValue({
      fingerprint: transportHash({ actor: current.id, action, input }),
      result: { id: 'previous' },
    });
    const apply = vi.fn();
    expect(await service.command(current, input, action, apply)).toEqual({
      id: 'previous',
    });
    expect(apply).not.toHaveBeenCalled();
    expect(tx.tenantAuditLog.create).not.toHaveBeenCalled();
    expect(tx.transportImportCommand.findUnique).toHaveBeenCalledWith({
      where: { companyId_commandId: { companyId: tenant, commandId } },
    });
  });
  it('rejects command reuse by another actor or with different payload', async () => {
    const { service, tx } = harness();
    tx.transportImportCommand.findUnique.mockResolvedValue({
      fingerprint: 'different',
    });
    const apply = vi.fn();
    await expect(
      service.command(current, { commandId }, 'action', apply),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(apply).not.toHaveBeenCalled();
  });
  it('deduplicates fleet identifiers, persists the range and records an audit receipt', async () => {
    const { service, tx } = harness();
    await service.createImport(current, {
      commandId,
      from: '2026-09-01',
      to: '2026-09-02',
      vehicleIds: ['46', '46', '2031'],
    });
    expect(tx.transportImport.create).toHaveBeenCalledWith({
      data: {
        companyId: tenant,
        from: new Date('2026-09-01'),
        to: new Date('2026-09-02'),
        vehicleIds: ['46', '2031'],
      },
    });
    expect(tx.transportImportCommand.create).toHaveBeenCalledOnce();
    expect(tx.tenantAuditLog.create).toHaveBeenCalledOnce();
  });
  it('reports missing integration prerequisites and never presents a disabled worker as ready', async () => {
    const { service } = harness();
    const result = await service.integration(tenant);
    expect(result).toMatchObject({
      configured: false,
      enabled: false,
      version: 0,
    });
    expect(result.activationRequirements).toHaveLength(3);
    service.config.set('AVIC_API_BASE_URL', '');
    expect(
      (await service.integration(tenant)).activationRequirements,
    ).toHaveLength(4);
  });
  it('reports readiness only with source identity, timezone and the worker configured', async () => {
    const { service, tx } = harness();
    tx.transportIntegration.findUnique.mockResolvedValue({
      id: 'integration',
      version: 2,
      enabled: true,
      settings,
    });
    service.config.set('TRANSPORT_WORKER_ENABLED', true);
    expect(await service.integration(tenant)).toMatchObject({
      configured: true,
      activationRequirements: [],
      version: 2,
    });
  });
  it('creates a configuration without a second integration upsert', async () => {
    const { service, tx } = harness();
    await service.configure(current, {
      commandId,
      expectedVersion: 0,
      enabled: true,
      settings,
    });
    expect(tx.transportIntegration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: tenant,
        enabled: true,
        settings: expect.objectContaining(settings),
      }),
    });
    expect(tx.transportIntegration.upsert).not.toHaveBeenCalled();
  });
  it('updates a configuration with optimistic concurrency', async () => {
    const { service, tx } = harness();
    tx.transportIntegration.findUnique.mockResolvedValue({
      id: 'integration',
      version: 2,
      settings,
    });
    await service.configure(current, {
      commandId,
      expectedVersion: 2,
      enabled: false,
      settings,
    });
    expect(tx.transportIntegration.update).toHaveBeenCalledWith({
      where: { id: 'integration' },
      data: expect.objectContaining({
        enabled: false,
        version: { increment: 1 },
      }),
    });
  });
  it('refuses incomplete activation, stale versions and source identity changes after import', async () => {
    const { service, tx } = harness();
    expect(() =>
      service.configure(current, {
        commandId,
        expectedVersion: 0,
        enabled: true,
        settings: {},
      }),
    ).toThrow();
    tx.transportIntegration.findUnique.mockResolvedValue({
      id: 'integration',
      version: 2,
      settings,
    });
    await expect(
      service.configure(current, {
        commandId,
        expectedVersion: 1,
        enabled: false,
        settings,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    tx.transportRecord.count.mockResolvedValue(1);
    await expect(
      service.configure(current, {
        commandId,
        expectedVersion: 2,
        enabled: true,
        settings: { ...settings, externalIdField: 'Id' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.transportIntegration.update).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { version: 2, status: 'FAILED' },
    { version: 1, status: 'COMPLETED' },
  ])(
    'does not resume missing, stale or finished imports: %s',
    async (record) => {
      const { service, tx } = harness();
      tx.transportImport.findFirst.mockResolvedValue(record);
      await expect(
        service.resume(current, 'job', { commandId, expectedVersion: 1 }),
      ).rejects.toBeDefined();
      expect(tx.transportImport.update).not.toHaveBeenCalled();
    },
  );
  it('resumes a failed import without losing its durable pagination cursor', async () => {
    const { service, tx } = harness();
    tx.transportImport.findFirst.mockResolvedValue({
      id: 'job',
      version: 1,
      status: 'FAILED',
      skip: 25,
      vehicleIndex: 2,
    });
    await service.resume(current, 'job', { commandId, expectedVersion: 1 });
    const data = tx.transportImport.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'QUEUED',
      attemptCount: 0,
      lastError: null,
      version: { increment: 1 },
    });
    expect(data).not.toHaveProperty('skip');
    expect(data).not.toHaveProperty('vehicleIndex');
  });
  it('paginates rejected rows without exposing source payloads and verifies tenant ownership first', async () => {
    const { service, tx } = harness();
    await expect(
      service.rejections(tenant, 'other-job', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.transportImportRejection.findMany).not.toHaveBeenCalled();
    tx.transportImport.findFirst.mockResolvedValue({ id: 'job' });
    tx.transportImportRejection.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(
      await service.rejections(tenant, 'job', { cursor, limit: 1 }),
    ).toEqual({ items: [{ id: 'a' }], nextCursor: 'a' });
    expect(tx.transportImportRejection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: tenant, importId: 'job' },
        omit: { raw: true },
        cursor: { id: cursor },
        skip: 1,
        take: 2,
      }),
    );
  });
  it('isolates import and analysis lists and enqueues an analysis for the requested fleet', async () => {
    const { service, tx } = harness();
    await service.listImports(tenant, { status: 'FAILED', cursor });
    expect(tx.transportImport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: tenant, status: 'FAILED' },
        cursor: { id: cursor },
      }),
    );
    expect(await service.listAnalysis(tenant, {})).toEqual({
      items: [],
      nextCursor: null,
    });
    await service.listAnalysis(tenant, { cursor });
    await service.analysis(current, {
      commandId,
      vehicleId: '2031',
      from: '2026-09-01',
      to: '2026-09-02',
    });
    expect(tx.transportAnalysis.create).toHaveBeenCalledWith({
      data: {
        companyId: tenant,
        vehicleId: '2031',
        from: new Date('2026-09-01'),
        to: new Date('2026-09-02'),
      },
    });
  });
  it('filters records by the installation timezone and omits raw provider metadata', async () => {
    const { service, tx } = harness();
    await service.records(tenant, {
      from: '2026-09-01',
      to: '2026-09-01',
      vehicleId: '2031',
      cursor,
    });
    expect(tx.$queryRaw.mock.calls[0]).toContain('America/Sao_Paulo');
    expect(tx.transportRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: tenant,
          vehicleExternalId: '2031',
          sortAt: {
            gte: new Date('2026-09-01T03:00:00Z'),
            lt: new Date('2026-09-02T03:00:00Z'),
          },
        },
        omit: { raw: true, fingerprint: true },
      }),
    );
    tx.$queryRaw.mockClear();
    await service.records(tenant, {});
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('maps contracts and fleet ownership by local civil date and does not pick an ambiguous contract', async () => {
    const { service, tx } = harness();
    const assignment = {
      contractId: 'contract',
      validFrom: new Date('2026-09-01'),
      validUntil: new Date('2026-09-01'),
      contract: { supplierRegistrationId: 'supplier', modality: 'continuous' },
    };
    tx.transportExternalRoute.findMany.mockResolvedValue([
      { externalId: 'route', assignments: [assignment] },
    ]);
    tx.transportFleet.findMany.mockResolvedValue([
      {
        id: 'fleet',
        externalVehicleId: '2031',
        ownerships: [
          {
            validFrom: new Date('2026-09-01'),
            validUntil: null,
            supplierRegistrationId: 'owner',
          },
        ],
      },
    ]);
    const row = {
      routeExternalId: 'route',
      vehicleExternalId: '2031',
      startedAt: new Date('2026-09-02T01:00:00Z'),
    };
    expect((await service.projectMappings(tenant, [row]))[0]).toMatchObject({
      mappingStatus: 'MAPPED',
      contractId: 'contract',
      fleetId: 'fleet',
      fleetSupplierRegistrationId: 'owner',
    });
    tx.transportExternalRoute.findMany.mockResolvedValue([
      {
        externalId: 'route',
        assignments: [assignment, { ...assignment, contractId: 'other' }],
      },
    ]);
    expect((await service.projectMappings(tenant, [row]))[0]).toMatchObject({
      mappingStatus: 'AMBIGUOUS',
      contractId: null,
      supplierRegistrationId: null,
    });
    expect(
      (
        await service.projectMappings(tenant, [
          { ...row, startedAt: null, routeExternalId: null },
        ])
      )[0],
    ).toMatchObject({
      mappingStatus: 'PENDING',
      contractId: null,
      fleetSupplierRegistrationId: null,
    });
  });
  it('redacts source payloads from history while preserving public evidence', async () => {
    const { service, tx } = harness();
    await expect(service.record(tenant, 'other')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    tx.transportRecord.findFirst.mockResolvedValue({
      id: 'record',
      routeExternalId: null,
      vehicleExternalId: '2031',
      startedAt: null,
    });
    tx.transportRecordHistory.findMany.mockResolvedValue([
      {
        before: { raw: { secret: 'source' }, fingerprint: 'hash', startKm: 10 },
        after: { raw: {}, fingerprint: 'hash2', startKm: 20 },
      },
    ]);
    expect((await service.record(tenant, 'record')).history).toEqual([
      { before: { startKm: 10 }, after: { startKm: 20 } },
    ]);
    expect(service.publicSnapshot(null)).toBeNull();
    expect(service.publicSnapshot([])).toEqual([]);
  });
  it('filters pending issues by tenant, status and fleet', async () => {
    const { service, tx } = harness();
    await service.issues(tenant, { status: 'OPEN', vehicleId: '2031', cursor });
    expect(tx.transportIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: tenant, status: 'OPEN', vehicleExternalId: '2031' },
      }),
    );
    await service.issues(tenant, {});
    await expect(service.issue(tenant, 'other')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    tx.transportIssue.findFirst.mockResolvedValue({ id: 'issue' });
    expect(await service.issue(tenant, 'issue')).toEqual({ id: 'issue' });
  });
  it('records a justification without changing kilometers or resolving the discrepancy', async () => {
    const { service, tx } = harness();
    tx.transportIssue.findFirst.mockResolvedValue({ id: 'issue', version: 1 });
    await service.justify(current, 'issue', {
      commandId,
      expectedVersion: 1,
      text: 'Awaiting source correction',
    });
    expect(tx.transportIssue.update).toHaveBeenCalledWith({
      where: { id: 'issue' },
      data: { version: { increment: 1 } },
    });
    expect(tx.transportRecord.update).not.toHaveBeenCalled();
    expect(tx.transportIssueHistory.create).toHaveBeenCalledWith({
      data: {
        companyId: tenant,
        issueId: 'issue',
        kind: 'JUSTIFIED',
        actorUserId: current.id,
        text: 'Awaiting source correction',
      },
    });
  });
  it.each([null, { id: 'issue', version: 2 }])(
    'rejects missing or stale justifications: %s',
    async (record) => {
      const { service, tx } = harness();
      tx.transportIssue.findFirst.mockResolvedValue(record);
      await expect(
        service.justify(current, 'issue', {
          commandId,
          expectedVersion: 1,
          text: 'Reason',
        }),
      ).rejects.toBeDefined();
      expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
    },
  );
});
