import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { Card, CardHeader, EmptyState, ErrorState, PageSkeleton } from '../../components/ui';
import { LEVEL_LABEL } from '../../lib/format';

interface Data {
  participants: number;
  per_challenge: Array<{ day: number; title: string; difficulty: string; solves: number; completion_pct: number }>;
  daily_solves: Array<{ date: string; solves: number }>;
  by_level: Array<{ level: keyof typeof LEVEL_LABEL; participants: number }>;
  by_difficulty: Array<{ difficulty: string; challenges: number; solve_rate_pct: number }>;
}
const INK = '#20357a', SAFFRON = '#f2a20c', GRID = '#e6eaf6', AXIS = '#5b6578';
const tip = { contentStyle: { borderRadius: 12, border: '1px solid #e6eaf6', fontSize: 12 } };
const DIFF_COLOR: Record<string, string> = { EASY: '#1f9d63', MEDIUM: SAFFRON, HARD: '#d6455d' };

export function AnalyticsTab({ programId }: { programId: string }) {
  const q = useQuery({ queryKey: ['analytics', programId], queryFn: () => api.get<Data>(`/admin/programs/${programId}/analytics`) });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.per_challenge.length) return <Card><EmptyState icon="📈" title="No data yet" body="Analytics appear once challenges are released and solves are verified." /></Card>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader title="Completion by challenge" sub={`% of ${d.participants} participants who solved each released day`} />
        <div className="h-72 p-4" role="img" aria-label="Bar chart of completion percentage per challenge day"><ResponsiveContainer>
          <BarChart data={d.per_challenge} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v) => `D${v}`} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: AXIS }} />
            <Tooltip {...tip} formatter={(v) => [`${v}%`, 'Completion']} labelFormatter={(l) => { const c = d.per_challenge.find((x) => x.day === l); return `Day ${l} · ${c?.title ?? ''}`; }} />
            <Bar dataKey="completion_pct" radius={[6, 6, 0, 0]}>{d.per_challenge.map((c) => <Cell key={c.day} fill={DIFF_COLOR[c.difficulty] ?? INK} />)}</Bar></BarChart></ResponsiveContainer></div>
        <p className="px-5 pb-4 text-xs text-ink-500">Bars are coloured by difficulty: green easy · amber medium · red hard.</p>
      </Card>
      <Card>
        <CardHeader title="Solves per day" sub="Verified submissions by solve date (IST)" />
        <div className="h-64 p-4" role="img" aria-label="Line chart of solves per day"><ResponsiveContainer>
          <LineChart data={d.daily_solves} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v: string) => v.slice(5)} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} />
            <Tooltip {...tip} /><Line type="monotone" dataKey="solves" stroke={INK} strokeWidth={2.5} dot={{ r: 3, fill: INK }} /></LineChart></ResponsiveContainer></div>
      </Card>
      <Card>
        <CardHeader title="Participants by level" />
        <div className="h-64 p-4" role="img" aria-label="Bar chart of participants by level"><ResponsiveContainer>
          <BarChart data={d.by_level.map((l) => ({ ...l, name: LEVEL_LABEL[l.level] }))} layout="vertical" margin={{ left: 20, right: 16 }}><CartesianGrid horizontal={false} stroke={GRID} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: AXIS }} width={80} />
            <Tooltip {...tip} /><Bar dataKey="participants" fill={INK} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Solve rate by difficulty" sub="Average % of participants solving a released challenge" />
        <div className="grid gap-3 p-5 sm:grid-cols-3">{d.by_difficulty.map((x) => (
          <div key={x.difficulty} className="rounded-xl bg-ink-50 p-4"><div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{x.difficulty} · {x.challenges} days</div><div className="num mt-1 text-3xl font-bold" style={{ color: DIFF_COLOR[x.difficulty] }}>{x.solve_rate_pct}%</div></div>))}</div>
      </Card>
    </div>
  );
}
