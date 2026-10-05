import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { Program, ProgramProgress, StudentChallenge } from '../lib/types';
import { fmtNum } from '../lib/format';
import { Button, Card, CardHeader, EmptyState, ErrorState, PageSkeleton, ProgramStatusBadge, ProgressBar, Select, Stat, Streak } from '../components/ui';
import { LeaderboardPanel, TodayCard, Timeline } from '../components/Domain';

interface Dash { programs: Array<{ program: Program; progress: ProgramProgress; today: StudentChallenge | null }> }

export default function Dashboard() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/me/dashboard'), refetchInterval: 60_000 });
  const [sel, setSel] = useState<string | null>(null);
  const first = profile?.full_name.split(' ')[0] ?? '';

  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const items = q.data!.programs;
  const cur = items.find((i) => i.program.id === sel) ?? items[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Welcome, {first} <span className="inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_1]">👋</span></h1>
          <p className="mt-1 text-ink-600">LeetCode: <span className="num font-semibold">{profile?.leetcode_username}</span></p>
        </div>
        {items.length > 1 && <div className="w-64"><Select aria-label="Program" value={cur.program.id} onChange={(e) => setSel(e.target.value)}>{items.map((i) => <option key={i.program.id} value={i.program.id}>{i.program.name}</option>)}</Select></div>}
      </div>

      {!cur ? (
        <Card><EmptyState icon="🚀" title="You're not in a program yet" body="Join a program to start receiving daily challenges and climb the leaderboard." action={<Link to="/programs"><Button variant="accent">Browse programs</Button></Link>} /></Card>
      ) : <ProgramDash key={cur.program.id} item={cur} />}
    </div>
  );
}

function ProgramDash({ item }: { item: Dash['programs'][number] }) {
  const { program: p, progress: pr, today } = item;
  const ch = useQuery({ queryKey: ['challenges', p.id], queryFn: () => api.get<{ challenges: StudentChallenge[] }>(`/programs/${p.id}/challenges`), refetchInterval: 60_000 });
  return (
    <>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-ink-900 to-ink-700 p-5 text-white sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-[.2em] text-saffron-400">{p.name}</h2>
            <ProgramStatusBadge s={p.effective_status} />
          </div>
          <div className="mt-4">
            <div className="flex items-baseline justify-between"><span className="text-sm text-ink-200">Progress</span><span className="num text-lg font-bold">{pr.solved} / {pr.total}</span></div>
            <ProgressBar value={pr.solved} max={pr.total} className="mt-2 !bg-white/15" />
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-ink-100">
          <Mini label="Points" value={fmtNum(pr.points)} />
          <Mini label="Rank" value={pr.rank ? `#${pr.rank}` : '–'} />
          <Mini label="Streak" value={<Streak n={pr.current_streak} />} />
        </div>
      </Card>

      <TodayCard programId={p.id} challenge={today} />

      <Card>
        <CardHeader title="Program timeline" sub={`${pr.solved} solved · longest streak ${pr.longest_streak}`} action={<Link to={`/programs/${p.id}`} className="text-sm font-semibold text-ink-600 hover:underline">Open program →</Link>} />
        <div className="p-4 sm:p-5">{ch.isLoading ? <PageSkeleton /> : ch.error ? <ErrorState error={ch.error} retry={() => ch.refetch()} /> : <Timeline challenges={ch.data!.challenges} />}</div>
      </Card>

      <LeaderboardPanel programId={p.id} defaultTab={today ? 'daily' : 'program'} />
    </>
  );
}

const Mini = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="px-3 py-4 text-center sm:px-6"><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</div><div className="num mt-1 text-xl font-bold sm:text-2xl">{value}</div></div>
);

void Stat;
