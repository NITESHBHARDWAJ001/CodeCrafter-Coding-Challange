import { LeetCodeSchemaError, LeetCodeTransientError } from './leetcode.types';

export interface LeetCodeClientOptions {
  url: string;
  timeoutMs: number;
  maxRetries: number;
  requestsPerSecond: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Spaces outgoing requests at least 1/rps apart, across all concurrent callers. */
export class RateLimiter {
  private nextSlot = 0;
  constructor(private readonly rps: number, private readonly sleep = defaultSleep) {}
  async acquire(): Promise<void> {
    const interval = 1000 / Math.max(0.1, this.rps);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + interval;
    if (slot > now) await this.sleep(slot - now);
  }
}

/**
 * Low-level transport for LeetCode's *unofficial* GraphQL endpoint (https://leetcode.com/graphql).
 * Knows nothing about challenges. Responsibilities: timeout, retries with backoff+jitter, rate limiting.
 * Throws LeetCodeTransientError once retries are exhausted.
 */
export class LeetCodeClient {
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: LeetCodeClientOptions) {
    this.sleep = opts.sleep ?? defaultSleep;
    this.limiter = new RateLimiter(opts.requestsPerSecond, this.sleep);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async query(query: string, variables: Record<string, unknown>): Promise<unknown> {
    let lastError: Error = new LeetCodeTransientError('LeetCode request failed');
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = lastError instanceof LeetCodeTransientError && lastError.retryAfterMs !== undefined
          ? lastError.retryAfterMs
          : 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await this.sleep(Math.min(backoff, 15_000));
      }
      await this.limiter.acquire();
      try {
        return await this.once(query, variables);
      } catch (e) {
        if (!(e instanceof LeetCodeTransientError)) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  private async once(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    try {
      const res = await this.fetchImpl(this.opts.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://leetcode.com',
          'User-Agent': 'CodeCrafterClub-Verifier/1.0 (+IIT Madras)',
        },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        throw new LeetCodeTransientError('LeetCode rate limited us (429)', Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
      }
      if (res.status >= 500) throw new LeetCodeTransientError(`LeetCode server error (${res.status})`);
      // GraphQL "user does not exist" arrives as HTTP 200 with errors[], which the parser interprets.
      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch {
        // HTML (Cloudflare challenge / maintenance page) is transient; anything else is a protocol change.
        if (/<html/i.test(text)) throw new LeetCodeTransientError(`LeetCode returned HTML (status ${res.status})`);
        throw new LeetCodeSchemaError(`Non-JSON response (status ${res.status})`);
      }
      if (!res.ok && !(typeof json === 'object' && json !== null && 'errors' in json))
        throw new LeetCodeSchemaError(`Unexpected HTTP ${res.status}`);
      return json;
    } catch (e) {
      if (e instanceof LeetCodeTransientError || e instanceof LeetCodeSchemaError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw new LeetCodeTransientError(`LeetCode request timed out after ${this.opts.timeoutMs}ms`);
      throw new LeetCodeTransientError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const RECENT_AC_QUERY = `
  query recentAc($username: String!, $limit: Int) {
    recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
  }`;

export const MATCHED_USER_QUERY = `
  query user($username: String!) {
    matchedUser(username: $username) { username profile { aboutMe } }
  }`;
