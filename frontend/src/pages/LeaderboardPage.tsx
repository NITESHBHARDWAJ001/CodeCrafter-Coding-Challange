import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Program } from '../lib/types';
import { LeaderboardPanel } from '../components/Domain';
import { Select, Tabs } from '../components/ui';

export default function LeaderboardPage() {
  const [scope, setScope] = useState<'program' | 'overall'>('program');
  const q = useQuery({ queryKey: ['programs'], queryFn: () => api.get<{ programs: Program[] }>('/programs') });
  const programs = q.data?.programs ?? [];
  const [pid, setPid] = useState('');
  const current = programs.find((p) => p.id === pid) ?? programs.find((p) => p.enrolled && p.effective_status === 'ACTIVE') ?? programs.find((p) => p.effective_status === 'ACTIVE') ?? programs[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Leaderboard</h1><p className="mt-1 text-ink-600">Ties are broken by solves, then by who got there first.</p></div>
        <Tabs tabs={[{ id: 'program', label: 'By program' }, { id: 'overall', label: 'Overall' }]} value={scope} onChange={setScope} />
      </div>
      {scope === 'overall' ? <LeaderboardPanel /> : current ? (
        <>
          <div className="max-w-sm"><Select aria-label="Program" value={current.id} onChange={(e) => setPid(e.target.value)}>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <LeaderboardPanel key={current.id} programId={current.id} />
        </>
      ) : null}
    </div>
  );
}
