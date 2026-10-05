import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import type { Program } from '../../lib/types';
import { fmtDate, fmtNum } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageSkeleton, ProgramStatusBadge, Skeleton, Stat, Tabs, useToast } from '../../components/ui';
import { LeaderboardPanel, ProgramPicker } from '../../components/Domain';
import { ChallengesTab } from './ChallengesTab';
import { ParticipantsTab } from './ParticipantsTab';
import { CertificatesTab } from './CertificatesTab';
import { SyncPanel } from './SyncPanel';
import { AnalyticsTab } from './AnalyticsTab';
import { ProgramForm } from './ProgramForm';

/* ───────── Dashboard ───────── */
interface Overview {
  active_programs: number; total_programs: number; total_participants: number; registered_users: number; todays_solves: number;
  current_program: { id: string; name: string; participants: number } | null; todays_challenge: { id: string; day_number: number; title: string } | null; todays_completion_pct: number | null;
}
export function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<Overview>('/admin/overview'), refetchInterval: 30_000 });
  const programs = useQuery({ queryKey: ['admin-programs'], queryFn: () => api.get<{ programs: Program[] }>('/admin/programs') });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const o = q.data!;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active programs" value={o.active_programs} hint={`${o.total_programs} total`} />
        <Stat label="Total participants" value={fmtNum(o.total_participants)} hint={`${fmtNum(o.registered_users)} registered users`} />
        <Stat label="Today's solves" value={fmtNum(o.todays_solves)} />
        <Stat label="Today's completion" value={o.todays_completion_pct === null ? '–' : `${o.todays_completion_pct}%`} tone="dark" hint={o.todays_challenge ? `Day ${o.todays_challenge.day_number} · ${o.todays_challenge.title}` : 'No live challenge'} />
      </div>
      <Card className="p-5"><div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Current active program</div>
        {o.current_program ? <div className="mt-1 flex flex-wrap items-center justify-between gap-3"><div><div className="text-2xl font-bold">{o.current_program.name}</div><div className="text-sm text-ink-600">{fmtNum(o.current_program.participants)} participants</div></div><Link to={`/admin/programs/${o.current_program.id}`}><Button variant="secondary">Manage →</Button></Link></div> : <p className="mt-1 text-ink-600">No program is active right now.</p>}</Card>
      <Card>
        <CardHeader title="Programs" action={<Link to="/admin/programs" className="text-sm font-semibold text-ink-600 hover:underline">View all →</Link>} />
        {programs.isLoading ? <div className="p-5"><Skeleton className="h-24" /></div> : (
          <ul className="divide-y divide-ink-100">{programs.data?.programs.slice(0, 6).map((p) => (
            <li key={p.id}><Link to={`/admin/programs/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-ink-50"><span className="font-semibold">{p.name}</span><span className="flex items-center gap-3 text-sm text-ink-600"><span className="num">{p.participants} joined</span><ProgramStatusBadge s={p.effective_status} /></span></Link></li>))}</ul>)}
      </Card>
    </div>
  );
}

/* ───────── Programs list ───────── */
export function AdminPrograms() {
  const q = useQuery({ queryKey: ['admin-programs'], queryFn: () => api.get<{ programs: Program[] }>('/admin/programs') });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">Programs</h1><Button onClick={() => setCreating(true)}>+ New program</Button></div>
      {q.isLoading ? <PageSkeleton /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !q.data!.programs.length ? (
        <Card><EmptyState icon="🗂️" title="Create your first program" body="e.g. “30 Days of DSA”. You can prepare every challenge in advance — they stay hidden until release." action={<Button onClick={() => setCreating(true)}>New program</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{q.data!.programs.map((p) => (
          <Link key={p.id} to={`/admin/programs/${p.id}`}><Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-start justify-between gap-2"><h2 className="text-xl font-bold">{p.name}</h2><ProgramStatusBadge s={p.effective_status} /></div>
            <p className="mt-1 text-sm text-ink-600">{fmtDate(p.start_date)} → {fmtDate(p.end_date)} · {p.duration_days} days</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge><span className="num">{p.participants}</span>&nbsp;participants</Badge>{p.certificate_enabled && <Badge tone="accent">🎓 Certificate</Badge>}{!p.enrollment_open && <Badge tone="warn">Enrollment closed</Badge>}</div>
          </Card></Link>))}</div>)}
      <Modal open={creating} onClose={() => setCreating(false)} title="New program" wide><ProgramForm onCancel={() => setCreating(false)} onSaved={(p) => { setCreating(false); nav(`/admin/programs/${p.id}?tab=challenges`); }} /></Modal>
    </div>
  );
}

/* ───────── Program detail ───────── */
interface Summary extends Program { participants: number; challenges: number; released: number; completed: number }
type Tab = 'overview' | 'challenges' | 'participants' | 'leaderboard' | 'certificates' | 'sync' | 'analytics';

export function AdminProgramPage() {
  const { id } = useParams() as { id: string };
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const q = useQuery({ queryKey: ['admin-program', id], queryFn: () => api.get<{ program: Summary }>(`/admin/programs/${id}`) });
  const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast();
  const del = useMutation({ mutationFn: () => api.del(`/admin/programs/${id}`), onSuccess: () => { toast('Program deleted'); qc.invalidateQueries({ queryKey: ['admin-programs'] }); nav('/admin/programs'); }, onError: (e) => toast(errorMessage(e), 'bad') });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data!.program;
  return (
    <div className="space-y-6">
      <Link to="/admin/programs" className="text-sm font-semibold text-ink-600 hover:underline">← Programs</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-3"><h1 className="text-3xl font-bold">{p.name}</h1><ProgramStatusBadge s={p.effective_status} /></div><p className="mt-1 text-ink-600">{fmtDate(p.start_date)} → {fmtDate(p.end_date)} · {p.timezone}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Participants" value={fmtNum(p.participants)} /><Stat label="Challenges" value={p.challenges} /><Stat label="Released" value={p.released} /><Stat label="Completed" value={p.completed} />
      </div>
      <Tabs<Tab> value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'challenges', label: 'Manage Challenges' }, { id: 'participants', label: 'Participants' }, { id: 'leaderboard', label: 'Leaderboard' },
        { id: 'certificates', label: 'Certificate Rules' }, { id: 'sync', label: 'Sync' }, { id: 'analytics', label: 'Analytics' }]} />
      {tab === 'overview' && (
        <Card><CardHeader title="Program settings" /><div className="p-5"><ProgramForm program={p} onSaved={() => q.refetch()} /></div>
          <div className="flex items-center justify-between border-t border-ink-100 px-5 py-4 text-sm"><span className="text-ink-500">Only DRAFT programs without participants can be deleted. Otherwise archive via status.</span>
            {p.status === 'DRAFT' && <Button variant="danger" size="sm" loading={del.isPending} onClick={() => confirm('Delete this draft program and its challenges?') && del.mutate()}>Delete program</Button>}</div></Card>)}
      {tab === 'challenges' && <ChallengesTab programId={id} />}
      {tab === 'participants' && <ParticipantsTab programId={id} />}
      {tab === 'leaderboard' && <LeaderboardPanel programId={id} />}
      {tab === 'certificates' && <CertificatesTab programId={id} />}
      {tab === 'sync' && <SyncPanel programId={id} />}
      {tab === 'analytics' && <AnalyticsTab programId={id} />}
    </div>
  );
}

/* ───────── Global pages (program-scoped content behind a picker) ───────── */
function Scoped({ title, render }: { title: string; render: (id: string) => React.ReactNode }) {
  const [sp, setSp] = useSearchParams();
  return (<div className="space-y-5"><h1 className="text-3xl font-bold">{title}</h1><ProgramPicker value={sp.get('program')} onChange={(v) => setSp({ program: v }, { replace: true })}>{(pid) => render(pid)}</ProgramPicker></div>);
}
export const AdminChallengesPage = () => <Scoped title="Challenges" render={(id) => <ChallengesTab programId={id} />} />;
export const AdminLeaderboardsPage = () => <Scoped title="Leaderboards" render={(id) => <LeaderboardPanel programId={id} />} />;
export const AdminCertificatesPage = () => <Scoped title="Certificates" render={(id) => <CertificatesTab programId={id} />} />;
export const AdminAnalyticsPage = () => <Scoped title="Analytics" render={(id) => <AnalyticsTab programId={id} />} />;
export const AdminSyncPage = () => (<div className="space-y-5"><h1 className="text-3xl font-bold">Sync</h1><SyncPanel /></div>);
export const AdminParticipantsPage = () => (<div className="space-y-5"><h1 className="text-3xl font-bold">Students</h1><ParticipantsTab /></div>);

/* ───────── Settings ───────── */
export function AdminSettingsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient(); const toast = useToast();
  const admins = useQuery({ queryKey: ['admins'], queryFn: () => api.get<{ admins: Array<{ id: string; full_name: string; email: string }> }>('/admin/admins') });
  const [email, setEmail] = useState('');
  const promote = useMutation({
    mutationFn: async () => {
      const r = await api.get<{ items: Array<{ id: string; email: string }> }>(`/admin/participants?q=${encodeURIComponent(email.trim())}&limit=5`);
      const u = r.items.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u) throw new Error('No registered user with that email');
      return api.put(`/admin/users/${u.id}/role`, { role: 'ADMIN' });
    },
    onSuccess: () => { toast('Admin added'); setEmail(''); qc.invalidateQueries({ queryKey: ['admins'] }); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const demote = useMutation({ mutationFn: (id: string) => api.put(`/admin/users/${id}/role`, { role: 'STUDENT' }), onSuccess: () => { toast('Admin removed'); qc.invalidateQueries({ queryKey: ['admins'] }); }, onError: (e) => toast(errorMessage(e), 'bad') });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <Card>
        <CardHeader title="Administrators" sub="Admins can manage programs, challenges, certificates and sync." />
        <form className="flex flex-wrap items-end gap-3 border-b border-ink-100 p-5" onSubmit={(e) => { e.preventDefault(); promote.mutate(); }}>
          <div className="min-w-[240px] flex-1"><Field label="Add admin by registered email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
          <Button type="submit" loading={promote.isPending}>Make admin</Button>
        </form>
        <ul className="divide-y divide-ink-100">{admins.data?.admins.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-5 py-3"><div><div className="font-semibold">{a.full_name}</div><div className="text-xs text-ink-500">{a.email}</div></div>
            {a.id === profile?.id ? <Badge>You</Badge> : <Button size="sm" variant="ghost" onClick={() => confirm(`Remove admin rights from ${a.full_name}?`) && demote.mutate(a.id)}>Remove</Button>}</li>))}</ul>
      </Card>
      <Card className="p-5 text-sm text-ink-600"><h3 className="mb-1 font-semibold text-ink-900">Where are the other settings?</h3>
        Sync schedule lives under <Link className="font-semibold underline" to="/admin/sync">Sync</Link>; scoring, streak rules, timezone and certificate rules are per program under <Link className="font-semibold underline" to="/admin/programs">Programs</Link>.</Card>
    </div>
  );
}
