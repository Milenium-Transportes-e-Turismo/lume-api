/** Pure checks on driver-reported readings. Call only with one tenant/provider scope. */
export interface OdometerRecord {
  id: string;
  vehicleId: string;
  startedAt: string | null;
  endedAt: string | null;
  startKm: number | null;
  endKm: number | null;
}
export type OdometerIssueCode =
  | 'NEGATIVE_DISTANCE'
  | 'SUSPICIOUS_DISTANCE'
  | 'ODOMETER_GAP'
  | 'SUSPICIOUS_GAP'
  | 'INCOMPLETE_READING'
  | 'AMBIGUOUS_SEQUENCE'
  | 'INCOMPLETE_SEQUENCE';
export interface OdometerIssue {
  stableKey: string;
  code: OdometerIssueCode;
  recordId: string;
  previousRecordId: string | null;
  verificationState: 'VERIFIED' | 'PENDING';
  context: Record<string, string | number | boolean | null>;
}
export interface OdometerOptions {
  maxTripKm?: number;
  maxGapKm?: number;
  /** True only after coverage across all clients and displacements is confirmed. */
  sequenceComplete?: boolean;
}
export interface OdometerAnalysis {
  issues: OdometerIssue[];
  evaluatedRecordIds: string[];
  /** Absence of an issue may resolve only these successfully evaluated checks. */
  evaluatedChecks: Array<{ recordId: string; codes: OdometerIssueCode[] }>;
}
const intrinsicCodes: OdometerIssueCode[] = [
  'NEGATIVE_DISTANCE',
  'SUSPICIOUS_DISTANCE',
  'INCOMPLETE_READING',
];
const sequenceCodes: OdometerIssueCode[] = [
  'ODOMETER_GAP',
  'SUSPICIOUS_GAP',
  'AMBIGUOUS_SEQUENCE',
  'INCOMPLETE_SEQUENCE',
];
function instant(value: string | null): number | null {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function reading(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}
interface ExactDecimal {
  units: bigint;
  scale: number;
}
/** Operate on decimal source values, avoiding binary float subtraction near thresholds. */
function decimal(value: number): ExactDecimal {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let units = BigInt(whole + fraction);
  const scale = fraction.length - Number(exponent);
  if (scale < 0) units *= 10n ** BigInt(-scale);
  return { units, scale: Math.max(0, scale) };
}
function subtract(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    scale,
    units:
      left.units * 10n ** BigInt(scale - left.scale) -
      right.units * 10n ** BigInt(scale - right.scale),
  };
}
function decimalValue(value: ExactDecimal): number | string {
  const sign = value.units < 0n ? '-' : '';
  const digits = (value.units < 0n ? -value.units : value.units)
    .toString()
    .padStart(value.scale + 1, '0');
  const text =
    value.scale === 0
      ? sign + digits
      : sign + digits.slice(0, -value.scale) + '.' + digits.slice(-value.scale);
  const numeric = Number(text);
  // JSON-safe numbers for ordinary readings; preserve text if serialization would round.
  return Number.isFinite(numeric) &&
    subtract(decimal(numeric), value).units === 0n
    ? numeric
    : text;
}
function exceeds(value: ExactDecimal, threshold: number): boolean {
  return subtract(value, decimal(threshold)).units > 0n;
}
export function analyzeOdometer(
  records: readonly OdometerRecord[],
  options: OdometerOptions = {},
): OdometerAnalysis {
  for (const limit of [options.maxTripKm, options.maxGapKm]) {
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
      throw new Error('Odometer thresholds must be finite and nonnegative');
    }
  }
  const issues: OdometerIssue[] = [];
  const checks = new Map<string, Set<OdometerIssueCode>>();
  const groups = new Map<string, OdometerRecord[]>();
  const mark = (record: OdometerRecord, codes: OdometerIssueCode[]) => {
    const current = checks.get(record.id) ?? new Set<OdometerIssueCode>();
    codes.forEach((code) => current.add(code));
    checks.set(record.id, current);
  };
  const issue = (
    record: OdometerRecord,
    code: OdometerIssueCode,
    context: OdometerIssue['context'],
    previousRecordId: string | null = null,
    verificationState: OdometerIssue['verificationState'] = 'VERIFIED',
  ) => {
    issues.push({
      // The neighbor is evidence, not identity: late arrivals update the same issue.
      stableKey: JSON.stringify([record.vehicleId, record.id, code]),
      recordId: record.id,
      previousRecordId,
      code,
      context,
      verificationState,
    });
  };
  for (const record of records) {
    if (checks.has(record.id)) throw new Error('Duplicate odometer record ID');
    checks.set(record.id, new Set());
    const group = groups.get(record.vehicleId) ?? [];
    group.push(record);
    groups.set(record.vehicleId, group);
    mark(record, ['INCOMPLETE_READING']);
    if (!reading(record.startKm) || !reading(record.endKm)) {
      issue(
        record,
        'INCOMPLETE_READING',
        { startKm: record.startKm, endKm: record.endKm },
        null,
        'PENDING',
      );
      continue;
    }
    mark(
      record,
      intrinsicCodes.filter(
        (code) =>
          code !== 'SUSPICIOUS_DISTANCE' || options.maxTripKm !== undefined,
      ),
    );
    const exactDistance = subtract(
      decimal(record.endKm),
      decimal(record.startKm),
    );
    const distance = decimalValue(exactDistance);
    if (exactDistance.units < 0n)
      issue(record, 'NEGATIVE_DISTANCE', {
        startKm: record.startKm,
        endKm: record.endKm,
        distance,
      });
    if (
      options.maxTripKm !== undefined &&
      exceeds(exactDistance, options.maxTripKm)
    ) {
      issue(record, 'SUSPICIOUS_DISTANCE', {
        distance,
        thresholdKm: options.maxTripKm,
      });
    }
  }
  for (const group of groups.values()) {
    const hasUnknownTime = group.some(
      (record) =>
        instant(record.startedAt) === null || instant(record.endedAt) === null,
    );
    group.sort(
      (a, b) =>
        (instant(a.startedAt) ?? Infinity) -
          (instant(b.startedAt) ?? Infinity) || a.id.localeCompare(b.id),
    );
    const ambiguousRecords = new Set<string>();
    let intervalEnd = -Infinity;
    let intervalRecord: OdometerRecord | undefined;
    for (const candidate of group) {
      const start = instant(candidate.startedAt);
      const end = instant(candidate.endedAt);
      if (start !== null && end !== null && end < start)
        ambiguousRecords.add(candidate.id);
      if (
        start !== null &&
        intervalRecord &&
        (intervalEnd > start || instant(intervalRecord.startedAt) === start)
      ) {
        ambiguousRecords.add(candidate.id);
        ambiguousRecords.add(intervalRecord.id);
      }
      if (end !== null && end >= intervalEnd) {
        intervalEnd = end;
        intervalRecord = candidate;
      }
    }
    let latestEnd = -Infinity;
    let latestRecord: OdometerRecord | undefined;
    for (let index = 0; index < group.length; index++) {
      const record = group[index];
      const start = instant(record.startedAt);
      const end = instant(record.endedAt);
      const previous = group[index - 1];
      const invalidRange = start !== null && end !== null && end < start;
      const overlapping = start !== null && latestEnd > start;
      const tied =
        previous && start !== null && instant(previous.startedAt) === start;
      if (
        start === null ||
        end === null ||
        hasUnknownTime ||
        !options.sequenceComplete
      ) {
        issue(
          record,
          'INCOMPLETE_SEQUENCE',
          {
            reason: hasUnknownTime
              ? 'UNKNOWN_TIMESTAMPS'
              : 'COVERAGE_NOT_CONFIRMED',
            sequenceComplete: !!options.sequenceComplete,
          },
          previous?.id ?? null,
          'PENDING',
        );
      }
      if (
        invalidRange ||
        overlapping ||
        tied ||
        ambiguousRecords.has(record.id) ||
        (previous && ambiguousRecords.has(previous.id))
      ) {
        issue(
          record,
          'AMBIGUOUS_SEQUENCE',
          {
            reason: invalidRange
              ? 'END_BEFORE_START'
              : tied
                ? 'TIED_START'
                : overlapping
                  ? 'OVERLAP'
                  : 'AMBIGUOUS_NEIGHBOR',
          },
          latestRecord?.id ?? previous?.id ?? null,
          'PENDING',
        );
        // Do not evaluate continuity through an overlap, even if adjacent readings agree.
      } else if (
        start !== null &&
        end !== null &&
        !hasUnknownTime &&
        options.sequenceComplete
      ) {
        mark(record, ['AMBIGUOUS_SEQUENCE', 'INCOMPLETE_SEQUENCE']);
        if (previous && reading(previous.endKm) && reading(record.startKm)) {
          const previousStart = instant(previous.startedAt);
          const previousEnd = instant(previous.endedAt);
          if (
            previousStart !== null &&
            previousEnd !== null &&
            previousEnd >= previousStart
          ) {
            mark(
              record,
              sequenceCodes.filter(
                (code) =>
                  code !== 'SUSPICIOUS_GAP' || options.maxGapKm !== undefined,
              ),
            );
            const exactGap = subtract(
              decimal(record.startKm),
              decimal(previous.endKm),
            );
            const gap = decimalValue(exactGap);
            const context = {
              previousEndKm: previous.endKm,
              startKm: record.startKm,
              gapKm: gap,
            };
            if (exactGap.units !== 0n)
              issue(record, 'ODOMETER_GAP', context, previous.id);
            if (
              options.maxGapKm !== undefined &&
              exceeds(
                {
                  ...exactGap,
                  units: exactGap.units < 0n ? -exactGap.units : exactGap.units,
                },
                options.maxGapKm,
              )
            ) {
              issue(
                record,
                'SUSPICIOUS_GAP',
                { ...context, thresholdKm: options.maxGapKm },
                previous.id,
              );
            }
          }
        }
      }
      if (end !== null && end > latestEnd) {
        latestEnd = end;
        latestRecord = record;
      }
    }
  }
  const evaluatedChecks = [...checks].map(([recordId, codes]) => ({
    recordId,
    codes: [...codes],
  }));
  return {
    issues,
    evaluatedChecks,
    evaluatedRecordIds: evaluatedChecks
      .filter((check) => check.codes.includes('ODOMETER_GAP'))
      .map((check) => check.recordId),
  };
}
