import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { profilesRepo } from '../repositories/profiles.repo';
import { relinksRepo } from '../repositories/relinks.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { programsRepo } from '../repositories/programs.repo';
import { progressRepo } from '../repositories/submissions.repo';
import { certificatesRepo } from '../repositories/certificates.repo';
import { leaderboardRepo } from '../repositories/leaderboard.repo';
import { effectiveProgramStatus } from '../domain/challengeState';
import { getSubmissionProvider } from '../providers/registry';
import { LEETCODE_USERNAME } from './auth.service';
import { LeetCodeSchemaError, LeetCodeTransientError } from '../leetcode/leetcode.types';
import type { LeetCodeService } from '../leetcode/leetcode.service';
import type { Profile } from '../types/db';

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  level: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(['FOUNDATION', 'DIPLOMA', 'DEGREE'])).optional(),
});
export const relinkStartSchema = z.object({ new_username: z.string().trim().regex(LEETCODE_USERNAME, 'Invalid LeetCode username') });

const RELINK_TTL_MS = 30 * 60_000;

export const profileService = {
  async update(userId: string, input: z.infer<typeof profileUpdateSchema>): Promise<Profile> {
    if (!input.full_name && !input.level) throw badRequest('Nothing to update');
    return profilesRepo.update(userId, input as Partial<Profile>);
  },

  async stats(userId: string) {
    const programIds = await participantsRepo.programsOfUser(userId);
    const [programs, progress, certCount, rank] = await Promise.all([
      programsRepo.list(), progressRepo.listByUser(userId), certificatesRepo.countByUser(userId), leaderboardRepo.overallRank(userId),
    ]);
    const mine = programs.filter((p) => programIds.includes(p.id));
    const activeIds = new Set(mine.filter((p) => effectiveProgramStatus(p) === 'ACTIVE').map((p) => p.id));
    return {
      total_programs: mine.length,
      active_programs: activeIds.size,
      problems_solved: progress.reduce((n, p) => n + p.solved_count, 0),
      total_points: progress.reduce((n, p) => n + p.total_points, 0),
      current_rank: rank,
      current_streak: Math.max(0, ...progress.filter((p) => activeIds.has(p.program_id)).map((p) => p.current_streak)),
      longest_streak: Math.max(0, ...progress.map((p) => p.longest_streak)),
      certificates_earned: certCount,
    };
  },

  /**
   * Changing the LeetCode username rewrites who we attribute future submissions to, so it requires proof of
   * ownership: the user puts a one-time code in their public LeetCode "About me", then confirms.
   * Past submissions keep the username they were verified under (challenge_submissions.verified_username).
   */
  async startRelink(userId: string, newUsername: string) {
    const me = await profilesRepo.get(userId);
    if (!me) throw notFound('Profile not found');
    if (me.leetcode_username.toLowerCase() === newUsername.toLowerCase()) throw badRequest('That is already your linked username');
    const taken = await profilesRepo.findByLeetCode(newUsername);
    if (taken) throw conflict('This LeetCode username is linked to another account', 'LEETCODE_TAKEN');
    const info = await lcProfile(newUsername);
    if (!info.exists) throw badRequest('LeetCode user not found');

    await relinksRepo.expirePending(userId);
    const code = `CC-LINK-${randomBytes(4).toString('hex').toUpperCase()}`;
    const row = await relinksRepo.create({ user_id: userId, new_username: newUsername, code, expires_at: new Date(Date.now() + RELINK_TTL_MS).toISOString() });
    return {
      new_username: row.new_username, code: row.code, expires_at: row.expires_at,
      instructions: `Paste ${row.code} anywhere in the "Summary" of your LeetCode profile (leetcode.com/profile → Edit Profile), save it, then press Confirm. You can remove it afterwards.`,
    };
  },

  async confirmRelink(userId: string): Promise<Profile> {
    const pending = await relinksRepo.getPending(userId);
    if (!pending) throw badRequest('No relink in progress. Start again.');
    if (new Date(pending.expires_at) < new Date()) { await relinksRepo.expirePending(userId); throw new AppError(410, 'RELINK_EXPIRED', 'The verification code expired. Start again.'); }
    const info = await lcProfile(pending.new_username);
    if (!info.exists) throw badRequest('LeetCode user not found');
    if (!info.aboutMe.includes(pending.code)) throw new AppError(422, 'CODE_NOT_FOUND', `Could not find ${pending.code} in the public summary of ${pending.new_username}. It can take a minute to appear.`);
    const updated = await profilesRepo.update(userId, { leetcode_username: pending.new_username, leetcode_linked_at: new Date().toISOString() });
    await relinksRepo.complete(pending.id);
    return updated;
  },
};

async function lcProfile(username: string) {
  const svc = getSubmissionProvider('LEETCODE') as LeetCodeService;
  try { return await svc.getProfileSummary(username); }
  catch (e) {
    if (e instanceof LeetCodeTransientError || e instanceof LeetCodeSchemaError)
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Could not reach LeetCode right now. Please try again shortly.');
    throw e;
  }
}
