import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { PrismaTollMatcherRepository } from './prisma-toll-matcher.repository';

describe('PrismaTollMatcherRepository', () => {
  it('mantém a sequência dos candidatos espaciais e explicita tarifa ausente', async () => {
    const prisma = {
      tollPoint: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 2 },
          _max: {
            sourceUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
            importedAt: new Date('2026-08-02T00:00:00.000Z'),
          },
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          tollPointId: 'point-a',
          sequence: 0.2,
          name: 'Praça A',
          type: 'PHYSICAL_PLAZA',
          road: 'BR-050',
          kilometer: 10,
          state: 'MG',
          direction: 'EASTBOUND',
          concessionaire: 'Concessionária A',
          latitude: -18.9,
          longitude: -48.2,
          tariffPrice: 28.5,
          tariffValidFrom: new Date('2026-01-01T00:00:00.000Z'),
          tariffValidUntil: null,
          source: 'official-fixture',
        },
        {
          tollPointId: 'point-b',
          sequence: 0.8,
          name: 'Pórtico B',
          type: 'FREE_FLOW',
          road: 'BR-050',
          kilometer: 50,
          state: 'MG',
          direction: 'EASTBOUND',
          concessionaire: null,
          latitude: -19.2,
          longitude: -47.7,
          tariffPrice: null,
          tariffValidFrom: null,
          tariffValidUntil: null,
          source: 'official-fixture',
        },
      ]),
    };
    const repository = new PrismaTollMatcherRepository(
      prisma as never,
      new ConfigService({
        TOLL_MATCH_CORRIDOR_METERS: 60,
        TOLL_ALLOW_DEVELOPMENT_FIXTURES: false,
      }),
    );

    const result = await repository.match({
      route: {
        direction: 'outbound',
        distanceKm: 100,
        durationMinutes: 120,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-48.27, -18.91],
            [-47.5, -19.5],
          ],
        },
        encodedPolylines: [],
        segments: [],
        engine: 'valhalla',
        engineVersion: 'test',
        mapDataVersion: 'fixture',
      },
      vehicle: {
        type: 'bus',
        axles: 3,
        fuelType: 'diesel',
        consumptionKmPerLiter: 3.1,
      },
      travelDate: new Date('2026-08-18T12:00:00.000Z'),
    });

    expect(result.items.map((item) => item.tollPointId)).toEqual([
      'point-a',
      'point-b',
    ]);
    expect(result.total).toBe(28.5);
    expect(result.complete).toBe(false);
    expect(result.dataVersion).toBe('2026-08-01T00:00:00.000Z');
    expect(result.items[1]?.tariffStatus).toBe('missing');
  });
});
