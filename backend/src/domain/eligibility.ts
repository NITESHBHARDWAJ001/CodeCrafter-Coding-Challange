import type { CertificateRules } from '../types/db';

export interface ParticipantStats {
  solved: number;
  points: number;
  missedDays: number;
  totalChallenges: number; // non-cancelled challenges in the program
}

export interface EligibilityResult { eligible: boolean; reasons: string[] }

/** All criteria are admin-configurable; a null criterion is simply not enforced. Nothing is hard-coded. */
export function evaluateEligibility(rules: Omit<CertificateRules, 'program_id'>, s: ParticipantStats): EligibilityResult {
  const reasons: string[] = [];
  if (rules.min_challenges !== null && s.solved < rules.min_challenges)
    reasons.push(`Solved ${s.solved} of required ${rules.min_challenges} challenges`);
  const pct = s.totalChallenges > 0 ? (s.solved / s.totalChallenges) * 100 : 0;
  if (rules.min_completion_pct !== null && pct + 1e-9 < Number(rules.min_completion_pct))
    reasons.push(`Completion ${pct.toFixed(1)}% is below required ${rules.min_completion_pct}%`);
  if (rules.min_points !== null && s.points < rules.min_points)
    reasons.push(`${s.points} points is below required ${rules.min_points}`);
  if (rules.max_missed_days !== null && s.missedDays > rules.max_missed_days)
    reasons.push(`Missed ${s.missedDays} days (maximum ${rules.max_missed_days})`);
  return { eligible: reasons.length === 0, reasons };
}
