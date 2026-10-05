import { admin, unwrap } from '../lib/supabase';
import type { LeaderboardRow } from '../types/db';

const norm = (rows: LeaderboardRow[]): LeaderboardRow[] =>
  rows.map((r) => ({ ...r, rank: Number(r.rank) }));

export const leaderboardRepo = {
  async program(programId: string, limit: number, offset: number): Promise<LeaderboardRow[]> {
    return norm(unwrap(await admin.rpc('program_leaderboard', { p_program_id: programId, p_limit: limit, p_offset: offset })));
  },
  async weekly(programId: string, since: string, limit: number, offset: number): Promise<LeaderboardRow[]> {
    return norm(unwrap(await admin.rpc('weekly_leaderboard', { p_program_id: programId, p_since: since, p_limit: limit, p_offset: offset })));
  },
  async challenge(challengeId: string, limit: number, offset: number): Promise<LeaderboardRow[]> {
    return norm(unwrap(await admin.rpc('challenge_leaderboard', { p_challenge_id: challengeId, p_limit: limit, p_offset: offset })));
  },
  async overall(limit: number, offset: number): Promise<LeaderboardRow[]> {
    return norm(unwrap(await admin.rpc('overall_leaderboard', { p_limit: limit, p_offset: offset })));
  },
  async programRank(programId: string, userId: string): Promise<number | null> {
    const v = unwrap(await admin.rpc('program_rank', { p_program_id: programId, p_user_id: userId })) as number | null;
    return v === null || v === undefined ? null : Number(v);
  },
  async overallRank(userId: string): Promise<number | null> {
    const v = unwrap(await admin.rpc('overall_rank', { p_user_id: userId })) as number | null;
    return v === null || v === undefined ? null : Number(v);
  },
};
