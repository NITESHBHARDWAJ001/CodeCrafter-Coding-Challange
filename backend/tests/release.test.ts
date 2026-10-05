import { describe, expect, it } from 'vitest';
import { challengeState, effectiveProgramStatus } from '../src/domain/challengeState';
import { toInstant, addHours } from '../src/domain/time';
import { releaseLabel } from '../src/domain/releaseLabel';
import { isVisibleToStudents, studentView } from '../src/services/challenge.service';
import type { Challenge, Program } from '../src/types/db';

const TZ = 'Asia/Kolkata';
const program = (over: Partial<Program> = {}): Program => ({
  id: 'p1', name: '30 Days of DSA', slug: 'dsa', description: '', banner_url: null,
  start_date: '2026-10-01', end_date: '2026-10-30', duration_days: 30, status: 'ACTIVE', enrollment_open: true,
  timezone: TZ, challenge_window_hours: 24, default_points: { EASY: 100, MEDIUM: 150, HARD: 250 },
  streak_policy: 'RESET_ON_MISS', streak_grace_days: 0, certificate_enabled: true, certificate_prefix: 'DSA',
  created_by: null, created_at: '', updated_at: '', ...over,
});
const challenge = (day: number): Challenge => {
  const rel = toInstant(`2026-10-${String(day).padStart(2, '0')}`, '09:00', TZ);
  return {
    id: `c${day}`, program_id: 'p1', day_number: day, title: `Secret Problem ${day}`, provider: 'LEETCODE',
    external_problem_id: `secret-slug-${day}`, external_problem_url: `https://leetcode.com/problems/secret-slug-${day}/`,
    category: 'Arrays', difficulty: 'EASY', points_override: null, release_at: rel.toISOString(),
    closes_at: addHours(rel, 24).toISOString(), status: 'SCHEDULED', created_at: '', updated_at: '',
  };
};
const at = (d: string, t: string) => toInstant(d, t, TZ);

describe('challenge release gating (Tests 4, 5, 15)', () => {
  const p = program();
  const days = Array.from({ length: 30 }, (_, i) => challenge(i + 1));
  const states = (now: Date) => days.map((c) => challengeState(c, effectiveProgramStatus(p, now), now));

  it('Oct 1 10:00: Day 1 released, Days 2-30 locked', () => {
    const s = states(at('2026-10-01', '10:00'));
    expect(s[0]).toBe('ACTIVE');
    expect(s.slice(1).every((x) => x === 'UPCOMING')).toBe(true);
  });

  it('Oct 1 08:59: nothing released yet (release time matters, not just date)', () => {
    expect(states(at('2026-10-01', '08:59')).every((x) => x === 'UPCOMING')).toBe(true);
  });

  it('Oct 2 10:00: Day 1 completed, Day 2 released, Day 3+ locked', () => {
    const s = states(at('2026-10-02', '10:00'));
    expect(s[0]).toBe('COMPLETED');
    expect(s[1]).toBe('ACTIVE');
    expect(s.slice(2).every((x) => x === 'UPCOMING')).toBe(true);
  });

  it('a cancelled challenge reports CANCELLED', () => {
    expect(challengeState({ ...challenge(1), status: 'CANCELLED' }, 'ACTIVE', at('2026-10-01', '10:00'))).toBe('CANCELLED');
  });

  it('DRAFT / SCHEDULED programs never release anything, even past release_at', () => {
    const now = at('2026-10-05', '10:00');
    expect(challengeState(days[0], 'DRAFT', now)).toBe('UPCOMING');
    expect(challengeState(days[0], 'SCHEDULED', now)).toBe('UPCOMING');
  });

  it('stored status lag does not matter: dates decide for SCHEDULED/ACTIVE programs', () => {
    expect(effectiveProgramStatus(program({ status: 'SCHEDULED' }), at('2026-10-02', '00:30'))).toBe('ACTIVE');
    expect(effectiveProgramStatus(program({ status: 'ACTIVE' }), at('2026-09-20', '12:00'))).toBe('SCHEDULED');
    expect(effectiveProgramStatus(program({ status: 'ACTIVE' }), at('2026-11-02', '12:00'))).toBe('COMPLETED');
  });

  it('student view of an upcoming challenge leaks nothing about the problem', () => {
    const now = at('2026-10-01', '10:00');
    const view = studentView(days[49 % 30], p, undefined, now); // day 20
    expect(view.locked).toBe(true);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/secret/i);
    expect(json).not.toMatch(/leetcode\.com/);
    expect(view).not.toHaveProperty('title');
    expect(view).not.toHaveProperty('problem_url');
    expect(view).not.toHaveProperty('points');
    expect(view.release_label).toBeTruthy();
  });

  it('student view of a released challenge includes the problem', () => {
    const now = at('2026-10-01', '10:00');
    const view = studentView(days[0], p, undefined, now);
    expect(view.locked).toBe(false);
    expect(view.title).toBe('Secret Problem 1');
    expect(view.points).toBe(100);
    expect(isVisibleToStudents(days[1], p, now)).toBe(false);
  });
});

describe('releaseLabel', () => {
  const now = at('2026-10-01', '10:00');
  it('formats relative labels in program timezone', () => {
    expect(releaseLabel(at('2026-10-01', '21:00'), TZ, now)).toBe('Releases today at 21:00');
    expect(releaseLabel(at('2026-10-02', '09:00'), TZ, now)).toBe('Releases tomorrow');
    expect(releaseLabel(at('2026-10-06', '09:00'), TZ, now)).toBe('Releases in 5 days');
  });
});
