import { describe, expect, it } from 'vitest';
import { analyzeOdometer, OdometerRecord } from './odometer';
function record(
  id: string,
  startKm: number | null,
  endKm: number | null,
  hour = 6,
): OdometerRecord {
  return {
    id,
    vehicleId: 'vehicle-a',
    startKm,
    endKm,
    startedAt: '2026-07-01T' + String(hour).padStart(2, '0') + ':00:00Z',
    endedAt: '2026-07-01T' + String(hour + 1).padStart(2, '0') + ':00:00Z',
  };
}
const complete = { sequenceComplete: true };
describe('driver-reported odometer analysis', () => {
  it('orders across clients and checks continuity without mutating source order', () => {
    const records = [
      record('afternoon', 179, 252, 15),
      record('morning', 100, 179),
    ];
    expect(analyzeOdometer(records, complete).issues).toEqual([]);
    expect(records[0].id).toBe('afternoon');
  });
  it('never compares different vehicles', () => {
    expect(
      analyzeOdometer(
        [
          record('a', 100, 110),
          { ...record('b', 400, 410, 8), vehicleId: 'b' },
        ],
        complete,
      ).issues,
    ).toEqual([]);
  });
  it('detects final below initial even when coverage is incomplete', () => {
    const result = analyzeOdometer([record('a', 100, 90)]);
    expect(
      result.issues.find((issue) => issue.code === 'NEGATIVE_DISTANCE'),
    ).toMatchObject({
      verificationState: 'VERIFIED',
      context: { distance: -10 },
    });
  });
  it('detects gaps with contextual previous readings and stable issue identity', () => {
    const before = analyzeOdometer(
      [record('a', 100, 110), record('c', 150, 160, 10)],
      complete,
    );
    const after = analyzeOdometer(
      [
        record('a', 100, 110),
        record('b', 110, 140, 8),
        record('c', 150, 160, 10),
      ],
      complete,
    );
    const firstIssue = before.issues.find((issue) => issue.recordId === 'c');
    const updatedIssue = after.issues.find((issue) => issue.recordId === 'c');
    expect(updatedIssue?.stableKey).toBe(firstIssue?.stableKey);
    expect(updatedIssue).toMatchObject({
      previousRecordId: 'b',
      context: { gapKm: 10 },
    });
  });
  it('compares decimal distance exactly at a configured threshold', () => {
    const exact = analyzeOdometer([record('a', 638533.1, 638533.4)], {
      ...complete,
      maxTripKm: 0.3,
    });
    expect(exact.issues).toEqual([]);
    const above = analyzeOdometer([record('a', 638533.1, 638533.401)], {
      ...complete,
      maxTripKm: 0.3,
    });
    expect(above.issues[0]).toMatchObject({
      code: 'SUSPICIOUS_DISTANCE',
      context: { distance: 0.301, thresholdKm: 0.3 },
    });
  });
  it('compares positive and negative decimal gaps exactly at their configured threshold', () => {
    for (const start of [638533.4, 638532.8]) {
      const result = analyzeOdometer(
        [record('a', 638533, 638533.1), record('b', start, start + 1, 8)],
        { ...complete, maxGapKm: 0.3 },
      );
      expect(result.issues.map((issue) => issue.code)).toEqual([
        'ODOMETER_GAP',
      ]);
      expect(result.issues[0].context.gapKm).toBe(
        start === 638533.4 ? 0.3 : -0.3,
      );
    }
    const above = analyzeOdometer(
      [record('a', 638533, 638533.1), record('b', 638533.401, 638534, 8)],
      { ...complete, maxGapKm: 0.3 },
    );
    expect(
      above.issues.find((issue) => issue.code === 'SUSPICIOUS_GAP')?.context
        .gapKm,
    ).toBe(0.301);
  });
  it('does not choose a suspicion threshold by default', () => {
    expect(analyzeOdometer([record('a', 1, 1000000)], complete).issues).toEqual(
      [],
    );
    expect(
      analyzeOdometer([record('a', 1, 1000000)], {
        ...complete,
        maxTripKm: 100,
      }).issues[0].code,
    ).toBe('SUSPICIOUS_DISTANCE');
  });
  it('checks configured positive and negative large gaps', () => {
    const result = analyzeOdometer(
      [record('a', 100, 110), record('b', 90, 100, 8)],
      { ...complete, maxGapKm: 10 },
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'ODOMETER_GAP',
      'SUSPICIOUS_GAP',
    ]);
  });
  it('does not resolve old suspicion when its threshold is disabled', () => {
    const result = analyzeOdometer([record('a', 100, 110)], complete);
    expect(result.evaluatedChecks[0].codes).not.toContain(
      'SUSPICIOUS_DISTANCE',
    );
  });
  it('requires coverage before a discontinuity can be verified', () => {
    const result = analyzeOdometer([
      record('a', 100, 110),
      record('b', 150, 160, 8),
    ]);
    expect(
      result.issues.every((issue) => issue.verificationState === 'PENDING'),
    ).toBe(true);
    expect(result.evaluatedChecks[1].codes).not.toContain('ODOMETER_GAP');
  });
  it('does not treat missing readings as zero', () => {
    const result = analyzeOdometer(
      [record('a', null, 110), record('b', 120, null, 8)],
      complete,
    );
    expect(
      result.issues.filter((issue) => issue.code === 'INCOMPLETE_READING'),
    ).toHaveLength(2);
    expect(
      result.issues.some((issue) => issue.code === 'NEGATIVE_DISTANCE'),
    ).toBe(false);
  });
  it('keeps explicit garage zero as a valid measurement', () => {
    expect(analyzeOdometer([record('a', 0, 10)], complete).issues).toEqual([]);
  });
  it('null timestamps prevent fabricated adjacency across the unknown trip', () => {
    const result = analyzeOdometer(
      [
        record('a', 100, 110),
        { ...record('unknown', 110, 120), startedAt: null },
        record('b', 120, 130, 8),
      ],
      complete,
    );
    expect(result.issues.some((issue) => issue.code === 'ODOMETER_GAP')).toBe(
      false,
    );
    expect(
      result.issues.filter((issue) => issue.code === 'INCOMPLETE_SEQUENCE'),
    ).toHaveLength(3);
  });
  it('uses explicit timezone offsets to establish the actual sequence', () => {
    const result = analyzeOdometer(
      [
        {
          ...record('a', 100, 110),
          startedAt: '2026-07-01T06:00:00-03:00',
          endedAt: '2026-07-01T07:00:00-03:00',
        },
        record('b', 110, 120, 11),
      ],
      complete,
    );
    expect(result.issues).toEqual([]);
    expect(result.evaluatedChecks[1].codes).toContain('ODOMETER_GAP');
  });
  it('rejects host-dependent naive timestamps as sequence evidence', () => {
    const result = analyzeOdometer(
      [{ ...record('a', 100, 110), startedAt: '2026-07-01T06:00:00' }],
      complete,
    );
    expect(result.issues[0].verificationState).toBe('PENDING');
  });
  it('does not blame continuity through overlap or its immediate successor', () => {
    const result = analyzeOdometer(
      [
        { ...record('a', 100, 200), endedAt: '2026-07-01T10:00:00Z' },
        record('b', 110, 120, 8),
        record('c', 200, 210, 10),
      ],
      complete,
    );
    expect(
      result.issues.filter((issue) => issue.code === 'AMBIGUOUS_SEQUENCE'),
    ).toHaveLength(3);
    expect(result.issues.some((issue) => issue.code === 'ODOMETER_GAP')).toBe(
      false,
    );
    expect(result.evaluatedChecks[2].codes).not.toContain('ODOMETER_GAP');
  });
  it('marks equal start times and reversed intervals as ambiguous', () => {
    const result = analyzeOdometer(
      [record('a', 100, 110), record('b', 120, 130)],
      complete,
    );
    expect(
      result.issues.filter((issue) => issue.code === 'AMBIGUOUS_SEQUENCE'),
    ).toHaveLength(2);
    const reverse = analyzeOdometer(
      [{ ...record('a', 100, 110), endedAt: '2026-07-01T05:00:00Z' }],
      complete,
    );
    expect(reverse.issues[0].code).toBe('AMBIGUOUS_SEQUENCE');
  });
  it('allows resolving only checks actually performed after a correction', () => {
    const result = analyzeOdometer(
      [record('a', 100, 110), record('b', 110, 120, 8)],
      complete,
    );
    expect(result.issues).toEqual([]);
    expect(result.evaluatedChecks[1].codes).toContain('ODOMETER_GAP');
    expect(result.evaluatedChecks[0].codes).not.toContain('ODOMETER_GAP');
  });
  it('fails explicit invalid thresholds and duplicate source identities', () => {
    expect(() => analyzeOdometer([], { maxGapKm: -1 })).toThrow();
    expect(() =>
      analyzeOdometer([record('a', 0, 1), record('a', 1, 2)]),
    ).toThrow();
  });
});
