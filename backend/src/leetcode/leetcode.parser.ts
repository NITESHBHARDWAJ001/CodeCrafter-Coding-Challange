import { LeetCodeSchemaError, LeetCodeSubmission } from './leetcode.types';

/**
 * Parsing is deliberately strict. If LeetCode changes its payload we want a loud per-user failure in the sync
 * log, never a silent "0 solves" that would look like users stopped solving.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function graphqlErrors(body: unknown): string[] {
  if (isObj(body) && Array.isArray(body.errors))
    return body.errors.map((e) => (isObj(e) && typeof e.message === 'string' ? e.message : 'unknown error'));
  return [];
}

export function parseRecentAccepted(body: unknown): LeetCodeSubmission[] {
  if (!isObj(body)) throw new LeetCodeSchemaError('Response is not a JSON object');
  const errs = graphqlErrors(body);
  if (errs.length) throw new LeetCodeSchemaError(`GraphQL error: ${errs.join('; ')}`);
  const list = isObj(body.data) ? body.data.recentAcSubmissionList : undefined;
  if (!Array.isArray(list)) throw new LeetCodeSchemaError('recentAcSubmissionList missing or not an array');

  return list.map((item, i) => {
    if (!isObj(item)) throw new LeetCodeSchemaError(`Submission #${i} is not an object`);
    const { id, title, titleSlug, timestamp } = item;
    const ts = Number(timestamp);
    if (typeof titleSlug !== 'string' || !titleSlug) throw new LeetCodeSchemaError(`Submission #${i} has no titleSlug`);
    if (!Number.isFinite(ts) || ts <= 0) throw new LeetCodeSchemaError(`Submission #${i} has an invalid timestamp`);
    return {
      id: String(id ?? ''),
      title: typeof title === 'string' ? title : titleSlug,
      problemSlug: titleSlug.toLowerCase(),
      status: 'ACCEPTED' as const,
      submittedAt: new Date(ts * 1000), // epoch seconds
    };
  });
}

export interface ParsedUser { exists: boolean; aboutMe: string }

export function parseMatchedUser(body: unknown): ParsedUser {
  if (!isObj(body)) throw new LeetCodeSchemaError('Response is not a JSON object');
  const errs = graphqlErrors(body);
  if (errs.some((m) => /does not exist/i.test(m))) return { exists: false, aboutMe: '' };
  if (errs.length) throw new LeetCodeSchemaError(`GraphQL error: ${errs.join('; ')}`);
  const data = isObj(body.data) ? body.data : undefined;
  if (!data || !('matchedUser' in data)) throw new LeetCodeSchemaError('matchedUser missing from response');
  const u = data.matchedUser;
  if (u === null) return { exists: false, aboutMe: '' };
  if (!isObj(u)) throw new LeetCodeSchemaError('matchedUser has unexpected shape');
  const about = isObj(u.profile) && typeof u.profile.aboutMe === 'string' ? u.profile.aboutMe : '';
  return { exists: true, aboutMe: about };
}
