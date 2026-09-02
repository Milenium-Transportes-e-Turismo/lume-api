import { describe, expect, it } from 'vitest';

import {
  compareEffectiveServicePriority,
  decidePriorityInterruption,
  selectPriorityResumeCandidate,
} from './service-priority-coordination';

describe('service priority coordination', () => {
  it('makes urgency dominant and uses organizational weight inside its band', () => {
    expect(
      compareEffectiveServicePriority(
        { priority: 'urgent', organizationalWeight: -2_000_000_000 },
        { priority: 'high', organizationalWeight: 2_000_000_000 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareEffectiveServicePriority(
        { priority: 'high', organizationalWeight: 20 },
        { priority: 'high', organizationalWeight: 10 },
      ),
    ).toBeGreaterThan(0);
  });

  it('keeps the current foreground on an exact tie', () => {
    expect(
      decidePriorityInterruption({
        foreground: {
          sessionId: 'foreground',
          priority: 'high',
          organizationalWeight: 50,
        },
        challenger: {
          sessionId: 'challenger',
          priority: 'high',
          organizationalWeight: 50,
        },
      }),
    ).toEqual({
      action: 'keep-foreground',
      reason: 'tie-keeps-current',
    });
  });

  it('selects the highest eligible predecessor and resolves its tie deterministically', () => {
    const pausedAt = new Date('2026-08-29T12:00:00.000Z');
    expect(
      selectPriorityResumeCandidate([
        {
          sessionId: 'b-session',
          priority: 'normal',
          organizationalWeight: 10,
          previousStatus: 'open',
          pausedAt,
        },
        {
          sessionId: 'a-session',
          priority: 'normal',
          organizationalWeight: 10,
          previousStatus: 'waiting-human',
          pausedAt,
        },
      ]),
    ).toMatchObject({ sessionId: 'a-session' });
  });
});
