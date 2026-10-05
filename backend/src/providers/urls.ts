import type { ChallengeProvider } from '../types/db';

interface Parsed { provider: ChallengeProvider; externalId: string }

const LEETCODE = /^https?:\/\/(?:www\.)?leetcode\.(?:com|cn)\/problems\/([a-z0-9][a-z0-9-]*)\/?(?:[?#/].*)?$/i;

/** Pure URL -> {provider, externalId}. Add other providers here as they are supported. */
export function parseProblemUrl(url: string): Parsed | null {
  const lc = LEETCODE.exec(url.trim());
  if (lc) return { provider: 'LEETCODE', externalId: lc[1].toLowerCase() };
  return null;
}
