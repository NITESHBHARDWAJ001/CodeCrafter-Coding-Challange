import { admin, unwrap } from '../lib/supabase';
import type { Progress, Submission } from '../types/db';
import { chunk } from '../lib/async';

export type NewSubmission = Omit<Submission, 'id' | 'verified_at'>;

export const submissionsRepo = {
  /**
   * Insert, relying on UNIQUE(challenge_id, user_id): a duplicate is silently ignored and (because of
   * ignoreDuplicates) NOT returned, so the returned array is exactly the set of newly-awarded solves.
   * This is what makes "run sync twice -> no duplicate points" hold even under concurrent syncs.
   */
  async insertNew(rows: NewSubmission[]): Promise<Submission[]> {
    if (!rows.length) return [];
    const out: Submission[] = [];
    for (const part of chunk(rows, 200)) {
      out.push(...unwrap(await admin.from('challenge_submissions')
        .upsert(part, { onConflict: 'challenge_id,user_id', ignoreDuplicates: true }).select('*').returns<Submission[]>()));
    }
    return out;
  },
  async listByProgram(programId: string): Promise<Submission[]> {
    const out: Submission[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const rows = unwrap(await admin.from('challenge_submissions').select('*').eq('program_id', programId)
        .order('submitted_at').range(from, from + page - 1).returns<Submission[]>());
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  },
  async listByUser(userId: string, programId?: string): Promise<Submission[]> {
    let q = admin.from('challenge_submissions').select('*').eq('user_id', userId);
    if (programId) q = q.eq('program_id', programId);
    return unwrap(await q.order('submitted_at', { ascending: false }).returns<Submission[]>());
  },
  async forChallenge(challengeId: string): Promise<Submission[]> {
    return unwrap(await admin.from('challenge_submissions').select('*').eq('challenge_id', challengeId).returns<Submission[]>());
  },
  async countSince(since: string, programId?: string): Promise<number> {
    let q = admin.from('challenge_submissions').select('id', { count: 'exact', head: true }).gte('submitted_at', since);
    if (programId) q = q.eq('program_id', programId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },
};

export const progressRepo = {
  async upsertMany(rows: Progress[]): Promise<void> {
    for (const part of chunk(rows, 500)) {
      unwrap(await admin.from('program_progress').upsert(part, { onConflict: 'program_id,user_id' }).select('user_id'));
    }
  },
  async get(programId: string, userId: string): Promise<Progress | null> {
    const { data, error } = await admin.from('program_progress').select('*').eq('program_id', programId).eq('user_id', userId).maybeSingle<Progress>();
    if (error) throw error;
    return data;
  },
  async listByProgram(programId: string): Promise<Progress[]> {
    const out: Progress[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const rows = unwrap(await admin.from('program_progress').select('*').eq('program_id', programId).range(from, from + page - 1).returns<Progress[]>());
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  },
  async listByUser(userId: string): Promise<Progress[]> {
    return unwrap(await admin.from('program_progress').select('*').eq('user_id', userId).returns<Progress[]>());
  },
};
