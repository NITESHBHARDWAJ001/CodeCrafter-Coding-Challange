import type { StreakPolicy } from '../types/db';

export interface DayOutcome {
  solved: boolean;
  /** window has ended: an unsolved closed day is a miss; an unsolved open day is still pending. */
  closed: boolean;
}

/**
 * Streak rules (documented, program-configurable):
 *  - Outcomes are the program's released, non-cancelled challenges in day order.
 *  - Solved day            -> streak +1.
 *  - Unsolved & still open -> ignored: today's challenge cannot break a streak until its window closes.
 *  - Unsolved & closed     -> a miss.
 *      RESET_ON_MISS : streak drops to 0 immediately.
 *      GRACE_DAYS    : up to `graceDays` consecutive misses are forgiven (streak kept, not incremented);
 *                      the (graceDays+1)th consecutive miss resets it to 0.
 *  - longest_streak is the maximum value `current` ever reached.
 */
export function computeStreaks(outcomes: DayOutcome[], policy: StreakPolicy, graceDays: number): { current: number; longest: number; missed: number } {
  let current = 0, longest = 0, consecutiveMisses = 0, missed = 0;
  for (const o of outcomes) {
    if (o.solved) {
      current += 1;
      consecutiveMisses = 0;
      if (current > longest) longest = current;
    } else if (o.closed) {
      missed += 1;
      consecutiveMisses += 1;
      if (policy === 'RESET_ON_MISS' || consecutiveMisses > graceDays) current = 0;
    }
  }
  return { current, longest, missed };
}
