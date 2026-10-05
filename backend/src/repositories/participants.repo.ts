import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { Profile } from '../types/db';

export interface ParticipantRow { id: string; program_id: string; user_id: string; status: 'ENROLLED' | 'WITHDRAWN'; enrolled_at: string }

export const participantsRepo = {
  async get(programId: string, userId: string): Promise<ParticipantRow | null> {
    return unwrapMaybe(await admin.from('program_participants').select('*').eq('program_id', programId).eq('user_id', userId).maybeSingle<ParticipantRow>());
  },
  async enroll(programId: string, userId: string): Promise<void> {
    unwrap(await admin.from('program_participants')
      .upsert({ program_id: programId, user_id: userId, status: 'ENROLLED' }, { onConflict: 'program_id,user_id' }).select('id'));
  },
  async withdraw(programId: string, userId: string): Promise<void> {
    unwrap(await admin.from('program_participants').update({ status: 'WITHDRAWN' }).eq('program_id', programId).eq('user_id', userId).select('id'));
  },
  /** Enrolled participants with their profile (page through to avoid PostgREST's 1000-row default cap). */
  async listEnrolled(programId: string): Promise<Array<ParticipantRow & { profile: Profile }>> {
    const out: Array<ParticipantRow & { profile: Profile }> = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const rows = unwrap(await admin.from('program_participants').select('*, profile:profiles(*)')
        .eq('program_id', programId).eq('status', 'ENROLLED').order('enrolled_at').range(from, from + page - 1)
        .returns<Array<ParticipantRow & { profile: Profile }>>());
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  },
  async countEnrolled(programId: string): Promise<number> {
    const { count, error } = await admin.from('program_participants').select('id', { count: 'exact', head: true }).eq('program_id', programId).eq('status', 'ENROLLED');
    if (error) throw error;
    return count ?? 0;
  },
  async countAllEnrolled(): Promise<number> {
    const { data, error } = await admin.from('program_participants').select('user_id').eq('status', 'ENROLLED');
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.user_id)).size;
  },
  async programsOfUser(userId: string): Promise<string[]> {
    const rows = unwrap(await admin.from('program_participants').select('program_id').eq('user_id', userId).eq('status', 'ENROLLED').returns<Array<{ program_id: string }>>());
    return rows.map((r) => r.program_id);
  },
  async enrolledUserIds(programId: string): Promise<string[]> {
    const rows = await this.listEnrolled(programId);
    return rows.map((r) => r.user_id);
  },
};
