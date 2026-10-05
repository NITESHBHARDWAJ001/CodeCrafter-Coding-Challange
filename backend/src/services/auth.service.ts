import { z } from 'zod';
import { env, list } from '../config/env';
import { admin } from '../lib/supabase';
import { AppError, badRequest, conflict, unauthorized, unavailable } from '../lib/errors';
import { profilesRepo } from '../repositories/profiles.repo';
import { getSubmissionProvider } from '../providers/registry';
import { LeetCodeSchemaError, LeetCodeTransientError } from '../leetcode/leetcode.types';
import type { Profile } from '../types/db';
import { logger } from '../lib/logger';

export const LEETCODE_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;

export const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  leetcode_username: z.string().trim().regex(LEETCODE_USERNAME, 'Invalid LeetCode username'),
  level: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(['FOUNDATION', 'DIPLOMA', 'DEGREE'])),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Wraps LeetCode lookups so transient failures become a clean 503 instead of a confusing 500. */
export async function leetcodeUserExists(username: string): Promise<boolean> {
  try {
    return await getSubmissionProvider('LEETCODE').userExists(username);
  } catch (e) {
    if (e instanceof LeetCodeTransientError || e instanceof LeetCodeSchemaError)
      throw unavailable('Could not reach LeetCode to verify the username right now. Please try again shortly.');
    throw e;
  }
}

export const authService = {
  async register(input: RegisterInput): Promise<{ profile: Profile; emailConfirmationRequired: boolean }> {
    const domains = list(env.ALLOWED_EMAIL_DOMAINS);
    if (domains.length) {
      const domain = input.email.split('@')[1];
      if (!domains.includes(domain)) throw badRequest(`Please use your student email (${domains.join(', ')})`);
    }
    if (await profilesRepo.findByEmail(input.email)) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
    if (await profilesRepo.findByLeetCode(input.leetcode_username))
      throw conflict('This LeetCode username is already linked to another account', 'LEETCODE_TAKEN');

    if (env.REQUIRE_LEETCODE_VALIDATION && !(await leetcodeUserExists(input.leetcode_username)))
      throw badRequest('LeetCode user not found. Check the username (it is case-sensitive in the profile URL).');

    // Create confirmed users server-side so registration does not send a confirmation email.
    // Supabase Auth still owns password hashing, sign-in, and password reset.
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
    if (error) {
      if (/rate limit/i.test(error.message) || error.status === 429)
        throw new AppError(429, 'EMAIL_RATE_LIMIT', 'Too many sign-up emails are being sent right now. Please try again in a few minutes.');
      throw badRequest(error.message);
    }
    const user = data.user;
    if (!user) throw new AppError(500, 'SIGNUP_FAILED', 'Sign-up did not return a user');

    const bootstrap = list(env.BOOTSTRAP_ADMIN_EMAILS).includes(input.email);
    try {
      const profile = await profilesRepo.insert({
        id: user.id, full_name: input.full_name, email: input.email,
        leetcode_username: input.leetcode_username, level: input.level as Profile['level'],
        role: bootstrap ? 'ADMIN' : 'STUDENT',
      });
      return { profile, emailConfirmationRequired: false };
    } catch (e) {
      // Compensate so a half-created account never blocks the user from retrying.
      await admin.auth.admin.deleteUser(user.id).catch((err) => logger.error({ err }, 'rollback of auth user failed'));
      throw e;
    }
  },

  async authenticate(token: string): Promise<Profile> {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) throw unauthorized('Invalid or expired session');
    const profile = await profilesRepo.get(data.user.id);
    if (!profile) throw unauthorized('No profile found for this account');
    return profile;
  },
};
