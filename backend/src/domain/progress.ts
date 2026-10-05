import type { Challenge, Program, Progress, Submission } from '../types/db';
import { challengeState, effectiveProgramStatus, isReleased } from './challengeState';
import { computeStreaks } from './streak';

/**
 * Rebuild every participant's progress from the source of truth (verified submissions).
 * Deriving, never incrementing, makes it idempotent: syncing twice, or recovering after a failed sync,
 * cannot drift or double count.
 */
export function buildProgress(
  program: Program,
  challenges: Challenge[],
  submissions: Submission[],
  userIds: string[],
  now: Date = new Date(),
): Progress[] {
  const status = effectiveProgramStatus(program, now);
  const released = challenges
    .filter((c) => isReleased(challengeState(c, status, now)))
    .sort((a, b) => a.day_number - b.day_number);

  const byUser = new Map<string, Map<string, Submission>>();
  for (const s of submissions) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, new Map());
    byUser.get(s.user_id)!.set(s.challenge_id, s);
  }

  return userIds.map((userId) => {
    const mine = byUser.get(userId) ?? new Map<string, Submission>();
    const outcomes = released.map((c) => ({
      solved: mine.has(c.id),
      closed: challengeState(c, status, now) === 'COMPLETED',
    }));
    const { current, longest, missed } = computeStreaks(outcomes, program.streak_policy, program.streak_grace_days);
    let points = 0, solved = 0, last: string | null = null;
    for (const s of mine.values()) {
      points += s.awarded_points;
      solved += 1;
      if (!last || s.submitted_at > last) last = s.submitted_at;
    }
    return {
      program_id: program.id, user_id: userId, solved_count: solved, total_points: points,
      current_streak: current, longest_streak: longest, missed_days: missed,
      last_solved_at: last, updated_at: now.toISOString(),
    };
  });
}
