import { z } from 'zod';
import { env } from '../config/env';
import { AppError, conflict, forbidden } from '../lib/errors';
import { logger } from '../lib/logger';
import { mapPool } from '../lib/async';
import { programsRepo } from '../repositories/programs.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { submissionsRepo, type NewSubmission } from '../repositories/submissions.repo';
import { syncRepo } from '../repositories/sync.repo';
import { getSubmissionProvider } from '../providers/registry';
import { challengeState, effectiveProgramStatus, isReleased } from '../domain/challengeState';
import { resolvePoints } from '../domain/scoring';
import { progressService } from './progress.service';
import { endOfDate } from '../domain/time';
import { isValidZone } from '../domain/time';
import type { Challenge, Program, SyncLog, SyncSettings } from '../types/db';

export const syncSettingsSchema = z.object({
  mode: z.enum(['MANUAL', 'SCHEDULED', 'BOTH']),
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm'),
  timezone: z.string().refine(isValidZone, 'Unknown timezone'),
  frequency: z.enum(['DAILY', 'HOURLY', 'EVERY_6_HOURS']),
});

const MAX_RECORDED_FAILURES = 100;
const STALE_RUNNING_MS = 30 * 60_000;
const SELF_VERIFY_COOLDOWN_MS = 60_000;

/** Programs whose challenges can still earn points: ACTIVE, plus recently COMPLETED (final-day submissions). */
export function isSyncCandidate(p: Program, now: Date, graceHours = env.COMPLETED_PROGRAM_SYNC_GRACE_HOURS): boolean {
  const status = effectiveProgramStatus(p, now);
  if (status === 'ACTIVE') return true;
  if (status !== 'COMPLETED') return false;
  const graceEnd = endOfDate(p.end_date, p.timezone).getTime() + (p.challenge_window_hours + graceHours) * 3_600_000;
  return now.getTime() <= graceEnd;
}

const running = new Set<string>(); // programs currently syncing in this process
const selfVerifyAt = new Map<string, number>();

export const syncService = {
  /**
   * Kick off a sync. Creates the RUNNING log rows synchronously (so callers get ids to poll), then executes in
   * the background. A failure here never throws into the HTTP request / cron tick.
   */
  async start(opts: { type: 'MANUAL' | 'SCHEDULED'; programId?: string; triggeredBy?: string | null }): Promise<SyncLog[]> {
    const settings = await syncRepo.getSettings();
    if (opts.type === 'MANUAL' && settings.mode === 'SCHEDULED') throw forbidden('Manual sync is disabled (sync mode is "Scheduled only")');
    if (opts.type === 'SCHEDULED' && (settings.mode === 'MANUAL' || !settings.enabled)) return [];

    const now = new Date();
    const all = opts.programId ? [await programsRepo.get(opts.programId)].filter((p): p is Program => !!p) : await programsRepo.list();
    // An explicit manual request may target any started program; automatic runs only active/grace-period ones.
    const targets = all.filter((p) => (opts.programId ? effectiveProgramStatus(p, now) !== 'DRAFT' && effectiveProgramStatus(p, now) !== 'SCHEDULED' : isSyncCandidate(p, now)));
    if (opts.programId && !targets.length) throw conflict('Program has not started yet, so there is nothing to sync', 'NOT_STARTED');

    const logs: Array<{ log: SyncLog; program: Program }> = [];
    for (const program of targets) {
      const recent = await syncRepo.runningFor(program.id, new Date(Date.now() - STALE_RUNNING_MS).toISOString());
      if (running.has(program.id) || recent) {
        if (opts.programId) throw conflict('A sync is already running for this program', 'SYNC_RUNNING');
        continue;
      }
      running.add(program.id);
      try {
        const log = await syncRepo.createLog({ program_id: program.id, sync_type: opts.type, status: 'RUNNING', triggered_by: opts.triggeredBy ?? null });
        logs.push({ log, program });
      } catch (err) { running.delete(program.id); throw err; }
    }

    // Programs are processed one after another so we stay within LeetCode's rate budget.
    void (async () => {
      for (const { log, program } of logs) {
        try { await this.executeProgram(log, program); }
        catch (err) { logger.error({ err, programId: program.id }, 'sync crashed'); }
        finally { running.delete(program.id); }
      }
    })();
    return logs.map((l) => l.log);
  },

  async executeProgram(log: SyncLog, program: Program): Promise<void> {
    let checked = 0, attempted = 0, newSolves = 0, total = 0;
    const failures: SyncLog['failures'] = [];
    let failedCount = 0;
    let fatal: string | null = null;
    try {
      const now = new Date();
      const status = effectiveProgramStatus(program, now);
      const [allChallenges, participants] = await Promise.all([challengesRepo.listByProgram(program.id), participantsRepo.listEnrolled(program.id)]);
      const released = allChallenges.filter((c) => isReleased(challengeState(c, status, now)));
      total = participants.length;
      await syncRepo.updateLog(log.id, { participants_total: total });

      const submissions = await submissionsRepo.listByProgram(program.id);
      const solved = new Set(submissions.map((s) => `${s.user_id}:${s.challenge_id}`));

      await mapPool(participants, env.SYNC_CONCURRENCY, async (p) => {
        const username = p.profile.leetcode_username;
        try {
          const pending = released.filter((c) => !solved.has(`${p.user_id}:${c.id}`));
          if (pending.length) {
            attempted++;
            const awards = await this.verifyUser(p.user_id, username, pending, program);
            const inserted = await submissionsRepo.insertNew(awards);
            newSolves += inserted.length;
          }
        } catch (err) {
          // Per-user isolation: one bad username / timeout must not stop (or corrupt) the rest.
          failedCount++;
          if (failures.length < MAX_RECORDED_FAILURES) failures.push({ user_id: p.user_id, username, error: errMsg(err) });
        } finally {
          checked++;
          if (checked % 25 === 0) await syncRepo.updateLog(log.id, { participants_checked: checked, new_submissions: newSolves, failed_users: failedCount }).catch(() => undefined);
        }
      });

      // Progress is rebuilt from verified submissions: a flaky LeetCode run cannot lower anyone's score.
      await progressService.recomputeProgram(program.id, new Date());
    } catch (err) {
      fatal = errMsg(err);
      logger.error({ err, programId: program.id }, 'sync failed');
    }

    const status: SyncLog['status'] = fatal ? 'FAILED' : failedCount === 0 ? 'SUCCESS' : failedCount >= attempted ? 'FAILED' : 'PARTIAL';
    await syncRepo.updateLog(log.id, {
      status, completed_at: new Date().toISOString(), participants_total: total, participants_checked: checked,
      new_submissions: newSolves, failed_users: failedCount, failures, error_message: fatal,
    });
  },

  /** Check one user against a set of challenges. Returns awards for the ones with a qualifying accepted submission. */
  async verifyUser(userId: string, username: string, challenges: Challenge[], program: Program): Promise<NewSubmission[]> {
    const awards: NewSubmission[] = [];
    for (const c of challenges) {
      const provider = getSubmissionProvider(c.provider);
      const res = await provider.verifyChallengeSubmission(username, c.external_problem_id, new Date(c.release_at), new Date(c.closes_at));
      if (res.verified && res.submission) {
        awards.push({
          challenge_id: c.id, program_id: program.id, user_id: userId, provider: c.provider,
          external_submission_id: res.submission.externalId, verified_username: username,
          submitted_at: res.submission.submittedAt.toISOString(),
          awarded_points: resolvePoints(c, program), // frozen at award time
        });
      }
    }
    return awards;
  },

  /** A student asking "check me now". Same verification path, only for themselves, with a cooldown. */
  async verifySelf(userId: string, username: string, programId: string): Promise<{ new_solves: number; checked: number }> {
    const last = selfVerifyAt.get(userId) ?? 0;
    if (Date.now() - last < SELF_VERIFY_COOLDOWN_MS) throw new AppError(429, 'COOLDOWN', 'Please wait a minute before checking again');
    selfVerifyAt.set(userId, Date.now());

    const program = await programsRepo.get(programId);
    if (!program) throw new AppError(404, 'NOT_FOUND', 'Program not found');
    if (!(await participantsRepo.get(programId, userId))) throw forbidden('You are not enrolled in this program');
    const now = new Date();
    const status = effectiveProgramStatus(program, now);
    const solved = new Set((await submissionsRepo.listByUser(userId, programId)).map((s) => s.challenge_id));
    const pending = (await challengesRepo.listByProgram(programId))
      .filter((c) => isReleased(challengeState(c, status, now)) && !solved.has(c.id));
    if (!pending.length) return { new_solves: 0, checked: 0 };
    const inserted = await submissionsRepo.insertNew(await this.verifyUser(userId, username, pending, program));
    if (inserted.length) await progressService.recomputeProgram(programId, new Date());
    return { new_solves: inserted.length, checked: pending.length };
  },

  async status(programId: string | null) {
    const [last, settings] = await Promise.all([syncRepo.lastCompleted(programId), syncRepo.getSettings()]);
    const current = (await syncRepo.listLogs(programId, 5, 0)).find((l) => l.status === 'RUNNING') ?? null;
    return { settings, last_sync: last, running: current };
  },

  async saveSettings(s: SyncSettings): Promise<SyncSettings> {
    return syncRepo.saveSettings(s);
  },
};

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}
