import { describe, expect, it } from 'vitest';

import {
  freezeTripRoutePlanSelection,
  prepareTripRoutePlanSelection,
  type TripRoutePlanSelection,
} from './trip-route-plan';

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tripId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const routeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorUserId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const commandId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const selectedAt = new Date('2026-09-01T12:00:00.000Z');

function prepare(
  overrides: Partial<Parameters<typeof prepareTripRoutePlanSelection>[0]> = {},
) {
  return prepareTripRoutePlanSelection({
    id: '11111111-1111-4111-8111-111111111111',
    companyId,
    tripId,
    tripStatus: 'draft',
    tripContractId: contractId,
    tripStartedAt: null,
    route: {
      id: routeId,
      contractId,
      aggregateVersion: 8,
      approvedVersion: 7,
    },
    approvedVersion: {
      version: 7,
      planVersion: 3,
      snapshot: {
        route: { code: 'ROTA-01', name: 'Centro → Fábrica' },
        points: [{ sequence: 1, label: 'Praça Central' }],
      },
    },
    expectedRouteVersion: 8,
    currentSelection: null,
    actorUserId,
    commandId,
    reason: undefined,
    selectedAt,
    ...overrides,
  });
}

describe('seleção do Plano de Rota da Viagem', () => {
  it('seleciona a versão aprovada e preserva somente o snapshot operacional', () => {
    const result = prepare({
      approvedVersion: {
        version: 7,
        planVersion: 3,
        snapshot: {
          route: { code: 'ROTA-01', name: 'Centro → Fábrica' },
          points: [{ sequence: 1, label: 'Praça Central' }],
          navigationLinks: [{ label: 'Ida', url: 'https://maps.example/ida' }],
          assignments: [
            {
              passengerId: 'passenger-1',
              passengerName: 'Nome que não pode ser duplicado',
              accessibilityRequired: true,
              accessibilityNotes: 'Informação sensível',
            },
          ],
        },
      },
    });

    expect(result).toMatchObject({
      sourceRouteId: routeId,
      sourceRouteVersion: 7,
      sourcePlanVersion: 3,
      routeAggregateVersionAtSelection: 8,
      reason: null,
      selectedByUserId: actorUserId,
      selectedAt,
      supersededAt: null,
      usedForExecutionAt: null,
    });
    expect(result.sourceSnapshot).toEqual({
      route: { code: 'ROTA-01', name: 'Centro → Fábrica' },
      points: [{ sequence: 1, label: 'Praça Central' }],
      navigationLinks: [{ label: 'Ida', url: 'https://maps.example/ida' }],
    });
    expect(JSON.stringify(result.sourceSnapshot)).not.toContain('passenger');
    expect(JSON.stringify(result.sourceSnapshot)).not.toContain(
      'Informação sensível',
    );
  });

  it('exige motivo para substituir o Plano de Rota vigente', () => {
    const currentSelection = prepare();

    expect(() =>
      prepare({
        tripStatus: 'scheduled',
        currentSelection,
      }),
    ).toThrow('Informe o motivo da substituição');

    expect(
      prepare({
        tripStatus: 'scheduled',
        currentSelection,
        reason: '  Trajeto revisado após nova aprovação.  ',
      }).reason,
    ).toBe('Trajeto revisado após nova aprovação.');
  });

  it('bloqueia seleção depois do início da execução', () => {
    expect(() =>
      prepare({
        tripStatus: 'in-execution',
        tripStartedAt: selectedAt,
      }),
    ).toThrow('não pode ser trocado depois do início');
  });

  it('rejeita rota de outro contrato e versão de leitura desatualizada', () => {
    expect(() =>
      prepare({
        route: {
          id: routeId,
          contractId: '22222222-2222-4222-8222-222222222222',
          aggregateVersion: 8,
          approvedVersion: 7,
        },
      }),
    ).toThrow('mesmo contrato');

    expect(() => prepare({ expectedRouteVersion: 6 })).toThrow('Rota alterada');
  });

  it('rejeita rota sem aprovação ou snapshot diferente da versão aprovada', () => {
    expect(() =>
      prepare({
        route: {
          id: routeId,
          contractId,
          aggregateVersion: 8,
          approvedVersion: null,
        },
      }),
    ).toThrow('versão aprovada');

    expect(() =>
      prepare({
        approvedVersion: {
          version: 6,
          planVersion: 3,
          snapshot: {},
        },
      }),
    ).toThrow('snapshot aprovado');
  });

  it('congela somente a seleção vigente que orientou o início', () => {
    const current = prepare();
    expect(freezeTripRoutePlanSelection(current, selectedAt)).toMatchObject({
      usedForExecutionAt: selectedAt,
      supersededAt: null,
    });

    expect(() =>
      freezeTripRoutePlanSelection(
        {
          ...current,
          supersededAt: new Date('2026-09-01T11:00:00.000Z'),
        } satisfies TripRoutePlanSelection,
        selectedAt,
      ),
    ).toThrow('seleção vigente');
  });
});
