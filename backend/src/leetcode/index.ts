import { env } from '../config/env';
import { LeetCodeClient } from './leetcode.client';
import { LeetCodeService } from './leetcode.service';

export const leetCodeService = new LeetCodeService(
  new LeetCodeClient({
    url: env.LEETCODE_GRAPHQL_URL,
    timeoutMs: env.LEETCODE_TIMEOUT_MS,
    maxRetries: env.LEETCODE_MAX_RETRIES,
    requestsPerSecond: env.LEETCODE_REQUESTS_PER_SECOND,
  }),
  { cacheTtlMs: env.LEETCODE_CACHE_TTL_SECONDS * 1000 },
);

export { LeetCodeService } from './leetcode.service';
export { LeetCodeClient } from './leetcode.client';
