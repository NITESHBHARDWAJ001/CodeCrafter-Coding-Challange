import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { Certificate } from '../lib/types';
import { fmtDate, fmtNum, LEVEL_LABEL } from '../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Stat, Streak, useToast } from '../components/ui';

export default function ProfilePage() {
  const { profile, stats, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(''); const [level, setLevel] = useState('');
  useEffect(() => { if (profile) { setName(profile.full_name); setLevel(profile.level); } }, [profile]);

  const save = useMutation({
    mutationFn: () => api.patch('/me', { full_name: name, level }),
    onSuccess: () => { toast('Profile updated'); refresh(); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const certs = useQuery({ queryKey: ['my-certs'], queryFn: () => api.get<{ certificates: Certificate[] }>('/me/certificates') });
  const download = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/me/certificates/${id}/download`),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'), onError: (e) => toast(errorMessage(e), 'bad'),
  });
  if (!profile || !stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-ink-900 font-display text-2xl font-bold text-saffron-400">{profile.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
        <div><h1 className="text-2xl font-bold sm:text-3xl">{profile.full_name}</h1><p className="text-ink-600">{profile.email}</p></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Programs" value={stats.total_programs} hint={`${stats.active_programs} active`} />
        <Stat label="Problems solved" value={stats.problems_solved} />
        <Stat label="Total points" value={fmtNum(stats.total_points)} />
        <Stat label="Current rank" value={stats.current_rank ? `#${stats.current_rank}` : '–'} hint="overall" />
        <Stat label="Current streak" value={<Streak n={stats.current_streak} />} />
        <Stat label="Longest streak" value={`${stats.longest_streak}d`} />
        <Stat label="Certificates" value={stats.certificates_earned} />
        <Stat label="Joined" value={<span className="text-lg">{fmtDate(profile.created_at)}</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your details" />
          <form className="space-y-4 p-5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
            <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required /></Field>
            <Field label="Student email" hint="Email changes aren't supported here."><Input value={profile.email} disabled /></Field>
            <Field label="Level"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Button type="submit" loading={save.isPending} disabled={name === profile.full_name && level === profile.level}>Save changes</Button>
          </form>
        </Card>
        <LeetCodeLink />
      </div>

      <Card>
        <CardHeader title="Certificates" />
        {!certs.data?.certificates.length ? <EmptyState icon="🎓" title="No certificates yet" body="Complete a program with certificates enabled and meet its criteria." /> : (
          <ul className="divide-y divide-ink-100">{certs.data.certificates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div><div className="font-semibold">{c.program_name}</div><div className="num text-xs text-ink-500">{c.certificate_code} · {c.challenges_completed}/{c.total_challenges} · {fmtDate(c.issued_at)}</div></div>
              <div className="flex gap-2"><a href={`/verify/${c.certificate_code}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">Verify page</Button></a><Button size="sm" variant="accent" loading={download.isPending && download.variables === c.id} onClick={() => download.mutate(c.id)}>Download PDF</Button></div>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}

function LeetCodeLink() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [pending, setPending] = useState<{ new_username: string; code: string; instructions: string } | null>(null);
  const start = useMutation({
    mutationFn: () => api.post<{ new_username: string; code: string; instructions: string }>('/me/leetcode/relink', { new_username: username.trim() }),
    onSuccess: (r) => setPending(r), onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const confirm = useMutation({
    mutationFn: () => api.post('/me/leetcode/relink/confirm'),
    onSuccess: () => { toast('LeetCode account relinked ✅'); setPending(null); setUsername(''); refresh(); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  return (
    <Card>
      <CardHeader title="LeetCode account" sub="Used to verify your submissions. Changes require proof of ownership." />
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3"><span className="text-sm text-ink-600">Linked username</span><span className="num font-bold">{profile?.leetcode_username}</span></div>
        {!pending ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
            <Field label="Link a different account" hint="Past solves stay attributed to the account they were verified under."><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="new LeetCode username" /></Field>
            <Button type="submit" variant="secondary" loading={start.isPending} disabled={!username.trim()}>Start relink</Button>
          </form>
        ) : (
          <div className="space-y-3 rounded-xl border border-saffron-500/50 bg-saffron-100/50 p-4 text-sm">
            <p>{pending.instructions}</p>
            <div className="num select-all rounded-lg bg-white px-3 py-2 text-center text-lg font-bold">{pending.code}</div>
            <div className="flex gap-2"><Button loading={confirm.isPending} onClick={() => confirm.mutate()}>Confirm</Button><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}

void Badge;
