import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { Program, ProgramProgress, StudentChallenge } from '../lib/types';
import { fmtDate, fmtNum } from '../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageSkeleton, ProgramStatusBadge, ProgressBar, Stat, Streak, Tabs, useToast } from '../components/ui';
import { CheckSolvesButton, LeaderboardPanel, Timeline } from '../components/Domain';

function useEnroll(programId: string) {
  const qc = useQueryClient(); const toast = useToast();
  return useMutation({
    mutationFn: () => api.post(`/programs/${programId}/enroll`),
    onSuccess: () => { toast("You're in! See you at the first challenge 🚀"); qc.invalidateQueries(); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
}

export function ProgramsPage() {
  const q = useQuery({ queryKey: ['programs'], queryFn: () => api.get<{ programs: Program[] }>('/programs') });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const programs = q.data!.programs;
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">Programs</h1><p className="mt-1 text-ink-600">Pick a challenge track and build the habit.</p></div>
      {!programs.length ? <Card><EmptyState icon="🌱" title="No programs yet" body="New programs will show up here as soon as they're announced." /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">{programs.map((p) => <ProgramCard key={p.id} p={p} />)}</div>
      )}
    </div>
  );
}

function ProgramCard({ p }: { p: Program }) {
  const enroll = useEnroll(p.id);
  const canJoin = !p.enrolled && p.enrollment_open && p.effective_status !== 'COMPLETED';
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative h-24 bg-gradient-to-br from-ink-900 via-ink-700 to-ink-600 p-4">
        <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-saffron-500/30 blur-2xl" />
        <div className="relative flex items-start justify-between"><span className="num rounded-lg bg-white/10 px-2 py-1 text-xs font-bold text-saffron-400">{p.duration_days} DAYS</span><ProgramStatusBadge s={p.effective_status} /></div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-xl font-bold">{p.name}</h2>
        <p className="mt-1.5 line-clamp-3 text-sm text-ink-600">{p.description || 'Daily LeetCode challenges, verified automatically.'}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge>{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</Badge>{p.certificate_enabled && <Badge tone="accent">🎓 Certificate</Badge>}</div>
        <div className="mt-auto flex items-center gap-2 pt-5">
          <Link to={`/programs/${p.id}`} className="flex-1"><Button variant="secondary" className="w-full">{p.enrolled ? 'Open' : 'View details'}</Button></Link>
          {canJoin && <Button variant="accent" loading={enroll.isPending} onClick={() => enroll.mutate()}>Join</Button>}
          {p.enrolled && <Badge tone="ok">Enrolled</Badge>}
        </div>
      </div>
    </Card>
  );
}

interface Detail { program: Program; enrolled: boolean; participants: number; progress: ProgramProgress }

export function ProgramDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<'timeline' | 'leaderboard' | 'about'>('timeline');
  const d = useQuery({ queryKey: ['program', id], queryFn: () => api.get<Detail>(`/programs/${id}`) });
  const ch = useQuery({ queryKey: ['challenges', id], queryFn: () => api.get<{ challenges: StudentChallenge[] }>(`/programs/${id}/challenges`), refetchInterval: 60_000 });
  const enroll = useEnroll(id!);

  if (d.isLoading) return <PageSkeleton />;
  if (d.error) return <ErrorState error={d.error} retry={() => d.refetch()} />;
  const { program: p, progress: pr, enrolled, participants } = d.data!;
  const canJoin = !enrolled && p.enrollment_open && p.effective_status !== 'COMPLETED';

  return (
    <div className="space-y-6">
      <Link to="/programs" className="text-sm font-semibold text-ink-600 hover:underline">← All programs</Link>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-ink-900 to-ink-700 p-6 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><ProgramStatusBadge s={p.effective_status} /><h1 className="mt-3 text-3xl font-bold">{p.name}</h1>
              <p className="mt-1 text-sm text-ink-200">{fmtDate(p.start_date)} → {fmtDate(p.end_date)} · {participants} participants</p></div>
            {canJoin && <Button variant="accent" size="lg" loading={enroll.isPending} onClick={() => enroll.mutate()}>Join program</Button>}
            {enrolled && <div className="flex items-center gap-3"><Badge tone="ok">✓ Enrolled</Badge>{p.effective_status === 'ACTIVE' && <CheckSolvesButton programId={p.id} />}</div>}
          </div>
          {enrolled && <div className="mt-5"><div className="flex justify-between text-sm"><span className="text-ink-200">Your progress</span><span className="num font-bold">{pr.solved} / {pr.total}</span></div><ProgressBar value={pr.solved} max={pr.total} className="mt-2 !bg-white/15" /></div>}
        </div>
        {enrolled && <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Stat label="Points" value={fmtNum(pr.points)} /><Stat label="Rank" value={pr.rank ? `#${pr.rank}` : '–'} />
          <Stat label="Streak" value={<Streak n={pr.current_streak} />} /><Stat label="Longest" value={`${pr.longest_streak}d`} />
        </div>}
      </Card>
      <Tabs tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'leaderboard', label: 'Leaderboard' }, { id: 'about', label: 'About' }]} value={tab} onChange={setTab} />
      {tab === 'timeline' && <Card><CardHeader title="Daily challenges" sub="Future days stay locked until their release time." /><div className="p-4 sm:p-5">{ch.isLoading ? <PageSkeleton /> : ch.error ? <ErrorState error={ch.error} /> : <Timeline challenges={ch.data!.challenges} />}</div></Card>}
      {tab === 'leaderboard' && <LeaderboardPanel programId={p.id} />}
      {tab === 'about' && (
        <Card className="space-y-4 p-5 text-sm">
          <p className="whitespace-pre-line text-ink-700">{p.description || 'No description yet.'}</p>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">How points work</dt><dd className="mt-1">Easy {p.default_points.EASY} · Medium {p.default_points.MEDIUM} · Hard {p.default_points.HARD} (individual days may differ)</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">Solve window</dt><dd className="mt-1">{p.challenge_window_hours} hours from release. Only accepted submissions made inside the window count.</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">Missing a day</dt><dd className="mt-1">{p.streak_policy === 'RESET_ON_MISS' ? 'Your streak resets to zero.' : `Up to ${p.streak_grace_days} consecutive missed day(s) are forgiven.`}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">Certificate</dt><dd className="mt-1">{p.certificate_enabled ? 'Issued to participants who meet the completion criteria.' : 'Not offered for this program.'}</dd></div>
          </dl>
        </Card>
      )}
    </div>
  );
}
