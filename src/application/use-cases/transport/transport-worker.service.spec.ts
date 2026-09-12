import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TransportWorkerService } from './transport-worker.service';
import { transportHash } from './transport-import.service';
import { AvicClient } from '../../../infra/avic/avic-client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import type {
  Prisma,
  TransportImport,
} from '../../../infra/database/prisma/generated/client';
import { settingsSchema } from '../../../modules/transport-import/transport-import.schemas';

const settings = settingsSchema.parse({
  externalIdField: 'RegistroViagemId',
  sourceUtcOffset: '-03:00',
  sequenceComplete: true,
});
const when = new Date('2026-07-01T10:00:00Z');
function sourceRecord(endKm = 90) {
  return {
    id: 'record-a',
    companyId: 'tenant-a',
    provider: 'avic',
    externalId: '999999999999999999999',
    vehicleExternalId: '8',
    startKm: 100,
    endKm,
    sortAt: when,
    startedAt: when,
    endedAt: new Date('2026-07-01T11:00:00Z'),
    verifiedAt: new Date('2026-07-02T00:00:00Z'),
    version: 1,
  };
}
function storedIssue() {
  return {
    id: 'issue-a',
    companyId: 'tenant-a',
    recordId: 'record-a',
    vehicleExternalId: '8',
    code: 'NEGATIVE_DISTANCE',
    status: 'OPEN',
    verificationState: 'VERIFIED',
    version: 2,
    context: { startKm: 100, endKm: 90, distance: -10, previousRecordId: null },
    lastVerifiedAt: when,
    verificationUnavailableAt: null,
    updatedAt: when,
  };
}
function harness() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    transportIntegration: { findMany: vi.fn().mockResolvedValue([]) },
    transportAnalysis: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'analysis-a',
        vehicleId: '8',
        from: new Date('2026-07-01'),
        to: new Date('2026-07-01'),
        cursorAt: null,
        cursorId: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    transportRecord: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([sourceRecord()])
        .mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...sourceRecord(), ...data, version: 2 }),
        ),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...sourceRecord(), ...data }),
        ),
    },
    transportImportRejection: { upsert: vi.fn().mockResolvedValue({}) },
    transportImport: {
      findFirst: vi.fn().mockResolvedValue(importJob()),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    transportIssue: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...storedIssue(), ...data }),
        ),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...storedIssue(), ...data }),
        ),
    },
    transportIssueHistory: { create: vi.fn().mockResolvedValue({}) },
    transportRecordHistory: { create: vi.fn().mockResolvedValue({}) },
    transportExternalRoute: {
      findFirst: vi.fn().mockResolvedValue({ id: 'route-a' }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi
      .fn()
      .mockImplementation((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
  };
  return {
    tx,
    worker: new TransportWorkerService(
      prisma as unknown as PrismaService,
      new ConfigService(),
    ),
  };
}
function importJob(): TransportImport {
  return {
    id: 'job-a',
    companyId: 'tenant-a',
    vehicleIds: ['8'],
    vehicleIndex: 0,
    skip: 25,
    from: new Date('2026-07-01'),
    to: new Date('2026-07-31'),
    attemptCount: 0,
    verificationIssueId: null,
    createdAt: when,
    version: 1,
  } as unknown as TransportImport;
}
const raw = {
  RegistroViagemId: '999999999999999999999',
  VeiculoId: '8',
  KMSaidaGaragem: '100',
  KMRetornoGaragem: '90',
  HoraSaidaGaragem: '2026-07-01T07:00:00',
  HoraChegadaGaragem: '2026-07-01T08:00:00',
};
function provider(worker: TransportWorkerService, response: Response | Error) {
  const fetcher = vi.fn<typeof fetch>();
  if (response instanceof Error) fetcher.mockRejectedValue(response);
  else fetcher.mockResolvedValue(response);
  vi.spyOn(worker, 'client').mockReturnValue(
    new AvicClient({ baseUrl: 'https://example.test', fetch: fetcher }),
  );
  return fetcher;
}
describe('transport persistence and safe verification', () => {
  it('keeps the same pending issue and its justification history when the discrepancy is unchanged', async () => {
    const { tx, worker } = harness();
    tx.transportIssue.findUnique.mockResolvedValue(storedIssue());
    tx.transportIssue.findMany.mockResolvedValue([storedIssue()]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.create).not.toHaveBeenCalled();
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
    expect(
      tx.transportIssue.update.mock.calls.every(
        ([query]) => query.data.status !== 'RESOLVED',
      ),
    ).toBe(true);
  });
  it('updates changed evidence on the existing issue, without inserting another justification', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findMany
      .mockReset()
      .mockResolvedValueOnce([sourceRecord(80)])
      .mockResolvedValue([]);
    tx.transportIssue.findUnique.mockResolvedValue(storedIssue());
    tx.transportIssue.findMany.mockResolvedValue([storedIssue()]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.create).not.toHaveBeenCalled();
    expect(tx.transportIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'issue-a' },
        data: expect.objectContaining({
          status: 'OPEN',
          context: expect.objectContaining({ distance: -20 }),
        }),
      }),
    );
    expect(tx.transportIssueHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'CHANGED', issueId: 'issue-a' }),
      }),
    );
    expect(
      tx.transportIssueHistory.create.mock.calls.every(
        ([query]) => query.data.kind !== 'JUSTIFIED',
      ),
    ).toBe(true);
  });
  it('resolves an old discrepancy after a successful source correction', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findMany
      .mockReset()
      .mockResolvedValueOnce([sourceRecord(110)])
      .mockResolvedValue([]);
    tx.transportIssue.findMany.mockResolvedValue([storedIssue()]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'issue-a' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          verificationState: 'VERIFIED',
        }),
      }),
    );
  });
  it('never resolves unavailable verification by analyzing an older cached copy', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findMany
      .mockReset()
      .mockResolvedValueOnce([sourceRecord(110)])
      .mockResolvedValue([]);
    tx.transportIssue.findMany.mockResolvedValue([
      {
        ...storedIssue(),
        verificationState: 'UNAVAILABLE',
        verificationUnavailableAt: new Date('2026-07-03'),
        updatedAt: new Date('2026-07-05'),
      },
    ]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.update).not.toHaveBeenCalled();
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
  });
  it('uses the failed verification instant independently of later human justification updates', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findMany
      .mockReset()
      .mockResolvedValueOnce([sourceRecord(110)])
      .mockResolvedValue([]);
    tx.transportIssue.findMany.mockResolvedValue([
      {
        ...storedIssue(),
        verificationState: 'UNAVAILABLE',
        verificationUnavailableAt: new Date('2026-07-01'),
        updatedAt: new Date('2026-07-03'),
      },
    ]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'issue-a' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          verificationState: 'VERIFIED',
        }),
      }),
    );
  });
  it('does not reinterpret a failed provider request as confirmed or resolved and preserves its cursor', async () => {
    const { tx, worker } = harness();
    tx.transportIssue.findFirst.mockResolvedValue(storedIssue());
    provider(worker, new Error('provider credentials secret'));
    await worker.importPage(
      { ...importJob(), verificationIssueId: 'issue-a' },
      settings,
    );
    expect(tx.transportRecord.update).not.toHaveBeenCalled();
    expect(tx.transportRecordHistory.create).not.toHaveBeenCalled();
    expect(tx.transportImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUEUED', attemptCount: 1 }),
      }),
    );
    expect(
      tx.transportImport.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('skip');
    expect(
      tx.transportImport.updateMany.mock.calls[0][0].data.lastError,
    ).not.toContain('secret');
    expect(tx.transportIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationState: 'UNAVAILABLE' }),
      }),
    );
    expect(tx.transportIssue.update.mock.calls[0][0].data).not.toHaveProperty(
      'status',
    );
  });
  it('refreshes verification on repeated imports without duplicating records or snapshots', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findUnique.mockResolvedValue({
      ...sourceRecord(),
      fingerprint: transportHash(raw),
    });
    provider(worker, new Response(JSON.stringify([raw])));
    await worker.importPage(importJob(), settings);
    expect(tx.transportRecord.create).not.toHaveBeenCalled();
    expect(tx.transportRecordHistory.create).not.toHaveBeenCalled();
    expect(tx.transportRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'record-a' },
        data: { verifiedAt: expect.any(Date) },
      }),
    );
    expect(tx.transportImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skip: 50, status: 'RUNNING' }),
      }),
    );
  });
  it('imports negative reported distance with exact external identity and a before/after snapshot', async () => {
    const { tx, worker } = harness();
    tx.transportRecord.findUnique.mockResolvedValue({
      ...sourceRecord(110),
      fingerprint: 'old',
    });
    provider(worker, new Response(JSON.stringify([raw])));
    await worker.importPage(importJob(), settings);
    expect(tx.transportRecord.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_provider_externalId: {
          companyId: 'tenant-a',
          provider: 'avic',
          externalId: '999999999999999999999',
        },
      },
    });
    expect(tx.transportRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startKm: 100,
          endKm: 90,
          version: { increment: 1 },
        }),
      }),
    );
    expect(tx.transportRecordHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'tenant-a',
          recordId: 'record-a',
          before: expect.objectContaining({ endKm: 110 }),
          after: expect.objectContaining({ endKm: 90 }),
        }),
      }),
    );
    expect(
      tx.transportRecordHistory.create.mock.calls[0][0].data,
    ).not.toHaveProperty('actorUserId');
  });
  it('refreshes verification time without duplicating the unchanged evidence history', async () => {
    const { tx, worker } = harness();
    tx.transportIssue.findUnique.mockResolvedValue(storedIssue());
    tx.transportIssue.findMany.mockResolvedValue([storedIssue()]);
    await worker.analyzePage('tenant-a', settings);
    expect(tx.transportIssue.update).toHaveBeenCalledWith({
      where: { id: 'issue-a' },
      data: { lastVerifiedAt: expect.any(Date) },
    });
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
  });
  it('restarts a running analysis so an earlier corrected row is not skipped by its cursor', async () => {
    const { tx, worker } = harness();
    tx.transportAnalysis.findFirst.mockResolvedValue({
      id: 'analysis-a',
      status: 'RUNNING',
      cursorAt: when,
      cursorId: 'record-z',
    });
    await worker.enqueueAnalysis(
      tx as unknown as Prisma.TransactionClient,
      'tenant-a',
      '8',
      when,
      when,
    );
    expect(tx.transportAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-a' },
      data: { status: 'QUEUED', cursorAt: null, cursorId: null, processed: 0 },
    });
    expect(tx.transportAnalysis.create).not.toHaveBeenCalled();
  });
  it('coalesces an already queued analysis instead of creating a duplicate task', async () => {
    const { tx, worker } = harness();
    tx.transportAnalysis.findFirst.mockResolvedValue({
      id: 'analysis-a',
      status: 'QUEUED',
    });
    await worker.enqueueAnalysis(
      tx as unknown as Prisma.TransactionClient,
      'tenant-a',
      '8',
      when,
      when,
    );
    expect(tx.transportAnalysis.update).not.toHaveBeenCalled();
    expect(tx.transportAnalysis.create).not.toHaveBeenCalled();
  });
  it('refuses unbounded provider pagination while retaining the last durable cursor', async () => {
    const { tx, worker } = harness();
    const fetcher = provider(worker, new Response('[]'));
    await worker.importPage({ ...importJob(), skip: 1250000 }, settings);
    expect(fetcher).not.toHaveBeenCalled();
    expect(tx.transportImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-a', version: 1 },
        data: expect.objectContaining({ status: 'QUEUED', attemptCount: 1 }),
      }),
    );
    expect(
      tx.transportImport.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('skip');
  });
  it('does not import or advance a cursor when another worker already advanced that version', async () => {
    const { tx, worker } = harness();
    tx.transportImport.findFirst.mockResolvedValue(null);
    provider(worker, new Response(JSON.stringify([raw])));
    await worker.importPage(importJob(), settings);
    expect(tx.transportImport.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-a', companyId: 'tenant-a', version: 1 },
    });
    expect(tx.transportRecord.create).not.toHaveBeenCalled();
    expect(tx.transportRecord.update).not.toHaveBeenCalled();
    expect(tx.transportRecordHistory.create).not.toHaveBeenCalled();
    expect(tx.transportImport.update).not.toHaveBeenCalled();
    expect(tx.transportImportRejection.upsert).not.toHaveBeenCalled();
  });
  it('preserves a rejected row and still imports valid rows from the same page', async () => {
    const { tx, worker } = harness();
    const invalid = { VeiculoId: '8', KMSaidaGaragem: '90071992547409931234' };
    provider(worker, new Response(JSON.stringify([invalid, raw])));
    await worker.importPage(importJob(), settings);
    expect(tx.transportImportRejection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          importId_vehicleIndex_pageSkip_position: {
            importId: 'job-a',
            vehicleIndex: 0,
            pageSkip: 25,
            position: 0,
          },
        },
        create: expect.objectContaining({
          companyId: 'tenant-a',
          raw: invalid,
        }),
        update: {},
      }),
    );
    expect(tx.transportRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.transportRecord.create.mock.calls[0][0].data.externalId).toBe(
      raw.RegistroViagemId,
    );
    expect(tx.transportImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skip: 50,
          imported: { increment: 1 },
          rejected: { increment: 1 },
        }),
      }),
    );
    expect(tx.transportImport.updateMany).not.toHaveBeenCalled();
  });
  it('does not mark a newer verification unavailable when a stale request fails', async () => {
    const { tx, worker } = harness();
    tx.transportImport.updateMany.mockResolvedValue({ count: 0 });
    tx.transportIssue.findFirst.mockResolvedValue(storedIssue());
    provider(worker, new Error('old request failed'));
    await worker.importPage(
      { ...importJob(), verificationIssueId: 'issue-a' },
      settings,
    );
    expect(tx.transportIssue.update).not.toHaveBeenCalled();
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
  });
  it('does not run final verification from an obsolete completed-page response', async () => {
    const { tx, worker } = harness();
    tx.transportImport.findFirst.mockResolvedValue(null);
    tx.transportIssue.findFirst.mockResolvedValue({
      ...storedIssue(),
      record: { ...sourceRecord(), verifiedAt: new Date('2026-06-01') },
    });
    provider(worker, new Response('[]'));
    await worker.importPage(
      { ...importJob(), verificationIssueId: 'issue-a' },
      settings,
    );
    expect(tx.transportIssue.update).not.toHaveBeenCalled();
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
  });
  it('keeps continuity pending when import coverage includes rejected or unfinished records', async () => {
    const { tx, worker } = harness();
    tx.transportImport.count.mockResolvedValue(1);
    tx.transportRecord.findMany
      .mockReset()
      .mockResolvedValueOnce([
        sourceRecord(110),
        {
          ...sourceRecord(200),
          id: 'record-b',
          startKm: 190,
          sortAt: new Date('2026-07-01T12:00:00Z'),
          startedAt: new Date('2026-07-01T12:00:00Z'),
          endedAt: new Date('2026-07-01T13:00:00Z'),
        },
      ])
      .mockResolvedValue([]);
    await worker.analyzePage('tenant-a', settings);
    expect(
      tx.transportIssue.create.mock.calls.some(
        ([query]) => query.data.code === 'ODOMETER_GAP',
      ),
    ).toBe(false);
    expect(
      tx.transportIssue.create.mock.calls.filter(
        ([query]) => query.data.code === 'INCOMPLETE_SEQUENCE',
      ),
    ).toHaveLength(2);
    expect(
      tx.transportIssue.create.mock.calls.every(
        ([query]) => query.data.verificationState === 'PENDING',
      ),
    ).toBe(true);
  });
  it('does not append repeated unavailable-history events on every retry', async () => {
    const { tx, worker } = harness();
    tx.transportIssue.findFirst.mockResolvedValue({
      ...storedIssue(),
      verificationState: 'UNAVAILABLE',
    });
    await worker.unavailable('tenant-a', 'issue-a');
    expect(tx.transportIssueHistory.create).not.toHaveBeenCalled();
    expect(tx.transportIssue.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'tenant-a', id: 'issue-a' },
    });
  });
});
