import { z } from 'zod';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { programsRepo } from '../repositories/programs.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { addDays } from '../domain/time';
import { isValidZone } from '../domain/time';
import { DateTime } from 'luxon';
import { effectiveProgramStatus } from '../domain/challengeState';
import type { CertificateRules, Program } from '../types/db';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const points = z.object({
  EASY: z.number().int().min(0).max(10000), MEDIUM: z.number().int().min(0).max(10000), HARD: z.number().int().min(0).max(10000),
});

export const programCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  description: z.string().max(5000).default(''),
  banner_url: z.string().url().nullable().optional(),
  start_date: date,
  end_date: date.optional(),
  duration_days: z.number().int().min(1).max(1000).optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).default('DRAFT'),
  enrollment_open: z.boolean().default(true),
  timezone: z.string().default('Asia/Kolkata'),
  challenge_window_hours: z.number().int().min(1).max(720).default(24),
  default_points: points.optional(),
  streak_policy: z.enum(['RESET_ON_MISS', 'GRACE_DAYS']).default('RESET_ON_MISS'),
  streak_grace_days: z.number().int().min(0).max(30).default(0),
  certificate_enabled: z.boolean().default(false),
  certificate_prefix: z.string().regex(/^[A-Z0-9]{2,8}$/).optional(),
}).refine((v) => v.end_date || v.duration_days, { message: 'Provide end_date or duration_days' });

export const programUpdateSchema = programCreateSchema.innerType().partial();

export const rulesSchema = z.object({
  min_challenges: z.number().int().min(0).nullable().default(null),
  min_completion_pct: z.number().min(0).max(100).nullable().default(null),
  min_points: z.number().int().min(0).nullable().default(null),
  max_missed_days: z.number().int().min(0).nullable().default(null),
});

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'program';

const STOP = new Set(['days', 'day', 'of', 'a', 'the', 'and', 'challenge', 'program']);
/** "30 Days of DSA" -> "DSA"; "Graph Challenge" -> "GRAPH". Admin can override. */
export function defaultCertificatePrefix(name: string): string {
  const words = name.split(/[^A-Za-z]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  const base = (words.join('') || 'GEN').toUpperCase().slice(0, 6);
  return base.length >= 2 ? base : 'GEN';
}

/** Reconcile duration/end date: duration wins (end = start + duration - 1); otherwise duration derives from the end date. */
export function resolveDates(start: string, end?: string, duration?: number): { end_date: string; duration_days: number } {
  if (duration) return { end_date: addDays(start, duration - 1), duration_days: duration };
  const days = Math.round(DateTime.fromISO(end!, { zone: 'utc' }).diff(DateTime.fromISO(start, { zone: 'utc' }), 'days').days) + 1;
  if (days < 1) throw badRequest('end_date must be on or after start_date');
  return { end_date: end!, duration_days: days };
}

export const withEffective = (p: Program) => ({ ...p, effective_status: effectiveProgramStatus(p) });

export const programService = {
  async create(input: z.infer<typeof programCreateSchema>, createdBy: string): Promise<Program> {
    if (!isValidZone(input.timezone)) throw badRequest('Unknown timezone');
    const dates = resolveDates(input.start_date, input.end_date, input.duration_days);
    let slug = input.slug ?? slugify(input.name);
    if (await programsRepo.getBySlug(slug)) {
      if (input.slug) throw conflict('Slug already in use', 'SLUG_TAKEN');
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const { end_date: _e, duration_days: _d, certificate_prefix, ...rest } = input;
    const program = await programsRepo.insert({
      ...rest, ...dates, slug, created_by: createdBy,
      certificate_prefix: certificate_prefix ?? defaultCertificatePrefix(input.name),
    } as Partial<Program>);
    await programsRepo.upsertRules({ program_id: program.id, min_challenges: null, min_completion_pct: 90, min_points: null, max_missed_days: null });
    return program;
  },

  async update(id: string, input: z.infer<typeof programUpdateSchema>): Promise<Program> {
    const current = await this.require(id);
    if (input.timezone && !isValidZone(input.timezone)) throw badRequest('Unknown timezone');
    const patch: Partial<Program> = { ...(input as Partial<Program>) };
    delete (patch as { end_date?: string }).end_date;
    delete (patch as { duration_days?: number }).duration_days;
    if (input.start_date || input.end_date || input.duration_days) {
      const start = input.start_date ?? current.start_date;
      if (input.duration_days) Object.assign(patch, resolveDates(start, undefined, input.duration_days));
      else if (input.end_date) Object.assign(patch, resolveDates(start, input.end_date));
      else Object.assign(patch, resolveDates(start, undefined, current.duration_days)); // start moved: keep duration
    }
    return programsRepo.update(id, patch);
  },

  async remove(id: string): Promise<void> {
    const p = await this.require(id);
    if (p.status !== 'DRAFT') throw conflict('Only DRAFT programs can be deleted. Archive it instead.', 'NOT_DRAFT');
    if ((await participantsRepo.countEnrolled(id)) > 0) throw conflict('Program has participants', 'HAS_PARTICIPANTS');
    await programsRepo.remove(id);
  },

  async require(id: string): Promise<Program> {
    const p = await programsRepo.get(id);
    if (!p) throw notFound('Program not found');
    return p;
  },

  /** What a student may see: never DRAFT/ARCHIVED, even by id. */
  async requireVisible(id: string, isAdmin: boolean): Promise<Program> {
    const p = await this.require(id);
    const eff = effectiveProgramStatus(p);
    if (!isAdmin && (eff === 'DRAFT' || eff === 'ARCHIVED')) throw notFound('Program not found');
    return p;
  },

  async listForUser(userId: string, isAdmin: boolean) {
    const [all, mine] = await Promise.all([programsRepo.list(), participantsRepo.programsOfUser(userId)]);
    const enrolled = new Set(mine);
    return all
      .map(withEffective)
      .filter((p) => isAdmin || (p.effective_status !== 'DRAFT' && p.effective_status !== 'ARCHIVED'))
      .map((p) => ({ ...p, enrolled: enrolled.has(p.id) }));
  },

  async enroll(programId: string, userId: string): Promise<void> {
    const p = await this.requireVisible(programId, false);
    const eff = effectiveProgramStatus(p);
    if (!p.enrollment_open) throw forbidden('Enrollment is closed for this program');
    if (eff === 'COMPLETED') throw forbidden('This program has finished');
    await participantsRepo.enroll(programId, userId);
  },

  async withdraw(programId: string, userId: string): Promise<void> {
    await this.requireVisible(programId, false);
    await participantsRepo.withdraw(programId, userId);
  },

  /** Keeps stored status aligned with the calendar (read paths never rely on this - see effectiveProgramStatus). */
  async advanceStatuses(now = new Date()): Promise<number> {
    let changed = 0;
    for (const p of await programsRepo.list()) {
      if (p.status !== 'SCHEDULED' && p.status !== 'ACTIVE') continue;
      const eff = effectiveProgramStatus(p, now);
      if (eff !== p.status) { await programsRepo.setStatus(p.id, eff); changed++; }
    }
    return changed;
  },

  async getRules(programId: string): Promise<CertificateRules> {
    return (await programsRepo.getRules(programId)) ?? { program_id: programId, min_challenges: null, min_completion_pct: null, min_points: null, max_missed_days: null };
  },
  async saveRules(programId: string, input: z.infer<typeof rulesSchema>): Promise<CertificateRules> {
    const p = await this.require(programId);
    const n = (await challengesRepo.listByProgram(programId)).filter((c) => c.status !== 'CANCELLED').length;
    if (input.min_challenges !== null && n > 0 && input.min_challenges > n)
      throw new AppError(422, 'UNPROCESSABLE', `Minimum challenges (${input.min_challenges}) exceeds the ${n} challenges in "${p.name}"`);
    return programsRepo.upsertRules({ program_id: programId, ...input });
  },
};
