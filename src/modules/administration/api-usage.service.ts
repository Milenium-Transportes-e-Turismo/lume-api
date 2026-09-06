import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../../application/presenters/user.presenter';
import { forbidden, validationError } from '../../core/errors/app-error';
import { Prisma } from '../../infra/database/prisma/generated/client';
import { PrismaService } from '../../infra/database/prisma/prisma.service';
import {
  auditChangedFields,
  auditOperationLabel,
} from './audit-operation-labels';
import { humanizeApiAction } from './api-usage-labels';

interface UsagePeriod {
  from: Date;
  to: Date;
}

interface DailyUsageRow {
  day: string;
  requests: number;
  bytes: bigint;
}

function assertAdministrator(principal: AuthenticatedPrincipal): void {
  if (!principal.isAdministrator) {
    throw forbidden(
      'Somente administradores podem consultar o uso da plataforma.',
    );
  }
}

function resolvePeriod(from?: string, to?: string): UsagePeriod {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - 6 * 86_400_000);
  start.setHours(0, 0, 0, 0);
  if (to) end.setHours(23, 59, 59, 999);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start > end ||
    end.getTime() - start.getTime() > 90 * 86_400_000
  ) {
    throw validationError('Selecione um período válido de até 90 dias.');
  }
  return { from: start, to: end };
}

function statusFilter(status?: 'success' | 'client-error' | 'server-error') {
  if (status === 'success') return { lt: 400 };
  if (status === 'client-error') return { gte: 400, lt: 500 };
  if (status === 'server-error') return { gte: 500 };
  return undefined;
}

@Injectable()
export class ApiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async operations(
    principal: AuthenticatedPrincipal,
    query: {
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
      userId?: string;
      status?: 'success' | 'client-error' | 'server-error';
    },
    includeActivity = false,
  ) {
    assertAdministrator(principal);
    const period = resolvePeriod(query.from, query.to);
    // Explicit command correlation only. Repeated requests without a command remain distinct.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        operation_id: string;
        actor_id: string | null;
        actor_name: string | null;
        occurred_at: Date;
        events: {
          id: string;
          action: string;
          targetType: string;
          targetId: string;
          targetName: string | null;
          before: unknown;
          after: unknown;
          source: string;
        }[];
        total: bigint;
      }>
    >(
      `WITH events AS (
 SELECT id::text, company_id, actor_user_id, action, target_type, target_id,
 COALESCE(NULLIF(metadata->>'operationId',''),NULLIF(metadata->>'commandId',''), NULLIF(metadata->>'requestId',''), id::text) AS operation_id,
 metadata->'before' AS before_data, metadata->'after' AS after_data, created_at, 'tenant_audit_logs' AS source
 FROM tenant_audit_logs
 UNION ALL
 SELECT id::text, company_id, actor_user_id, action, 'registration', routing_company_id::text, command_id::text, before_snapshot, after_snapshot, created_at, 'routing_company_history' FROM routing_company_history
 UNION ALL
 SELECT id::text, company_id, actor_user_id, action, 'user', user_id::text, command_id::text, before_snapshot, result_snapshot, occurred_at, 'user_update_history' FROM user_update_history
 UNION ALL
 SELECT id::text, company_id, actor_user_id, name, 'whatsapp-channel', channel_id::text,
 COALESCE(NULLIF(metadata->>'operationId',''), regexp_replace(command_id, ':(started|provider-ready|provider-failed)$', '')),
 before_snapshot, after_snapshot, created_at, 'whatsapp_channel_events' FROM whatsapp_channel_events
 UNION ALL
 SELECT id::text, company_id, actor_user_id, name, 'service-session', service_session_id::text, command_id, before_snapshot, after_snapshot, created_at, 'service_session_events' FROM service_session_events
 UNION ALL
 SELECT id::text, company_id, user_id, method || ' ' || route, 'api-request', id::text, 'request:' || id::text,
 NULL::jsonb, jsonb_build_object('statusCode',status_code,'requestBytes',request_bytes,'responseBytes',response_bytes,'durationMs',duration_ms),
 created_at, 'api_request_metrics' FROM api_request_metrics WHERE $7::boolean
), grouped AS (
 SELECT e.operation_id, e.actor_user_id AS actor_id, MAX(e.created_at) AS occurred_at,
 jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'targetType',e.target_type,'targetId',e.target_id,'targetName',COALESCE(r.individual_name,r.legal_name,u.name,c.name),'before',e.before_data,'after',e.after_data,'source',e.source) ORDER BY e.created_at, e.id) AS events
 FROM events e
 LEFT JOIN routing_companies r ON r.company_id=e.company_id AND r.id::text=e.target_id AND e.target_type IN ('registration','routing-company')
 LEFT JOIN users u ON u.company_id=e.company_id AND u.id::text=e.target_id AND e.target_type='user'
 LEFT JOIN whatsapp_channels c ON c.company_id=e.company_id AND c.id::text=e.target_id AND e.target_type='whatsapp-channel'
 WHERE e.company_id=$1::uuid AND e.created_at >= $2 AND e.created_at <= $3 AND ($4::uuid IS NULL OR e.actor_user_id=$4::uuid)
 AND ($8::text IS NULL OR (e.target_type='api-request' AND
 (($8='success' AND (e.after_data->>'statusCode')::int < 400)
 OR ($8='client-error' AND (e.after_data->>'statusCode')::int BETWEEN 400 AND 499)
 OR ($8='server-error' AND (e.after_data->>'statusCode')::int >= 500))))
 GROUP BY e.operation_id, e.actor_user_id
)
SELECT g.*, CASE WHEN actor.deleted_at IS NULL THEN actor.name ELSE 'Usuário excluído' END AS actor_name, COUNT(*) OVER() AS total
FROM grouped g LEFT JOIN users actor ON actor.id=g.actor_id AND actor.company_id=$1::uuid
ORDER BY g.occurred_at DESC,g.operation_id LIMIT $5 OFFSET $6`,
      principal.companyId,
      period.from,
      period.to,
      query.userId ?? null,
      query.pageSize,
      (query.page - 1) * query.pageSize,
      includeActivity,
      includeActivity ? (query.status ?? null) : null,
    );
    return {
      data: rows.map((row) => {
        const first = row.events[0];
        const request =
          first.targetType === 'api-request'
            ? (first.after as {
                statusCode: number;
                requestBytes: number;
                responseBytes: number;
                durationMs: number;
              })
            : null;
        const label = request
          ? {
              module: 'Atividade de usuário',
              action: humanizeApiAction(
                first.action.split(' ')[0],
                first.action.slice(first.action.indexOf(' ') + 1),
              ),
            }
          : auditOperationLabel(first.action, first.targetType);
        return {
          id: row.operation_id,
          actor: row.actor_name ?? 'Sistema',
          actorId: row.actor_id,
          createdAt: row.occurred_at.toISOString(),
          ...label,
          kind: request ? ('request' as const) : ('operation' as const),
          request,
          result: request
            ? request.statusCode >= 500
              ? 'Falha no serviço'
              : request.statusCode >= 400
                ? 'Solicitação não concluída'
                : 'Concluída'
            : 'Registrada',
          target: first.targetName ?? label.module,
          targetId: first.targetId,
          changes: request
            ? []
            : [
                ...new Set(
                  row.events.flatMap((event) =>
                    auditChangedFields(event.before, event.after),
                  ),
                ),
              ],
          events: row.events.map((event) => ({
            id: event.id,
            code: event.action,
            source: event.source,
            targetType: event.targetType,
            targetId: event.targetId,
          })),
        };
      }),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(rows[0]?.total ?? 0),
        totalPages: Math.ceil(Number(rows[0]?.total ?? 0) / query.pageSize),
      },
    };
  }

  async summary(
    principal: AuthenticatedPrincipal,
    query: { from?: string; to?: string },
  ) {
    assertAdministrator(principal);
    const period = resolvePeriod(query.from, query.to);
    const where = {
      companyId: principal.companyId,
      createdAt: { gte: period.from, lte: period.to },
    } satisfies Prisma.ApiRequestMetricWhereInput;
    const [aggregate, errors, userGroups, actionGroups, daily] =
      await Promise.all([
        this.prisma.apiRequestMetric.aggregate({
          where,
          _count: { _all: true },
          _sum: { requestBytes: true, responseBytes: true },
          _avg: { durationMs: true },
        }),
        this.prisma.apiRequestMetric.count({
          where: { ...where, statusCode: { gte: 400 } },
        }),
        this.prisma.apiRequestMetric.groupBy({
          by: ['userId'],
          where,
          _count: { _all: true },
          _sum: { requestBytes: true, responseBytes: true },
          _avg: { durationMs: true },
        }),
        this.prisma.apiRequestMetric.groupBy({
          by: ['method', 'route'],
          where,
          _count: { _all: true },
          _sum: { requestBytes: true, responseBytes: true },
          _avg: { durationMs: true },
        }),
        this.prisma.$queryRaw<DailyUsageRow[]>(Prisma.sql`
          SELECT
            to_char("created_at" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS "day",
            COUNT(*)::int AS "requests",
            COALESCE(SUM("request_bytes" + "response_bytes"), 0)::bigint AS "bytes"
          FROM "api_request_metrics"
          WHERE "company_id" = ${principal.companyId}::uuid
            AND "created_at" >= ${period.from}
            AND "created_at" <= ${period.to}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
      ]);
    const topUserGroups = [...userGroups]
      .sort((first, second) => second._count._all - first._count._all)
      .slice(0, 10);
    const users = await this.prisma.user.findMany({
      where: {
        companyId: principal.companyId,
        id: { in: topUserGroups.map((group) => group.userId) },
      },
      select: { id: true, name: true, email: true, deletedAt: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      totals: {
        requests: aggregate._count._all,
        requestBytes: aggregate._sum.requestBytes ?? 0,
        responseBytes: aggregate._sum.responseBytes ?? 0,
        averageDurationMs: Math.round(aggregate._avg.durationMs ?? 0),
        errors,
        activeUsers: userGroups.length,
      },
      daily: daily.map((row) => ({ ...row, bytes: Number(row.bytes) })),
      users: topUserGroups.map((group) => {
        const user = userById.get(group.userId);
        return {
          id: group.userId,
          name: user?.deletedAt
            ? 'Usuário excluído'
            : (user?.name ?? 'Usuário indisponível'),
          email: user?.deletedAt ? null : (user?.email ?? null),
          requests: group._count._all,
          bytes:
            (group._sum.requestBytes ?? 0) + (group._sum.responseBytes ?? 0),
          averageDurationMs: Math.round(group._avg.durationMs ?? 0),
        };
      }),
      actions: [...actionGroups]
        .sort((first, second) => second._count._all - first._count._all)
        .slice(0, 10)
        .map((group) => ({
          action: humanizeApiAction(group.method, group.route),
          requests: group._count._all,
          bytes:
            (group._sum.requestBytes ?? 0) + (group._sum.responseBytes ?? 0),
          averageDurationMs: Math.round(group._avg.durationMs ?? 0),
        })),
    };
  }

  async list(
    principal: AuthenticatedPrincipal,
    query: {
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
      userId?: string;
      status?: 'success' | 'client-error' | 'server-error';
    },
  ) {
    assertAdministrator(principal);
    const period = resolvePeriod(query.from, query.to);
    const where = {
      companyId: principal.companyId,
      createdAt: { gte: period.from, lte: period.to },
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.status ? { statusCode: statusFilter(query.status) } : {}),
    } satisfies Prisma.ApiRequestMetricWhereInput;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.apiRequestMetric.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, deletedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.apiRequestMetric.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        action: humanizeApiAction(row.method, row.route),
        result:
          row.statusCode >= 500
            ? 'Falha no serviço'
            : row.statusCode >= 400
              ? 'Solicitação não concluída'
              : 'Concluída',
        statusCode: row.statusCode,
        requestBytes: row.requestBytes,
        responseBytes: row.responseBytes,
        durationMs: row.durationMs,
        createdAt: row.createdAt.toISOString(),
        user: {
          id: row.user.id,
          name: row.user.deletedAt ? 'Usuário excluído' : row.user.name,
          email: row.user.deletedAt ? null : row.user.email,
        },
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
}
