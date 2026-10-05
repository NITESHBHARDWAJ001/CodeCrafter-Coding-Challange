import type { Challenge, Difficulty, Program } from '../types/db';

export const FALLBACK_POINTS: Record<Difficulty, number> = { EASY: 100, MEDIUM: 150, HARD: 250 };

/** Points a challenge is worth *right now*. The value is frozen into challenge_submissions.awarded_points at award time. */
export function resolvePoints(c: Pick<Challenge, 'difficulty' | 'points_override'>, p: Pick<Program, 'default_points'>): number {
  if (c.points_override !== null && c.points_override !== undefined) return c.points_override;
  return p.default_points?.[c.difficulty] ?? FALLBACK_POINTS[c.difficulty];
}
