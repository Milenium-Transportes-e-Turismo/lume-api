import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';
import { Prisma } from '../../../infra/database/prisma/generated/client';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import {
  commandSchema,
  civilDate,
  parseInput,
  settingsSchema,
} from '../../../modules/transport-import/transport-import.schemas';
import { TransportImportService } from './transport-import.service';

const summarySchema = z
  .object({ contractId: z.string().uuid(), from: civilDate, to: civilDate })
  .refine((v) => v.from <= v.to, 'Período inválido.');
const periodStateSchema = commandSchema
  .extend({
    contractId: z.string().uuid(),
    period: z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/),
    state: z.enum(['OPEN', 'CLOSED']),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
type Metric = {
  day: string;
  count: bigint;
  missing: bigint;
  registered: Prisma.Decimal | null;
};
@Injectable()
export class TransportSummaryService {
  constructor(
    readonly prisma: PrismaService,
    readonly imports: TransportImportService,
  ) {}
  setState(current: AuthenticatedPrincipal, raw: unknown) {
    const input = parseInput(periodStateSchema, raw);
    parseInput(
      civilDate,
      input.period.length === 7 ? input.period + '-01' : input.period,
    );
    return this.imports.command(
      current,
      input,
      'transport.period.state',
      async (tx) => {
        const contract = await tx.transportContractProfile.findFirst({
          where: { companyId: current.companyId, contractId: input.contractId },
        });
        if (!contract) throw notFound('Contrato');
        const key = {
          companyId: current.companyId,
          contractId: input.contractId,
          period: input.period,
        };
        const before = await tx.transportPeriodState.findUnique({
          where: { companyId_contractId_period: key },
        });
        if ((before?.version ?? 0) !== input.expectedVersion)
          throw conflict('O período mudou. Recarregue.');
        return before
          ? tx.transportPeriodState.update({
              where: { id: before.id },
              data: { state: input.state, version: { increment: 1 } },
            })
          : tx.transportPeriodState.create({
              data: { ...key, state: input.state },
            });
      },
    );
  }
  async summary(companyId: string, raw: unknown) {
    const q = parseInput(summarySchema, raw);
    if (
      (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000 >
      366
    )
      throw validationError('Consulte até 367 dias por vez.');
    const contract = await this.prisma.transportContractProfile.findFirst({
      where: { companyId, contractId: q.contractId },
      include: { contract: true },
    });
    if (!contract) throw notFound('Contrato');
    const config = await this.prisma.transportIntegration.findUnique({
      where: { companyId_provider: { companyId, provider: 'avic' } },
    });
    const settings = parseInput(settingsSchema, config?.settings ?? {});
    const conditions = await this.prisma.transportContractCondition.findMany({
      where: {
        companyId,
        contractId: q.contractId,
        validFrom: { lte: new Date(q.to) },
        OR: [{ validUntil: null }, { validUntil: { gte: new Date(q.from) } }],
      },
      orderBy: { validFrom: 'asc' },
    });
    const metrics = await this.prisma.$queryRaw<Metric[]>`
     SELECT to_char(r.started_at AT TIME ZONE ${settings.timezone}, 'YYYY-MM-DD') AS day,
       count(*)::bigint AS count,
       count(*) FILTER (WHERE c.id IS NULL OR
         (c.include_garage AND (r.start_km IS NULL OR r.end_km IS NULL OR r.end_km < r.start_km)) OR
         (NOT c.include_garage AND r.service_km IS NULL))::bigint AS missing,
       sum(CASE WHEN c.include_garage AND r.end_km >= r.start_km THEN r.end_km-r.start_km
                WHEN NOT c.include_garage THEN r.service_km ELSE NULL END) AS registered
     FROM transport_records r
     JOIN transport_external_routes route ON route.company_id=r.company_id AND route.provider=r.provider
       AND route.external_id=r.route_external_id
     JOIN transport_route_assignments a ON a.company_id=r.company_id AND a.route_id=route.id
       AND (r.started_at AT TIME ZONE ${settings.timezone})::date>=a.valid_from
       AND (a.valid_until IS NULL OR (r.started_at AT TIME ZONE ${settings.timezone})::date<=a.valid_until)
     LEFT JOIN transport_contract_conditions c ON c.company_id=r.company_id AND c.contract_id=a.contract_id
       AND (r.started_at AT TIME ZONE ${settings.timezone})::date>=c.valid_from
       AND (c.valid_until IS NULL OR (r.started_at AT TIME ZONE ${settings.timezone})::date<=c.valid_until)
     WHERE r.company_id=${companyId}::uuid AND a.contract_id=${q.contractId}::uuid
       AND (r.started_at AT TIME ZONE ${settings.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date
     GROUP BY day ORDER BY day
   `;
    const states = await this.prisma.transportPeriodState.findMany({
      where: { companyId, contractId: q.contractId },
    });
    const unfinished = await this.prisma.transportImport.count({
      where: {
        companyId,
        supersededByImportId: null,
        OR: [
          { status: { in: ['QUEUED', 'RUNNING', 'FAILED'] } },
          { rejected: { gt: 0 } },
        ],
        from: { lte: new Date(q.to) },
        to: { gte: new Date(q.from) },
      },
    });
    const unresolved = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
     SELECT count(*)::bigint AS count FROM transport_records r
     WHERE r.company_id=${companyId}::uuid
       AND (r.started_at IS NULL OR (r.started_at AT TIME ZONE ${settings.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date)
       AND NOT EXISTS(SELECT 1 FROM transport_external_routes route
         JOIN transport_route_assignments a ON a.route_id=route.id AND a.company_id=route.company_id
         WHERE route.company_id=r.company_id AND route.provider=r.provider AND route.external_id=r.route_external_id
         AND (r.started_at AT TIME ZONE ${settings.timezone})::date>=a.valid_from
         AND (a.valid_until IS NULL OR (r.started_at AT TIME ZONE ${settings.timezone})::date<=a.valid_until))
   `;
    type Group = {
      period: string;
      periodicity: 'DAILY' | 'MONTHLY';
      days: string[];
      conditionIds: Set<string>;
      registered: Prisma.Decimal;
      missing: boolean;
      count: number;
    };
    const groups = new Map<string, Group>();
    for (
      let date = new Date(q.from);
      date <= new Date(q.to);
      date = new Date(date.getTime() + 86400000)
    ) {
      const day = date.toISOString().slice(0, 10);
      const c = conditions.find(
        (c) => c.validFrom <= date && (!c.validUntil || c.validUntil >= date),
      );
      const periodicity = c?.period === 'monthly' ? 'MONTHLY' : 'DAILY';
      const period = periodicity === 'MONTHLY' ? day.slice(0, 7) : day;
      const key = periodicity + period;
      const g = groups.get(key) ?? {
        period,
        periodicity,
        days: [],
        conditionIds: new Set(),
        registered: new Prisma.Decimal(0),
        missing: false,
        count: 0,
      };
      g.days.push(day);
      if (c) g.conditionIds.add(c.id);
      else g.missing = true;
      const metric = metrics.find((m) => m.day === day);
      if (metric) {
        g.count += Number(metric.count);
        g.missing ||= Number(metric.missing) > 0;
        if (metric.registered !== null)
          g.registered = g.registered.add(metric.registered);
      }
      groups.set(key, g);
    }
    return {
      contractId: q.contractId,
      source: 'DRIVER_REPORTED',
      unmappedRecords: Number(unresolved[0]?.count ?? 0),
      periods: [...groups.values()].map((g) => {
        const relevant = conditions.filter((c) => g.conditionIds.has(c.id));
        const c = relevant[0];
        let allowance = c?.allowanceKm ?? null;
        let dataStatus = g.missing
          ? 'INSUFFICIENT_MEASUREMENTS'
          : g.count === 0
            ? 'NO_RECORDS'
            : unfinished
              ? 'IMPORT_PENDING'
              : Number(unresolved[0]?.count ?? 0) > 0
                ? 'MAPPING_PENDING'
                : !settings.sequenceComplete
                  ? 'COVERAGE_UNCONFIRMED'
                  : 'SUFFICIENT';
        if (!c) dataStatus = 'CONDITION_REQUIRED';
        const marker = states.find((s) => s.period === g.period);
        const state = marker?.state ?? 'UNCONFIGURED';
        if (g.periodicity === 'MONTHLY') {
          const monthStart = g.period + '-01';
          const monthEnd = new Date(
            Date.UTC(
              Number(g.period.slice(0, 4)),
              Number(g.period.slice(5, 7)),
              0,
            ),
          )
            .toISOString()
            .slice(0, 10);
          if (
            g.days[0] !== monthStart ||
            g.days[g.days.length - 1] !== monthEnd
          )
            dataStatus = 'PARTIAL_PERIOD';
          const transition = relevant.filter(
            (c) =>
              c.transitionMonth === g.period &&
              c.transitionAllowanceKm !== null,
          );
          if (transition.length === 1)
            allowance = transition[0].transitionAllowanceKm;
          else if (
            relevant.length > 1 ||
            (c &&
              (c.validFrom > new Date(monthStart) ||
                (c.validUntil && c.validUntil < new Date(monthEnd))))
          ) {
            allowance = null;
            if (relevant.some((c) => c.allowanceKm !== null))
              dataStatus = 'TRANSITION_CONDITION_REQUIRED';
          }
        }
        const canCompare =
          dataStatus === 'SUFFICIENT' &&
          allowance !== null &&
          (g.periodicity === 'DAILY' || state === 'CLOSED');
        return {
          period: g.period,
          periodicity: g.periodicity,
          state,
          version: marker?.version ?? 0,
          contractedKm: allowance?.toString() ?? null,
          registeredKm: g.missing ? null : g.registered.toString(),
          differenceKm: canCompare
            ? g.registered.minus(allowance!).toString()
            : null,
          dataStatus,
          recordCount: g.count,
        };
      }),
    };
  }
}
