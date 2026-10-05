import { challengesRepo } from '../repositories/challenges.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { progressRepo, submissionsRepo } from '../repositories/submissions.repo';
import { programsRepo } from '../repositories/programs.repo';
import { buildProgress } from '../domain/progress';
import { notFound } from '../lib/errors';

export const progressService = {
  /**
   * Recompute points/streaks/solved for the whole cohort from verified submissions.
   * Purely derived, so it can run any number of times (also after a failed or partial sync) without drift.
   */
  async recomputeProgram(programId: string, now = new Date()): Promise<number> {
    const program = await programsRepo.get(programId);
    if (!program) throw notFound('Program not found');
    const [challenges, submissions, userIds] = await Promise.all([
      challengesRepo.listByProgram(programId),
      submissionsRepo.listByProgram(programId),
      participantsRepo.enrolledUserIds(programId),
    ]);
    const rows = buildProgress(program, challenges, submissions, userIds, now);
    await progressRepo.upsertMany(rows);
    return rows.length;
  },
};
