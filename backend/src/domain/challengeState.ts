import type { ProgramStatus } from '../types/db';
import { endOfDate, startOfDate } from './time';

export type ChallengeState = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

interface ProgramLike { status: ProgramStatus; start_date: string; end_date: string; timezone: string }
interface ChallengeLike { status: 'SCHEDULED' | 'CANCELLED'; release_at: string | Date; closes_at: string | Date }

/**
 * Program status as it really is *now*. The stored status can lag (a job advances it), so access control
 * never depends on the job having run: dates decide for SCHEDULED/ACTIVE programs.
 */
export function effectiveProgramStatus(p: ProgramLike, now: Date = new Date()): ProgramStatus {
  if (p.status === 'DRAFT' || p.status === 'ARCHIVED' || p.status === 'COMPLETED') return p.status;
  if (now < startOfDate(p.start_date, p.timezone)) return 'SCHEDULED';
  if (now > endOfDate(p.end_date, p.timezone)) return 'COMPLETED';
  return 'ACTIVE';
}

/**
 * The single source of truth for "can a participant see/solve this challenge?".
 * Used by every student-facing endpoint and by the sync engine. Never computed on the client.
 *
 *  UPCOMING  - not released yet (also: any challenge of a DRAFT/SCHEDULED program) -> hidden
 *  ACTIVE    - released and still inside its points window
 *  COMPLETED - window closed
 *  CANCELLED - withdrawn by admin
 */
export function challengeState(c: ChallengeLike, programStatus: ProgramStatus, now: Date = new Date()): ChallengeState {
  if (c.status === 'CANCELLED') return 'CANCELLED';
  if (programStatus === 'DRAFT' || programStatus === 'SCHEDULED') return 'UPCOMING';
  const release = new Date(c.release_at);
  const closes = new Date(c.closes_at);
  if (now < release) return 'UPCOMING';
  if (now < closes) return 'ACTIVE';
  return 'COMPLETED';
}

export const isReleased = (s: ChallengeState) => s === 'ACTIVE' || s === 'COMPLETED';
