import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';

const st = vi.hoisted(() => ({
  program: null as any, challenges: [] as any[], profileUpdates: [] as any[],
}));

vi.mock('../src/services/auth.service', async (orig) => {
  const actual = await orig<typeof import('../src/services/auth.service')>();
  const { AppError } = await import('../src/lib/errors');
  const users: Record<string, any> = {
    student: { id: '11111111-1111-4111-8111-111111111111', role: 'STUDENT', full_name: 'Stu Dent', leetcode_username: 'stu', email: 's@x.edu', level: 'DEGREE' },
    admin: { id: '22222222-2222-4222-8222-222222222222', role: 'ADMIN', full_name: 'Ad Min', leetcode_username: 'adm', email: 'a@x.edu', level: 'DEGREE' },
  };
  return { ...actual, authService: { ...actual.authService, authenticate: async (t: string) => { if (!users[t]) throw new AppError(401, 'UNAUTHORIZED', 'bad token'); return users[t]; } } };
});
vi.mock('../src/repositories/programs.repo', () => ({
  programsRepo: { get: async () => st.program, list: async () => [st.program], getRules: async () => null },
}));
vi.mock('../src/repositories/challenges.repo', () => ({
  challengesRepo: {
    get: async (id: string) => st.challenges.find((c) => c.id === id) ?? null,
    listByProgram: async () => st.challenges, challengeIdsWithSubmissions: async () => new Set(),
  },
}));
vi.mock('../src/repositories/submissions.repo', () => ({
  submissionsRepo: { listByUser: async () => [], listByProgram: async () => [] },
  progressRepo: { get: async () => null, listByUser: async () => [] },
}));
vi.mock('../src/repositories/participants.repo', () => ({
  participantsRepo: { get: async () => null, countEnrolled: async () => 0, programsOfUser: async () => [], countAllEnrolled: async () => 0 },
}));
vi.mock('../src/repositories/leaderboard.repo', () => ({ leaderboardRepo: { programRank: async () => null, overallRank: async () => null } }));
vi.mock('../src/repositories/profiles.repo', () => ({
  profilesRepo: { update: async (_id: string, patch: any) => { st.profileUpdates.push(patch); return { id: _id, ...patch }; }, count: async () => 0 },
}));
vi.mock('../src/repositories/certificates.repo', () => ({ certificatesRepo: { countByUser: async () => 0 } }));

import { createApp } from '../src/app';
import { toInstant, addHours } from '../src/domain/time';

const PROGRAM_ID = '33333333-3333-4333-8333-333333333333';
const TZ = 'Asia/Kolkata';
const app = createApp();
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

function seed(status = 'ACTIVE') {
  const today = DateTime.now().setZone(TZ);
  st.program = {
    id: PROGRAM_ID, name: 'DSA', status, timezone: TZ, challenge_window_hours: 24, default_points: { EASY: 100, MEDIUM: 150, HARD: 250 },
    start_date: today.minus({ days: 1 }).toISODate(), end_date: today.plus({ days: 28 }).toISODate(), duration_days: 30,
    streak_policy: 'RESET_ON_MISS', streak_grace_days: 0, certificate_enabled: false, slug: 'dsa', enrollment_open: true,
  };
  const rel = (h: number) => new Date(Date.now() + h * 3_600_000);
  const mk = (id: string, day: number, relH: number) => ({
    id: `00000000-0000-4000-8000-00000000000${day}`, program_id: PROGRAM_ID, day_number: day, title: `TopSecretTitle${day}`, provider: 'LEETCODE',
    external_problem_id: `top-secret-slug-${day}`, external_problem_url: `https://leetcode.com/problems/top-secret-slug-${day}/`, category: 'Arrays',
    difficulty: 'EASY', points_override: null, release_at: rel(relH).toISOString(), closes_at: rel(relH + 24).toISOString(), status: 'SCHEDULED',
  });
  st.challenges = [mk('a', 1, -30), mk('b', 2, -2), mk('c', 3, 22), mk('d', 4, 46)];
  st.profileUpdates = [];
}
const released = '00000000-0000-4000-8000-000000000002';
const future = '00000000-0000-4000-8000-000000000004';

describe('release gating over HTTP (Test 15)', () => {
  beforeEach(() => seed());

  it('requires authentication', async () => {
    expect((await request(app).get('/api/programs')).status).toBe(401);
    expect((await request(app).get(`/api/challenges/${released}`).set(as('nope'))).status).toBe(401);
  });

  it('a future challenge cannot be fetched directly by id', async () => {
    const res = await request(app).get(`/api/challenges/${future}`).set(as('student'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHALLENGE_LOCKED');
    expect(JSON.stringify(res.body)).not.toMatch(/TopSecret|top-secret|leetcode\.com/);
  });

  it('listing shows future days as locked placeholders without problem details', async () => {
    const res = await request(app).get(`/api/programs/${PROGRAM_ID}/challenges`).set(as('student'));
    expect(res.status).toBe(200);
    const list = res.body.challenges;
    expect(list).toHaveLength(4);
    expect(list.filter((c: any) => c.locked).map((c: any) => c.day_number)).toEqual([3, 4]);
    const lockedJson = JSON.stringify(list.filter((c: any) => c.locked));
    expect(lockedJson).not.toMatch(/TopSecret|top-secret|leetcode/);
    expect(list.find((c: any) => c.day_number === 3).release_label).toMatch(/Releases/);
    expect(list.find((c: any) => c.day_number === 2)).toMatchObject({ locked: false, state: 'ACTIVE', title: 'TopSecretTitle2', points: 100 });
    expect(list.find((c: any) => c.day_number === 1).state).toBe('COMPLETED');
  });

  it('today endpoint returns only the active challenge', async () => {
    const res = await request(app).get(`/api/programs/${PROGRAM_ID}/today`).set(as('student'));
    expect(res.body.challenge).toMatchObject({ day_number: 2, state: 'ACTIVE' });
  });

  it('a released challenge is readable', async () => {
    const res = await request(app).get(`/api/challenges/${released}`).set(as('student'));
    expect(res.status).toBe(200);
    expect(res.body.challenge.problem_url).toContain('top-secret-slug-2');
  });

  it('draft programs are invisible to students (even by id) but visible to admins', async () => {
    seed('DRAFT');
    expect((await request(app).get(`/api/programs/${PROGRAM_ID}/challenges`).set(as('student'))).status).toBe(404);
    expect((await request(app).get(`/api/challenges/${released}`).set(as('student'))).status).toBe(404);
    expect((await request(app).get(`/api/programs/${PROGRAM_ID}/challenges`).set(as('admin'))).status).toBe(200);
  });

  it('a SCHEDULED program whose start is in the future releases nothing', async () => {
    seed('SCHEDULED');
    st.program.start_date = DateTime.now().setZone(TZ).plus({ days: 5 }).toISODate();
    st.program.end_date = DateTime.now().setZone(TZ).plus({ days: 34 }).toISODate();
    const res = await request(app).get(`/api/programs/${PROGRAM_ID}/challenges`).set(as('student'));
    expect(res.body.challenges.every((c: any) => c.locked)).toBe(true);
    expect((await request(app).get(`/api/challenges/${released}`).set(as('student'))).status).toBe(403);
  });
});

describe('students cannot manipulate points, ranks, submissions, eligibility (Test 16)', () => {
  beforeEach(() => seed());

  it('there is no endpoint that accepts a client-supplied solved/points submission', async () => {
    for (const path of ['/api/submissions', '/api/submission', `/api/challenges/${released}/submit`, `/api/challenges/${released}/solve`]) {
      const res = await request(app).post(path).set(as('student')).send({ solved: true, points: 100 });
      expect([404, 405]).toContain(res.status);
    }
    const put = await request(app).put(`/api/challenges/${released}`).set(as('student')).send({ points: 10000 });
    expect(put.status).toBe(404); // student router has no PUT; the admin one is under /api/admin
  });

  it('PATCH /me ignores privileged fields', async () => {
    const res = await request(app).patch('/api/me').set(as('student')).send({ full_name: 'New Name', role: 'ADMIN', total_points: 99999, leetcode_username: 'someoneelse' });
    expect(res.status).toBe(200);
    expect(st.profileUpdates).toEqual([{ full_name: 'New Name' }]);
    const onlyBad = await request(app).patch('/api/me').set(as('student')).send({ role: 'ADMIN', total_points: 99999 });
    expect(onlyBad.status).toBe(400);
    expect(st.profileUpdates).toHaveLength(1);
  });

  it('every admin route rejects students', async () => {
    const routes: Array<[string, string]> = [
      ['get', '/api/admin/overview'], ['post', '/api/admin/programs'], ['post', '/api/admin/sync'],
      ['post', `/api/admin/programs/${PROGRAM_ID}/certificates/generate`], ['put', `/api/admin/programs/${PROGRAM_ID}/certificate-rules`],
      ['post', `/api/admin/programs/${PROGRAM_ID}/challenges/bulk/import`], ['put', `/api/admin/users/${PROGRAM_ID}/role`],
      ['get', `/api/admin/programs/${PROGRAM_ID}/certificates/eligibility`],
    ];
    for (const [m, p] of routes) {
      const res = await (request(app) as any)[m](p).set(as('student')).send({});
      expect(res.status, `${m} ${p}`).toBe(403);
    }
  });
});

describe('admin bulk upload over HTTP (Test 3)', () => {
  beforeEach(() => seed());
  it('validates a CSV and reports row-level errors without writing anything', async () => {
    const header = 'day_number,title,leetcode_url,category,difficulty,points,release_date,release_time';
    const rows = Array.from({ length: 30 }, (_, i) => `${i + 1},P${i + 1},https://leetcode.com/problems/p-${i + 1}/,Arrays,Easy,100,2026-10-${String(i + 1).padStart(2, '0')},09:00`);
    rows[33 - 4] = '30,Broken,,Arrays,Easy,100,2026-10-30,09:00'; // Missing URL (also duplicates nothing)
    rows[28] = '29,Bad,https://leetcode.com/problems/p-29/,Arrays,Nightmare,100,2026-10-29,09:00';
    const res = await request(app).post(`/api/admin/programs/${PROGRAM_ID}/challenges/bulk/validate`).set(as('admin')).send({ csv: [header, ...rows].join('\n') });
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(28);
    expect(res.body.invalidCount).toBe(2);
    expect(res.body.errors.map((e: any) => e.message)).toEqual(expect.arrayContaining(['Missing LeetCode URL', expect.stringContaining('Invalid difficulty')]));
  });
  it('rejects import containing invalid rows unless skipInvalid is set', async () => {
    const res = await request(app).post(`/api/admin/programs/${PROGRAM_ID}/challenges/bulk/import`).set(as('admin'))
      .send({ rows: [{ day_number: 1, title: 'x', leetcode_url: '', difficulty: 'easy', release_date: '2026-10-01' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.details.invalidCount).toBe(1);
  });
});

describe('misc hardening', () => {
  it('unknown routes 404 with JSON and malformed JSON is a 400', async () => {
    seed();
    expect((await request(app).get('/api/nope').set(as('student'))).status).toBe(404);
    const bad = await request(app).patch('/api/me').set(as('student')).set('Content-Type', 'application/json').send('{bad json');
    expect(bad.status).toBe(400);
  });
  it('health is public', async () => {
    expect((await request(app).get('/api/health')).body.ok).toBe(true);
  });
});

void toInstant; void addHours;
