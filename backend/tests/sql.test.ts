import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migrations on a real Postgres engine (PGlite) with a minimal stand-in for Supabase's `auth` schema,
 * then exercises constraints, ranking functions and Row Level Security as an end-user role.
 */
const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
let db: PGlite;

const U = { a: '00000000-0000-4000-8000-0000000000a1', b: '00000000-0000-4000-8000-0000000000b2', c: '00000000-0000-4000-8000-0000000000c3', admin: '00000000-0000-4000-8000-0000000000ad' };
const P = '10000000-0000-4000-8000-000000000001';
const DRAFT = '10000000-0000-4000-8000-000000000002';
const CH = { past: '20000000-0000-4000-8000-000000000001', now: '20000000-0000-4000-8000-000000000002', future: '20000000-0000-4000-8000-000000000003' };

async function asUser(id: string | null, fn: () => Promise<void>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id ?? ''}', false), set_config('request.jwt.claim.role', 'authenticated', false);`);
  try { await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`); }
}
const q = async <T = any>(sql: string, params: any[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create role authenticated; create role service_role; create role anon;
    grant usage on schema public, auth to authenticated, service_role;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    alter default privileges in schema public grant all on sequences to authenticated, service_role;
  `);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  await db.exec(`grant all on all tables in schema public to authenticated, service_role; grant usage on schema auth to authenticated; grant execute on function auth.uid(), auth.role() to authenticated;`);

  const users = [[U.a, 'Aman', 'aman', 'DEGREE', 'STUDENT'], [U.b, 'Rahul', 'rahul', 'DIPLOMA', 'STUDENT'], [U.c, 'Nitesh', 'nitesh', 'DEGREE', 'STUDENT'], [U.admin, 'Admin', 'admin', 'DEGREE', 'ADMIN']];
  for (const [id, name, lc, level, role] of users) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into profiles (id, full_name, email, leetcode_username, level, role) values ($1,$2,$3,$4,$5,$6)', [id, name, `${lc}@x.edu`, lc, level, role]);
  }
  await db.query(`insert into programs (id, name, slug, start_date, end_date, duration_days, status) values
    ($1, 'DSA', 'dsa', current_date - 2, current_date + 27, 30, 'ACTIVE'), ($2, 'Secret Draft', 'draft', current_date + 10, current_date + 40, 30, 'DRAFT')`, [P, DRAFT]);
  const ch = (id: string, day: number, rel: string, prog = P) =>
    db.query(`insert into challenges (id, program_id, day_number, title, external_problem_id, external_problem_url, difficulty, release_at, closes_at)
              values ($1,$2,$3::int,'T'||$3::text,'slug-'||$3::text,'https://leetcode.com/problems/slug-'||$3::text||'/','EASY', now() + $4::interval, now() + $4::interval + interval '24 hours')`, [id, prog, day, rel]);
  await ch(CH.past, 1, '-30 hours'); await ch(CH.now, 2, '-2 hours'); await ch(CH.future, 3, '20 hours');
  await ch('20000000-0000-4000-8000-000000000009', 1, '-1 hour', DRAFT);
  for (const u of [U.a, U.b, U.c]) await db.query(`insert into program_participants (program_id, user_id) values ($1,$2)`, [P, u]);
});
afterAll(async () => { await db.close(); });

describe('schema constraints', () => {
  it('Test 8 backstop: a second submission for the same (challenge, user) is rejected by the database', async () => {
    const ins = () => db.query(`insert into challenge_submissions (challenge_id, program_id, user_id, provider, verified_username, submitted_at, awarded_points)
                               values ($1,$2,$3,'LEETCODE','aman', now(), 100)`, [CH.now, P, U.a]);
    await ins();
    await expect(ins()).rejects.toThrow(/unique|duplicate/i);
    expect((await q('select count(*)::int n from challenge_submissions where user_id=$1', [U.a]))[0].n).toBe(1);
  });
  it('LeetCode usernames and emails are unique case-insensitively', async () => {
    await expect(db.query(`insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000e1')`).then(() =>
      db.query(`insert into profiles (id, full_name, email, leetcode_username, level) values ('00000000-0000-4000-8000-0000000000e1','Dup','DUP@x.edu','AMAN','DEGREE')`))).rejects.toThrow(/unique|duplicate/i);
  });
  it('rejects bad data: end before start, negative points, invalid username', async () => {
    await expect(db.query(`insert into programs (name, slug, start_date, end_date, duration_days) values ('x','x-bad', '2026-10-10', '2026-10-01', 1)`)).rejects.toThrow();
    await expect(db.query(`insert into challenge_submissions (challenge_id, program_id, user_id, provider, verified_username, submitted_at, awarded_points) values ($1,$2,$3,'LEETCODE','x', now(), -5)`, [CH.past, P, U.b])).rejects.toThrow();
    await expect(db.query(`update profiles set leetcode_username='bad name!' where id=$1`, [U.b])).rejects.toThrow();
  });
  it('certificate codes are unique and well-formed', async () => {
    const [a, b] = [(await q(`select next_certificate_code('dsa') c`))[0].c, (await q(`select next_certificate_code('dsa') c`))[0].c];
    expect(a).toMatch(/^CC-DSA-\d{4}-\d{6}$/);
    expect(a).not.toBe(b);
  });
  it('one certificate per user per program', async () => {
    const ins = (code: string) => db.query(`insert into certificates (certificate_code, program_id, user_id, recipient_name, program_name, challenges_completed, total_challenges) values ($1,$2,$3,'A','DSA',29,30)`, [code, P, U.a]);
    await ins('CC-DSA-2026-000001');
    await expect(ins('CC-DSA-2026-000002')).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('leaderboards: deterministic tie-breaking (points DESC, solved DESC, earliest ASC)', () => {
  it('orders and ranks correctly', async () => {
    await db.exec(`delete from program_progress`);
    const row = (u: string, solved: number, pts: number, mins: number) =>
      db.query(`insert into program_progress (program_id, user_id, solved_count, total_points, last_solved_at) values ($1,$2,$3,$4, now() - ($5 || ' minutes')::interval)`, [P, u, solved, pts, mins]);
    await row(U.a, 3, 300, 10);  // tie on points & solved with c; a reached it LATER (10 min ago vs 50)
    await row(U.c, 3, 300, 50);  // => c ranks above a
    await row(U.b, 5, 250, 5);   // fewer points, more solves => still below
    const board = await q('select rank::int, full_name from program_leaderboard($1, 10, 0)', [P]);
    expect(board.map((r) => [r.rank, r.full_name])).toEqual([[1, 'Nitesh'], [2, 'Aman'], [3, 'Rahul']]);
    const page2 = await q('select rank::int, full_name from program_leaderboard($1, 1, 1)', [P]);
    expect(page2).toEqual([{ rank: 2, full_name: 'Aman' }]); // ranks computed before paginating
    expect((await q('select program_rank($1,$2)::int r', [P, U.b]))[0].r).toBe(3);
  });
  it('daily leaderboard orders by earliest solve; weekly sums awarded points', async () => {
    await db.exec(`delete from challenge_submissions`);
    const sub = (u: string, ch: string, minsAgo: number, pts: number) =>
      db.query(`insert into challenge_submissions (challenge_id, program_id, user_id, provider, verified_username, submitted_at, awarded_points) values ($1,$2,$3,'LEETCODE','x', now() - ($4 || ' minutes')::interval, $5)`, [ch, P, u, minsAgo, pts]);
    await sub(U.b, CH.now, 90, 100); await sub(U.a, CH.now, 30, 100); await sub(U.a, CH.past, 600, 100);
    expect((await q('select rank::int, full_name from challenge_leaderboard($1, 10, 0)', [CH.now])).map((r) => r.full_name)).toEqual(['Rahul', 'Aman']);
    const wk = await q('select full_name, points from weekly_leaderboard($1, now() - interval \'7 days\', 10, 0)', [P]);
    expect(wk[0]).toMatchObject({ full_name: 'Aman', points: 200 });
  });
  it('overall leaderboard aggregates across programs', async () => {
    const rows = await q('select full_name from overall_leaderboard(10, 0)');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('Row Level Security (Test 16 at the database layer)', () => {
  it('students only see released challenges of visible programs', async () => {
    await asUser(U.a, async () => {
      const rows = await q('select id from challenges order by day_number');
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(CH.past);
      expect(ids).toContain(CH.now);
      expect(ids).not.toContain(CH.future);                                   // future day hidden even to a raw query
      expect(ids).not.toContain('20000000-0000-4000-8000-000000000009');      // draft program's challenge hidden
    });
  });
  it('students cannot see draft programs, admins can', async () => {
    await asUser(U.a, async () => { expect((await q('select id from programs')).map((r) => r.id)).toEqual([P]); });
    await asUser(U.admin, async () => { expect((await q('select id from programs')).length).toBe(2); });
    await asUser(U.admin, async () => { expect((await q('select id from challenges')).map((r) => r.id)).toContain(CH.future); });
  });
  it('students cannot forge a solve, points, progress or certificate', async () => {
    await asUser(U.b, async () => {
      await expect(db.query(`insert into challenge_submissions (challenge_id, program_id, user_id, provider, verified_username, submitted_at, awarded_points) values ($1,$2,$3,'LEETCODE','rahul', now(), 9999)`, [CH.past, P, U.b])).rejects.toThrow(/row-level security/i);
      await expect(db.query(`insert into program_progress (program_id, user_id, total_points) values ($1,$2,9999) on conflict (program_id, user_id) do update set total_points = 9999`, [P, U.b])).rejects.toThrow(/row-level security/i);
      await expect(db.query(`insert into certificates (certificate_code, program_id, user_id, recipient_name, program_name, challenges_completed, total_challenges) values ('CC-FAKE-2026-000001',$1,$2,'x','x',30,30)`, [P, U.b])).rejects.toThrow(/row-level security/i);
      await db.query(`update program_progress set total_points = 9999 where user_id = $1`, [U.b]);       // no UPDATE policy => 0 rows
      await db.query(`update challenge_submissions set awarded_points = 9999`);
      await db.query(`update challenges set release_at = now() - interval '1 year'`);                    // cannot unlock the future
      await db.query(`update programs set status = 'COMPLETED'`);
    });
    expect((await q('select total_points from program_progress where user_id = $1', [U.b]))[0].total_points).toBe(250);
    expect((await q('select max(awarded_points)::int m from challenge_submissions'))[0].m).toBe(100);
    expect((await q('select count(*)::int n from challenges where release_at < now() - interval \'100 days\''))[0].n).toBe(0);
    expect((await q(`select status from programs where id = $1`, [P]))[0].status).toBe('ACTIVE');
  });
  it('students only read their own submissions/progress', async () => {
    await asUser(U.a, async () => {
      expect((await q('select distinct user_id from challenge_submissions')).map((r) => r.user_id)).toEqual([U.a]);
      expect((await q('select distinct user_id from program_progress')).map((r) => r.user_id)).toEqual([U.a]);
    });
  });
  it('students cannot change role, email or LeetCode username, but can edit their name', async () => {
    await asUser(U.a, async () => {
      await expect(db.query(`update profiles set role='ADMIN' where id=$1`, [U.a])).rejects.toThrow(/cannot be changed/i);
      await expect(db.query(`update profiles set leetcode_username='hacker' where id=$1`, [U.a])).rejects.toThrow(/cannot be changed/i);
      await expect(db.query(`update profiles set email='x@y.z' where id=$1`, [U.a])).rejects.toThrow(/cannot be changed/i);
      await db.query(`update profiles set full_name='Aman Q' where id=$1`, [U.a]);
      await db.query(`update profiles set full_name='Pwned' where id=$1`, [U.b]); // other user's row: 0 rows
    });
    expect((await q('select full_name from profiles where id=$1', [U.a]))[0].full_name).toBe('Aman Q');
    expect((await q('select full_name from profiles where id=$1', [U.b]))[0].full_name).toBe('Rahul');
  });
  it('students cannot read other profiles, sync logs or settings; admins can', async () => {
    await db.query(`insert into sync_logs (program_id, sync_type, status) values ($1,'MANUAL','SUCCESS')`, [P]);
    await asUser(U.a, async () => {
      expect((await q('select id from profiles')).map((r) => r.id)).toEqual([U.a]);
      expect(await q('select * from sync_logs')).toHaveLength(0);
      expect(await q('select * from app_settings')).toHaveLength(0);
    });
    await asUser(U.admin, async () => {
      expect((await q('select id from profiles')).length).toBe(4);
      expect((await q('select * from sync_logs')).length).toBe(1);
      expect((await q('select * from app_settings')).length).toBe(1);
    });
  });
  it('students cannot mint certificate codes', async () => {
    await asUser(U.a, async () => { await expect(q(`select next_certificate_code('x')`)).rejects.toThrow(/permission denied/i); });
  });
  it('students can read the public leaderboard function', async () => {
    await asUser(U.a, async () => { expect((await q('select * from program_leaderboard($1, 5, 0)', [P])).length).toBe(3); });
  });
});
