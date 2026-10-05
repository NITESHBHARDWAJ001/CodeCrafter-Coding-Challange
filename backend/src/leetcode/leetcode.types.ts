export interface LeetCodeSubmission {
  id: string;
  title: string;
  /** problem slug, e.g. "two-sum" (LeetCode's titleSlug) */
  problemSlug: string;
  /** recentAcSubmissionList only ever returns accepted submissions */
  status: 'ACCEPTED';
  submittedAt: Date;
}

export class LeetCodeTransientError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) { super(message); }
}
/** The response no longer looks like what we expect: LeetCode changed something. Not retryable. */
export class LeetCodeSchemaError extends Error {}
export class LeetCodeUserNotFoundError extends Error {}
