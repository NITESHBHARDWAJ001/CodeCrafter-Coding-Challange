import type { ChallengeProvider } from '../types/db';

export interface VerifiedSubmission {
  externalId: string | null;
  submittedAt: Date;
}

export type Coverage = 'COMPLETE' | 'PARTIAL';

export interface VerificationResult {
  verified: boolean;
  submission?: VerifiedSubmission;
  /**
   * PARTIAL means the provider only exposes a bounded recent window (LeetCode: last 20 accepted solves) and that
   * window does not reach back to the start of the challenge window, so "not found" is not conclusive.
   * Sync simply tries again next run; nothing is ever revoked or penalised on a negative result.
   */
  coverage: Coverage;
}

/**
 * Everything the rest of the app is allowed to know about an external judge.
 * LeetCode is the first implementation; Codeforces/CodeChef/... implement the same interface.
 */
export interface SubmissionProvider {
  readonly provider: ChallengeProvider;
  userExists(username: string): Promise<boolean>;
  verifyChallengeSubmission(
    username: string,
    problemSlug: string,
    startTime: Date,
    endTime: Date,
  ): Promise<VerificationResult>;
}
