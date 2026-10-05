// Live end-to-end check against the running API + Supabase. Usage: node scripts/e2e.cjs
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync(__dirname + '/../.env', 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const API = 'http://localhost:4000/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function login(email, password = 'CodeCrafter#2026') {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json(); if (!j.access_token) throw new Error('login failed ' + email + ' ' + JSON.stringify(j)); return j.access_token;
}
const call = async (tok, method, path, body) => { const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };

(async () => {
  const stu = await login('nitesh@students.test'); const adm = await login('admin@codecrafter.test');
  ok('T1 student can log in & read profile', (await call(stu, 'GET', '/me')).j?.profile?.email === 'nitesh@students.test');
  const progs = (await call(stu, 'GET', '/programs')).j.programs;
  const dsa = progs.find((p) => p.slug === '30-days-of-dsa'); const sql = progs.find((p) => p.slug === '15-days-of-sql');
  ok('T2 programs exist (30-day DSA active)', dsa && dsa.effective_status === 'ACTIVE' && dsa.duration_days === 30);
  const list = (await call(stu, 'GET', `/programs/${dsa.id}/challenges`)).j.challenges;
  ok('T3 all 30 challenges uploaded', list.length === 30);
  const rel = list.filter((c) => !c.locked), lock = list.filter((c) => c.locked);
  ok('T4/5 only released days visible (Days 1-6 released today), rest locked', rel.length === 6 && lock.length === 24, `released=${rel.length}`);
  ok('locked days leak nothing', !JSON.stringify(lock).match(/leetcode|title|"points"/i));
  const fut = lock[0];
  const direct = await call(stu, 'GET', `/challenges/${fut.id}`);
  ok('T15 direct API call for future challenge is refused (403 CHALLENGE_LOCKED)', direct.s === 403 && direct.j.error.code === 'CHALLENGE_LOCKED');
  const sqlList = (await call(stu, 'GET', `/programs/${sql.id}/challenges`)).j.challenges;
  ok('scheduled program: everything locked', sqlList.every((c) => c.locked));
  // supabase direct (PostgREST) with student token must not see future challenges either
  const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/challenges?select=day_number`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + stu } });
  const direct2 = await pr.json(); ok('T15b raw Supabase REST also hides future days (RLS)', Array.isArray(direct2) && direct2.every((c) => c.day_number <= 6) && direct2.length >= 6, JSON.stringify(direct2).slice(0, 120));
  // T16 tampering
  const hack = await fetch(`${env.SUPABASE_URL}/rest/v1/program_progress?user_id=eq.${(await call(stu, 'GET', '/me')).j.profile.id}`, { method: 'PATCH', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + stu, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ total_points: 999999 }) });
  const hj = await hack.json(); ok('T16 student cannot raise own points via Supabase REST', Array.isArray(hj) && hj.length === 0, JSON.stringify(hj).slice(0, 100));
  const role = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?email=eq.nitesh@students.test`, { method: 'PATCH', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + stu, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'ADMIN' }) });
  ok('T16 student cannot self-promote to admin', role.status >= 400, 'status ' + role.status);
  ok('T16 student blocked from admin API', (await call(stu, 'GET', '/admin/overview')).s === 403);
  ok('T16 no submission endpoint', [404, 405].includes((await call(stu, 'POST', '/submissions', { solved: true, points: 100 })).s));
  // dashboard / leaderboards
  const dash = (await call(stu, 'GET', '/me/dashboard')).j.programs[0];
  ok('dashboard: progress, rank, streak, today', dash.progress.total === 30 && dash.progress.rank > 0 && dash.today && dash.today.state === 'ACTIVE', JSON.stringify(dash.progress));
  const board = (await call(stu, 'GET', `/programs/${dsa.id}/leaderboard?type=program`)).j;
  ok('T11 program leaderboard ranked & deterministic', board.rows.length === 8 && board.rows.every((r, i) => r.rank === i + 1) && board.rows.every((r, i, a) => i === 0 || a[i - 1].points >= r.points), JSON.stringify(board.rows.map((r) => [r.rank, r.full_name, r.points])));
  const daily = (await call(stu, 'GET', `/programs/${dsa.id}/leaderboard?type=daily`)).j; ok('daily + weekly + overall boards respond', daily.rows !== undefined && (await call(stu, 'GET', `/programs/${dsa.id}/leaderboard?type=weekly`)).s === 200 && (await call(stu, 'GET', '/leaderboard/overall')).s === 200);
  // admin
  const ov = (await call(adm, 'GET', '/admin/overview')).j; ok('admin overview', ov.active_programs >= 1 && ov.total_participants >= 8, JSON.stringify(ov));
  const csv = 'day_number,title,leetcode_url,category,difficulty,points,release_date,release_time\n1,Ok,https://leetcode.com/problems/a/,X,Easy,100,2026-12-01,09:00\n2,Bad,,X,Easy,100,2026-12-02,09:00\n3,Bad2,https://leetcode.com/problems/c/,X,Nope,100,2026-12-03,09:00';
  const v = (await call(adm, 'POST', `/admin/programs/${dsa.id}/challenges/bulk/validate`, { csv })).j; ok('CSV validation reports row errors', v.validCount === 1 && v.invalidCount === 2 && v.errors.some((e) => e.row === 3 && /Missing/.test(e.message)));
  // new program + bulk import all 30, check Day gating of a brand-new future program
  const today = new Date(); const d = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  const np = (await call(adm, 'POST', '/admin/programs', { name: 'E2E Test Program ' + Date.now(), start_date: d(3), duration_days: 30, status: 'SCHEDULED', certificate_enabled: true })).j.program;
  ok('T2 admin creates a 30-day program (end date auto-calculated)', np && np.duration_days === 30 && np.end_date === d(32), JSON.stringify(np)?.slice(0, 150));
  const rows = Array.from({ length: 30 }, (_, i) => ({ day_number: i + 1, title: 'P' + (i + 1), leetcode_url: `https://leetcode.com/problems/p-${i + 1}/`, category: 'Arrays', difficulty: 'Easy', points: '', release_date: d(3 + i), release_time: '09:00' }));
  const imp = (await call(adm, 'POST', `/admin/programs/${np.id}/challenges/bulk/import`, { rows })).j; ok('T3 admin bulk-uploads all 30 at once', imp.imported === 30, JSON.stringify(imp));
  const sv = (await call(stu, 'GET', `/programs/${np.id}/challenges`)); ok('new SCHEDULED program hidden/locked from students', sv.s === 200 && sv.j.challenges.every((c) => c.locked));
  await call(adm, 'PUT', `/admin/programs/${np.id}/certificate-rules`, { min_challenges: 27, min_completion_pct: 90, min_points: 2500, max_missed_days: 3 });
  const rules = (await call(adm, 'GET', `/admin/programs/${np.id}/certificate-rules`)).j.rules; ok('T12 certificate criteria configurable', rules.min_challenges === 27 && rules.min_points === 2500 && rules.max_missed_days === 3);
  // eligibility on seeded program with strict rules -> nobody has 27 yet
  const el = (await call(adm, 'GET', `/admin/programs/${dsa.id}/certificates/eligibility`)).j; ok('T13 eligibility engine (27/30 rule excludes everyone mid-program)', el.eligible === 0 && el.not_eligible === 8, `${el.eligible}/${el.not_eligible}`);
  const gen = await call(adm, 'POST', `/admin/programs/${dsa.id}/certificates/generate`); ok('certificates refused before program completes', gen.s === 409);
  // relax rules & force generate to test PDF + storage + verify
  await call(adm, 'PUT', `/admin/programs/${dsa.id}/certificate-rules`, { min_challenges: 3, min_completion_pct: null, min_points: null, max_missed_days: null });
  const g2 = await call(adm, 'POST', `/admin/programs/${dsa.id}/certificates/generate?force=true`); ok('T13/14 certificates generated for eligible only', g2.s === 200 && g2.j.issued > 0, JSON.stringify(g2.j));
  const certs = (await call(adm, 'GET', `/admin/programs/${dsa.id}/certificates`)).j.certificates;
  ok('T14 unique verification IDs', certs.length === g2.j.issued && new Set(certs.map((c) => c.certificate_code)).size === certs.length && certs.every((c) => /^CC-DSA-\d{4}-\d{6}$/.test(c.certificate_code)), certs.map((c) => c.certificate_code).join());
  const vr = await call(null, 'GET', `/verify/${certs[0].certificate_code}`); ok('public verify (no login) shows name+program only', vr.s === 200 && vr.j.verified && !JSON.stringify(vr.j).match(/email|leetcode_username|user_id/), JSON.stringify(vr.j));
  ok('bogus certificate id -> not verified', (await call(null, 'GET', '/verify/CC-DSA-2026-999999')).s === 404);
  const dl = await call(adm, 'GET', `/admin/certificates/${certs[0].id}/download`); const pdf = dl.j?.url && await fetch(dl.j.url); ok('PDF stored in Supabase Storage & downloadable', pdf && pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 5000);
  const g3 = await call(adm, 'POST', `/admin/programs/${dsa.id}/certificates/generate?force=true`); ok('generating again issues no duplicates', g3.j.issued === 0);
  // sync
  const s1 = await call(adm, 'POST', '/admin/sync', { program_id: dsa.id }); ok('T9 admin can trigger manual sync', s1.s === 202 && s1.j.started === 1, JSON.stringify(s1.j).slice(0, 150));
  let log; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1500)); log = (await call(adm, 'GET', `/admin/sync/logs?program_id=${dsa.id}&limit=1`)).j.logs[0]; if (log && log.status !== 'RUNNING') break; }
  ok('sync finished & logged (demo LeetCode users have no solves -> 0 new)', log && ['SUCCESS', 'PARTIAL'].includes(log.status) && log.participants_checked === 8, JSON.stringify(log)?.slice(0, 250));
  const before = (await call(stu, 'GET', `/programs/${dsa.id}/leaderboard?type=program`)).j.rows.map((r) => r.points).join();
  await call(adm, 'POST', '/admin/sync', { program_id: dsa.id }); await new Promise((r) => setTimeout(r, 12000));
  const after = (await call(stu, 'GET', `/programs/${dsa.id}/leaderboard?type=program`)).j.rows.map((r) => r.points).join(); ok('T8 re-running sync does not change points', before === after, before + ' vs ' + after);
  const st = (await call(adm, 'GET', '/admin/sync/status')).j; ok('T10 scheduled sync armed with next run', !!st.next_run && st.settings.enabled, JSON.stringify(st.next_run));
  const set = await call(adm, 'PUT', '/admin/sync/settings', { mode: 'BOTH', enabled: true, time: '22:30', timezone: 'Asia/Kolkata', frequency: 'DAILY' }); ok('sync schedule configurable', set.s === 200);
  await call(adm, 'PUT', '/admin/sync/settings', { mode: 'BOTH', enabled: true, time: '23:00', timezone: 'Asia/Kolkata', frequency: 'DAILY' });
  const an = await call(adm, 'GET', `/admin/programs/${dsa.id}/analytics`); ok('analytics', an.s === 200 && an.j.per_challenge.length === 6);
  const part = (await call(adm, 'GET', '/admin/participants?q=nitesh&level=DEGREE')).j; ok('participant search by name/level', part.items.length >= 1);
  // cleanup test program
  await call(adm, 'DELETE', `/admin/programs/${np.id}`);
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error('E2E crashed', e); process.exit(1); });
