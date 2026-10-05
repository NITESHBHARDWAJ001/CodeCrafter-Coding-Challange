export type Level = 'FOUNDATION' | 'DIPLOMA' | 'DEGREE';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ProgramStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type ChallengeState = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Profile {
  id: string; full_name: string; email: string; leetcode_username: string; level: Level;
  role: 'STUDENT' | 'ADMIN'; created_at: string;
}
export interface Stats {
  total_programs: number; active_programs: number; problems_solved: number; total_points: number;
  current_rank: number | null; current_streak: number; longest_streak: number; certificates_earned: number;
}
export interface Program {
  id: string; name: string; slug: string; description: string; banner_url: string | null;
  start_date: string; end_date: string; duration_days: number; status: ProgramStatus; effective_status: ProgramStatus;
  enrollment_open: boolean; timezone: string; challenge_window_hours: number;
  default_points: Record<Difficulty, number>; streak_policy: 'RESET_ON_MISS' | 'GRACE_DAYS'; streak_grace_days: number;
  certificate_enabled: boolean; certificate_prefix: string; enrolled?: boolean; participants?: number;
}
export interface ProgramProgress {
  solved: number; total: number; points: number; rank: number | null; current_streak: number; longest_streak: number;
}
export interface StudentChallenge {
  id: string; day_number: number; state: ChallengeState; locked: boolean; released: boolean; releases_at: string; release_label?: string;
  title?: string; category?: string; difficulty?: Difficulty; points?: number; problem_url?: string; closes_at?: string;
  solved?: boolean; solved_at?: string | null; points_awarded?: number | null;
}
export interface AdminChallenge {
  id: string; program_id: string; day_number: number; title: string; external_problem_id: string; external_problem_url: string;
  category: string; difficulty: Difficulty; points: number; points_override: number | null; release_at: string; closes_at: string;
  release_date: string; release_time: string; state: ChallengeState; status: 'SCHEDULED' | 'CANCELLED'; has_submissions: boolean;
}
export interface LeaderboardRow {
  rank: number; user_id: string; full_name: string; level: Level; solved: number; points: number; current_streak: number; last_solved_at: string | null;
}
export interface BoardResult { type: string; rows: LeaderboardRow[]; me: LeaderboardRow | null; context?: { day_number?: number; title?: string; challenge_id?: string } }
export interface SyncLog {
  id: string; program_id: string | null; program_name?: string | null; sync_type: 'MANUAL' | 'SCHEDULED'; started_at: string; completed_at: string | null;
  participants_total: number; participants_checked: number; new_submissions: number; failed_users: number;
  failures: Array<{ user_id: string; username: string; error: string }>; status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'; error_message: string | null;
}
export interface SyncSettings { mode: 'MANUAL' | 'SCHEDULED' | 'BOTH'; enabled: boolean; time: string; timezone: string; frequency: 'DAILY' | 'HOURLY' | 'EVERY_6_HOURS' }
export interface Certificate {
  id: string; certificate_code: string; program_id: string; recipient_name: string; program_name: string;
  challenges_completed: number; total_challenges: number; issued_at: string;
}
export interface Rules { min_challenges: number | null; min_completion_pct: number | null; min_points: number | null; max_missed_days: number | null }
