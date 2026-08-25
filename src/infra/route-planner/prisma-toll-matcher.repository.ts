import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TollMatcherRepository,
  type TollMatcherInput,
} from '../../application/contracts/toll-matcher.repository';
import { AppError } from '../../core/errors/app-error';
import type { TollCalculationItem } from '../../domain/route-planner/route-planner.types';
import { Prisma } from '../database/prisma/generated/client';
import { PrismaService } from '../database/prisma/prisma.service';

interface TollCandidateRow {
  tollPointId: string;
  sequence: number;
  name: string;
  type: 'PHYSICAL_PLAZA' | 'FREE_FLOW';
  road: string;
  kilometer: unknown;
  state: string;
  direction: string;
  concessionaire: string | null;
  latitude: number;
  longitude: number;
  tariffPrice: unknown;
  tariffValidFrom: Date | null;
  tariffValidUntil: Date | null;
  source: string;
}

@Injectable()
export class PrismaTollMatcherRepository extends TollMatcherRepository {
  private readonly logger = new Logger(PrismaTollMatcherRepository.name);
  private readonly corridorMeters: number;
  private readonly allowDevelopmentFixtures: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    this.corridorMeters = config.getOrThrow<number>(
      'TOLL_MATCH_CORRIDOR_METERS',
    );
    this.allowDevelopmentFixtures = config.getOrThrow<boolean>(
      'TOLL_ALLOW_DEVELOPMENT_FIXTURES',
    );
  }

  async match(input: TollMatcherInput) {
    const geometry = JSON.stringify(input.route.geometry);
    try {
      const [dataset, rows] = await Promise.all([
        this.prisma.tollPoint.aggregate({
          where: {
            active: true,
            ...(this.allowDevelopmentFixtures
              ? {}
              : { dataKind: { not: 'DEVELOPMENT_FIXTURE' as const } }),
          },
          _count: { _all: true },
          _max: { sourceUpdatedAt: true, importedAt: true },
        }),
        this.prisma.$queryRaw<TollCandidateRow[]>(Prisma.sql`
          WITH route AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326) AS geom
          ), candidates AS (
            SELECT
              point."id" AS "tollPointId",
              ST_LineLocatePoint(route.geom, point."location"::geometry) AS "sequence",
              point."name",
              point."type"::text AS "type",
              road."name" AS "road",
              point."kilometer",
              point."state",
              point."direction"::text AS "direction",
              concessionaire."name" AS "concessionaire",
              ST_Y(point."location"::geometry) AS "latitude",
              ST_X(point."location"::geometry) AS "longitude",
              point."source",
              route.geom
            FROM "toll_points" point
            JOIN "toll_roads" road ON road."id" = point."road_id" AND road."active" = true
            LEFT JOIN "toll_concessions" concession
              ON concession."id" = point."concession_id"
            LEFT JOIN "toll_concessionaires" concessionaire
              ON concessionaire."id" = concession."concessionaire_id"
            CROSS JOIN route
            WHERE point."active" = true
              AND (${this.allowDevelopmentFixtures} = true OR point."data_kind" <> 'DEVELOPMENT_FIXTURE')
              AND ST_DWithin(
                point."location",
                route.geom::geography,
                ${this.corridorMeters}
              )
          ), directional AS (
            SELECT candidates.*,
              degrees(ST_Azimuth(
                ST_LineInterpolatePoint(geom, GREATEST("sequence" - 0.0001, 0)),
                ST_LineInterpolatePoint(geom, LEAST("sequence" + 0.0001, 1))
              )) AS heading
            FROM candidates
          )
          SELECT
            directional."tollPointId",
            directional."sequence",
            directional."name",
            directional."type",
            directional."road",
            directional."kilometer",
            directional."state",
            directional."direction",
            directional."concessionaire",
            directional."latitude",
            directional."longitude",
            directional."source",
            tariff."price" AS "tariffPrice",
            tariff."valid_from" AS "tariffValidFrom",
            tariff."valid_until" AS "tariffValidUntil"
          FROM directional
          LEFT JOIN LATERAL (
            SELECT candidate_tariff.*
            FROM "toll_tariffs" candidate_tariff
            JOIN "toll_vehicle_categories" category
              ON category."id" = candidate_tariff."vehicle_category_id"
            WHERE candidate_tariff."toll_point_id" = directional."tollPointId"
              AND category."active" = true
              AND category."minimum_axles" <= ${input.vehicle.axles}
              AND (category."maximum_axles" IS NULL OR category."maximum_axles" >= ${input.vehicle.axles})
              AND (candidate_tariff."axles" IS NULL OR candidate_tariff."axles" = ${input.vehicle.axles})
              AND (${this.allowDevelopmentFixtures} = true OR candidate_tariff."data_kind" <> 'DEVELOPMENT_FIXTURE')
              AND candidate_tariff."valid_from" <= ${input.travelDate}::date
              AND (candidate_tariff."valid_until" IS NULL OR candidate_tariff."valid_until" >= ${input.travelDate}::date)
            ORDER BY (candidate_tariff."axles" = ${input.vehicle.axles}) DESC,
              candidate_tariff."valid_from" DESC
            LIMIT 1
          ) tariff ON true
          WHERE directional."direction" = 'BOTH'
            OR directional.heading IS NULL
            OR (directional."direction" = 'NORTHBOUND' AND (directional.heading >= 315 OR directional.heading < 45))
            OR (directional."direction" = 'EASTBOUND' AND directional.heading >= 45 AND directional.heading < 135)
            OR (directional."direction" = 'SOUTHBOUND' AND directional.heading >= 135 AND directional.heading < 225)
            OR (directional."direction" = 'WESTBOUND' AND directional.heading >= 225 AND directional.heading < 315)
          ORDER BY directional."sequence" ASC
        `),
      ]);
      const items: TollCalculationItem[] = rows.map((row, index) => ({
        tollPointId: row.tollPointId,
        sequence: index + 1,
        name: row.name,
        type: row.type === 'FREE_FLOW' ? 'free-flow' : 'physical-plaza',
        road: row.road,
        kilometer: row.kilometer === null ? null : Number(row.kilometer),
        state: row.state,
        direction: row.direction.toLocaleLowerCase('en-US'),
        concessionaire: row.concessionaire,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        tariffStatus: row.tariffPrice === null ? 'missing' : 'found',
        price: row.tariffPrice === null ? null : Number(row.tariffPrice),
        tariffValidFrom:
          row.tariffValidFrom?.toISOString().slice(0, 10) ?? null,
        tariffValidUntil:
          row.tariffValidUntil?.toISOString().slice(0, 10) ?? null,
        source: row.source,
      }));
      const datasetAvailable = dataset._count._all > 0;
      const datasetVersion =
        dataset._max.sourceUpdatedAt ?? dataset._max.importedAt;
      const total = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
      const complete =
        datasetAvailable &&
        items.length > 0 &&
        items.every((item) => item.tariffStatus === 'found');
      this.logger.log({
        event: items.length > 0 ? 'toll.match' : 'toll.not_found',
        direction: input.route.direction,
        candidateCount: items.length,
        datasetAvailable,
      });
      return {
        count: items.length,
        total: Math.round((total + Number.EPSILON) * 100) / 100,
        complete,
        dataStatus: datasetAvailable
          ? ('available' as const)
          : ('unavailable' as const),
        dataVersion: datasetVersion?.toISOString() ?? null,
        items,
        matcherStrategy: 'postgis-corridor-heading-v1',
      };
    } catch (error) {
      this.logger.error({
        event: 'toll.error',
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new AppError(
        'TOLL_DATA_UNAVAILABLE',
        'A base interna de pedágios está indisponível.',
      );
    }
  }
}
