import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import type { Certificate, Level, Rules } from '../../lib/types';
import { fmtDate, fmtNum, LEVEL_LABEL } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageSkeleton, Stat, Toggle, useToast } from '../../components/ui';

interface Elig {
  certificate_enabled: boolean; program_status: string; rules: Rules; total_challenges: number; eligible: number; not_eligible: number; already_issued: number;
  participants: Array<{ user_id: string; full_name: string; leetcode_username: string; level: Level; solved: number; points: number; missedDays: number; eligible: boolean; reasons: string[]; certificate_code: string | null }>;
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const show = (n: number | null) => (n === null ? '' : String(n));

export function CertificatesTab({ programId }: { programId: string }) {
  const qc = useQueryClient(); const toast = useToast();
  const elig = useQuery({ queryKey: ['elig', programId], queryFn: () => api.get<Elig>(`/admin/programs/${programId}/certificates/eligibility`) });
  const certs = useQuery({ queryKey: ['program-certs', programId], queryFn: () => api.get<{ certificates: Certificate[] }>(`/admin/programs/${programId}/certificates`) });
  const [r, setR] = useState({ min_challenges: '', min_completion_pct: '', min_points: '', max_missed_days: '' });
  const [force, setForce] = useState(false);
  useEffect(() => { if (elig.data) setR({ min_challenges: show(elig.data.rules.min_challenges), min_completion_pct: show(elig.data.rules.min_completion_pct), min_points: show(elig.data.rules.min_points), max_missed_days: show(elig.data.rules.max_missed_days) }); }, [elig.data?.rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { qc.invalidateQueries({ queryKey: ['elig', programId] }); qc.invalidateQueries({ queryKey: ['program-certs', programId] }); };
  const saveRules = useMutation({
    mutationFn: () => api.put(`/admin/programs/${programId}/certificate-rules`, { min_challenges: numOrNull(r.min_challenges), min_completion_pct: numOrNull(r.min_completion_pct), min_points: numOrNull(r.min_points), max_missed_days: numOrNull(r.max_missed_days) }),
    onSuccess: () => { toast('Certificate criteria saved'); refresh(); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const toggle = useMutation({
    mutationFn: (v: boolean) => api.patch(`/admin/programs/${programId}`, { certificate_enabled: v }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['admin-program', programId] }); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const generate = useMutation({
    mutationFn: () => api.post<{ issued: number; failed: number }>(`/admin/programs/${programId}/certificates/generate${force ? '?force=true' : ''}`),
    onSuccess: (x) => { toast(`${x.issued} certificate${x.issued === 1 ? '' : 's'} issued${x.failed ? `, ${x.failed} failed` : ''}`, x.failed ? 'bad' : 'ok'); refresh(); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const download = useMutation({ mutationFn: (id: string) => api.get<{ url: string }>(`/admin/certificates/${id}/download`), onSuccess: (x) => window.open(x.url, '_blank', 'noopener'), onError: (e) => toast(errorMessage(e), 'bad') });

  if (elig.isLoading) return <PageSkeleton />;
  if (elig.error) return <ErrorState error={elig.error} retry={() => elig.refetch()} />;
  const e = elig.data!;
  const completed = e.program_status === 'COMPLETED';
  const todo = e.participants.filter((p) => p.eligible && !p.certificate_code).length;
  const set = (k: keyof typeof r) => (ev: { target: { value: string } }) => setR((s) => ({ ...s, [k]: ev.target.value }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Certificate settings" sub="Leave a criterion empty to not enforce it. Nothing is hard-coded." action={<Toggle checked={e.certificate_enabled} onChange={(v) => toggle.mutate(v)} label="Enable certificates" />} />
        <form className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(ev) => { ev.preventDefault(); saveRules.mutate(); }}>
          <Field label="Minimum challenges" hint={`of ${e.total_challenges}`}><Input type="number" min={0} value={r.min_challenges} onChange={set('min_challenges')} /></Field>
          <Field label="Minimum completion %"><Input type="number" min={0} max={100} step="0.1" value={r.min_completion_pct} onChange={set('min_completion_pct')} /></Field>
          <Field label="Minimum points"><Input type="number" min={0} value={r.min_points} onChange={set('min_points')} /></Field>
          <Field label="Maximum missed days"><Input type="number" min={0} value={r.max_missed_days} onChange={set('max_missed_days')} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={saveRules.isPending}>Save criteria</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Certificate eligibility" sub={`Program is ${e.program_status}. Evaluated live from verified submissions.`} />
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <Stat label="Eligible" value={fmtNum(e.eligible)} /><Stat label="Not eligible" value={fmtNum(e.not_eligible)} /><Stat label="Already issued" value={fmtNum(e.already_issued)} /><Stat label="Ready to issue" value={fmtNum(todo)} tone="dark" />
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-ink-100 px-5 py-4">
          <Button variant="accent" size="lg" disabled={!e.certificate_enabled || todo === 0 || (!completed && !force)} loading={generate.isPending}
            onClick={() => confirm(`Generate ${todo} certificate${todo === 1 ? '' : 's'}? This creates PDFs and unique verification IDs.`) && generate.mutate()}>🎓 Generate certificates</Button>
          {!completed && <Toggle checked={force} onChange={setForce} label="Program not finished — generate anyway (testing)" />}
          {!e.certificate_enabled && <span className="text-sm text-ink-500">Enable certificates first.</span>}
        </div>
        {!e.participants.length ? <EmptyState icon="👥" title="No participants" /> : (
          <div className="max-h-[420px] overflow-auto border-t border-ink-100"><table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500"><tr><th className="px-5 py-2">Participant</th><th>Level</th><th className="text-right">Solved</th><th className="text-right">Points</th><th className="text-right">Missed</th><th className="px-5">Result</th></tr></thead>
            <tbody>{e.participants.map((p) => (
              <tr key={p.user_id} className="border-t border-ink-100"><td className="px-5 py-2.5"><div className="font-semibold">{p.full_name}</div><div className="num text-xs text-ink-400">{p.leetcode_username}</div></td><td>{LEVEL_LABEL[p.level]}</td>
                <td className="num text-right">{p.solved}/{e.total_challenges}</td><td className="num text-right">{fmtNum(p.points)}</td><td className="num text-right">{p.missedDays}</td>
                <td className="px-5 py-2">{p.certificate_code ? <Badge tone="ok" className="num">{p.certificate_code}</Badge> : p.eligible ? <Badge tone="accent">Eligible</Badge> : <span title={p.reasons.join('\n')}><Badge tone="bad">Not eligible</Badge><div className="mt-0.5 text-[11px] text-ink-500">{p.reasons[0]}</div></span>}</td></tr>))}</tbody></table></div>)}
      </Card>

      <Card>
        <CardHeader title="Issued certificates" sub={`${certs.data?.certificates.length ?? 0} issued`} />
        {!certs.data?.certificates.length ? <EmptyState icon="📜" title="None issued yet" /> : (
          <ul className="divide-y divide-ink-100">{certs.data.certificates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div><div className="font-semibold">{c.recipient_name}</div><div className="num text-xs text-ink-500">{c.certificate_code} · {c.challenges_completed}/{c.total_challenges} · {fmtDate(c.issued_at)}</div></div>
              <div className="flex gap-2"><a href={`/verify/${c.certificate_code}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">Verify</Button></a><Button size="sm" onClick={() => download.mutate(c.id)}>PDF</Button></div></li>))}</ul>)}
      </Card>
    </div>
  );
}
