import { participantsRepo } from '../repositories/participants.repo';
import { programsRepo } from '../repositories/programs.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { progressRepo } from '../repositories/submissions.repo';
import { leaderboardRepo } from '../repositories/leaderboard.repo';
import { challengeService } from './challenge.service';
import { withEffective } from './program.service';

export const dashboardService = {
  /** Everything the student dashboard needs, all derived server-side (rank, points, today's challenge). */
  async forUser(userId: string) {
    const ids = new Set(await participantsRepo.programsOfUser(userId));
    const programs = (await programsRepo.list()).filter((p) => ids.has(p.id)).map(withEffective)
      .filter((p) => p.effective_status !== 'DRAFT' && p.effective_status !== 'ARCHIVED');

    const items = [];
    for (const p of programs) {
      const [challenges, progress, rank, today] = await Promise.all([
        challengesRepo.listByProgram(p.id), progressRepo.get(p.id, userId),
        leaderboardRepo.programRank(p.id, userId), challengeService.currentFor(p.id, userId),
      ]);
      items.push({
        program: p,
        progress: {
          solved: progress?.solved_count ?? 0,
          total: challenges.filter((c) => c.status !== 'CANCELLED').length,
          points: progress?.total_points ?? 0,
          rank, current_streak: progress?.current_streak ?? 0, longest_streak: progress?.longest_streak ?? 0,
        },
        today,
      });
    }
    // Active programs first.
    items.sort((a, b) => Number(b.program.effective_status === 'ACTIVE') - Number(a.program.effective_status === 'ACTIVE'));
    return { programs: items };
  },
};
