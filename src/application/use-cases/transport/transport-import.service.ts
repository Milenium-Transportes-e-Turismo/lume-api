import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { Prisma } from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import {
  analysisSchema,
  importSchema,
  integrationSchema,
  justificationSchema,
  pageSchema,
  parseInput,
  resumeSchema,
  settingsSchema,
} from '../../../modules/transport-import/transport-import.schemas';

export const transportJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}
export const transportHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(JSON.parse(JSON.stringify(value)))))
    .digest('hex');
export const endOfDay = (date: string) =>
  new Date(new Date(date + 'T00:00:00Z').getTime() + 86400000);
type Tx = Prisma.TransactionClient;

@Injectable()
export class TransportImportService {
  constructor(
    readonly prisma: PrismaService,
    readonly config: ConfigService,
  ) {}

  async command(
    current: AuthenticatedPrincipal,
    input: { commandId: string },
    action: string,
    apply: (tx: Tx) => Promise<unknown>,
  ) {
    const fingerprint = transportHash({ actor: current.id, action, input });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'transport:' + current.companyId},0))`;
      const receipt = await tx.transportImportCommand.findUnique({
        where: {
          companyId_commandId: {
            companyId: current.companyId,
            commandId: input.commandId,
          },
        },
      });
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw conflict('commandId já utilizado por outro comando.');
        return receipt.result;
      }
      if (action !== 'transport.integration.configure')
        await tx.transportIntegration.upsert({
          where: {
            companyId_provider: {
              companyId: current.companyId,
              provider: 'avic',
            },
          },
          create: { companyId: current.companyId },
          update: {},
        });
      const result = transportJson(await apply(tx));
      await tx.transportImportCommand.create({
        data: {
          companyId: current.companyId,
          commandId: input.commandId,
          fingerprint,
          result,
        },
      });
      await tx.tenantAuditLog.create({
        data: {
          companyId: current.companyId,
          actorUserId: current.id,
          action,
          targetType: 'transport',
          targetId: input.commandId,
          metadata: { commandId: input.commandId },
        },
      });
      return result;
    });
  }

  async integration(companyId: string) {
    const row = await this.prisma.transportIntegration.findUnique({
      where: { companyId_provider: { companyId, provider: 'avic' } },
    });
    const settings = parseInput(settingsSchema, row?.settings ?? {});
    const requirements: string[] = [];
    if (!this.config.get<string>('AVIC_API_BASE_URL'))
      requirements.push('Configurar AVIC_API_BASE_URL na API.');
    if (!settings.externalIdField)
      requirements.push(
        'Confirmar qual identificador externo é estável: RegistroViagemId ou Id.',
      );
    if (!settings.sourceUtcOffset)
      requirements.push('Confirmar o fuso dos horários retornados pela Avic.');
    if (
      ![true, 'true'].includes(
        this.config.get('TRANSPORT_WORKER_ENABLED') ?? false,
      )
    )
      requirements.push(
        'Ativar TRANSPORT_WORKER_ENABLED na API para processar as filas.',
      );
    return {
      id: row?.id ?? null,
      provider: 'avic',
      version: row?.version ?? 0,
      enabled: row?.enabled ?? false,
      settings,
      configured: requirements.length === 0,
      activationRequirements: requirements,
    };
  }

  configure(current: AuthenticatedPrincipal, raw: unknown) {
    const input = parseInput(integrationSchema, raw);
    if (
      input.enabled &&
      (!input.settings.externalIdField ||
        !input.settings.sourceUtcOffset ||
        !this.config.get('AVIC_API_BASE_URL'))
    )
      throw validationError(
        'Configure a URL da API, o identificador estável e o fuso da origem antes de ativar.',
      );
    return this.command(
      current,
      input,
      'transport.integration.configure',
      async (tx) => {
        const existing = await tx.transportIntegration.findUnique({
          where: {
            companyId_provider: {
              companyId: current.companyId,
              provider: 'avic',
            },
          },
        });
        if ((existing?.version ?? 0) !== input.expectedVersion)
          throw conflict('A configuração mudou. Recarregue.');
        if (
          existing &&
          parseInput(settingsSchema, existing.settings).externalIdField !==
            input.settings.externalIdField &&
          (await tx.transportRecord.count({
            where: { companyId: current.companyId },
          })) > 0
        )
          throw conflict(
            'O identificador externo não pode mudar após a importação. É necessária uma migração explícita do mapeamento.',
          );
        return existing
          ? tx.transportIntegration.update({
              where: { id: existing.id },
              data: {
                settings: transportJson(input.settings),
                enabled: input.enabled,
                version: { increment: 1 },
              },
            })
          : tx.transportIntegration.create({
              data: {
                companyId: current.companyId,
                settings: transportJson(input.settings),
                enabled: input.enabled,
              },
            });
      },
    );
  }

  createImport(current: AuthenticatedPrincipal, raw: unknown) {
    const input = parseInput(importSchema, raw);
    return this.command(current, input, 'transport.import.create', async (tx) =>
      tx.transportImport.create({
        data: {
          companyId: current.companyId,
          from: new Date(input.from),
          to: new Date(input.to),
          vehicleIds: [...new Set(input.vehicleIds)],
        },
      }),
    );
  }
  resume(current: AuthenticatedPrincipal, id: string, raw: unknown) {
    const input = parseInput(resumeSchema, raw);
    return this.command(
      current,
      input,
      'transport.import.resume:' + id,
      async (tx) => {
        const row = await tx.transportImport.findFirst({
          where: { id, companyId: current.companyId },
        });
        if (!row) throw notFound('Importação');
        if (row.version !== input.expectedVersion)
          throw conflict('A importação mudou. Recarregue.');
        if (row.status !== 'FAILED')
          throw conflict(
            'Somente uma importação interrompida pode ser retomada.',
          );
        return tx.transportImport.update({
          where: { id },
          data: {
            status: 'QUEUED',
            lastError: null,
            attemptCount: 0,
            nextAttemptAt: new Date(),
            version: { increment: 1 },
          },
        });
      },
    );
  }
  async importDetail(companyId: string, id: string) {
    const row = await this.prisma.transportImport.findFirst({
      where: { companyId, id },
    });
    if (!row) throw notFound('Importação');
    return row;
  }
  async rejections(companyId: string, id: string, raw: unknown) {
    await this.importDetail(companyId, id);
    const q = parseInput(pageSchema, raw);
    return this.page(
      await this.prisma.transportImportRejection.findMany({
        where: { companyId, importId: id },
        omit: { raw: true },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      q.limit,
    );
  }
  async listImports(companyId: string, raw: unknown) {
    const q = parseInput(pageSchema, raw);
    const items = await this.prisma.transportImport.findMany({
      where: { companyId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return this.page(items, q.limit);
  }
  async listAnalysis(companyId: string, raw: unknown) {
    const q = parseInput(pageSchema, raw);
    return this.page(
      await this.prisma.transportAnalysis.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      q.limit,
    );
  }
  analysis(current: AuthenticatedPrincipal, raw: unknown) {
    const input = parseInput(analysisSchema, raw);
    return this.command(
      current,
      input,
      'transport.analysis.create',
      async (tx) =>
        tx.transportAnalysis.create({
          data: {
            companyId: current.companyId,
            vehicleId: input.vehicleId,
            from: new Date(input.from),
            to: new Date(input.to),
          },
        }),
    );
  }
  async records(companyId: string, raw: unknown) {
    const q = parseInput(pageSchema, raw);
    const integration = await this.prisma.transportIntegration.findUnique({
      where: { companyId_provider: { companyId, provider: 'avic' } },
    });
    const timezone = parseInput(
      settingsSchema,
      integration?.settings ?? {},
    ).timezone;
    const bounds =
      q.from || q.to
        ? (
            await this.prisma.$queryRaw<
              Array<{ start: Date; end: Date }>
            >`SELECT
      (${q.from ?? '1970-01-01'}::date::timestamp AT TIME ZONE ${timezone}) AS start,
      ((${q.to ?? '9999-12-30'}::date+1)::timestamp AT TIME ZONE ${timezone}) AS end`
          )[0]
        : null;
    const items = await this.prisma.transportRecord.findMany({
      where: {
        companyId,
        ...(q.vehicleId ? { vehicleExternalId: q.vehicleId } : {}),
        ...(q.from || q.to
          ? {
              sortAt: {
                ...(q.from ? { gte: bounds!.start } : {}),
                ...(q.to ? { lt: bounds!.end } : {}),
              },
            }
          : {}),
      },
      omit: { raw: true, fingerprint: true },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return this.page(await this.projectMappings(companyId, items), q.limit);
  }
  async projectMappings<
    T extends {
      routeExternalId: string | null;
      startedAt: Date | null;
      vehicleExternalId: string;
    },
  >(companyId: string, rows: T[]) {
    const config = await this.prisma.transportIntegration.findUnique({
      where: { companyId_provider: { companyId, provider: 'avic' } },
    });
    const settings = parseInput(settingsSchema, config?.settings ?? {});
    const routes = await this.prisma.transportExternalRoute.findMany({
      where: {
        companyId,
        provider: 'avic',
        externalId: {
          in: rows.flatMap((r) =>
            r.routeExternalId ? [r.routeExternalId] : [],
          ),
        },
      },
      include: { assignments: { include: { contract: true } } },
    });
    const fleets = await this.prisma.transportFleet.findMany({
      where: {
        companyId,
        provider: 'avic',
        externalVehicleId: { in: rows.map((r) => r.vehicleExternalId) },
      },
      include: { ownerships: true },
    });
    const dateOf = (value: Date) =>
      new Date(
        new Intl.DateTimeFormat('sv-SE', {
          timeZone: settings.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(value),
      );
    return rows.map((row) => {
      const day = row.startedAt ? dateOf(row.startedAt) : null;
      const assignments = routes
        .filter((route) => route.externalId === row.routeExternalId)
        .flatMap((route) => route.assignments)
        .filter(
          (a) =>
            day && a.validFrom <= day && (!a.validUntil || a.validUntil >= day),
        );
      const fleet = fleets.find(
        (f) => f.externalVehicleId === row.vehicleExternalId,
      );
      const ownership = fleet?.ownerships.find(
        (o) =>
          day && o.validFrom <= day && (!o.validUntil || o.validUntil >= day),
      );
      return {
        ...row,
        mappingStatus:
          assignments.length === 1
            ? 'MAPPED'
            : assignments.length > 1
              ? 'AMBIGUOUS'
              : 'PENDING',
        contractId: assignments.length === 1 ? assignments[0].contractId : null,
        supplierRegistrationId:
          assignments.length === 1
            ? assignments[0].contract.supplierRegistrationId
            : null,
        modality:
          assignments.length === 1 ? assignments[0].contract.modality : null,
        fleetId: fleet?.id ?? null,
        fleetSupplierRegistrationId: ownership?.supplierRegistrationId ?? null,
      };
    });
  }

  async record(companyId: string, id: string) {
    const row = await this.prisma.transportRecord.findFirst({
      where: { companyId, id },
      omit: { raw: true, fingerprint: true },
    });
    if (!row) throw notFound('Registro importado');
    const history = await this.prisma.transportRecordHistory.findMany({
      where: { companyId, recordId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      ...(await this.projectMappings(companyId, [row]))[0],
      history: history.map((h) => ({
        ...h,
        before: this.publicSnapshot(h.before),
        after: this.publicSnapshot(h.after),
      })),
    };
  }
  publicSnapshot(value: Prisma.JsonValue | null): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    const { raw: _raw, fingerprint: _fingerprint, ...snapshot } = value;
    void _raw;
    void _fingerprint;
    return snapshot;
  }
  async issues(companyId: string, raw: unknown) {
    const q = parseInput(pageSchema, raw);
    return this.page(
      await this.prisma.transportIssue.findMany({
        where: {
          companyId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.vehicleId ? { vehicleExternalId: q.vehicleId } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      q.limit,
    );
  }
  async issue(companyId: string, id: string) {
    const row = await this.prisma.transportIssue.findFirst({
      where: { companyId, id },
      include: { history: { orderBy: { createdAt: 'desc' }, take: 100 } },
    });
    if (!row) throw notFound('Pendência');
    return row;
  }
  justify(current: AuthenticatedPrincipal, id: string, raw: unknown) {
    const input = parseInput(justificationSchema, raw);
    return this.command(
      current,
      input,
      'transport.issue.justify:' + id,
      async (tx) => {
        const row = await tx.transportIssue.findFirst({
          where: { companyId: current.companyId, id },
        });
        if (!row) throw notFound('Pendência');
        if (row.version !== input.expectedVersion)
          throw conflict('A pendência mudou. Recarregue antes de justificar.');
        const updated = await tx.transportIssue.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await tx.transportIssueHistory.create({
          data: {
            companyId: current.companyId,
            issueId: id,
            kind: 'JUSTIFIED',
            actorUserId: current.id,
            text: input.text,
          },
        });
        return updated;
      },
    );
  }
  page<T extends { id: string }>(items: T[], limit: number) {
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? items[limit - 1].id : null,
    };
  }
}
