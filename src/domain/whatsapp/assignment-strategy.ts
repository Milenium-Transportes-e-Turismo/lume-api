import { validationError } from '../../core/errors/app-error';

export const ASSIGNMENT_STRATEGIES = [
  'manual',
  'round-robin',
  'least-load',
] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export interface AssignmentCandidate {
  readonly userId: string;
  readonly activeAttendances: number;
  readonly maxConcurrentAttendances: number | null;
  readonly availableForAssignment: boolean;
  readonly lastAssignedAt: Date | null;
}

function isEligible(candidate: AssignmentCandidate): boolean {
  return (
    candidate.availableForAssignment &&
    candidate.activeAttendances >= 0 &&
    (candidate.maxConcurrentAttendances === null ||
      candidate.activeAttendances < candidate.maxConcurrentAttendances)
  );
}

function byOldestAssignment(
  first: AssignmentCandidate,
  second: AssignmentCandidate,
): number {
  const firstAt = first.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const secondAt = second.lastAssignedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return firstAt - secondAt || first.userId.localeCompare(second.userId);
}

export function selectAssignmentCandidate(input: {
  readonly strategy: AssignmentStrategy;
  readonly candidates: readonly AssignmentCandidate[];
}): AssignmentCandidate | null {
  if (input.strategy === 'manual') return null;
  const eligible = input.candidates.filter(isEligible);
  if (eligible.length === 0) return null;

  if (input.strategy === 'round-robin') {
    return [...eligible].sort(byOldestAssignment)[0];
  }

  return [...eligible].sort((first, second) => {
    const loadDifference = first.activeAttendances - second.activeAttendances;
    return loadDifference || byOldestAssignment(first, second);
  })[0];
}

export function assertSingleActiveAssignment(
  activeAssignmentUserIds: readonly string[],
): void {
  const assigned = activeAssignmentUserIds.filter((value) => value.trim());
  if (assigned.length > 1) {
    throw validationError(
      'Uma ServiceSession pode possuir somente um humano responsável por vez.',
    );
  }
}

export function logoutAssignmentEffect(): 'keep-assignment' {
  return 'keep-assignment';
}
