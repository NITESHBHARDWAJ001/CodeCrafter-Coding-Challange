/** Live check of the LeetCode integration: `npm run smoke:leetcode -- <username> [slug]` */
import { LeetCodeClient } from '../src/leetcode/leetcode.client';
import { LeetCodeService } from '../src/leetcode/leetcode.service';

async function main() {
  const username = process.argv[2] ?? 'lee215';
  const svc = new LeetCodeService(
    new LeetCodeClient({ url: 'https://leetcode.com/graphql', timeoutMs: 10_000, maxRetries: 2, requestsPerSecond: 2 }),
    { cacheTtlMs: 60_000 },
  );
  console.log('user exists      :', await svc.userExists(username));
  console.log('ghost user exists:', await svc.userExists('zz_no_such_user_cc_98765'));
  const recent = await svc.getUserRecentSubmissions(username);
  console.log(`recent accepted  : ${recent.length} (newest ${recent[0]?.submittedAt.toISOString()}, oldest ${recent.at(-1)?.submittedAt.toISOString()})`);
  const slug = process.argv[3] ?? recent[0]?.problemSlug;
  if (slug && recent[0]) {
    const t = recent[0].submittedAt;
    const hit = await svc.verifyChallengeSubmission(username, slug, new Date(t.getTime() - 3600_000), new Date(t.getTime() + 3600_000));
    const miss = await svc.verifyChallengeSubmission(username, slug, new Date('2020-01-01'), new Date('2020-01-02'));
    console.log(`verify in-window : ${JSON.stringify(hit)}`);
    console.log(`verify 2020      : ${JSON.stringify(miss)}`);
  }
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
