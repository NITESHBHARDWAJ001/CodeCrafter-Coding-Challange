import { leetCodeService } from '../leetcode';
import type { SubmissionProvider } from './types';
import type { ChallengeProvider } from '../types/db';
import { AppError } from '../lib/errors';

const providers: Partial<Record<ChallengeProvider, SubmissionProvider>> = {
  LEETCODE: leetCodeService,
  // CODEFORCES: codeforcesService,  <- implement SubmissionProvider and register here
};

export function getSubmissionProvider(p: ChallengeProvider): SubmissionProvider {
  const impl = providers[p];
  if (!impl) throw new AppError(501, 'PROVIDER_NOT_SUPPORTED', `No verifier is implemented for provider ${p}`);
  return impl;
}

export const supportedProviders = (): ChallengeProvider[] => Object.keys(providers) as ChallengeProvider[];
