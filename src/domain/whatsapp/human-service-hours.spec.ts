import { describe, expect, it } from 'vitest';

import {
  decideHumanHandoff,
  isHumanServiceOpen,
  openingHoursSideEffects,
  parseHumanServiceHours,
  type HumanServiceHours,
} from './human-service-hours';

const tenantDefault: HumanServiceHours = {
  timeZone: 'America/Sao_Paulo',
  weekly: {
    1: [{ start: '08:00', end: '18:00' }],
    2: [{ start: '08:00', end: '18:00' }],
    3: [{ start: '08:00', end: '18:00' }],
    4: [{ start: '08:00', end: '18:00' }],
    5: [{ start: '08:00', end: '18:00' }],
  },
  holidays: ['2026-09-07'],
  exceptions: {
    '2026-08-29': [{ start: '09:00', end: '12:00' }],
  },
};

describe('human service hours', () => {
  it('uses tenant time zone and weekly schedule', () => {
    expect(
      isHumanServiceOpen({
        at: new Date('2026-08-31T14:00:00.000Z'), // 11:00 in São Paulo
        tenantDefault,
      }),
    ).toBe(true);
    expect(
      isHumanServiceOpen({
        at: new Date('2026-08-31T22:00:00.000Z'), // 19:00 in São Paulo
        tenantDefault,
      }),
    ).toBe(false);
  });

  it('supports holidays, weekends and exceptional hours', () => {
    expect(
      isHumanServiceOpen({
        at: new Date('2026-09-07T14:00:00.000Z'),
        tenantDefault,
      }),
    ).toBe(false);
    expect(
      isHumanServiceOpen({
        at: new Date('2026-08-29T13:00:00.000Z'), // Saturday exception, 10:00
        tenantDefault,
      }),
    ).toBe(true);
  });

  it('applies a department override without changing the tenant default', () => {
    const override: HumanServiceHours = {
      ...tenantDefault,
      weekly: { 1: [{ start: '12:00', end: '16:00' }] },
      holidays: [],
      exceptions: {},
    };
    const at = new Date('2026-08-31T14:00:00.000Z');

    expect(isHumanServiceOpen({ at, tenantDefault })).toBe(true);
    expect(
      isHumanServiceOpen({ at, tenantDefault, departmentOverride: override }),
    ).toBe(false);
  });

  it('preserves the legacy always-open behavior when no schedule is configured', () => {
    expect(
      isHumanServiceOpen({
        at: new Date('2026-08-31T22:00:00.000Z'),
        tenantDefault: null,
      }),
    ).toBe(true);
  });

  it('validates persisted schedules before using them for routing', () => {
    expect(parseHumanServiceHours(tenantDefault)).toEqual(tenantDefault);
    expect(() =>
      parseHumanServiceHours({
        ...tenantDefault,
        weekly: {
          1: [
            { start: '08:00', end: '12:00' },
            { start: '11:30', end: '18:00' },
          ],
        },
      }),
    ).toThrow(/sobrepostos/iu);
    expect(() =>
      parseHumanServiceHours({
        ...tenantDefault,
        exceptions: { '2026-02-30': 'closed' },
      }),
    ).toThrow(/data inválida/iu);
  });
});

describe('human handoff', () => {
  it('keeps AI working 24/7 when it can resolve the request', () => {
    expect(
      decideHumanHandoff({
        aiCanResolve: true,
        humanServiceOpen: false,
        offHoursMessageAlreadySent: false,
        tenantOffHoursMessage:
          'Recebemos sua solicitação e ela seguirá para atendimento.',
      }),
    ).toEqual({ action: 'continue-ai', customerMessage: null });
  });

  it('queues human control and sends the off-hours message only once', () => {
    const message = 'Recebemos sua solicitação e ela seguirá para atendimento.';
    expect(
      decideHumanHandoff({
        aiCanResolve: false,
        humanServiceOpen: false,
        offHoursMessageAlreadySent: false,
        tenantOffHoursMessage: message,
      }),
    ).toEqual({ action: 'queue-human', customerMessage: message });
    expect(
      decideHumanHandoff({
        aiCanResolve: false,
        humanServiceOpen: false,
        offHoursMessageAlreadySent: true,
        tenantOffHoursMessage: message,
      }),
    ).toEqual({ action: 'queue-human', customerMessage: null });
  });

  it('does not reactivate AI or message the customer when business hours begin', () => {
    expect(openingHoursSideEffects()).toEqual({
      sendAutomaticMessage: false,
      changeControlMode: false,
      activateAi: false,
    });
  });
});
