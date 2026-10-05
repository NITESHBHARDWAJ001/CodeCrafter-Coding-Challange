import { ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { BoardResult, Program, StudentChallenge } from '../lib/types';
import { DIFF_LABEL, fmtDay, fmtNum, fmtTime, LEVEL_LABEL } from '../lib/format';
import { Badge, Button, Card, CardHeader, DifficultyBadge, EmptyState, ErrorState, Select, Skeleton, Streak, Tabs, cx, useToast } from './ui';

/* ───────── Leaderboard ───────── */
type BoardTab = 'program' | 'daily' | 'weekly' | 'overall';

export function LeaderboardPanel({ programId, defaultTab = 'program' }: { programId?: string; defaultTab?: BoardTab }) {
  const { profile } = useAuth();
  const tabs: Array<{ id: BoardTab; label: string }> = programId
    ? [{ id: 'program', label: 'Program' }, { id: 'daily', label: "Today's challenge" }, { id: 'weekly', label: 'This week' }]
    : [{ id: 'overall', label: 'Overall' }];
  const [tab, setTab] = useState<BoardTab>(programId ? defaultTab : 'overall');
  const path = tab === 'overall' ? '/leaderboard/overall?limit=100' : `/programs/${programId}/leaderboard?type=${tab}&limit=100`;
  const q = useQuery({ queryKey: ['board', programId ?? 'overall', tab], queryFn: () => api.get<BoardResult>(path), refetchInterval: 60_000 });

  return (
    <Card>
      <CardHeader
        title="Leaderboard"
        sub={tab === 'daily' && q.data?.context?.title ? `${fmtDay(q.data.context.day_number ?? 0)} · ${q.data.context.title}` : tab === 'program' ? 'Points → solved → earliest to reach the score' : tab === 'weekly' ? 'Points earned since Monday' : 'Across all programs'}
        action={tabs.length > 1 ? <Tabs tabs={tabs} value={tab} onChange={setTab} /> : undefined}
      />
      {q.isLoading ? <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : q.error ? <div className="p-5"><ErrorState error={q.error} retry={() => q.refetch()} /></div>
        : !q.data?.rows.length ? <EmptyState icon="🏁" title="No one on the board yet" body={tab === 'daily' ? "Nobody has a verified solve for this challenge yet. Be the first!" : 'Rankings appear after the first sync verifies a solve.'} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="px-4 py-2.5 sm:px-5">Rank</th><th className="py-2.5">Name</th><th className="hidden py-2.5 sm:table-cell">Level</th>
                <th className="py-2.5 text-right">Solved</th><th className="py-2.5 text-right">Points</th><th className="px-4 py-2.5 text-right sm:px-5">Streak</th>
              </tr></thead>
              <tbody>
                {q.data.rows.map((r) => <Row key={r.user_id} r={r} me={r.user_id === profile?.id} />)}
                {q.data.me && !q.data.rows.some((r) => r.user_id === q.data!.me!.user_id) && (<>
                  <tr><td colSpan={6} className="px-5 py-1 text-center text-ink-400">⋯</td></tr>
                  <Row r={q.data.me} me />
                </>)}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

function Row({ r, me }: { r: BoardResult['rows'][number]; me?: boolean }) {
  const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : null;
  return (
    <tr className={cx('border-t border-ink-100', me && 'bg-saffron-100/60')}>
      <td className="px-4 py-3 sm:px-5"><span className="num font-bold">{medal ?? `#${r.rank}`}</span></td>
      <td className="py-3 font-semibold">{r.full_name}{me && <Badge tone="accent" className="ml-2">You</Badge>}</td>
      <td className="hidden py-3 text-ink-600 sm:table-cell">{LEVEL_LABEL[r.level]}</td>
      <td className="num py-3 text-right">{r.solved}</td>
      <td className="num py-3 text-right font-bold">{fmtNum(r.points)}</td>
      <td className="num px-4 py-3 text-right sm:px-5">{r.current_streak > 0 ? `🔥 ${r.current_streak}` : '–'}</td>
    </tr>
  );
}

/* ───────── Timeline ───────── */
export function Timeline({ challenges }: { challenges: StudentChallenge[] }) {
  if (!challenges.length) return <EmptyState icon="🗓️" title="No challenges yet" body="The admin hasn't published challenges for this program." />;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {challenges.map((c) => <Tile key={c.id} c={c} />)}
    </div>
  );
}

function Tile({ c }: { c: StudentChallenge }) {
  const today = c.state === 'ACTIVE';
  let icon = '🔒', tone = 'border-ink-100 bg-white text-ink-400', label = c.release_label ?? 'Locked';
  if (c.locked) { /* defaults */ }
  else if (c.solved) { icon = '✅'; tone = 'border-ok/30 bg-ok-bg/60 text-ink-900'; label = c.title ?? ''; }
  else if (c.state === 'CANCELLED') { icon = '🚫'; tone = 'border-ink-100 bg-ink-50 text-ink-500'; label = `${c.title} (cancelled)`; }
  else if (today) { icon = '🔵'; tone = 'border-saffron-500 bg-saffron-100 text-ink-900 ring-2 ring-saffron-500/40'; label = c.title ?? ''; }
  else { icon = '❌'; tone = 'border-bad/20 bg-bad-bg/50 text-ink-900'; label = c.title ?? ''; }
  const body = (
    <div className={cx('flex h-full flex-col gap-1 rounded-xl border p-3 transition', tone, !c.locked && 'hover:-translate-y-0.5 hover:shadow-md')}>
      <div className="flex items-center justify-between"><span className="num text-sm font-bold">{fmtDay(c.day_number)}</span><span aria-hidden>{icon}</span></div>
      <div className={cx('line-clamp-2 text-xs', c.locked ? 'font-medium' : 'font-semibold')}>{today && !c.solved && <Badge tone="accent" className="mr-1">TODAY</Badge>}{label}</div>
      {!c.locked && c.points !== undefined && <div className="num mt-auto text-[11px] text-ink-500">{c.solved ? `+${c.points_awarded ?? c.points}` : c.points} pts</div>}
    </div>
  );
  const sr = c.locked ? `${fmtDay(c.day_number)} locked. ${c.release_label}` : `${fmtDay(c.day_number)} ${c.title}${c.solved ? ' solved' : today ? ' today' : ' not solved'}`;
  return c.locked ? <div aria-label={sr} role="img">{body}</div> : <a href={c.problem_url} target="_blank" rel="noreferrer" aria-label={sr}>{body}</a>;
}

/* ───────── "Check my solves" (server-side verification; the client only asks, never reports) ───────── */
export function CheckSolvesButton({ programId, variant = 'accent' }: { programId: string; variant?: 'accent' | 'secondary' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const verify = useMutation({
    mutationFn: () => api.post<{ new_solves: number; checked: number }>(`/me/programs/${programId}/verify`),
    onSuccess: (r) => {
      toast(r.new_solves > 0 ? `Verified! ${r.new_solves} new solve${r.new_solves > 1 ? 's' : ''} counted 🎉` : r.checked === 0 ? 'Everything released is already counted.' : 'No new accepted submission found on LeetCode yet. Try again in a minute.');
      qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  return <Button variant={variant} loading={verify.isPending} onClick={() => verify.mutate()}>🔄 Check my solves</Button>;
}

/* ───────── Today's challenge ───────── */
export function TodayCard({ programId, challenge }: { programId: string; challenge: StudentChallenge | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const verify = useMutation({
    mutationFn: () => api.post<{ new_solves: number; checked: number }>(`/me/programs/${programId}/verify`),
    onSuccess: (r) => {
      toast(r.new_solves > 0 ? `Verified! +${r.new_solves} new solve${r.new_solves > 1 ? 's' : ''} counted 🎉` : "Nothing new found on LeetCode yet. It can take a moment after you submit.", r.new_solves > 0 ? 'ok' : 'ok');
      qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  if (!challenge) return (
    <Card className="p-6"><EmptyState icon="☕" title="No challenge live right now" body="The next challenge unlocks at its scheduled release time. Check the timeline below." /></Card>
  );
  const solved = challenge.solved;
  return (
    <Card className="overflow-hidden">
      <div className="bg-ink-900 px-5 py-3 text-xs font-bold uppercase tracking-[.2em] text-saffron-400">Today&apos;s challenge</div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="num text-sm font-bold text-ink-500">{fmtDay(challenge.day_number)}</div>
          <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{challenge.title}</h2>
          <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-xs text-ink-500">Category</dt><dd className="font-semibold">{challenge.category}</dd></div>
            <div><dt className="text-xs text-ink-500">Difficulty</dt><dd>{challenge.difficulty && <DifficultyBadge d={challenge.difficulty} />}</dd></div>
            <div><dt className="text-xs text-ink-500">Points</dt><dd className="num font-bold">{challenge.points}</dd></div>
            <div><dt className="text-xs text-ink-500">Status</dt><dd>{solved ? <Badge tone="ok">✅ SOLVED</Badge> : <Badge tone="bad">NOT SOLVED</Badge>}</dd></div>
          </dl>
          {solved && (
            <div className="mt-4 rounded-xl bg-ok-bg px-4 py-3 text-sm">
              <span className="font-semibold text-ok">Solved at {challenge.solved_at ? fmtTime(challenge.solved_at) : '–'}</span>
              <span className="num ml-3 font-bold text-ok">+{challenge.points_awarded}</span>
            </div>
          )}
          {challenge.closes_at && <p className="mt-3 text-xs text-ink-500">Counts for today&apos;s points until {fmtTime(challenge.closes_at)} (IST).</p>}
        </div>
        <div className="flex flex-col gap-2 sm:w-56">
          <a href={challenge.problem_url} target="_blank" rel="noreferrer"><Button variant="accent" size="lg" className="w-full">Solve on LeetCode →</Button></a>
          {!solved && <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>I&apos;ve submitted — check now</Button>}
        </div>
      </div>
    </Card>
  );
}

/* ───────── Program picker for admin global pages ───────── */
export function useAdminPrograms() {
  return useQuery({ queryKey: ['admin-programs'], queryFn: () => api.get<{ programs: Program[] }>('/admin/programs') });
}

export function ProgramPicker({ value, onChange, children }: { value: string | null; onChange: (id: string) => void; children: (programId: string, program: Program) => ReactNode }) {
  const q = useAdminPrograms();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const programs = q.data!.programs;
  if (!programs.length) return <Card><EmptyState title="No programs yet" body="Create a program first." /></Card>;
  const current = programs.find((p) => p.id === value) ?? programs.find((p) => p.effective_status === 'ACTIVE') ?? programs[0];
  return (
    <div className="space-y-5">
      <div className="max-w-sm"><Select aria-label="Program" value={current.id} onChange={(e) => onChange(e.target.value)}>
        {programs.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.effective_status}</option>)}
      </Select></div>
      {children(current.id, current)}
    </div>
  );
}

export { Streak };
export const difficultyLabel = (d: keyof typeof DIFF_LABEL) => DIFF_LABEL[d];
