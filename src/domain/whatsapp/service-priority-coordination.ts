import type { ServicePriority, ServiceSessionStatus } from './service-session';

const urgencyRank: Readonly<Record<ServicePriority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export interface EffectiveServicePriority {
  readonly priority: ServicePriority;
  readonly organizationalWeight: number;
}

export interface PriorityCandidate extends EffectiveServicePriority {
  readonly sessionId: string;
}

export type PriorityInterruptionDecision =
  | {
      readonly action: 'interrupt';
      readonly reason: 'strictly-higher-priority';
    }
  | {
      readonly action: 'keep-foreground';
      readonly reason: 'same-session' | 'lower-priority' | 'tie-keeps-current';
    };

/**
 * Urgency is the primary safety boundary. The configured queue/department
 * weight breaks ties inside the same urgency band. An exact tie never causes
 * an interruption, which prevents oscillation between concurrent sessions.
 */
export function compareEffectiveServicePriority(
  first: EffectiveServicePriority,
  second: EffectiveServicePriority,
): number {
  const urgencyDifference =
    urgencyRank[first.priority] - urgencyRank[second.priority];
  if (urgencyDifference !== 0) return urgencyDifference;
  return first.organizationalWeight - second.organizationalWeight;
}

export function decidePriorityInterruption(input: {
  readonly foreground: PriorityCandidate;
  readonly challenger: PriorityCandidate;
}): PriorityInterruptionDecision {
  if (input.foreground.sessionId === input.challenger.sessionId) {
    return { action: 'keep-foreground', reason: 'same-session' };
  }
  const comparison = compareEffectiveServicePriority(
    input.challenger,
    input.foreground,
  );
  if (comparison > 0) {
    return { action: 'interrupt', reason: 'strictly-higher-priority' };
  }
  return {
    action: 'keep-foreground',
    reason: comparison === 0 ? 'tie-keeps-current' : 'lower-priority',
  };
}

export interface PausedPriorityCandidate extends PriorityCandidate {
  readonly previousStatus: Exclude<
    ServiceSessionStatus,
    'paused-by-higher-priority' | 'closing' | 'closed'
  >;
  readonly pausedAt: Date;
}

export function selectPriorityResumeCandidate(
  candidates: readonly PausedPriorityCandidate[],
): PausedPriorityCandidate | null {
  return (
    [...candidates].sort((first, second) => {
      const effective = compareEffectiveServicePriority(second, first);
      if (effective !== 0) return effective;
      const recency = second.pausedAt.getTime() - first.pausedAt.getTime();
      return recency || first.sessionId.localeCompare(second.sessionId);
    })[0] ?? null
  );
}
