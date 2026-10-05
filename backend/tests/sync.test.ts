import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

// ───────── in-memory persistence that honours UNIQUE(challenge_id, user_id) like Postgres ─────────
const db = vi.hoisted(() => ({
  program: null as any, challenges: [] as any[], participants: [] as any[],
  submissions: [] as any[], progress: [] as any[], logs: [] as any[],
  leetcode: {} as Record<string, Array<{ id: string; slug: string; at: string }> | 'FAIL'>,
  providerCalls: [] as string[],
}));

vi.mock('../src/repositories/programs.repo', () => ({
  programsRepo: { get: async () => db.program, list: async () => [db.program] },
}));
vi.mock('../src/repositories/challenges.repo', () => ({
  challengesRepo: { listByProgram: async () => db.challenges },
}));
vi.mock('../src/repositories/participants.repo', () => ({
  participantsRepo: {
    listEnrolled: async () => db.participants,
    enrolledUserIds: async () => db.participants.map((p) => p.user_id),
    get: async () => ({ status: 'ENROLLED' }),
  },
}));
vi.mock('../src/repositories/submissions.repo', () => ({
  submissionsRepo: {
    insertNew: async (rows: any[]) => {
      const out: any[] = [];
      for (const r of rows) {
        if (db.submissions.some((s) => s.challenge_id === r.challenge_id && s.user_id === r.user_id)) continue; // ON CONFLICT DO NOTHING
        const row = { ...r, id: `s${db.submissions.length}`, verified_at: new Date().toISOString() };
        db.submissions.push(row); out.push(row);
      }
      return out;
    },
    listByProgram: async () => db.submissions,
    listByUser: async (u: string) => db.submissions.filter((s) => s.user_id === u),
  },
  progressRepo: { upsertMany: async (rows: any[]) => { for (const r of rows) { db.progress = db.progress.filter((p) => p.user_id !== r.user_id); db.progress.push(r); } } },
}));
vi.mock('../src/repositories/sync.repo', () => ({
  syncRepo: {
    getSettings: async () => ({ mode: 'BOTH', enabled: true, time: '23:00', timezone: 'Asia/Kolkata', frequency: 'DAILY' }),
    runningFor: async () => null,
    createLog: async (r: any) => { const l = { id: `l${db.logs.length}`, ...r }; db.logs.push(l); return l; },
    updateLog: async (id: string, patch: any) => { Object.assign(db.logs.find((l) => l.id === id), patch); },
  },
}));
vi.mock('../src/providers/registry', async () => {
  const { findQualifyingSubmission } = await import('../src/leetcode/leetcode.verification');
  return {
    getSubmissionProvider: () => ({
      provider: 'LEETCODE',
      verifyChallengeSubmission: async (username: string, slug: string, start: Date, end: Date) => {
        db.providerCalls.push(`${username}:${slug}`);
        const data = db.leetcode[username];
        if (data === 'FAIL') throw new Error('LeetCode request timed out');
        const subs = (data ?? []).map((s) => ({ id: s.id, title: s.slug, problemSlug: s.slug, status: 'ACCEPTED' as const, submittedAt: new Date(s.at) }));
        const hit = findQualifyingSubmission(subs, slug, start, end);
        return hit ? { verified: true, submission: { externalId: hit.id, submittedAt: hit.submittedAt }, coverage: 'COMPLETE' as const } : { verified: false, coverage: 'COMPLETE' as const };
      },
    }),
  };
});

import { syncService } from '../src/services/sync.service';
import { syncRepo } from '../src/repositories/sync.repo';

const TZ = 'Asia/Kolkata';
const H = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * H).toISOString();

function seed() {
  const today = DateTime.now().setZone(TZ);
  db.program = {
    id: 'p1', name: '30 Days of DSA', status: 'ACTIVE', timezone: TZ, challenge_window_hours: 24,
    start_date: today.minus({ days: 3 }).toISODate(), end_date: today.plus({ days: 26 }).toISODate(), duration_days: 30,
    default_points: { EASY: 100, MEDIUM: 150, HARD: 250 }, streak_policy: 'RESET_ON_MISS', streak_grace_days: 0,
  };
  const mk = (day: number, slug: string, relH: number, over: any = {}) => ({
    id: `c${day}`, program_id: 'p1', day_number: day, title: slug, provider: 'LEETCODE', external_problem_id: slug,
    external_problem_url: '', category: 'x', difficulty: 'EASY', points_override: null, status: 'SCHEDULED',
    release_at: iso(relH), closes_at: iso(relH + 24), ...over,
  });
  db.challenges = [
    mk(1, 'two-sum', -30),                                   // closed 6h ago
    mk(2, 'valid-parentheses', -6, { points_override: 120 }), // ACTIVE now, admin-overridden points
    mk(3, 'binary-search', 18),                               // LOCKED
  ];
  const user = (id: string, name: string) => ({ user_id: id, profile: { id, full_name: name, leetcode_username: name } });
  db.participants = [user('u1', 'rahul'), user('u2', 'aman'), user('u3', 'nitesh'), user('u4', 'flaky')];
  db.submissions = []; db.progress = []; db.logs = []; db.providerCalls = [];
  db.leetcode = {
    // solved Day 2 six months ago, then nothing new => must NOT get Day 2 points (Test 6)
    rahul: [{ id: 'old', slug: 'valid-parentheses', at: iso(-24 * 180) }],
    // solved Day 1 and Day 2 inside their windows (Test 7)
    aman: [{ id: 'a1', slug: 'two-sum', at: iso(-20) }, { id: 'a2', slug: 'valid-parentheses', at: iso(-2) }],
    // solved Day 2 inside window, plus the LOCKED Day 3 problem "early" (must be ignored)
    nitesh: [{ id: 'n2', slug: 'valid-parentheses', at: iso(-1) }, { id: 'n3', slug: 'binary-search', at: iso(-0.5) }],
    flaky: 'FAIL',
  };
}

const run = async () => {
  const log = await syncRepo.createLog({ program_id: 'p1', sync_type: 'MANUAL', status: 'RUNNING' } as any);
  await syncService.executeProgram(log as any, db.program);
  return db.logs.find((l) => l.id === (log as any).id);
};
const pts = (u: string) => db.progress.find((p) => p.user_id === u)?.total_points ?? 0;

describe('sync engine', () => {
  beforeEach(seed);

  it('Test 6: a solve from six months ago earns nothing', async () => {
    await run();
    expect(db.submissions.filter((s) => s.user_id === 'u1')).toHaveLength(0);
    expect(pts('u1')).toBe(0);
  });

  it('Test 7: in-window accepted submissions earn points (override applied and frozen on the submission)', async () => {
    await run();
    const aman = db.submissions.filter((s) => s.user_id === 'u2');
    expect(aman.map((s) => [s.challenge_id, s.awarded_points]).sort()).toEqual([['c1', 100], ['c2', 120]]);
    expect(pts('u2')).toBe(220);
  });

  it('never verifies or awards a locked challenge, even if the user already solved that problem', async () => {
    await run();
    expect(db.providerCalls.some((c) => c.endsWith(':binary-search'))).toBe(false);
    expect(db.submissions.some((s) => s.challenge_id === 'c3')).toBe(false);
  });

  it('Test 8: running sync twice does not award duplicate points', async () => {
    const first = await run();
    const snapshot = JSON.stringify(db.submissions.map((s) => [s.user_id, s.challenge_id, s.awarded_points]).sort());
    const pointsBefore = db.progress.map((p) => [p.user_id, p.total_points]).sort();
    const second = await run();
    expect(first.new_submissions).toBe(3);   // aman x2, nitesh x1
    expect(second.new_submissions).toBe(0);
    expect(JSON.stringify(db.submissions.map((s) => [s.user_id, s.challenge_id, s.awarded_points]).sort())).toBe(snapshot);
    expect(db.progress.map((p) => [p.user_id, p.total_points]).sort()).toEqual(pointsBefore);
  });

  it('overlapping/concurrent syncs still cannot double-award (unique constraint semantics)', async () => {
    await Promise.all([run(), run(), run()]);
    expect(db.submissions.filter((s) => s.user_id === 'u2')).toHaveLength(2);
    expect(pts('u2')).toBe(220);
  });

  it('isolates a failing user: others are processed, failure is logged, status is PARTIAL', async () => {
    const log = await run();
    expect(log.status).toBe('PARTIAL');
    expect(log.participants_total).toBe(4);
    expect(log.participants_checked).toBe(4);
    expect(log.failed_users).toBe(1);
    expect(log.failures[0]).toMatchObject({ username: 'flaky' });
    expect(pts('u2')).toBe(220);
  });

  it('a total LeetCode outage marks the sync FAILED but does not corrupt existing standings', async () => {
    await run(); // establish standings
    const before = db.progress.map((p) => [p.user_id, p.total_points, p.solved_count]).sort();
    for (const k of Object.keys(db.leetcode)) db.leetcode[k] = 'FAIL';
    const log = await run();
    expect(log.status).toBe('FAILED');   // every user that needed a LeetCode check failed
    expect(log.failed_users).toBe(3);    // aman had nothing pending, so was never sent to LeetCode
    expect(db.progress.map((p) => [p.user_id, p.total_points, p.solved_count]).sort()).toEqual(before);
  });

  it('skips LeetCode entirely for users who already solved everything released', async () => {
    await run();
    db.providerCalls = [];
    await run();
    expect(db.providerCalls.filter((c) => c.startsWith('aman:'))).toHaveLength(0);
  });

  it('streaks/points come out right: aman has a 2-day streak, rahul missed both closed/open correctly', async () => {
    await run();
    expect(db.progress.find((p) => p.user_id === 'u2')).toMatchObject({ solved_count: 2, current_streak: 2, longest_streak: 2 });
    expect(db.progress.find((p) => p.user_id === 'u1')).toMatchObject({ solved_count: 0, current_streak: 0, missed_days: 1 });
  });
});
