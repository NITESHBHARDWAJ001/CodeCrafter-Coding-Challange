import { describe, expect, it } from 'vitest';
import { computeStreaks } from '../src/domain/streak';
import { evaluateEligibility } from '../src/domain/eligibility';
import { resolvePoints } from '../src/domain/scoring';
import { buildProgress } from '../src/domain/progress';
import { parseCsv, validateChallengeRows } from '../src/domain/csv';
import { parseProblemUrl } from '../src/providers/urls';
import { toCron, nextRunFor } from '../src/jobs/scheduler';
import { defaultCertificatePrefix, resolveDates } from '../src/services/program.service';
import { toInstant, addHours } from '../src/domain/time';
import type { Challenge, Program, Submission } from '../src/types/db';
import { DateTime } from 'luxon';

const S = (solved: boolean, closed = true) => ({ solved, closed });

describe('streaks', () => {
  it('counts consecutive solves', () => expect(computeStreaks([S(true), S(true), S(true)], 'RESET_ON_MISS', 0)).toEqual({ current: 3, longest: 3, missed: 0 }));
  it('RESET_ON_MISS: a missed closed day resets to 0 but keeps the longest', () =>
    expect(computeStreaks([S(true), S(true), S(false), S(true)], 'RESET_ON_MISS', 0)).toEqual({ current: 1, longest: 2, missed: 1 }));
  it('today\'s still-open unsolved challenge does not break the streak', () =>
    expect(computeStreaks([S(true), S(true), S(false, false)], 'RESET_ON_MISS', 0)).toEqual({ current: 2, longest: 2, missed: 0 }));
  it('GRACE_DAYS(1): one miss is forgiven (streak kept, not incremented)', () =>
    expect(computeStreaks([S(true), S(false), S(true)], 'GRACE_DAYS', 1)).toEqual({ current: 2, longest: 2, missed: 1 }));
  it('GRACE_DAYS(1): two consecutive misses reset', () =>
    expect(computeStreaks([S(true), S(true), S(false), S(false), S(true)], 'GRACE_DAYS', 1)).toEqual({ current: 1, longest: 2, missed: 2 }));
  it('empty program', () => expect(computeStreaks([], 'RESET_ON_MISS', 0)).toEqual({ current: 0, longest: 0, missed: 0 }));
});

describe('certificate eligibility (Test 12, 13): criteria are configurable, never hard-coded', () => {
  const none = { min_challenges: null, min_completion_pct: null, min_points: null, max_missed_days: null };
  const stats = { solved: 27, points: 2600, missedDays: 3, totalChallenges: 30 };
  it('no rules => everyone eligible', () => expect(evaluateEligibility(none, { ...stats, solved: 0, points: 0 }).eligible).toBe(true));
  it('the spec example passes: 27/30, 90%, 2500 pts, <=3 missed', () =>
    expect(evaluateEligibility({ min_challenges: 27, min_completion_pct: 90, min_points: 2500, max_missed_days: 3 }, stats).eligible).toBe(true));
  it('fails with a reason per violated rule', () => {
    const r = evaluateEligibility({ min_challenges: 28, min_completion_pct: 95, min_points: 3000, max_missed_days: 2 }, stats);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(4);
  });
  it('each rule is independent', () => {
    expect(evaluateEligibility({ ...none, min_points: 2601 }, stats).eligible).toBe(false);
    expect(evaluateEligibility({ ...none, max_missed_days: 3 }, stats).eligible).toBe(true);
    expect(evaluateEligibility({ ...none, max_missed_days: 2 }, stats).eligible).toBe(false);
  });
  it('percent boundary is inclusive (27/30 = 90%)', () => expect(evaluateEligibility({ ...none, min_completion_pct: 90 }, stats).eligible).toBe(true));
  it('zero challenges => 0% completion', () => expect(evaluateEligibility({ ...none, min_completion_pct: 50 }, { ...stats, totalChallenges: 0, solved: 0 }).eligible).toBe(false));
});

describe('scoring', () => {
  const p = { default_points: { EASY: 100, MEDIUM: 150, HARD: 250 } };
  it('uses difficulty defaults', () => {
    expect(resolvePoints({ difficulty: 'EASY', points_override: null }, p)).toBe(100);
    expect(resolvePoints({ difficulty: 'HARD', points_override: null }, p)).toBe(250);
  });
  it('per-challenge override wins (including an explicit 0)', () => {
    expect(resolvePoints({ difficulty: 'EASY', points_override: 500 }, p)).toBe(500);
    expect(resolvePoints({ difficulty: 'EASY', points_override: 0 }, p)).toBe(0);
  });
});

describe('progress is derived from submissions (idempotent; historical points are frozen)', () => {
  const TZ = 'Asia/Kolkata';
  const program: Program = {
    id: 'p', name: 'x', slug: 'x', description: '', banner_url: null, start_date: '2026-10-01', end_date: '2026-10-30', duration_days: 30,
    status: 'ACTIVE', enrollment_open: true, timezone: TZ, challenge_window_hours: 24, default_points: { EASY: 100, MEDIUM: 150, HARD: 250 },
    streak_policy: 'RESET_ON_MISS', streak_grace_days: 0, certificate_enabled: true, certificate_prefix: 'X', created_by: null, created_at: '', updated_at: '',
  };
  const ch = (d: number, points_override: number | null = null): Challenge => {
    const rel = toInstant(`2026-10-0${d}`, '09:00', TZ);
    return { id: `c${d}`, program_id: 'p', day_number: d, title: 't', provider: 'LEETCODE', external_problem_id: `s${d}`, external_problem_url: '', category: '', difficulty: 'EASY', points_override, release_at: rel.toISOString(), closes_at: addHours(rel, 24).toISOString(), status: 'SCHEDULED', created_at: '', updated_at: '' };
  };
  const sol = (user: string, d: number, pts: number): Submission => ({ id: `${user}${d}`, challenge_id: `c${d}`, program_id: 'p', user_id: user, provider: 'LEETCODE', external_submission_id: null, verified_username: user, submitted_at: toInstant(`2026-10-0${d}`, '12:00', TZ).toISOString(), verified_at: '', awarded_points: pts });
  const now = toInstant('2026-10-03', '10:00', TZ); // day 1 done, day 2 done, day 3 active

  it('computes points/solved/streak and ignores future challenges', () => {
    const rows = buildProgress(program, [ch(1), ch(2), ch(3), ch(4)], [sol('a', 1, 100), sol('a', 2, 100), sol('b', 2, 100)], ['a', 'b', 'c'], now);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(by.a).toMatchObject({ solved_count: 2, total_points: 200, current_streak: 2, longest_streak: 2, missed_days: 0 });
    expect(by.b).toMatchObject({ solved_count: 1, total_points: 100, current_streak: 1, missed_days: 1 }); // missed day 1, then solved day 2
    expect(by.c).toMatchObject({ solved_count: 0, total_points: 0, current_streak: 0, missed_days: 2 });
  });
  it('same input => same output (running sync twice cannot change anything)', () => {
    const args = [program, [ch(1), ch(2)], [sol('a', 1, 100)], ['a'], now] as const;
    expect(buildProgress(...args)).toEqual(buildProgress(...args));
  });
  it('points come from the stored award, not from the current challenge config', () => {
    const rows = buildProgress(program, [ch(1, 9999)], [sol('a', 1, 100)], ['a'], now);
    expect(rows[0].total_points).toBe(100);
  });
});

describe('CSV bulk import validation', () => {
  const ctx = { timezone: 'Asia/Kolkata', windowHours: 24 };
  const header = 'day_number,title,leetcode_url,category,difficulty,points,release_date,release_time';
  it('accepts the spec example', () => {
    const csv = `${header}
1,Two Sum,https://leetcode.com/problems/two-sum/,Arrays,Easy,100,2026-10-10,09:00
2,Valid Parentheses,https://leetcode.com/problems/valid-parentheses/,Stack,Easy,100,2026-10-11,09:00
3,Binary Search,https://leetcode.com/problems/binary-search/,Binary Search,Easy,100,2026-10-12,09:00`;
    const r = validateChallengeRows(parseCsv(csv), ctx);
    expect(r.validCount).toBe(3);
    expect(r.invalidCount).toBe(0);
    expect(r.valid[0]).toMatchObject({ external_problem_id: 'two-sum', provider: 'LEETCODE', difficulty: 'EASY', points_override: 100 });
    // 09:00 IST = 03:30Z, window = 24h
    expect(r.valid[0].release_at).toBe('2026-10-10T03:30:00.000Z');
    expect(r.valid[0].closes_at).toBe('2026-10-11T03:30:00.000Z');
  });
  it('reports spreadsheet-style row numbers for each problem', () => {
    const csv = `${header}
1,Two Sum,,Arrays,Easy,100,2026-10-10,09:00
2,Bad,https://leetcode.com/problems/bad/,Stack,Impossible,100,2026-10-11,09:00
3,Dup,https://leetcode.com/problems/x/,Stack,Easy,,2026-10-11,09:00
3,Dup2,https://leetcode.com/problems/y/,Stack,Easy,,2026-10-11,09:00
5,Time,https://example.com/foo,Stack,Easy,,2026-13-45,99:99`;
    const r = validateChallengeRows(parseCsv(csv), ctx);
    expect(r.validCount).toBe(1);
    expect(r.invalidCount).toBe(4);
    const msgs = r.errors.map((e) => `${e.row}:${e.message}`);
    expect(msgs).toContain('2:Missing LeetCode URL');
    expect(msgs.some((m) => m.startsWith('3:Invalid difficulty'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('5:Duplicate day 3'))).toBe(true);
    expect(r.errors.filter((e) => e.row === 6).length).toBeGreaterThanOrEqual(2);
  });
  it('blank points => use program defaults (null override)', () => {
    const r = validateChallengeRows([{ day_number: 1, title: 't', leetcode_url: 'https://leetcode.com/problems/a/', difficulty: 'hard', release_date: '2026-10-10' }], ctx);
    expect(r.valid[0].points_override).toBeNull();
    expect(r.valid[0].difficulty).toBe('HARD');
    expect(r.valid[0].release_at).toBe('2026-10-09T18:30:00.000Z'); // default 00:00 IST
  });
  it('handles BOM, quoted commas and extra whitespace', () => {
    const csv = `﻿${header}\n 1 , "Two Sum, again" ,https://leetcode.com/problems/two-sum,Arrays,easy,,2026-10-10,09:00`;
    const r = validateChallengeRows(parseCsv(csv), ctx);
    expect(r.valid[0].title).toBe('Two Sum, again');
  });
  it('accepts url variants and extracts the slug', () => {
    expect(parseProblemUrl('https://leetcode.com/problems/two-sum/description/')?.externalId).toBe('two-sum');
    expect(parseProblemUrl('https://www.leetcode.com/problems/Two-Sum?envType=daily')?.externalId).toBe('two-sum');
    expect(parseProblemUrl('https://leetcode.com/contest/weekly')).toBeNull();
    expect(parseProblemUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('program helpers & scheduler', () => {
  it('calculates end date from duration (inclusive)', () => expect(resolveDates('2026-10-10', undefined, 30)).toEqual({ end_date: '2026-11-08', duration_days: 30 }));
  it('calculates duration from end date', () => expect(resolveDates('2026-10-10', '2026-11-08')).toEqual({ end_date: '2026-11-08', duration_days: 30 }));
  it('rejects end before start', () => expect(() => resolveDates('2026-10-10', '2026-10-01')).toThrow());
  it('derives certificate prefixes', () => {
    expect(defaultCertificatePrefix('30 Days of DSA')).toBe('DSA');
    expect(defaultCertificatePrefix('Graph Challenge')).toBe('GRAPH');
    expect(defaultCertificatePrefix('100 Days of LeetCode')).toBe('LEETCO');
  });
  it('cron expressions', () => {
    expect(toCron({ time: '23:00', frequency: 'DAILY' })).toBe('0 23 * * *');
    expect(toCron({ time: '07:15', frequency: 'HOURLY' })).toBe('15 * * * *');
    expect(toCron({ time: '23:00', frequency: 'EVERY_6_HOURS' })).toBe('0 5-23/6 * * *');
  });
  it('next run is computed in the configured timezone', () => {
    const from = DateTime.fromISO('2026-10-04T10:00:00', { zone: 'Asia/Kolkata' });
    const next = nextRunFor({ mode: 'BOTH', enabled: true, time: '23:00', timezone: 'Asia/Kolkata', frequency: 'DAILY' }, from)!;
    expect(DateTime.fromISO(next).setZone('Asia/Kolkata').toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-04 23:00');
    expect(nextRunFor({ mode: 'MANUAL', enabled: true, time: '23:00', timezone: 'Asia/Kolkata', frequency: 'DAILY' }, from)).toBeNull();
  });
});
