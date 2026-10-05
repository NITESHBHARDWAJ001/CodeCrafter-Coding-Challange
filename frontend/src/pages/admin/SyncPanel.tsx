import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import type { SyncLog, SyncSettings } from '../../lib/types';
import { fmtDateTime, fmtDuration, fmtNum, fmtTime } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageSkeleton, ProgressBar, Select, Toggle, useToast } from '../../components/ui';

interface Status { settings: SyncSettings; last_sync: SyncLog | null; running: SyncLog | null; next_run: string | null }

const tone = (s: SyncLog['status']) => (s === 'SUCCESS' ? 'ok' : s === 'PARTIAL' ? 'warn' : s === 'FAILED' ? 'bad' : 'info') as 'ok' | 'warn' | 'bad' | 'info';

export function SyncPanel({ programId }: { programId?: string }) {
  const qc = useQueryClient(); const toast = useToast();
  const qs = programId ? `?program_id=${programId}` : '';
  const status = useQuery({ queryKey: ['sync-status', programId], queryFn: () => api.get<Status>(`/admin/sync/status${qs}`), refetchInterval: (q) => (q.state.data?.running ? 2000 : 15000) });
  const logs = useQuery({ queryKey: ['sync-logs', programId], queryFn: () => api.get<{ logs: SyncLog[] }>(`/admin/sync/logs${qs}${qs ? '&' : '?'}limit=30`), refetchInterval: status.data?.running ? 3000 : 20000 });
  const start = useMutation({
    mutationFn: () => api.post<{ started: number }>('/admin/sync', programId ? { program_id: programId } : {}),
    onSuccess: (r) => { toast(r.started ? `Sync started for ${r.started} program${r.started > 1 ? 's' : ''}` : 'Nothing to sync (no active programs, or one is already running)'); qc.invalidateQueries({ queryKey: ['sync-status'] }); qc.invalidateQueries({ queryKey: ['sync-logs'] }); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  if (status.isLoading) return <PageSkeleton />;
  if (status.error) return <ErrorState error={status.error} retry={() => status.refetch()} />;
  const { settings, last_sync: last, running, next_run } = status.data!;
  const manualAllowed = settings.mode !== 'SCHEDULED';

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-ink-900 px-5 py-3 text-xs font-bold uppercase tracking-[.2em] text-saffron-400">Sync leaderboard</div>
        <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KV k="Last sync" v={last ? fmtTime(last.started_at) : '—'} sub={last ? fmtDateTime(last.started_at).split(' · ')[0] : undefined} />
            <KV k="Participants" v={fmtNum((running ?? last)?.participants_total)} />
            <KV k="Checked" v={fmtNum((running ?? last)?.participants_checked)} />
            <KV k="New solves" v={fmtNum((running ?? last)?.new_submissions)} />
          </div>
          <div className="flex flex-col gap-2 md:w-52">
            <Button variant="accent" size="lg" loading={start.isPending || !!running} disabled={!manualAllowed} onClick={() => start.mutate()}>{running ? 'Syncing…' : '🔄 SYNC NOW'}</Button>
            {!manualAllowed && <p className="text-xs text-ink-500">Manual sync is off (mode: Scheduled only).</p>}
          </div>
        </div>
        {running && <div className="border-t border-ink-100 px-5 py-4"><div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold">Running… {running.program_name ?? ''}</span><span className="num">{running.participants_checked} / {running.participants_total || '…'}</span></div><ProgressBar value={running.participants_checked} max={running.participants_total || 1} /></div>}
      </Card>

      {!programId && <SettingsCard settings={settings} nextRun={next_run} />}

      <Card>
        <CardHeader title="Sync history" />
        {logs.isLoading ? <div className="p-5"><PageSkeleton /></div> : !logs.data?.logs.length ? <EmptyState icon="🕘" title="No syncs yet" body="Run the first one with Sync Now." /> : (
          <ul className="divide-y divide-ink-100">{logs.data.logs.map((l) => <LogRow key={l.id} l={l} />)}</ul>)}
      </Card>
    </div>
  );
}

const KV = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (<div><div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{k}</div><div className="num mt-1 text-2xl font-bold">{v}</div>{sub && <div className="text-xs text-ink-500">{sub}</div>}</div>);

function LogRow({ l }: { l: SyncLog }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="font-semibold">{fmtDateTime(l.started_at)}</div><div className="text-xs text-ink-500">{l.program_name ?? 'All'} · {l.sync_type === 'MANUAL' ? 'Manual' : 'Scheduled'} · {fmtDuration(l.started_at, l.completed_at)}</div></div>
        <div className="flex items-center gap-5 text-sm">
          <span>Checked <b className="num">{fmtNum(l.participants_checked)}</b></span><span>New solves <b className="num">{fmtNum(l.new_submissions)}</b></span><span>Failed <b className={`num ${l.failed_users ? 'text-bad' : ''}`}>{fmtNum(l.failed_users)}</b></span>
          <Badge tone={tone(l.status)}>{l.status}</Badge>
        </div>
      </div>
      {(l.error_message || l.failures.length > 0) && (
        <div className="mt-2">
          {l.error_message && <p className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{l.error_message}</p>}
          {l.failures.length > 0 && <button className="text-xs font-semibold text-ink-600 hover:underline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'} failed checks ({l.failures.length}{l.failed_users > l.failures.length ? `+` : ''})</button>}
          {open && <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-ink-50 p-3 text-xs">{l.failures.map((f, i) => <li key={i}><span className="num font-bold">{f.username}</span> — {f.error}</li>)}</ul>}
        </div>)}
    </li>
  );
}

function SettingsCard({ settings, nextRun }: { settings: SyncSettings; nextRun: string | null }) {
  const qc = useQueryClient(); const toast = useToast();
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = useMutation({ mutationFn: () => api.put('/admin/sync/settings', s), onSuccess: () => { toast('Sync settings saved'); qc.invalidateQueries({ queryKey: ['sync-status'] }); }, onError: (e) => toast(errorMessage(e), 'bad') });
  return (
    <Card>
      <CardHeader title="Automatic sync" sub={nextRun && s.enabled && settings.mode !== 'MANUAL' ? `Next run: ${fmtDateTime(nextRun, settings.timezone)} (${settings.timezone})` : 'Scheduled sync is off'} action={<Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label={s.enabled ? 'ON' : 'OFF'} />} />
      <form className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Mode"><Select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as SyncSettings['mode'] })}><option value="MANUAL">Manual only</option><option value="SCHEDULED">Scheduled only</option><option value="BOTH">Both</option></Select></Field>
        <Field label="Frequency"><Select value={s.frequency} onChange={(e) => setS({ ...s, frequency: e.target.value as SyncSettings['frequency'] })}><option value="DAILY">Daily</option><option value="EVERY_6_HOURS">Every 6 hours</option><option value="HOURLY">Hourly</option></Select></Field>
        <Field label="Sync time" hint={s.frequency === 'DAILY' ? 'Time of day' : 'Minute past the hour is used'}><Input type="time" required value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} /></Field>
        <Field label="Timezone"><Input list="sync-tz" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} /><datalist id="sync-tz">{['Asia/Kolkata', 'UTC', 'Asia/Singapore', 'Europe/London', 'America/New_York'].map((t) => <option key={t} value={t} />)}</datalist></Field>
        <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={save.isPending}>Save settings</Button>
          <p className="mt-2 text-xs text-ink-500">LeetCode only exposes each user&apos;s 20 most recent accepted submissions, so syncing at least daily is recommended.</p></div>
      </form>
    </Card>
  );
}
