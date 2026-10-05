import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import type { Certificate, Level, Program } from '../../lib/types';
import { fmtDate, fmtNum, LEVEL_LABEL } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageSkeleton, Select, Skeleton, Streak, useToast } from '../../components/ui';

interface Item { id: string; full_name: string; email: string; leetcode_username: string; level: Level; role: 'STUDENT' | 'ADMIN'; created_at: string; programs: number; solved: number; points: number; current_streak: number }

/** Student management. With `programId` it lists that program's participants; without, every registered user. */
export function ParticipantsTab({ programId }: { programId?: string }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [level, setLevel] = useState(''); const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const limit = 25;
  const base = () => { const p = new URLSearchParams(); if (dq) p.set('q', dq); if (level) p.set('level', level); if (programId) p.set('program_id', programId); return p; };
  const params = base(); params.set('limit', String(limit)); params.set('offset', String(page * limit));
  const res = useQuery({ queryKey: ['admin-participants', programId, dq, level, page], queryFn: () => api.get<{ items: Item[]; total: number }>(`/admin/participants?${params}`), placeholderData: (p) => p });
  const pages = Math.max(1, Math.ceil((res.data?.total ?? 0) / limit));

  async function exportCsv() {
    setExporting(true);
    try {
      const all: Item[] = [];
      for (let off = 0; off < 5000; off += 100) {
        const p = base(); p.set('limit', '100'); p.set('offset', String(off));
        const r = await api.get<{ items: Item[]; total: number }>(`/admin/participants?${p}`);
        all.push(...r.items); if (all.length >= r.total || !r.items.length) break;
      }
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['name,email,leetcode_username,level,role,joined,programs,solved,points,current_streak', ...all.map((u) => [u.full_name, u.email, u.leetcode_username, u.level, u.role, u.created_at.slice(0, 10), u.programs, u.solved, u.points, u.current_streak].map(esc).join(','))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      toast(`Exported ${all.length} students`);
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setExporting(false); }
  }

  return (
    <>
      <Card>
        <CardHeader title={programId ? 'Participants' : 'All students'} sub={res.data ? `${fmtNum(res.data.total)} ${programId ? 'in this program' : 'registered users'}` : undefined}
          action={<Button size="sm" variant="secondary" loading={exporting} onClick={exportCsv}>⬇ Export CSV</Button>} />
        <div className="flex flex-wrap gap-3 border-b border-ink-100 p-4">
          <div className="min-w-[220px] flex-1"><Input type="search" placeholder="Search name, email or LeetCode username…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" /></div>
          <div className="w-44"><Select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setPage(0); }}><option value="">All levels</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        </div>
        {res.isLoading ? <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div> : res.error ? <div className="p-5"><ErrorState error={res.error} retry={() => res.refetch()} /></div>
          : !res.data!.items.length ? <EmptyState icon="🔎" title="No matches" body="Try a different search or filter." />
          : (
            <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-500"><th className="px-5 py-2.5">Student</th><th>LeetCode</th><th>Level</th><th>Joined</th><th className="text-right">Programs</th><th className="text-right">Solved</th><th className="text-right">Points</th><th className="px-5 text-right">Streak</th></tr></thead>
              <tbody>{res.data!.items.map((p) => (
                <tr key={p.id} className="cursor-pointer border-t border-ink-100 hover:bg-ink-50" onClick={() => setOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
                  <td className="px-5 py-3"><div className="flex items-center gap-2 font-semibold">{p.full_name}{p.role === 'ADMIN' && <Badge tone="dark">Admin</Badge>}</div><div className="text-xs text-ink-500">{p.email}</div></td>
                  <td className="num">{p.leetcode_username}</td><td>{LEVEL_LABEL[p.level]}</td><td className="whitespace-nowrap text-ink-600">{fmtDate(p.created_at)}</td>
                  <td className="num text-right">{p.programs}</td><td className="num text-right">{p.solved}</td><td className="num text-right font-bold">{fmtNum(p.points)}</td>
                  <td className="num px-5 text-right">{p.current_streak ? `🔥 ${p.current_streak}` : '–'}</td></tr>))}</tbody></table></div>)}
        {pages > 1 && <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-sm"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Button><span className="text-ink-500">Page {page + 1} of {pages}</span><Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button></div>}
      </Card>
      {open && <StudentModal userId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

interface Detail {
  profile: { id: string; full_name: string; email: string; leetcode_username: string; level: Level; role: 'STUDENT' | 'ADMIN'; created_at: string };
  overall_rank: number | null;
  enrollments: Array<{ program_id: string; program_name: string; solved: number; total: number; points: number; rank: number | null; current_streak: number; longest_streak: number; certificate: string }>;
  certificates: Certificate[];
}

function StudentModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const { profile: me } = useAuth();
  const d = useQuery({ queryKey: ['admin-participant', userId], queryFn: () => api.get<Detail>(`/admin/participants/${userId}`) });
  const programs = useQuery({ queryKey: ['admin-programs'], queryFn: () => api.get<{ programs: Program[] }>('/admin/programs') });
  const [f, setF] = useState({ full_name: '', level: 'DEGREE', leetcode_username: '' });
  const [enrollId, setEnrollId] = useState('');
  useEffect(() => { if (d.data) setF({ full_name: d.data.profile.full_name, level: d.data.profile.level, leetcode_username: d.data.profile.leetcode_username }); }, [d.data?.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-participant', userId] }); qc.invalidateQueries({ queryKey: ['admin-participants'] }); qc.invalidateQueries({ queryKey: ['admins'] }); };
  const fail = (e: unknown) => toast(errorMessage(e), 'bad');

  const save = useMutation({ mutationFn: () => api.patch(`/admin/users/${userId}`, f), onSuccess: () => { toast('Student updated'); refresh(); }, onError: fail });
  const role = useMutation({ mutationFn: (r: 'STUDENT' | 'ADMIN') => api.put(`/admin/users/${userId}/role`, { role: r }), onSuccess: () => { toast('Role updated'); refresh(); }, onError: fail });
  const enroll = useMutation({ mutationFn: () => api.post(`/admin/programs/${enrollId}/participants/${userId}`), onSuccess: () => { toast('Enrolled'); setEnrollId(''); refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: (pid: string) => api.del(`/admin/programs/${pid}/participants/${userId}`), onSuccess: () => { toast('Removed from program (verified solves are kept)'); refresh(); }, onError: fail });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title="Student" wide>
      {d.isLoading ? <PageSkeleton /> : d.error ? <ErrorState error={d.error} /> : (() => {
        const { profile: p, enrollments, overall_rank, certificates } = d.data!;
        const joined = new Set(enrollments.map((e) => e.program_id));
        const available = (programs.data?.programs ?? []).filter((x) => !joined.has(x.id) && x.effective_status !== 'ARCHIVED');
        const dirty = f.full_name !== p.full_name || f.level !== p.level || f.leetcode_username !== p.leetcode_username;
        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-2xl font-bold">{p.full_name}</h3><p className="text-sm text-ink-600">{p.email}</p>
                <div className="mt-2 flex flex-wrap gap-2"><Badge>{LEVEL_LABEL[p.level]}</Badge>{p.role === 'ADMIN' && <Badge tone="dark">Admin</Badge>}<Badge>Joined {fmtDate(p.created_at)}</Badge><Badge tone="accent">{certificates.length} certificate{certificates.length === 1 ? '' : 's'}</Badge></div></div>
              <div className="text-right"><div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Overall rank</div><div className="num text-3xl font-bold">{overall_rank ? `#${overall_rank}` : '–'}</div></div>
            </div>

            <form className="grid gap-4 rounded-2xl border border-ink-100 p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Field label="Full name"><Input required minLength={2} value={f.full_name} onChange={set('full_name')} /></Field>
              <Field label="Level"><Select value={f.level} onChange={set('level')}>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="LeetCode username" hint="Admin override. Checked against LeetCode; past solves keep their original username."><Input required value={f.leetcode_username} onChange={set('leetcode_username')} spellCheck={false} /></Field>
              <div className="sm:col-span-3"><Button type="submit" loading={save.isPending} disabled={!dirty}>Save changes</Button></div>
            </form>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Programs</h4>
              {!enrollments.length ? <p className="text-sm text-ink-500">Not enrolled in any program.</p> : (
                <div className="overflow-x-auto rounded-xl border border-ink-100"><table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500"><tr><th className="px-4 py-2">Program</th><th>Progress</th><th className="text-right">Points</th><th className="text-right">Rank</th><th className="text-right">Streak</th><th className="px-4">Certificate</th><th /></tr></thead>
                  <tbody>{enrollments.map((e) => (<tr key={e.program_id} className="border-t border-ink-100"><td className="px-4 py-2.5 font-semibold">{e.program_name}</td><td className="num">{e.solved} / {e.total}</td><td className="num text-right font-bold">{fmtNum(e.points)}</td><td className="num text-right">{e.rank ? `#${e.rank}` : '–'}</td><td className="text-right"><Streak n={e.current_streak} /></td>
                    <td className="px-4"><Badge tone={e.certificate === 'ISSUED' ? 'ok' : e.certificate === 'ELIGIBLE' ? 'accent' : 'neutral'}>{e.certificate.replace('_', ' ')}</Badge></td>
                    <td className="px-3 text-right"><button className="text-xs font-semibold text-bad hover:underline" onClick={() => confirm(`Remove ${p.full_name} from ${e.program_name}? Their verified solves are kept.`) && remove.mutate(e.program_id)}>Remove</button></td></tr>))}</tbody></table></div>)}
              {available.length > 0 && (
                <div className="mt-3 flex flex-wrap items-end gap-3"><div className="w-64"><Select aria-label="Enrol in program" value={enrollId} onChange={(e) => setEnrollId(e.target.value)}><option value="">Enrol in a program…</option>{available.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
                  <Button variant="secondary" disabled={!enrollId} loading={enroll.isPending} onClick={() => enroll.mutate()}>Enrol</Button></div>)}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
              <div className="text-sm text-ink-600">Admin access lets this person manage programs, challenges, certificates and sync.</div>
              {p.id === me?.id ? <Badge>This is you</Badge>
                : p.role === 'ADMIN' ? <Button variant="danger" size="sm" loading={role.isPending} onClick={() => confirm(`Remove admin rights from ${p.full_name}?`) && role.mutate('STUDENT')}>Remove admin</Button>
                : <Button variant="secondary" size="sm" loading={role.isPending} onClick={() => confirm(`Make ${p.full_name} an admin?`) && role.mutate('ADMIN')}>Make admin</Button>}
            </div>
          </div>);
      })()}
    </Modal>
  );
}
