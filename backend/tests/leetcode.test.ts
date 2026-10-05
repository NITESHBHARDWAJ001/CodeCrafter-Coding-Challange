import { describe, expect, it, vi } from 'vitest';
import { findQualifyingSubmission, assessCoverage } from '../src/leetcode/leetcode.verification';
import { parseMatchedUser, parseRecentAccepted } from '../src/leetcode/leetcode.parser';
import { LeetCodeClient } from '../src/leetcode/leetcode.client';
import { LeetCodeService, RECENT_LIMIT } from '../src/leetcode/leetcode.service';
import { LeetCodeSchemaError, LeetCodeTransientError, type LeetCodeSubmission } from '../src/leetcode/leetcode.types';

const sub = (slug: string, iso: string, id = slug + iso): LeetCodeSubmission => ({
  id, title: slug, problemSlug: slug, status: 'ACCEPTED', submittedAt: new Date(iso),
});
const WINDOW = { start: new Date('2026-10-02T03:30:00Z'), end: new Date('2026-10-03T03:30:00Z') }; // Day 2, 09:00 IST

describe('verification rules (Tests 6, 7)', () => {
  it('Test 6: a Two Sum solved six months ago does NOT satisfy today\'s Two Sum', () => {
    const subs = [sub('two-sum', '2026-04-02T10:00:00Z')];
    expect(findQualifyingSubmission(subs, 'two-sum', WINDOW.start, WINDOW.end)).toBeUndefined();
  });

  it('Test 7: an accepted submission inside the window qualifies', () => {
    const subs = [sub('two-sum', '2026-04-02T10:00:00Z'), sub('two-sum', '2026-10-02T11:00:00Z', 'good')];
    expect(findQualifyingSubmission(subs, 'two-sum', WINDOW.start, WINDOW.end)?.id).toBe('good');
  });

  it('wrong problem in the window does not count', () => {
    expect(findQualifyingSubmission([sub('valid-parentheses', '2026-10-02T11:00:00Z')], 'two-sum', WINDOW.start, WINDOW.end)).toBeUndefined();
  });

  it('window is [start, end): start inclusive, end exclusive', () => {
    expect(findQualifyingSubmission([sub('a', WINDOW.start.toISOString())], 'a', WINDOW.start, WINDOW.end)).toBeDefined();
    expect(findQualifyingSubmission([sub('a', WINDOW.end.toISOString())], 'a', WINDOW.start, WINDOW.end)).toBeUndefined();
    expect(findQualifyingSubmission([sub('a', '2026-10-02T03:29:59Z')], 'a', WINDOW.start, WINDOW.end)).toBeUndefined();
  });

  it('earliest qualifying submission is chosen; slug matching is case-insensitive', () => {
    const subs = [sub('Two-Sum'.toLowerCase(), '2026-10-02T15:00:00Z', 'late'), sub('two-sum', '2026-10-02T05:00:00Z', 'early')];
    expect(findQualifyingSubmission(subs, 'TWO-SUM', WINDOW.start, WINDOW.end)?.id).toBe('early');
  });
});

describe('coverage (LeetCode only exposes the last 20 accepted solves)', () => {
  const many = (n: number, startIso: string) => Array.from({ length: n }, (_, i) => sub(`p${i}`, new Date(new Date(startIso).getTime() + i * 60_000).toISOString()));
  it('fewer than the limit => complete', () => expect(assessCoverage(many(5, '2026-10-02T04:00:00Z'), 20, WINDOW.start)).toBe('COMPLETE'));
  it('full page whose oldest item is before the window => complete', () => expect(assessCoverage(many(20, '2026-10-01T00:00:00Z'), 20, WINDOW.start)).toBe('COMPLETE'));
  it('full page entirely inside the window => partial (older in-window solves may be hidden)', () => expect(assessCoverage(many(20, '2026-10-02T04:00:00Z'), 20, WINDOW.start)).toBe('PARTIAL'));
});

describe('parser', () => {
  const ok = { data: { recentAcSubmissionList: [{ id: '1', title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1791086655' }] } };
  it('parses epoch-seconds timestamps', () => {
    const [s] = parseRecentAccepted(ok);
    expect(s.problemSlug).toBe('two-sum');
    expect(s.submittedAt.toISOString()).toBe(new Date(1791086655 * 1000).toISOString());
    expect(s.status).toBe('ACCEPTED');
  });
  it('treats an empty list as empty (LeetCode returns [] for unknown users)', () => {
    expect(parseRecentAccepted({ data: { recentAcSubmissionList: [] } })).toEqual([]);
  });
  it('fails loudly on shape changes instead of reporting "no solves"', () => {
    expect(() => parseRecentAccepted({ data: {} })).toThrow(LeetCodeSchemaError);
    expect(() => parseRecentAccepted({ data: { recentAcSubmissionList: null } })).toThrow(LeetCodeSchemaError);
    expect(() => parseRecentAccepted({ errors: [{ message: 'boom' }] })).toThrow(LeetCodeSchemaError);
    expect(() => parseRecentAccepted({ data: { recentAcSubmissionList: [{ id: '1', titleSlug: 'x', timestamp: 'abc' }] } })).toThrow(LeetCodeSchemaError);
  });
  it('detects missing users via matchedUser', () => {
    expect(parseMatchedUser({ errors: [{ message: 'That user does not exist.' }], data: { matchedUser: null } }).exists).toBe(false);
    expect(parseMatchedUser({ data: { matchedUser: { username: 'a', profile: { aboutMe: 'hi CC-LINK-1' } } } })).toEqual({ exists: true, aboutMe: 'hi CC-LINK-1' });
  });
});

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const mkClient = (fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof LeetCodeClient>[0]> = {}) =>
  new LeetCodeClient({ url: 'http://lc.test/graphql', timeoutMs: 50, maxRetries: 3, requestsPerSecond: 1000, fetchImpl, sleep: async () => undefined, ...over });

describe('client resilience', () => {
  it('retries transient 5xx then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 502 })).mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(jsonRes({ data: 1 }));
    expect(await mkClient(f as unknown as typeof fetch).query('q', {})).toEqual({ data: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('honours Retry-After on 429 and gives up after maxRetries', async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': '2' } }));
    const c = mkClient(f as unknown as typeof fetch, { maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); } });
    await expect(c.query('q', {})).rejects.toBeInstanceOf(LeetCodeTransientError);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((s) => s === 2000).length).toBe(2);
  });
  it('treats an HTML challenge page as transient, non-JSON junk as a schema error', async () => {
    const html = vi.fn().mockResolvedValue(new Response('<html>Just a moment</html>', { status: 200 }));
    await expect(mkClient(html as unknown as typeof fetch, { maxRetries: 0 }).query('q', {})).rejects.toBeInstanceOf(LeetCodeTransientError);
    const junk = vi.fn().mockResolvedValue(new Response('nope', { status: 200 }));
    await expect(mkClient(junk as unknown as typeof fetch).query('q', {})).rejects.toBeInstanceOf(LeetCodeSchemaError);
    expect(junk).toHaveBeenCalledTimes(1); // not retried
  });
  it('times out hung requests', async () => {
    const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => { init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    await expect(mkClient(f as unknown as typeof fetch, { maxRetries: 1, timeoutMs: 10 }).query('q', {})).rejects.toThrow(/timed out/);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('service: caching and de-duplication', () => {
  const body = { data: { recentAcSubmissionList: [{ id: '9', title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(Math.floor(new Date('2026-10-02T11:00:00Z').getTime() / 1000)) }] } };

  it('one fetch serves many challenge checks (and concurrent callers share the in-flight request)', async () => {
    const f = vi.fn().mockImplementation(async () => jsonRes(body));
    const svc = new LeetCodeService(mkClient(f as unknown as typeof fetch), { cacheTtlMs: 60_000 });
    const [a, b] = await Promise.all([
      svc.verifyChallengeSubmission('Nitesh', 'two-sum', WINDOW.start, WINDOW.end),
      svc.verifyChallengeSubmission('nitesh', 'valid-parentheses', WINDOW.start, WINDOW.end),
    ]);
    await svc.verifyChallengeSubmission('nitesh', 'two-sum', WINDOW.start, WINDOW.end);
    expect(a.verified).toBe(true);
    expect(a.submission?.externalId).toBe('9');
    expect(b.verified).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('requests exactly the documented limit', async () => {
    const f = vi.fn().mockImplementation(async () => jsonRes(body));
    await new LeetCodeService(mkClient(f as unknown as typeof fetch), { cacheTtlMs: 0 }).getUserRecentSubmissions('x');
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).variables.limit).toBe(RECENT_LIMIT);
  });

  it('cache expires', async () => {
    let t = 0;
    const f = vi.fn().mockImplementation(async () => jsonRes(body));
    const svc = new LeetCodeService(mkClient(f as unknown as typeof fetch), { cacheTtlMs: 1000, now: () => t });
    await svc.getUserRecentSubmissions('x'); t = 500; await svc.getUserRecentSubmissions('x'); t = 1500; await svc.getUserRecentSubmissions('x');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch is not cached', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValue(jsonRes(body));
    const svc = new LeetCodeService(mkClient(f as unknown as typeof fetch, { maxRetries: 0 }), { cacheTtlMs: 60_000 });
    await expect(svc.getUserRecentSubmissions('x')).rejects.toBeInstanceOf(LeetCodeTransientError);
    expect(await svc.getUserRecentSubmissions('x')).toHaveLength(1);
  });
});
