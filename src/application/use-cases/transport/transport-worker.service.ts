import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AvicClient,
  normalizeAvicRecord,
} from '../../../infra/avic/avic-client';
import { analyzeOdometer } from '../../../domain/transport/odometer';
import {
  Prisma,
  type TransportImport,
  type TransportIntegration,
} from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import {
  parseInput,
  settingsSchema,
  type TransportSettings,
} from '../../../modules/transport-import/transport-import.schemas';
import {
  endOfDay,
  transportHash,
  transportJson,
} from './transport-import.service';

const dayString = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86400000);
const asDate = (value: string | null) => (value ? new Date(value) : null);
type Tx = Prisma.TransactionClient;
@Injectable()
export class TransportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransportWorkerService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly avicClients = new Map<string, AvicClient>();
  constructor(
    readonly prisma: PrismaService,
    readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (
      ![true, 'true'].includes(
        this.config.get('TRANSPORT_WORKER_ENABLED') ?? false,
      )
    )
      return;
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn(
          'Processamento de transportes indisponível; nova tentativa no próximo ciclo.',
        ),
      );
    }, 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.avicClients.clear();
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const integrations = await this.prisma.transportIntegration.findMany({
        take: 100,
      });
      for (const integration of integrations) {
        const leaseUntil = new Date(Date.now() + 120000);
        const lease = await this.prisma.transportIntegration.updateMany({
          where: {
            id: integration.id,
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
          },
          data: { leaseUntil },
        });
        if (!lease.count) continue;
        try {
          const settings = parseInput(settingsSchema, integration.settings);
          if (integration.enabled) {
            await this.schedule(integration, settings);
            const job = await this.prisma.transportImport.findFirst({
              where: {
                companyId: integration.companyId,
                status: { in: ['QUEUED', 'RUNNING'] },
                nextAttemptAt: { lte: new Date() },
              },
              orderBy: { createdAt: 'asc' },
            });
            if (job) await this.importPage(job, settings);
          }
          await this.analyzePage(integration.companyId, settings);
        } finally {
          await this.prisma.transportIntegration.updateMany({
            where: { id: integration.id, leaseUntil },
            data: { leaseUntil: null },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
  async schedule(
    integration: TransportIntegration,
    settings: TransportSettings,
  ) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const part = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const day = part('year') + '-' + part('month') + '-' + part('day');
    const time = part('hour') + ':' + part('minute');
    if (time < settings.scheduleTime) return;
    if (integration.lastScheduledDay !== day) {
      let cursor: string | undefined;
      let batch = 0;
      for (;;) {
        const fleet = await this.prisma.transportFleet.findMany({
          where: {
            companyId: integration.companyId,
            provider: 'avic',
            externalVehicleId: { not: null },
            active: true,
          },
          select: { id: true, externalVehicleId: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!fleet.length) break;
        const vehicleIds = fleet.flatMap((f) =>
          f.externalVehicleId ? [f.externalVehicleId] : [],
        );
        await this.prisma.transportImport.upsert({
          where: {
            companyId_provider_scheduleKey: {
              companyId: integration.companyId,
              provider: 'avic',
              scheduleKey: 'daily:' + day + ':' + batch,
            },
          },
          create: {
            companyId: integration.companyId,
            vehicleIds,
            from: plusDays(new Date(day), -settings.lookbackDays),
            to: new Date(day),
            scheduleKey: 'daily:' + day + ':' + batch,
          },
          update: {},
        });
        cursor = fleet[fleet.length - 1].id;
        batch++;
        if (fleet.length < 500) break;
      }
      await this.prisma.transportIntegration.update({
        where: { id: integration.id },
        data: { lastScheduledDay: day },
      });
    }
    const pending = await this.prisma.transportIssue.findMany({
      where: {
        companyId: integration.companyId,
        status: 'OPEN',
        nextVerificationAt: { lte: new Date() },
      },
      include: { record: true },
      orderBy: { nextVerificationAt: 'asc' },
      take: 10,
    });
    for (const issue of pending) {
      const date = issue.record.startedAt ?? issue.record.sourceUpdatedAt;
      if (!date) {
        await this.unavailable(issue.companyId, issue.id);
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.transportImport.upsert({
          where: {
            companyId_provider_scheduleKey: {
              companyId: issue.companyId,
              provider: 'avic',
              scheduleKey: 'verify:' + issue.id + ':' + day,
            },
          },
          create: {
            companyId: issue.companyId,
            vehicleIds: [issue.vehicleExternalId],
            from: plusDays(date, -settings.lookbackDays),
            to: plusDays(date, settings.lookbackDays),
            verificationIssueId: issue.id,
            scheduleKey: 'verify:' + issue.id + ':' + day,
          },
          update: {},
        });
        await tx.transportIssue.update({
          where: { id: issue.id },
          data: { nextVerificationAt: plusDays(new Date(), 1) },
        });
      });
    }
  }
  client(companyId: string) {
    const cached = this.avicClients.get(companyId);
    if (cached) return cached;
    let headers: Record<string, string> = {};
    const secret = this.config.get<string>('AVIC_API_HEADERS_JSON');
    if (secret) {
      const parsed: unknown = JSON.parse(secret);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((v) => typeof v !== 'string')
      )
        throw new Error('Avic authentication configuration invalid');
      headers = parsed as Record<string, string>;
    }
    const userId = this.config.get<string>('AVIC_API_USER_ID') ?? '';
    const accessKey = this.config.get<string>('AVIC_API_ACCESS_KEY') ?? '';
    const client = new AvicClient({
      baseUrl: this.config.getOrThrow<string>('AVIC_API_BASE_URL'),
      headers,
      ...(userId || accessKey
        ? {
            credentials: {
              userId,
              accessKey,
              utcOffset:
                this.config.get<string>('AVIC_AUTH_UTC_OFFSET') || undefined,
            },
          }
        : {}),
      maxPages: 50000,
      timeoutMs: 30000,
    });
    // Bounded cache, isolated by the authoritative tenant from the persisted job.
    if (this.avicClients.size >= 100) {
      const oldest = this.avicClients.keys().next().value;
      if (oldest !== undefined) this.avicClients.delete(oldest);
    }
    this.avicClients.set(companyId, client);
    return client;
  }
  async importPage(job: TransportImport, settings: TransportSettings) {
    try {
      if (job.skip >= 1250000)
        throw new Error('Limite de páginas atingido; reduza o período.');
      const page = await this.client(job.companyId).readPage({
        vehicleId: job.vehicleIds[job.vehicleIndex],
        from: dayString(plusDays(job.from, -settings.lookbackDays)),
        to: dayString(plusDays(job.to, settings.lookbackDays)),
        skip: job.skip,
      });
      const normalized = page.records.map((raw, position) => {
        try {
          return {
            position,
            raw,
            record: normalizeAvicRecord(raw, {
              externalIdField: settings.externalIdField,
              sourceUtcOffset: settings.sourceUtcOffset,
            }),
          };
        } catch {
          return { position, raw, record: null };
        }
      });
      const records = normalized.flatMap((item) =>
        item.record ? [item.record] : [],
      );
      const rejected = normalized.filter((item) => item.record === null);
      const applied = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'transport:' + job.companyId},0))`;
        const authoritative = await tx.transportImport.findFirst({
          where: { id: job.id, companyId: job.companyId, version: job.version },
        });
        if (!authoritative) return false;
        for (const item of rejected)
          await tx.transportImportRejection.upsert({
            where: {
              importId_vehicleIndex_pageSkip_position: {
                importId: job.id,
                vehicleIndex: job.vehicleIndex,
                pageSkip: job.skip,
                position: item.position,
              },
            },
            create: {
              companyId: job.companyId,
              importId: job.id,
              vehicleIndex: job.vehicleIndex,
              pageSkip: job.skip,
              position: item.position,
              raw: transportJson(item.raw),
              reason:
                'Identificador ausente ou contrato da origem inválido. Revise o mapeamento; o item foi preservado sem atribuir identidade.',
            },
            update: {},
          });
        for (const record of records) {
          const fingerprint = transportHash(record.raw);
          const before = await tx.transportRecord.findUnique({
            where: {
              companyId_provider_externalId: {
                companyId: job.companyId,
                provider: 'avic',
                externalId: record.externalId,
              },
            },
          });
          if (before?.fingerprint === fingerprint) {
            await tx.transportRecord.update({
              where: { id: before.id },
              data: { verifiedAt: new Date() },
            });
            continue;
          }
          const data = {
            driverExternalId: record.driverExternalId,
            driverName: record.driverName?.slice(0, 200) ?? null,
            customerExternalId: record.customerExternalId,
            customerName: record.customerName?.slice(0, 200) ?? null,
            vehicleExternalId: record.vehicleId,
            fleet: record.fleet,
            routeExternalId: record.routeExternalId,
            routeName: record.routeName,
            startedAt: asDate(record.startedAt),
            endedAt: asDate(record.endedAt),
            sortAt: asDate(record.startedAt) ?? new Date(0),
            startKm: record.startKm,
            endKm: record.endKm,
            reportedKm: record.reportedKm,
            // The provider example cannot establish which readings isolate garage legs.
            serviceKm: null,
            sourceUpdatedAt: asDate(record.sourceUpdatedAt),
            raw: transportJson(record.raw),
            fingerprint,
            verifiedAt: new Date(),
          };
          const updated = before
            ? await tx.transportRecord.update({
                where: { id: before.id },
                data: { ...data, version: { increment: 1 } },
              })
            : await tx.transportRecord.create({
                data: {
                  ...data,
                  companyId: job.companyId,
                  externalId: record.externalId,
                },
              });
          await tx.transportRecordHistory.create({
            data: {
              companyId: job.companyId,
              recordId: updated.id,
              version: updated.version,
              before: before ? transportJson(before) : Prisma.JsonNull,
              after: transportJson(updated),
            },
          });
          if (
            before &&
            (before.vehicleExternalId !== updated.vehicleExternalId ||
              before.sortAt.getTime() !== updated.sortAt.getTime())
          ) {
            await this.enqueueAnalysis(
              tx,
              job.companyId,
              before.vehicleExternalId,
              plusDays(before.sortAt, -1),
              plusDays(before.sortAt, 1),
            );
          }
          if (record.routeName || record.routeExternalId) {
            // Discovery is deliberately name based and remains unconfirmed. An external ID
            // is bound only by an explicit route mapping command in the catalog.
            const name = (
              record.routeName ??
              'Identificador externo ' + record.routeExternalId
            ).slice(0, 200);
            const existing = await tx.transportExternalRoute.findFirst({
              where: { companyId: job.companyId, provider: 'avic', name },
            });
            if (!existing)
              await tx.transportExternalRoute.create({
                data: { companyId: job.companyId, provider: 'avic', name },
              });
          }
        }
        const endVehicle = page.nextSkip === null;
        const nextVehicle = endVehicle
          ? job.vehicleIndex + 1
          : job.vehicleIndex;
        const completed = nextVehicle >= job.vehicleIds.length;
        await tx.transportImport.update({
          where: { id: job.id },
          data: {
            status: completed ? 'COMPLETED' : 'RUNNING',
            vehicleIndex: nextVehicle,
            skip: endVehicle ? 0 : page.nextSkip!,
            imported: { increment: records.length },
            rejected: { increment: rejected.length },
            lastError: null,
            attemptCount: 0,
            version: { increment: 1 },
          },
        });
        if (completed) {
          if (job.rejected + rejected.length === 0)
            await tx.$executeRaw`UPDATE transport_imports
            SET superseded_by_import_id=${job.id}::uuid,version=version+1,updated_at=CURRENT_TIMESTAMP
            WHERE company_id=${job.companyId}::uuid AND provider='avic' AND id<>${job.id}::uuid
              AND created_at<${job.createdAt} AND superseded_by_import_id IS NULL
              AND (status='FAILED' OR (status='COMPLETED' AND rejected>0))
              AND "from">=${job.from}::date AND "to"<=${job.to}::date
              AND vehicle_ids <@ ARRAY[${Prisma.join(job.vehicleIds)}]::text[]`;
          for (const vehicleId of job.vehicleIds)
            await this.enqueueAnalysis(
              tx,
              job.companyId,
              vehicleId,
              job.from,
              job.to,
            );
        }
        return true;
      });
      if (!applied) return;
      if (
        page.nextSkip === null &&
        job.vehicleIndex + 1 >= job.vehicleIds.length &&
        job.verificationIssueId
      ) {
        const issue = await this.prisma.transportIssue.findFirst({
          where: { id: job.verificationIssueId, companyId: job.companyId },
          include: { record: true },
        });
        if (issue && issue.record.verifiedAt < job.createdAt)
          await this.unavailable(job.companyId, issue.id);
      }
    } catch {
      const attempt = job.attemptCount + 1;
      const failed = await this.prisma.transportImport.updateMany({
        where: { id: job.id, version: job.version },
        data: {
          status: attempt >= 5 ? 'FAILED' : 'QUEUED',
          attemptCount: attempt,
          lastError:
            'Não foi possível verificar esta página na Avic. O cursor foi preservado; nenhuma divergência foi confirmada ou resolvida.',
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 60000 * 2 ** attempt),
          ),
          version: { increment: 1 },
        },
      });
      if (failed.count && job.verificationIssueId)
        await this.unavailable(job.companyId, job.verificationIssueId);
    }
  }
  async enqueueAnalysis(
    tx: Tx,
    companyId: string,
    vehicleId: string,
    from: Date,
    to: Date,
  ) {
    const existing = await tx.transportAnalysis.findFirst({
      where: {
        companyId,
        vehicleId,
        from,
        to,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });
    if (existing?.status === 'RUNNING')
      await tx.transportAnalysis.update({
        where: { id: existing.id },
        data: {
          status: 'QUEUED',
          cursorAt: null,
          cursorId: null,
          processed: 0,
        },
      });
    if (!existing)
      await tx.transportAnalysis.create({
        data: { companyId, vehicleId, from, to },
      });
  }
  async unavailable(companyId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.transportIssue.findFirst({
        where: { companyId, id },
      });
      if (!before) return;
      await tx.transportIssue.update({
        where: { id },
        data: {
          verificationState: 'UNAVAILABLE',
          verificationUnavailableAt: new Date(),
          nextVerificationAt: plusDays(new Date(), 1),
          version: { increment: 1 },
        },
      });
      if (before.verificationState !== 'UNAVAILABLE')
        await tx.transportIssueHistory.create({
          data: {
            companyId,
            issueId: id,
            kind: 'VERIFICATION_UNAVAILABLE',
            before: { verificationState: before.verificationState },
            after: { verificationState: 'UNAVAILABLE' },
          },
        });
    });
  }
  async analyzePage(companyId: string, settings: TransportSettings) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'transport:' + companyId},0))`;
        const job = await tx.transportAnalysis.findFirst({
          where: { companyId, status: { in: ['QUEUED', 'RUNNING'] } },
          orderBy: { createdAt: 'asc' },
        });
        if (!job) return;
        const rows = await tx.transportRecord.findMany({
          where: {
            companyId,
            vehicleExternalId: job.vehicleId,
            AND: [
              {
                OR: [
                  { startedAt: null },
                  {
                    sortAt: {
                      gte: plusDays(job.from, -1),
                      lt: plusDays(endOfDay(dayString(job.to)), 1),
                    },
                  },
                ],
              },
              ...(job.cursorAt && job.cursorId
                ? [
                    {
                      OR: [
                        { sortAt: { gt: job.cursorAt } },
                        { sortAt: job.cursorAt, id: { gt: job.cursorId } },
                      ],
                    },
                  ]
                : []),
            ],
          },
          orderBy: [{ sortAt: 'asc' }, { id: 'asc' }],
          take: 200,
        });
        if (!rows.length) {
          await tx.transportAnalysis.update({
            where: { id: job.id },
            data: { status: 'COMPLETED' },
          });
          return;
        }
        const first = rows[0],
          last = rows[rows.length - 1];
        const previous = await tx.transportRecord.findFirst({
          where: {
            companyId,
            vehicleExternalId: job.vehicleId,
            OR: [
              { sortAt: { lt: first.sortAt } },
              { sortAt: first.sortAt, id: { lt: first.id } },
            ],
          },
          orderBy: [{ sortAt: 'desc' }, { id: 'desc' }],
        });
        const next = await tx.transportRecord.findFirst({
          where: {
            companyId,
            vehicleExternalId: job.vehicleId,
            OR: [
              { sortAt: { gt: last.sortAt } },
              { sortAt: last.sortAt, id: { gt: last.id } },
            ],
          },
          orderBy: [{ sortAt: 'asc' }, { id: 'asc' }],
        });
        const overlapping = await tx.transportRecord.findMany({
          where: {
            companyId,
            vehicleExternalId: job.vehicleId,
            sortAt: { lt: first.sortAt },
            endedAt: { gte: first.sortAt },
          },
          take: 200,
        });
        const missingTime = await tx.transportRecord.count({
          where: {
            companyId,
            vehicleExternalId: job.vehicleId,
            startedAt: null,
          },
        });
        const pendingImport = await tx.transportImport.count({
          where: {
            companyId,
            vehicleIds: { has: job.vehicleId },
            supersededByImportId: null,
            OR: [
              { status: { in: ['QUEUED', 'RUNNING', 'FAILED'] } },
              { rejected: { gt: 0 } },
            ],
          },
        });
        const all = [
          ...new Map(
            [
              ...(previous ? [previous] : []),
              ...overlapping,
              ...rows,
              ...(next ? [next] : []),
            ].map((r) => [r.id, r]),
          ).values(),
        ];
        const result = analyzeOdometer(
          all.map((r) => ({
            id: r.id,
            vehicleId: r.vehicleExternalId,
            startedAt: r.startedAt?.toISOString() ?? null,
            endedAt: r.endedAt?.toISOString() ?? null,
            startKm: r.startKm === null ? null : Number(r.startKm),
            endKm: r.endKm === null ? null : Number(r.endKm),
          })),
          {
            ...(settings.maxTripKm === null
              ? {}
              : { maxTripKm: settings.maxTripKm }),
            ...(settings.maxGapKm === null
              ? {}
              : { maxGapKm: settings.maxGapKm }),
            sequenceComplete:
              settings.sequenceComplete &&
              missingTime === 0 &&
              pendingImport === 0 &&
              overlapping.length < 200,
          },
        );
        const targets = new Set(rows.map((r) => r.id));
        if (next) targets.add(next.id);
        const byId = new Map(all.map((r) => [r.id, r]));
        for (const finding of result.issues.filter((i) =>
          targets.has(i.recordId),
        )) {
          const context = transportJson({
            ...finding.context,
            previousRecordId: finding.previousRecordId,
          });
          const existing = await tx.transportIssue.findUnique({
            where: {
              companyId_provider_recordId_code: {
                companyId,
                provider: 'avic',
                recordId: finding.recordId,
                code: finding.code,
              },
            },
          });
          const record = byId.get(finding.recordId)!;
          // An unavailable external verification remains unavailable until the source was seen again.
          const state =
            existing?.verificationState === 'UNAVAILABLE' &&
            record.verifiedAt <
              (existing.verificationUnavailableAt ?? existing.updatedAt)
              ? 'UNAVAILABLE'
              : finding.verificationState;
          const data = {
            vehicleExternalId: record.vehicleExternalId,
            status: 'OPEN',
            verificationState: state,
            context,
            lastVerifiedAt:
              state === 'VERIFIED'
                ? new Date()
                : (existing?.lastVerifiedAt ?? null),
          };
          const changed =
            !existing ||
            existing.status !== 'OPEN' ||
            existing.verificationState !== state ||
            transportHash(existing.context) !== transportHash(context);
          if (!changed) {
            if (state === 'VERIFIED')
              await tx.transportIssue.update({
                where: { id: existing.id },
                data: { lastVerifiedAt: new Date() },
              });
            continue;
          }
          const updated = existing
            ? await tx.transportIssue.update({
                where: { id: existing.id },
                data: { ...data, version: { increment: 1 } },
              })
            : await tx.transportIssue.create({
                data: {
                  ...data,
                  companyId,
                  recordId: finding.recordId,
                  vehicleExternalId: record.vehicleExternalId,
                  code: finding.code,
                },
              });
          await tx.transportIssueHistory.create({
            data: {
              companyId,
              issueId: updated.id,
              kind: existing ? 'CHANGED' : 'DETECTED',
              before: existing
                ? transportJson({
                    context: existing.context,
                    status: existing.status,
                    verificationState: existing.verificationState,
                  })
                : Prisma.JsonNull,
              after: transportJson(data),
            },
          });
        }
        for (const check of result.evaluatedChecks.filter((c) =>
          targets.has(c.recordId),
        )) {
          const existing = await tx.transportIssue.findMany({
            where: {
              companyId,
              recordId: check.recordId,
              status: 'OPEN',
              code: { in: check.codes },
            },
          });
          for (const issue of existing) {
            if (
              result.issues.some(
                (i) => i.recordId === check.recordId && i.code === issue.code,
              )
            )
              continue;
            const row = byId.get(check.recordId)!;
            if (
              issue.verificationState === 'UNAVAILABLE' &&
              row.verifiedAt <
                (issue.verificationUnavailableAt ?? issue.updatedAt)
            )
              continue;
            await tx.transportIssue.update({
              where: { id: issue.id },
              data: {
                status: 'RESOLVED',
                verificationState: 'VERIFIED',
                lastVerifiedAt: new Date(),
                version: { increment: 1 },
              },
            });
            await tx.transportIssueHistory.create({
              data: {
                companyId,
                issueId: issue.id,
                kind: 'RESOLVED',
                before: { status: issue.status, context: issue.context },
                after: { status: 'RESOLVED' },
              },
            });
          }
        }
        await tx.transportAnalysis.update({
          where: { id: job.id },
          data: {
            status: rows.length < 200 ? 'COMPLETED' : 'RUNNING',
            cursorAt: last.sortAt,
            cursorId: last.id,
            processed: { increment: rows.length },
          },
        });
      },
      { timeout: 60000 },
    );
  }
}
