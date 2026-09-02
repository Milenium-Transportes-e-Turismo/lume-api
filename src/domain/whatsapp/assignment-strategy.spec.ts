import { describe, expect, it } from 'vitest';

import {
  assertSingleActiveAssignment,
  logoutAssignmentEffect,
  selectAssignmentCandidate,
  type AssignmentCandidate,
} from './assignment-strategy';

const first: AssignmentCandidate = {
  userId: '6c427456-f7cc-4b92-b4b7-cea777491610',
  activeAttendances: 2,
  maxConcurrentAttendances: null,
  availableForAssignment: true,
  lastAssignedAt: new Date('2026-08-29T11:00:00.000Z'),
};
const second: AssignmentCandidate = {
  userId: 'f1947ce3-b9e2-439c-820f-f5eb208dfdb2',
  activeAttendances: 1,
  maxConcurrentAttendances: 2,
  availableForAssignment: true,
  lastAssignedAt: new Date('2026-08-29T12:00:00.000Z'),
};

describe('service assignment strategies', () => {
  it('keeps MANUAL unassigned', () => {
    expect(
      selectAssignmentCandidate({
        strategy: 'manual',
        candidates: [first, second],
      }),
    ).toBe(null);
  });

  it('uses oldest assignment for ROUND_ROBIN', () => {
    expect(
      selectAssignmentCandidate({
        strategy: 'round-robin',
        candidates: [second, first],
      }),
    ).toEqual(first);
  });

  it('uses active load for LEAST_LOAD and respects maximum capacity', () => {
    expect(
      selectAssignmentCandidate({
        strategy: 'least-load',
        candidates: [first, second],
      }),
    ).toEqual(second);
    expect(
      selectAssignmentCandidate({
        strategy: 'least-load',
        candidates: [
          { ...second, activeAttendances: 2, maxConcurrentAttendances: 2 },
        ],
      }),
    ).toBe(null);
  });

  it('supports an unlimited nullable maximum without treating logout as release', () => {
    expect(
      selectAssignmentCandidate({
        strategy: 'least-load',
        candidates: [
          {
            ...first,
            activeAttendances: 1_000,
            maxConcurrentAttendances: null,
          },
        ],
      }),
    ).toEqual({
      ...first,
      activeAttendances: 1_000,
      maxConcurrentAttendances: null,
    });
    expect(logoutAssignmentEffect()).toBe('keep-assignment');
  });

  it('rejects multiple active human assignments for the same session', () => {
    expect(() =>
      assertSingleActiveAssignment([first.userId, second.userId]),
    ).toThrow('somente um humano responsável');
    expect(() => assertSingleActiveAssignment([first.userId])).not.toThrow();
  });
});
