import { DateTime } from 'luxon';
import { admin, unwrap } from '../lib/supabase';
import { notFound } from '../lib/errors';
import { programsRepo } from '../repositories/programs.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { progressRepo, submissionsRepo } from '../repositories/submissions.repo';
import { certificatesRepo } from '../repositories/certificates.repo';
import { leaderboardRepo } from '../repositories/leaderboard.repo';
import { profilesRepo } from '../repositories/profiles.repo';
import { programService } from './program.service';
import { certificateService } from './certificate.service';
import { challengeState, effectiveProgramStatus, isReleased } from '../domain/challengeState';
import type { Profile, Progress, UserLevel } from '../types/db';

/** Strip PostgREST filter metacharacters so a search box can never alter the query structure. */
const safe = (q: string) => q.replace(/[,()%*\\:"']/g, ' ').trim().slice(0, 80);

export const adminService = {
  async overview() {
    const programs = await programsRepo.list();
    const now = new Date();
    const active = programs.filter((p) => effectiveProgramStatus(p, now) === 'ACTIVE');
    const startOfToday = (zone: string) => DateTime.now().setZone(zone).startOf('day').toUTC().toISO()!;

    const [totalParticipants, registered] = await Promise.all([participantsRepo.countAllEnrolled(), profilesRepo.count()]);

    // "Current program" = the active program with the most participants.
    const withCounts = await Promise.all(active.map(async (p) => ({ p, n: await participantsRepo.countEnrolled(p.id) })));
    const current = withCounts.sort((a, b) => b.n - a.n)[0];

    let todaySolves = 0;
    for (const p of active) todaySolves += await submissionsRepo.countSince(startOfToday(p.timezone), p.id);

    let todaysCompletion: number | null = null;
    let todayChallenge: { id: string; day_number: number; title: string } | null = null;
    if (current) {
      const challenges = await challengesRepo.listByProgram(current.p.id);
      const status = effectiveProgramStatus(current.p, now);
      const today = challenges.filter((c) => challengeState(c, status, now) === 'ACTIVE').sort((a, b) => b.release_at.localeCompare(a.release_at))[0];
      if (today) {
        todayChallenge = { id: today.id, day_number: today.day_number, title: today.title };
        const solved = (await submissionsRepo.forChallenge(today.id)).length;
        todaysCompletion = current.n ? Math.round((solved / current.n) * 100) : 0;
      }
    }
    return {
      active_programs: active.length,
      total_programs: programs.length,
      total_participants: totalParticipants,
      registered_users: registered,
      todays_solves: todaySolves,
      current_program: current ? { id: current.p.id, name: current.p.name, participants: current.n } : null,
      todays_challenge: todayChallenge,
      todays_completion_pct: todaysCompletion,
    };
  },

  async programSummary(programId: string) {
    const program = await programService.require(programId);
    const [participants, challenges] = await Promise.all([participantsRepo.countEnrolled(programId), challengesRepo.listByProgram(programId)]);
    const now = new Date();
    const status = effectiveProgramStatus(program, now);
    const states = challenges.map((c) => challengeState(c, status, now));
    return {
      ...program, effective_status: status, participants,
      challenges: challenges.filter((c) => c.status !== 'CANCELLED').length,
      released: states.filter(isReleased).length,
      completed: states.filter((s) => s === 'COMPLETED').length,
    };
  },

  async searchParticipants(opts: { q?: string; level?: UserLevel; programId?: string; limit: number; offset: number }) {
    const q = opts.q ? safe(opts.q) : '';
    const orFilter = q ? `full_name.ilike.%${q}%,email.ilike.%${q}%,leetcode_username.ilike.%${q}%` : null;
    let profiles: Profile[] = [];
    let total = 0;

    if (opts.programId) {
      let query = admin.from('program_participants')
        .select('user_id, profile:profiles!inner(*)', { count: 'exact' })
        .eq('program_id', opts.programId).eq('status', 'ENROLLED');
      if (orFilter) query = query.or(orFilter, { referencedTable: 'profiles' });
      if (opts.level) query = query.eq('profiles.level', opts.level);
      const res = await query.order('enrolled_at').range(opts.offset, opts.offset + opts.limit - 1);
      if (res.error) throw res.error;
      total = res.count ?? 0;
      profiles = (res.data as unknown as Array<{ profile: Profile }>).map((r) => r.profile);
    } else {
      let query = admin.from('profiles').select('*', { count: 'exact' });
      if (orFilter) query = query.or(orFilter);
      if (opts.level) query = query.eq('level', opts.level);
      const res = await query.order('full_name').range(opts.offset, opts.offset + opts.limit - 1);
      if (res.error) throw res.error;
      total = res.count ?? 0;
      profiles = res.data as Profile[];
    }

    const ids = profiles.map((p) => p.id);
    const progress: Progress[] = ids.length
      ? unwrap(await admin.from('program_progress').select('*').in('user_id', ids).returns<Progress[]>())
      : [];
    const enrolled: Array<{ user_id: string }> = ids.length
      ? unwrap(await admin.from('program_participants').select('user_id').in('user_id', ids).eq('status', 'ENROLLED').returns<Array<{ user_id: string }>>())
      : [];
    const items = profiles.map((p) => {
      const mine = progress.filter((x) => x.user_id === p.id && (!opts.programId || x.program_id === opts.programId));
      return {
        ...p,
        programs: enrolled.filter((e) => e.user_id === p.id).length,
        solved: mine.reduce((n, x) => n + x.solved_count, 0),
        points: mine.reduce((n, x) => n + x.total_points, 0),
        current_streak: Math.max(0, ...mine.map((x) => x.current_streak)),
      };
    });
    return { items, total };
  },

  async participantDetail(userId: string) {
    const profile = await profilesRepo.get(userId);
    if (!profile) throw notFound('User not found');
    const [programIds, programs, progress, certs, overallRank] = await Promise.all([
      participantsRepo.programsOfUser(userId), programsRepo.list(), progressRepo.listByUser(userId),
      certificatesRepo.listByUser(userId), leaderboardRepo.overallRank(userId),
    ]);
    const enrollments = [];
    for (const p of programs.filter((x) => programIds.includes(x.id))) {
      const [rank, challenges, elig] = await Promise.all([
        leaderboardRepo.programRank(p.id, userId), challengesRepo.listByProgram(p.id),
        p.certificate_enabled ? certificateService.eligibility(p.id) : Promise.resolve(null),
      ]);
      const pr = progress.find((x) => x.program_id === p.id);
      enrollments.push({
        program_id: p.id, program_name: p.name, status: effectiveProgramStatus(p),
        solved: pr?.solved_count ?? 0, total: challenges.filter((c) => c.status !== 'CANCELLED').length,
        points: pr?.total_points ?? 0, rank, current_streak: pr?.current_streak ?? 0, longest_streak: pr?.longest_streak ?? 0,
        certificate: !p.certificate_enabled ? 'N/A'
          : certs.some((c) => c.program_id === p.id) ? 'ISSUED'
          : elig?.participants.find((r) => r.user_id === userId)?.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
      });
    }
    return { profile, overall_rank: overallRank, enrollments, certificates: certs };
  },

  async programAnalytics(programId: string) {
    const program = await programService.require(programId);
    const [challenges, submissions, participants] = await Promise.all([
      challengesRepo.listByProgram(programId), submissionsRepo.listByProgram(programId), participantsRepo.listEnrolled(programId),
    ]);
    const now = new Date();
    const status = effectiveProgramStatus(program, now);
    const n = participants.length;
    const solvesByChallenge = new Map<string, number>();
    const perDay = new Map<string, number>();
    for (const s of submissions) {
      solvesByChallenge.set(s.challenge_id, (solvesByChallenge.get(s.challenge_id) ?? 0) + 1);
      const day = DateTime.fromISO(s.submitted_at).setZone(program.timezone).toISODate()!;
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    const released = challenges.filter((c) => isReleased(challengeState(c, status, now)));
    const byLevel = ['FOUNDATION', 'DIPLOMA', 'DEGREE'].map((level) => ({ level, participants: participants.filter((p) => p.profile.level === level).length }));
    const byDifficulty = ['EASY', 'MEDIUM', 'HARD'].map((d) => {
      const cs = released.filter((c) => c.difficulty === d);
      const solves = cs.reduce((a, c) => a + (solvesByChallenge.get(c.id) ?? 0), 0);
      return { difficulty: d, challenges: cs.length, solve_rate_pct: cs.length && n ? Math.round((solves / (cs.length * n)) * 100) : 0 };
    });
    return {
      participants: n,
      per_challenge: released.map((c) => ({
        day: c.day_number, title: c.title, difficulty: c.difficulty, solves: solvesByChallenge.get(c.id) ?? 0,
        completion_pct: n ? Math.round(((solvesByChallenge.get(c.id) ?? 0) / n) * 100) : 0,
      })),
      daily_solves: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, solves]) => ({ date, solves })),
      by_level: byLevel,
      by_difficulty: byDifficulty,
    };
  },
};
