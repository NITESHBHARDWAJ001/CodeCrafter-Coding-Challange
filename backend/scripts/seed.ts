/**
 * Demo data for local development:  npm run seed
 *  - 1 admin + 8 demo students (Supabase Auth users + profiles)
 *  - "30 Days of DSA": started 5 days ago, 30 real LeetCode problems, Days 1-5 released, 6-30 locked
 *  - "15 Days of SQL": scheduled to start in 10 days (everything locked)
 *  - simulated verified solves for Days 1-4 so leaderboards/streaks have something to show
 * Safe to re-run (idempotent). Demo LeetCode usernames do not exist, so a real sync will simply find nothing for them.
 * Never run against production.
 */
import { DateTime } from 'luxon';
import { admin } from '../src/lib/supabase';
import { profilesRepo } from '../src/repositories/profiles.repo';
import { programsRepo } from '../src/repositories/programs.repo';
import { participantsRepo } from '../src/repositories/participants.repo';
import { challengesRepo } from '../src/repositories/challenges.repo';
import { submissionsRepo } from '../src/repositories/submissions.repo';
import { programService } from '../src/services/program.service';
import { challengeService } from '../src/services/challenge.service';
import { progressService } from '../src/services/progress.service';
import { toInstant } from '../src/domain/time';
import type { Profile } from '../src/types/db';

const PASSWORD = process.env.SEED_PASSWORD ?? 'CodeCrafter#2026';
const TZ = 'Asia/Kolkata';

const DSA: Array<[string, string, string, 'Easy' | 'Medium' | 'Hard']> = [
  ['Two Sum', 'two-sum', 'Arrays', 'Easy'], ['Valid Parentheses', 'valid-parentheses', 'Stack', 'Easy'],
  ['Binary Search', 'binary-search', 'Binary Search', 'Easy'], ['Merge Two Sorted Lists', 'merge-two-sorted-lists', 'Linked List', 'Easy'],
  ['Best Time to Buy and Sell Stock', 'best-time-to-buy-and-sell-stock', 'Arrays', 'Easy'], ['Valid Anagram', 'valid-anagram', 'Hashing', 'Easy'],
  ['Invert Binary Tree', 'invert-binary-tree', 'Trees', 'Easy'], ['Maximum Subarray', 'maximum-subarray', 'Dynamic Programming', 'Medium'],
  ['Climbing Stairs', 'climbing-stairs', 'Dynamic Programming', 'Easy'], ['Contains Duplicate', 'contains-duplicate', 'Hashing', 'Easy'],
  ['Product of Array Except Self', 'product-of-array-except-self', 'Arrays', 'Medium'], ['3Sum', '3sum', 'Two Pointers', 'Medium'],
  ['Container With Most Water', 'container-with-most-water', 'Two Pointers', 'Medium'], ['Group Anagrams', 'group-anagrams', 'Hashing', 'Medium'],
  ['Binary Tree Level Order Traversal', 'binary-tree-level-order-traversal', 'Trees', 'Medium'], ['Number of Islands', 'number-of-islands', 'Graphs', 'Medium'],
  ['Coin Change', 'coin-change', 'Dynamic Programming', 'Medium'], ['Longest Increasing Subsequence', 'longest-increasing-subsequence', 'Dynamic Programming', 'Medium'],
  ['Reverse Linked List', 'reverse-linked-list', 'Linked List', 'Easy'], ['Linked List Cycle', 'linked-list-cycle', 'Linked List', 'Easy'],
  ['Top K Frequent Elements', 'top-k-frequent-elements', 'Heap', 'Medium'], ['Course Schedule', 'course-schedule', 'Graphs', 'Medium'],
  ['Validate Binary Search Tree', 'validate-binary-search-tree', 'Trees', 'Medium'], ['Word Search', 'word-search', 'Backtracking', 'Medium'],
  ['Merge Intervals', 'merge-intervals', 'Intervals', 'Medium'], ['Rotting Oranges', 'rotting-oranges', 'Graphs', 'Medium'],
  ['Trapping Rain Water', 'trapping-rain-water', 'Two Pointers', 'Hard'], ['Median of Two Sorted Arrays', 'median-of-two-sorted-arrays', 'Binary Search', 'Hard'],
  ['Word Ladder', 'word-ladder', 'Graphs', 'Hard'], ['Merge k Sorted Lists', 'merge-k-sorted-lists', 'Heap', 'Hard'],
];
const SQL: Array<[string, string, string, 'Easy' | 'Medium' | 'Hard']> = [
  ['Combine Two Tables', 'combine-two-tables', 'Joins', 'Easy'], ['Second Highest Salary', 'second-highest-salary', 'Aggregation', 'Medium'],
  ['Employees Earning More Than Their Managers', 'employees-earning-more-than-their-managers', 'Joins', 'Easy'], ['Duplicate Emails', 'duplicate-emails', 'Aggregation', 'Easy'],
  ['Customers Who Never Order', 'customers-who-never-order', 'Joins', 'Easy'], ['Department Highest Salary', 'department-highest-salary', 'Joins', 'Medium'],
  ['Rank Scores', 'rank-scores', 'Window Functions', 'Medium'], ['Consecutive Numbers', 'consecutive-numbers', 'Window Functions', 'Medium'],
  ['Delete Duplicate Emails', 'delete-duplicate-emails', 'DML', 'Easy'], ['Rising Temperature', 'rising-temperature', 'Joins', 'Easy'],
  ['Trips and Users', 'trips-and-users', 'Joins', 'Hard'], ['Human Traffic of Stadium', 'human-traffic-of-stadium', 'Window Functions', 'Hard'],
  ['Exchange Seats', 'exchange-seats', 'Conditional', 'Medium'], ['Nth Highest Salary', 'nth-highest-salary', 'Aggregation', 'Medium'],
  ['Department Top Three Salaries', 'department-top-three-salaries', 'Window Functions', 'Hard'],
];

async function upsertUser(email: string, name: string, lc: string, level: Profile['level'], role: Profile['role']): Promise<Profile> {
  const existing = await profilesRepo.findByEmail(email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return profilesRepo.insert({ id: data.user.id, full_name: name, email, leetcode_username: lc, level, role });
}

async function seedChallenges(programId: string, list: typeof DSA, firstReleaseDate: string) {
  const start = DateTime.fromISO(firstReleaseDate, { zone: TZ });
  const csvRows = list.map(([title, slug, category, difficulty], i) => ({
    day_number: i + 1, title, leetcode_url: `https://leetcode.com/problems/${slug}/`, category, difficulty,
    points: difficulty === 'Hard' && i === list.length - 1 ? 300 : '', // one admin override as a demo
    release_date: start.plus({ days: i }).toISODate()!, release_time: '09:00',
  }));
  const r = await challengeService.importRows(programId, { rows: csvRows, skipInvalid: false, onConflict: 'skip' });
  console.log(`  challenges imported: ${r.imported}, skipped: ${r.skipped.length}`);
}

async function main() {
  console.log('Seeding demo data…');
  const adminUser = await upsertUser('admin@codecrafter.test', 'Club Admin', 'cc_admin_demo', 'DEGREE', 'ADMIN');
  const students = await Promise.all([
    ['rahul@students.test', 'Rahul Verma', 'demo_rahul', 'DEGREE'], ['aman@students.test', 'Aman Gupta', 'demo_aman', 'DIPLOMA'],
    ['nitesh@students.test', 'Nitesh Sharma', 'demo_nitesh', 'DEGREE'], ['priya@students.test', 'Priya Nair', 'demo_priya', 'FOUNDATION'],
    ['ishita@students.test', 'Ishita Rao', 'demo_ishita', 'DEGREE'], ['karthik@students.test', 'Karthik S', 'demo_karthik', 'DIPLOMA'],
    ['meera@students.test', 'Meera Iyer', 'demo_meera', 'FOUNDATION'], ['vikram@students.test', 'Vikram Patel', 'demo_vikram', 'DEGREE'],
  ].map(([e, n, lc, lv]) => upsertUser(e, n, lc, lv as Profile['level'], 'STUDENT')));

  const today = DateTime.now().setZone(TZ).startOf('day');

  // ── program 1: active
  let dsa = await programsRepo.getBySlug('30-days-of-dsa');
  if (!dsa) {
    dsa = await programService.create({
      name: '30 Days of DSA', slug: '30-days-of-dsa', description: 'One carefully chosen LeetCode problem every day. Build the habit, climb the board, earn a verifiable certificate.',
      start_date: today.minus({ days: 5 }).toISODate()!, duration_days: 30, status: 'ACTIVE', enrollment_open: true, timezone: TZ,
      challenge_window_hours: 24, streak_policy: 'GRACE_DAYS', streak_grace_days: 1, certificate_enabled: true, certificate_prefix: 'DSA',
    } as never, adminUser.id);
    await programsRepo.upsertRules({ program_id: dsa.id, min_challenges: 27, min_completion_pct: 90, min_points: null, max_missed_days: 3 });
    await seedChallenges(dsa.id, DSA, dsa.start_date);
  }
  for (const s of students) await participantsRepo.enroll(dsa.id, s.id);

  // ── simulated verified solves: [student index, days solved]
  const challenges = await challengesRepo.listByProgram(dsa.id);
  const plan: Record<number, number[]> = { 0: [1, 2, 3, 4], 1: [1, 2, 3], 2: [1, 2, 4], 3: [2, 3, 4], 4: [1, 2, 3, 4, 5], 5: [1], 6: [], 7: [3, 4] };
  const existing = new Set((await submissionsRepo.listByProgram(dsa.id)).map((s) => `${s.user_id}:${s.challenge_id}`));
  const rows = [];
  for (const [idx, days] of Object.entries(plan)) {
    const u = students[Number(idx)];
    for (const d of days) {
      const c = challenges.find((x) => x.day_number === d)!;
      if (existing.has(`${u.id}:${c.id}`)) continue;
      const solvedAt = new Date(new Date(c.release_at).getTime() + (30 + Number(idx) * 37 + d * 11) * 60_000);
      rows.push({
        challenge_id: c.id, program_id: dsa.id, user_id: u.id, provider: 'LEETCODE' as const, external_submission_id: `demo-${idx}-${d}`,
        verified_username: u.leetcode_username, submitted_at: solvedAt.toISOString(),
        awarded_points: c.points_override ?? ({ EASY: 100, MEDIUM: 150, HARD: 250 } as const)[c.difficulty],
      });
    }
  }
  const inserted = await submissionsRepo.insertNew(rows);
  console.log(`  demo solves inserted: ${inserted.length}`);
  await progressService.recomputeProgram(dsa.id);

  // ── program 2: scheduled
  let sql = await programsRepo.getBySlug('15-days-of-sql');
  if (!sql) {
    sql = await programService.create({
      name: '15 Days of SQL', slug: '15-days-of-sql', description: 'Joins, aggregations and window functions, one query a day.',
      start_date: today.plus({ days: 10 }).toISODate()!, duration_days: 15, status: 'SCHEDULED', enrollment_open: true, timezone: TZ,
      challenge_window_hours: 24, streak_policy: 'RESET_ON_MISS', streak_grace_days: 0, certificate_enabled: true, certificate_prefix: 'SQL',
    } as never, adminUser.id);
    await seedChallenges(sql.id, SQL, sql.start_date);
  }

  console.log('\nDone.');
  console.log('  Admin   : admin@codecrafter.test');
  console.log('  Students: rahul@students.test, aman@students.test, nitesh@students.test, …');
  console.log(`  Password: ${PASSWORD}   (override with SEED_PASSWORD; local/dev only)`);
  void toInstant;
}

main().catch((e) => { console.error(e); process.exit(1); });
