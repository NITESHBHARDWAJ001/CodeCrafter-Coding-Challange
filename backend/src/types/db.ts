export type UserRole = 'STUDENT' | 'ADMIN';
export type UserLevel = 'FOUNDATION' | 'DIPLOMA' | 'DEGREE';
export type ProgramStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type ChallengeProvider = 'LEETCODE' | 'CODEFORCES' | 'HACKERRANK' | 'CODECHEF' | 'OTHER';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type StreakPolicy = 'RESET_ON_MISS' | 'GRACE_DAYS';
export type SyncStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface Profile {
  id: string; full_name: string; email: string; leetcode_username: string; level: UserLevel;
  role: UserRole; leetcode_linked_at: string; created_at: string; updated_at: string;
}
export interface Program {
  id: string; name: string; slug: string; description: string; banner_url: string | null;
  start_date: string; end_date: string; duration_days: number; status: ProgramStatus;
  enrollment_open: boolean; timezone: string; challenge_window_hours: number;
  default_points: Record<Difficulty, number>; streak_policy: StreakPolicy; streak_grace_days: number;
  certificate_enabled: boolean; certificate_prefix: string; created_by: string | null;
  created_at: string; updated_at: string;
}
export interface Challenge {
  id: string; program_id: string; day_number: number; title: string; provider: ChallengeProvider;
  external_problem_id: string; external_problem_url: string; category: string; difficulty: Difficulty;
  points_override: number | null; release_at: string; closes_at: string;
  status: 'SCHEDULED' | 'CANCELLED'; created_at: string; updated_at: string;
}
export interface Submission {
  id: string; challenge_id: string; program_id: string; user_id: string; provider: ChallengeProvider;
  external_submission_id: string | null; verified_username: string; submitted_at: string;
  verified_at: string; awarded_points: number;
}
export interface Progress {
  program_id: string; user_id: string; solved_count: number; total_points: number;
  current_streak: number; longest_streak: number; missed_days: number; last_solved_at: string | null;
  updated_at: string;
}
export interface CertificateRules {
  program_id: string; min_challenges: number | null; min_completion_pct: number | null;
  min_points: number | null; max_missed_days: number | null;
}
export interface Certificate {
  id: string; certificate_code: string; program_id: string; user_id: string; recipient_name: string;
  program_name: string; challenges_completed: number; total_challenges: number; issued_at: string;
  storage_path: string | null;
}
export interface SyncLog {
  id: string; program_id: string | null; sync_type: 'MANUAL' | 'SCHEDULED'; started_at: string;
  completed_at: string | null; participants_total: number; participants_checked: number;
  new_submissions: number; failed_users: number; failures: Array<{ user_id: string; username: string; error: string }>;
  status: SyncStatus; error_message: string | null; triggered_by: string | null;
}
export interface SyncSettings {
  mode: 'MANUAL' | 'SCHEDULED' | 'BOTH'; enabled: boolean; time: string; timezone: string;
  frequency: 'DAILY' | 'HOURLY' | 'EVERY_6_HOURS';
}
export interface LeaderboardRow {
  rank: number; user_id: string; full_name: string; level: UserLevel; solved: number; points: number;
  current_streak: number; last_solved_at: string | null;
}
