import { describe, expect, it } from 'vitest';

import { AppError } from '../../core/errors/app-error';
import {
  applyTripCommand,
  createTripDraft,
  type Trip,
  type TripCommand,
  type TripPlan,
} from './trip';

const firstPlan: TripPlan = {
  serviceDate: '2026-09-10',
  legs: [
    { id: 'leg-return', sequence: 2, label: 'Volta' },
    { id: 'leg-outbound', sequence: 1, label: 'Ida' },
  ],
};

function draft(plan: TripPlan = firstPlan): Trip {
  return createTripDraft({
    id: 'trip-1',
    companyId: 'tenant-1',
    code: ' vg-001 ',
    source: {
      kind: 'continuous-contract',
      contractId: 'contract-1',
      sourceVersion: 3,
    },
    plan,
    actorUserId: 'operator-1',
    commandId: 'command-create',
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
  }).trip;
}

function apply(
  trip: Trip,
  command: Omit<
    TripCommand,
    'commandId' | 'actorUserId' | 'expectedVersion' | 'occurredAt'
  > &
    Partial<
      Pick<
        TripCommand,
        'commandId' | 'actorUserId' | 'expectedVersion' | 'occurredAt'
      >
    >,
) {
  return applyTripCommand(trip, {
    commandId: `command-${command.type}-${trip.version}`,
    actorUserId: 'operator-1',
    expectedVersion: trip.version,
    occurredAt: new Date(
      new Date('2026-09-01T12:00:00.000Z').getTime() + trip.version * 60_000,
    ),
    ...command,
  } as TripCommand);
}

function scheduled(): Trip {
  return apply(draft(), { type: 'schedule' }).trip;
}

function executing(): Trip {
  return apply(scheduled(), { type: 'start' }).trip;
}

const evidence = [
  {
    kind: 'manual-note' as const,
    description: 'Relato confirmado pelo responsável operacional.',
  },
];

describe('trip aggregate', () => {
  it('cria um rascunho manual ligado a uma origem versionada', () => {
    const result = createTripDraft({
      id: 'trip-1',
      companyId: 'tenant-1',
      code: ' vg-001 ',
      source: {
        kind: 'confirmed-service',
        confirmedServiceId: 'service-1',
        sourceVersion: 2,
      },
      plan: firstPlan,
      actorUserId: 'operator-1',
      commandId: 'command-create',
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
    });

    expect(result.trip).toMatchObject({
      code: 'VG-001',
      status: 'draft',
      version: 1,
      planVersion: 0,
      source: {
        kind: 'confirmed-service',
        confirmedServiceId: 'service-1',
        sourceVersion: 2,
      },
    });
    expect(result.trip.plan.legs.map(({ id }) => id)).toEqual([
      'leg-outbound',
      'leg-return',
    ]);
    expect(result.history).toMatchObject({
      action: 'draft-created',
      fromStatus: null,
      toStatus: 'draft',
      resultingVersion: 1,
    });
  });

  it('permite rascunho incompleto, mas exige data e trecho para programar', () => {
    const incomplete = draft({ serviceDate: null, legs: [] });

    expect(() => apply(incomplete, { type: 'schedule' })).toThrow(
      /data civil/i,
    );

    const withoutLegs = apply(incomplete, {
      type: 'edit-draft',
      plan: { serviceDate: '2026-09-10', legs: [] },
    }).trip;
    expect(() => apply(withoutLegs, { type: 'schedule' })).toThrow(
      /ao menos um trecho/i,
    );
  });

  it('programa uma viagem e cria uma versão imutável do plano', () => {
    const result = apply(draft(), { type: 'schedule' });

    expect(result.trip).toMatchObject({
      status: 'scheduled',
      version: 2,
      planVersion: 1,
      scheduledAt: expect.any(Date),
    });
    expect(result.planVersion).toMatchObject({
      version: 1,
      aggregateVersion: 2,
      reason: null,
      plan: result.trip.plan,
    });
    expect(result.history).toMatchObject({
      action: 'schedule',
      fromStatus: 'draft',
      toStatus: 'scheduled',
    });
  });

  it('troca edição comum por revisão versionada depois da programação', () => {
    const programmed = scheduled();

    expect(() =>
      apply(programmed, { type: 'edit-draft', plan: firstPlan }),
    ).toThrow(/revisão da programação/i);

    const revised = apply(programmed, {
      type: 'revise-schedule',
      reason: 'Cliente alterou o horário programado.',
      plan: {
        ...firstPlan,
        legs: [{ id: 'leg-outbound', sequence: 1, label: 'Ida revisada' }],
      },
    });
    expect(revised.trip).toMatchObject({
      status: 'scheduled',
      planVersion: 2,
      version: 3,
    });
    expect(revised.planVersion).toMatchObject({
      version: 2,
      reason: 'Cliente alterou o horário programado.',
    });
  });

  it('aplica a suspensão reversível com motivo e ocorrência auditável', () => {
    const running = executing();
    expect(() => apply(running, { type: 'suspend', reason: '  ' })).toThrow(
      /motivo/i,
    );

    const suspended = apply(running, {
      type: 'suspend',
      reason: 'Via temporariamente bloqueada.',
    });
    expect(suspended.trip.status).toBe('suspended');
    expect(suspended.operationalRecord).toMatchObject({
      kind: 'occurrence',
      category: 'suspension',
      reason: 'Via temporariamente bloqueada.',
    });

    const resumed = apply(suspended.trip, {
      type: 'resume',
      reason: 'Via liberada pela autoridade local.',
    });
    expect(resumed.trip.status).toBe('in-execution');
    expect(resumed.operationalRecord).toMatchObject({
      kind: 'occurrence',
      category: 'resumption',
    });
  });

  it('exige motivo e evidência para a interrupção definitiva', () => {
    const running = executing();
    expect(() =>
      apply(running, {
        type: 'interrupt',
        reason: 'Falha mecânica sem possibilidade de retomada.',
        evidence: [],
      }),
    ).toThrow(/evidência/i);

    const interrupted = apply(running, {
      type: 'interrupt',
      reason: 'Falha mecânica sem possibilidade de retomada.',
      evidence,
    });
    expect(interrupted.trip.status).toBe('interrupted');
    expect(interrupted.operationalRecord).toMatchObject({
      kind: 'occurrence',
      category: 'interruption',
      evidence,
    });
    expect(() =>
      apply(interrupted.trip, {
        type: 'resume',
        reason: 'Tentativa indevida de retomada.',
      }),
    ).toThrow(/interrupted para in-execution/i);

    const closed = apply(interrupted.trip, {
      type: 'close-early',
      reason: 'Execução preservada até o ponto da falha.',
    });
    expect(closed.trip).toMatchObject({
      status: 'early-terminated',
      endedAt: expect.any(Date),
    });
  });

  it('bloqueia edição depois do início e diferencia ocorrência de desvio', () => {
    const running = executing();

    expect(() =>
      apply(running, { type: 'edit-draft', plan: firstPlan }),
    ).toThrow(/ocorrências ou desvios/i);
    expect(() =>
      apply(running, {
        type: 'record-occurrence',
        reason: 'Parada operacional observada.',
        evidence: [],
      }),
    ).toThrow(/evidência/i);

    const occurrence = apply(running, {
      type: 'record-occurrence',
      reason: 'Embarque adicional autorizado.',
      evidence,
    });
    expect(occurrence.trip.status).toBe('in-execution');
    expect(occurrence.operationalRecord?.kind).toBe('occurrence');

    const deviation = apply(occurrence.trip, {
      type: 'record-deviation',
      reason: 'Trajeto alterado por bloqueio da via planejada.',
      evidence,
    });
    expect(deviation.trip.status).toBe('in-execution');
    expect(deviation.operationalRecord).toMatchObject({
      kind: 'deviation',
      reason: 'Trajeto alterado por bloqueio da via planejada.',
    });
  });

  it('cancela somente antes do início e sempre exige motivo', () => {
    const programmed = scheduled();
    expect(() => apply(programmed, { type: 'cancel', reason: ' ' })).toThrow(
      /motivo/i,
    );

    const cancelled = apply(programmed, {
      type: 'cancel',
      reason: 'Solicitação do cliente antes da saída.',
    });
    expect(cancelled.trip).toMatchObject({
      status: 'cancelled',
      endedAt: expect.any(Date),
    });
    expect(cancelled.history.reason).toBe(
      'Solicitação do cliente antes da saída.',
    );
    expect(() =>
      apply(executing(), {
        type: 'cancel',
        reason: 'Não pode virar cancelamento depois da saída.',
      }),
    ).toThrow(/in-execution para cancelled/i);
  });

  it('conclui normalmente e impede novas mutações operacionais', () => {
    const completed = apply(executing(), { type: 'complete' }).trip;
    expect(completed.status).toBe('completed');
    expect(() =>
      apply(completed, {
        type: 'record-deviation',
        reason: 'Registro tardio.',
        evidence,
      }),
    ).toThrow(/antes do encerramento/i);
  });

  it('protege toda mutação com versão esperada', () => {
    const current = draft();
    expect(() =>
      applyTripCommand(current, {
        type: 'schedule',
        commandId: 'stale-command',
        actorUserId: 'operator-1',
        expectedVersion: 99,
        occurredAt: new Date('2026-09-02T12:00:00.000Z'),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AppError>>({ code: 'CONFLICT' }),
    );
  });
});
