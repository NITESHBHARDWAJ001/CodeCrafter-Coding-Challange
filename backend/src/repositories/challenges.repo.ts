import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { Challenge, Submission } from '../types/db';
import { chunk } from '../lib/async';

export const challengesRepo = {
  async get(id: string): Promise<Challenge | null> {
    return unwrapMaybe(await admin.from('challenges').select('*').eq('id', id).maybeSingle<Challenge>());
  },
  async listByProgram(programId: string): Promise<Challenge[]> {
    return unwrap(await admin.from('challenges').select('*').eq('program_id', programId).order('day_number').returns<Challenge[]>());
  },
  async insert(c: Partial<Challenge>): Promise<Challenge> {
    return unwrap(await admin.from('challenges').insert(c).select('*').single<Challenge>());
  },
  async update(id: string, patch: Partial<Challenge>): Promise<Challenge> {
    return unwrap(await admin.from('challenges').update(patch).eq('id', id).select('*').single<Challenge>());
  },
  async remove(id: string): Promise<void> {
    unwrap(await admin.from('challenges').delete().eq('id', id).select('id'));
  },
  async upsertMany(rows: Array<Partial<Challenge>>): Promise<number> {
    let n = 0;
    for (const part of chunk(rows, 200)) {
      const res = unwrap(await admin.from('challenges').upsert(part, { onConflict: 'program_id,day_number' }).select('id'));
      n += res.length;
    }
    return n;
  },
  async insertManyIgnoringDuplicates(rows: Array<Partial<Challenge>>): Promise<number> {
    let n = 0;
    for (const part of chunk(rows, 200)) {
      const res = unwrap(await admin.from('challenges').upsert(part, { onConflict: 'program_id,day_number', ignoreDuplicates: true }).select('id'));
      n += res.length;
    }
    return n;
  },
  async submissionCount(challengeId: string): Promise<number> {
    const { count, error } = await admin.from('challenge_submissions').select('id', { count: 'exact', head: true }).eq('challenge_id', challengeId);
    if (error) throw error;
    return count ?? 0;
  },
  async challengeIdsWithSubmissions(programId: string): Promise<Set<string>> {
    const rows = unwrap(await admin.from('challenge_submissions').select('challenge_id').eq('program_id', programId).limit(100000).returns<Array<Pick<Submission, 'challenge_id'>>>());
    return new Set(rows.map((r) => r.challenge_id));
  },
};
