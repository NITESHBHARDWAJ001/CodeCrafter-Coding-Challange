import type { Coverage } from '../providers/types';
import type { LeetCodeSubmission } from './leetcode.types';

/**
 * Pure verification rules (no I/O), so the acceptance-critical logic is trivially unit-testable.
 *
 * A challenge is solved iff there exists a submission where
 *    status = ACCEPTED  AND  problemSlug = challenge slug  AND  startTime <= submittedAt < endTime.
 * "Ever solved it" is irrelevant: a six-month-old Two Sum fails the window check.
 */
export function findQualifyingSubmission(
  submissions: LeetCodeSubmission[],
  problemSlug: string,
  startTime: Date,
  endTime: Date,
): LeetCodeSubmission | undefined {
  const slug = problemSlug.toLowerCase();
  return submissions
    .filter((s) => s.status === 'ACCEPTED' && s.problemSlug === slug && s.submittedAt >= startTime && s.submittedAt < endTime)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())[0]; // earliest accepted counts
}

/**
 * LeetCode only exposes the N most recent accepted submissions. If we received exactly N and the oldest of them is
 * still newer than the window start, there may be in-window submissions we cannot see.
 */
export function assessCoverage(submissions: LeetCodeSubmission[], requestedLimit: number, windowStart: Date): Coverage {
  if (submissions.length < requestedLimit) return 'COMPLETE';
  const oldest = Math.min(...submissions.map((s) => s.submittedAt.getTime()));
  return oldest <= windowStart.getTime() ? 'COMPLETE' : 'PARTIAL';
}
