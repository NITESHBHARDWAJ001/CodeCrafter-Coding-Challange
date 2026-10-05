import { LeetCodeClient } from '../src/leetcode/leetcode.client';
import { LeetCodeService } from '../src/leetcode/leetcode.service';
(async () => {
  const s = new LeetCodeService(new LeetCodeClient({ url: 'https://leetcode.com/graphql', timeoutMs: 10000, maxRetries: 2, requestsPerSecond: 2 }), { cacheTtlMs: 0 });
  const u = process.argv[2];
  const p = await s.getProfileSummary(u);
  console.log('exists:', p.exists, '| about-me:', JSON.stringify(p.aboutMe.slice(0, 80)));
  for (const x of await s.getUserRecentSubmissions(u)) console.log(x.submittedAt.toISOString().replace('T', ' ').slice(0, 16), '|', x.problemSlug);
})();
