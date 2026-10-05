import { DateTime } from 'luxon';
import { notFound } from '../lib/errors';
import { leaderboardRepo } from '../repositories/leaderboard.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { programService } from './program.service';
import { challengeState, effectiveProgramStatus } from '../domain/challengeState';
import { isVisibleToStudents } from './challenge.service';
import type { LeaderboardRow } from '../types/db';

export type BoardType = 'program' | 'daily' | 'weekly' | 'overall';
interface Page { limit: number; offset: number }

export interface BoardResult {
  type: BoardType;
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
  context?: { challenge_id?: string; day_number?: number; title?: string; since?: string };
}

export const leaderboardService = {
  async get(type: BoardType, programId: string | null, userId: string, isAdmin: boolean, page: Page, challengeId?: string): Promise<BoardResult> {
    if (type === 'overall') {
      const rows = await leaderboardRepo.overall(page.limit, page.offset);
      return { type, rows, me: await meFor(rows, userId, () => leaderboardRepo.overall(1_000_000, 0)) };
    }
    if (!programId) throw notFound('Program required');
    const program = await programService.requireVisible(programId, isAdmin);

    if (type === 'program') {
      const rows = await leaderboardRepo.program(programId, page.limit, page.offset);
      return { type, rows, me: await meFor(rows, userId, () => leaderboardRepo.program(programId, 1_000_000, 0)) };
    }

    if (type === 'weekly') {
      const since = DateTime.now().setZone(program.timezone).startOf('week').toUTC().toISO()!;
      const rows = await leaderboardRepo.weekly(programId, since, page.limit, page.offset);
      return { type, rows, me: await meFor(rows, userId, () => leaderboardRepo.weekly(programId, since, 1_000_000, 0)), context: { since } };
    }

    // daily: a specific released challenge, or today's current one
    const now = new Date();
    const challenges = await challengesRepo.listByProgram(programId);
    const status = effectiveProgramStatus(program, now);
    const target = challengeId
      ? challenges.find((c) => c.id === challengeId)
      : challenges.filter((c) => challengeState(c, status, now) === 'ACTIVE').sort((a, b) => b.release_at.localeCompare(a.release_at))[0]
        ?? challenges.filter((c) => challengeState(c, status, now) === 'COMPLETED').sort((a, b) => b.release_at.localeCompare(a.release_at))[0];
    if (!target || (!isAdmin && !isVisibleToStudents(target, program, now))) return { type, rows: [], me: null };
    const rows = await leaderboardRepo.challenge(target.id, page.limit, page.offset);
    return {
      type, rows, me: await meFor(rows, userId, () => leaderboardRepo.challenge(target.id, 1_000_000, 0)),
      context: { challenge_id: target.id, day_number: target.day_number, title: target.title },
    };
  },
};

/** The caller's own row, even when they're outside the requested page. */
async function meFor(rows: LeaderboardRow[], userId: string, full: () => Promise<LeaderboardRow[]>): Promise<LeaderboardRow | null> {
  const inPage = rows.find((r) => r.user_id === userId);
  if (inPage) return inPage;
  return (await full()).find((r) => r.user_id === userId) ?? null;
}
