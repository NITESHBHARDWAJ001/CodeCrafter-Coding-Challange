import { z } from 'zod';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { challengesRepo } from '../repositories/challenges.repo';
import { submissionsRepo } from '../repositories/submissions.repo';
import { programsRepo } from '../repositories/programs.repo';
import { programService } from './program.service';
import { challengeState, effectiveProgramStatus, type ChallengeState } from '../domain/challengeState';
import { resolvePoints } from '../domain/scoring';
import { releaseLabel } from '../domain/releaseLabel';
import { formatLocal } from '../domain/time';
import {
  RawChallengeRow, ValidationReport, ValidChallengeRow, importBodySchema, parseCsv, validateChallengeRows,
} from '../domain/csv';
import type { Challenge, Program, Submission } from '../types/db';

export const challengeInputSchema = z.object({
  day_number: z.union([z.string(), z.number()]),
  title: z.string(),
  leetcode_url: z.string(),
  category: z.string().optional().default('General'),
  difficulty: z.string(),
  points: z.union([z.string(), z.number(), z.null()]).optional(),
  release_date: z.string(),
  release_time: z.string().optional().default('00:00'),
});

type Row = Omit<Challenge, 'created_at' | 'updated_at'>;

export interface StudentChallengeView {
  id: string; day_number: number; state: ChallengeState; locked: boolean; released: boolean;
  releases_at: string; release_label?: string;
  // Present ONLY once released:
  title?: string; category?: string; difficulty?: Challenge['difficulty']; points?: number;
  problem_url?: string; provider?: Challenge['provider']; closes_at?: string;
  solved?: boolean; solved_at?: string | null; points_awarded?: number | null;
}

function toRow(program: Program, v: ValidChallengeRow): Partial<Challenge> {
  return {
    program_id: program.id, day_number: v.day_number, title: v.title, provider: v.provider,
    external_problem_id: v.external_problem_id, external_problem_url: v.external_problem_url,
    category: v.category, difficulty: v.difficulty, points_override: v.points_override,
    release_at: v.release_at, closes_at: v.closes_at, status: 'SCHEDULED',
  };
}

/** Admin-facing challenge: everything, plus derived state and computed points. */
export function adminView(c: Challenge, p: Program, now = new Date()) {
  const state = challengeState(c, effectiveProgramStatus(p, now), now);
  const local = formatLocal(c.release_at, p.timezone);
  return {
    ...c, state, points: resolvePoints(c, p), release_date: local.date, release_time: local.time,
  };
}

/**
 * THE release gate for participants. A challenge's problem details are visible iff its program has started
 * and its release time has passed (a cancelled-after-release challenge stays visible, marked CANCELLED).
 */
export function isVisibleToStudents(c: Challenge, p: Program, now = new Date()): boolean {
  const status = effectiveProgramStatus(p, now);
  return status !== 'DRAFT' && status !== 'SCHEDULED' && new Date(c.release_at) <= now;
}

export function studentView(c: Challenge, p: Program, mine: Submission | undefined, now = new Date()): StudentChallengeView {
  const state = challengeState(c, effectiveProgramStatus(p, now), now);
  if (!isVisibleToStudents(c, p, now)) {
    // Locked: expose NOTHING about the problem (no title, slug, url, category, difficulty, points).
    return {
      id: c.id, day_number: c.day_number, state: 'UPCOMING', releases_at: c.release_at,
      locked: true, released: false, release_label: releaseLabel(c.release_at, p.timezone, now),
    };
  }
  return {
    id: c.id, day_number: c.day_number, state, releases_at: c.release_at, locked: false, released: true,
    title: c.title, category: c.category, difficulty: c.difficulty, points: resolvePoints(c, p),
    problem_url: c.external_problem_url, provider: c.provider, closes_at: c.closes_at,
    solved: !!mine, solved_at: mine?.submitted_at ?? null, points_awarded: mine?.awarded_points ?? null,
  };
}

export const challengeService = {
  // ───────────── student side (state enforced HERE, on the server) ─────────────
  async listForStudent(programId: string, userId: string, isAdmin: boolean) {
    const program = await programService.requireVisible(programId, isAdmin);
    const [challenges, mine] = await Promise.all([challengesRepo.listByProgram(programId), submissionsRepo.listByUser(userId, programId)]);
    const byChallenge = new Map(mine.map((s) => [s.challenge_id, s]));
    const now = new Date();
    return challenges.map((c) => studentView(c, program, byChallenge.get(c.id), now));
  },

  async getForStudent(challengeId: string, userId: string, isAdmin: boolean) {
    const c = await challengesRepo.get(challengeId);
    if (!c) throw notFound('Challenge not found');
    const program = await programService.requireVisible(c.program_id, isAdmin);
    const now = new Date();
    if (!isAdmin && !isVisibleToStudents(c, program, now))
      throw new AppError(403, 'CHALLENGE_LOCKED', releaseLabel(c.release_at, program.timezone, now));
    const mine = (await submissionsRepo.listByUser(userId, c.program_id)).find((s) => s.challenge_id === c.id);
    return studentView(c, program, mine, now);
  },

  /** Today's challenge = the latest released, non-cancelled challenge still inside its window. */
  async currentFor(programId: string, userId: string) {
    const program = await programsRepo.get(programId);
    if (!program) return null;
    const now = new Date();
    const status = effectiveProgramStatus(program, now);
    const challenges = await challengesRepo.listByProgram(programId);
    const active = challenges.filter((c) => challengeState(c, status, now) === 'ACTIVE').sort((a, b) => b.release_at.localeCompare(a.release_at))[0];
    if (!active) return null;
    const mine = (await submissionsRepo.listByUser(userId, programId)).find((s) => s.challenge_id === active.id);
    return studentView(active, program, mine, now);
  },

  // ───────────── admin side ─────────────
  async listForAdmin(programId: string) {
    const program = await programService.require(programId);
    const [challenges, withSubs] = await Promise.all([challengesRepo.listByProgram(programId), challengesRepo.challengeIdsWithSubmissions(programId)]);
    const now = new Date();
    return challenges.map((c) => ({ ...adminView(c, program, now), has_submissions: withSubs.has(c.id) }));
  },

  validateRows(program: Program, rows: RawChallengeRow[]): ValidationReport {
    return validateChallengeRows(rows, { timezone: program.timezone, windowHours: program.challenge_window_hours });
  },

  async validateCsv(programId: string, csv: string): Promise<ValidationReport> {
    const program = await programService.require(programId);
    let rows: RawChallengeRow[];
    try { rows = parseCsv(csv); } catch (e) { throw unprocessable(`Could not parse CSV: ${(e as Error).message}`); }
    if (!rows.length) throw unprocessable('The CSV has no data rows');
    if (rows.length > 1000) throw unprocessable('CSV is limited to 1000 rows');
    return this.validateRows(program, rows);
  },

  async importRows(programId: string, body: z.infer<typeof importBodySchema>) {
    const program = await programService.require(programId);
    const report = this.validateRows(program, body.rows as RawChallengeRow[]);
    if (report.invalidCount > 0 && !body.skipInvalid)
      throw unprocessable(`${report.invalidCount} invalid row(s). Fix them or choose to skip invalid rows.`, report);

    const existing = await challengesRepo.listByProgram(programId);
    const existingByDay = new Map(existing.map((c) => [c.day_number, c]));
    const withSubs = await challengesRepo.challengeIdsWithSubmissions(programId);

    const toWrite: Array<Partial<Challenge>> = [];
    const skipped: number[] = [];
    const errors = [...report.errors];
    for (const v of report.valid) {
      const prev = existingByDay.get(v.day_number);
      if (!prev) { toWrite.push(toRow(program, v)); continue; }
      if (body.onConflict === 'skip') { skipped.push(v.day_number); continue; }
      if (withSubs.has(prev.id) && prev.external_problem_id !== v.external_problem_id) {
        errors.push({ row: 0, field: 'day_number', message: `Day ${v.day_number} already has verified solves for a different problem; cannot replace it` });
        continue;
      }
      toWrite.push(toRow(program, v));
    }
    const imported = await challengesRepo.upsertMany(toWrite);
    return { imported, skipped, errors, validCount: report.validCount, invalidCount: report.invalidCount };
  },

  async create(programId: string, input: z.infer<typeof challengeInputSchema>) {
    const program = await programService.require(programId);
    const report = this.validateRows(program, [input as RawChallengeRow]);
    if (report.invalidCount) throw unprocessable('Invalid challenge', report);
    const v = report.valid[0];
    if (existingDay((await challengesRepo.listByProgram(programId)), v.day_number)) throw conflict(`Day ${v.day_number} already exists`, 'DAY_EXISTS');
    return adminView(await challengesRepo.insert(toRow(program, v)), program);
  },

  async update(challengeId: string, input: z.infer<typeof challengeInputSchema>) {
    const current = await challengesRepo.get(challengeId);
    if (!current) throw notFound('Challenge not found');
    const program = await programService.require(current.program_id);
    const report = this.validateRows(program, [input as RawChallengeRow]);
    if (report.invalidCount) throw unprocessable('Invalid challenge', report);
    const v = report.valid[0];
    const siblings = await challengesRepo.listByProgram(program.id);
    if (siblings.some((c) => c.id !== challengeId && c.day_number === v.day_number)) throw conflict(`Day ${v.day_number} already exists`, 'DAY_EXISTS');
    if (v.external_problem_id !== current.external_problem_id && (await challengesRepo.submissionCount(challengeId)) > 0)
      throw conflict('This challenge already has verified solves; its problem cannot be changed. Cancel it and add a new day instead.', 'HAS_SUBMISSIONS');
    // Existing awarded_points are frozen on the submissions, so changing points/difficulty only affects future solves.
    const { program_id: _p, status: _s, ...patch } = toRow(program, v);
    return adminView(await challengesRepo.update(challengeId, patch), program);
  },

  async setCancelled(challengeId: string, cancelled: boolean) {
    const current = await challengesRepo.get(challengeId);
    if (!current) throw notFound('Challenge not found');
    const program = await programService.require(current.program_id);
    return adminView(await challengesRepo.update(challengeId, { status: cancelled ? 'CANCELLED' : 'SCHEDULED' }), program);
  },

  async remove(challengeId: string) {
    const current = await challengesRepo.get(challengeId);
    if (!current) throw notFound('Challenge not found');
    if ((await challengesRepo.submissionCount(challengeId)) > 0) throw forbidden('Challenge has verified solves; cancel it instead of deleting');
    await challengesRepo.remove(challengeId);
  },
};

const existingDay = (list: Row[] | Challenge[], day: number) => list.some((c) => c.day_number === day);
