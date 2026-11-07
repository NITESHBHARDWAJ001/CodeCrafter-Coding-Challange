import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import type { Announcement, Program } from '../../lib/types';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageSkeleton, Select, Textarea, useToast } from '../../components/ui';

interface ListResult { announcements: Announcement[]; push_configured: boolean }
interface ParticipantHit { id: string; full_name: string; email: string }
type Audience = 'ALL' | 'PROGRAM' | 'STUDENT';

export function AnnouncementsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<ListResult>('/admin/announcements?limit=30') });
  const programs = useQuery({ queryKey: ['admin-programs'], queryFn: () => api.get<{ programs: Program[] }>('/admin/programs') });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('ALL');
  const [programId, setProgramId] = useState('');
  const [url, setUrl] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [student, setStudent] = useState<ParticipantHit | null>(null);

  const studentSearch = useQuery({
    queryKey: ['announce-student-search', studentQuery],
    queryFn: () => api.get<{ items: ParticipantHit[] }>(`/admin/participants?q=${encodeURIComponent(studentQuery)}&limit=6`),
    enabled: studentQuery.trim().length >= 2,
  });

  const reset = () => { setTitle(''); setBody(''); setUrl(''); setStudent(null); setStudentQuery(''); };

  const send = useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number; push_configured: boolean }>('/admin/announcements', {
      title, body, audience,
      program_id: audience === 'PROGRAM' ? programId : undefined,
      user_id: audience === 'STUDENT' ? student?.id : undefined,
      url: url || undefined,
    }),
    onSuccess: (r) => {
      toast(r.push_configured ? `Sent — ${r.sent} delivered${r.failed ? `, ${r.failed} failed` : ''}` : 'Saved. Push is not configured yet, so nobody was notified — see note below.');
      reset();
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/announcements/${id}`),
    onSuccess: () => { toast('Announcement deleted'); qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  if (list.isLoading) return <PageSkeleton />;
  if (list.error) return <ErrorState error={list.error} retry={() => list.refetch()} />;
  const { announcements, push_configured } = list.data!;

  const canSend = title.trim().length >= 2 && body.trim().length >= 1
    && (audience !== 'PROGRAM' || !!programId)
    && (audience !== 'STUDENT' || !!student);

  return (
    <div className="space-y-6">
      {!push_configured && (
        <Card className="border-saffron-500/40 bg-saffron-100/40 p-4 text-sm text-ink-700">
          <b className="text-ink-900">Push isn&apos;t configured yet.</b> Announcements will still save and show in students&apos; in-app feed, but no push notification will be sent until <code className="rounded bg-white px-1.5 py-0.5">VAPID_PUBLIC_KEY</code> / <code className="rounded bg-white px-1.5 py-0.5">VAPID_PRIVATE_KEY</code> are set on the backend.
        </Card>
      )}
      <Card>
        <CardHeader title="New announcement" sub="Sends a push notification to its audience and adds it to the in-app feed. Use “A specific student” to test safely without broadcasting." />
        <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Field label="Title"><Input required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Day 5 challenge is live!" /></Field>
          <Field label="Message"><Textarea required maxLength={1000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Solve it before midnight to keep your streak." /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience">
              <Select value={audience} onChange={(e) => { setAudience(e.target.value as Audience); setStudent(null); setStudentQuery(''); }}>
                <option value="ALL">All students</option>
                <option value="PROGRAM">One program&apos;s participants</option>
                <option value="STUDENT">A specific student (testing)</option>
              </Select>
            </Field>
            {audience === 'PROGRAM' && (
              <Field label="Program">
                <Select required value={programId} onChange={(e) => setProgramId(e.target.value)}>
                  <option value="" disabled>Choose a program…</option>
                  {programs.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            {audience === 'STUDENT' && (
              <Field label="Student" hint={!student ? 'Search by name or email' : undefined}>
                {student ? (
                  <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm">
                    <span><b>{student.full_name}</b> · {student.email}</span>
                    <button type="button" className="font-semibold text-ink-600 hover:underline" onClick={() => setStudent(null)}>Change</button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} placeholder="rahul@students.test" autoComplete="off" />
                    {studentQuery.trim().length >= 2 && (
                      <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg">
                        {studentSearch.isLoading ? <div className="px-3.5 py-2.5 text-sm text-ink-500">Searching…</div>
                          : !studentSearch.data?.items.length ? <div className="px-3.5 py-2.5 text-sm text-ink-500">No match</div>
                          : studentSearch.data.items.map((s) => (
                            <button type="button" key={s.id} className="block w-full px-3.5 py-2.5 text-left text-sm hover:bg-ink-50" onClick={() => { setStudent(s); setStudentQuery(''); }}>
                              <b>{s.full_name}</b> <span className="text-ink-500">· {s.email}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            )}
          </div>
          <Field label="Link (optional)" hint="Opened when the notification is clicked, e.g. /programs/&lt;id&gt;"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/programs/..." /></Field>
          <div><Button type="submit" variant="accent" loading={send.isPending} disabled={!canSend}>📣 Send announcement</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title="History" />
        {!announcements.length ? <EmptyState icon="📣" title="No announcements yet" body="Send your first one above to test push notifications." /> : (
          <ul className="divide-y divide-ink-100">{announcements.map((a) => (
            <li key={a.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="font-semibold">{a.title}</div><p className="mt-0.5 text-sm text-ink-600">{a.body}</p></div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <Badge tone={a.audience === 'ALL' ? 'info' : a.audience === 'STUDENT' ? 'accent' : 'neutral'}>{a.audience === 'ALL' ? 'All' : a.audience === 'STUDENT' ? 'One student' : 'Program'}</Badge>
                  <span>{fmtDateTime(a.created_at)}</span>
                  <Button size="sm" variant="ghost" className="text-bad hover:bg-bad-bg" loading={del.isPending && del.variables === a.id} onClick={() => confirm('Delete this announcement? It will disappear from everyone’s feed.') && del.mutate(a.id)}>Delete</Button>
                </div>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-ink-500">
                <span>Sent <b className="num text-ink-800">{a.sent_count}</b></span>
                {a.failed_count > 0 && <span className="text-bad">Failed <b className="num">{a.failed_count}</b></span>}
              </div>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}
