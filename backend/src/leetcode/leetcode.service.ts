import type { SubmissionProvider, VerificationResult } from '../providers/types';
import {
  LeetCodeClient, MATCHED_USER_QUERY, RECENT_AC_QUERY,
} from './leetcode.client';
import { parseMatchedUser, parseRecentAccepted } from './leetcode.parser';
import { assessCoverage, findQualifyingSubmission } from './leetcode.verification';
import type { LeetCodeSubmission } from './leetcode.types';

/** The most LeetCode will return for recentAcSubmissionList (verified empirically: limit=500 still yields 20). */
export const RECENT_LIMIT = 20;

export interface LeetCodeServiceOptions { cacheTtlMs: number; now?: () => number }

interface CacheEntry { at: number; value: LeetCodeSubmission[] }

/**
 * The only thing the rest of the app talks to. Implements the provider-agnostic SubmissionProvider contract.
 * Replace this folder (or swap the client for an official API) without touching sync/leaderboard code.
 */
export class LeetCodeService implements SubmissionProvider {
  readonly provider = 'LEETCODE' as const;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<LeetCodeSubmission[]>>();
  private readonly now: () => number;

  constructor(private readonly client: LeetCodeClient, private readonly opts: LeetCodeServiceOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** The user's most recent accepted submissions (max 20), newest first. Cached briefly + concurrent calls are de-duplicated. */
  async getUserRecentSubmissions(username: string): Promise<LeetCodeSubmission[]> {
    const key = username.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.opts.cacheTtlMs) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      const body = await this.client.query(RECENT_AC_QUERY, { username, limit: RECENT_LIMIT });
      const value = parseRecentAccepted(body).sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
      this.cache.set(key, { at: this.now(), value });
      return value;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async getAcceptedSubmissions(username: string, range: { from: Date; to: Date }): Promise<LeetCodeSubmission[]> {
    const all = await this.getUserRecentSubmissions(username);
    return all.filter((s) => s.submittedAt >= range.from && s.submittedAt < range.to);
  }

  async verifyChallengeSubmission(username: string, problemSlug: string, startTime: Date, endTime: Date): Promise<VerificationResult> {
    const all = await this.getUserRecentSubmissions(username);
    const hit = findQualifyingSubmission(all, problemSlug, startTime, endTime);
    const coverage = assessCoverage(all, RECENT_LIMIT, startTime);
    return hit
      ? { verified: true, submission: { externalId: hit.id, submittedAt: hit.submittedAt }, coverage }
      : { verified: false, coverage };
  }

  /** NB: recentAcSubmissionList returns [] for unknown users, so existence uses matchedUser. */
  async userExists(username: string): Promise<boolean> {
    const body = await this.client.query(MATCHED_USER_QUERY, { username });
    return parseMatchedUser(body).exists;
  }

  /** Public "About me" text, used for the relink ownership proof. */
  async getProfileSummary(username: string): Promise<{ exists: boolean; aboutMe: string }> {
    const body = await this.client.query(MATCHED_USER_QUERY, { username });
    return parseMatchedUser(body);
  }

  clearCache(): void { this.cache.clear(); }
}
