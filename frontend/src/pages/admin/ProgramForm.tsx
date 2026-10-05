import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../../lib/api';
import type { Program } from '../../lib/types';
import { Button, Field, Input, Select, Textarea, Toggle, useToast } from '../../components/ui';

const TZ = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function ProgramForm({ program, onSaved, onCancel }: { program?: Program; onSaved: (p: Program) => void; onCancel?: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [f, setF] = useState({
    name: program?.name ?? '', description: program?.description ?? '', start_date: program?.start_date ?? '', duration_days: String(program?.duration_days ?? 30),
    status: program?.status ?? 'DRAFT', enrollment_open: program?.enrollment_open ?? true, timezone: program?.timezone ?? 'Asia/Kolkata',
    challenge_window_hours: String(program?.challenge_window_hours ?? 24), certificate_enabled: program?.certificate_enabled ?? false,
    certificate_prefix: program?.certificate_prefix ?? '', streak_policy: program?.streak_policy ?? 'RESET_ON_MISS', streak_grace_days: String(program?.streak_grace_days ?? 1),
    easy: String(program?.default_points?.EASY ?? 100), medium: String(program?.default_points?.MEDIUM ?? 150), hard: String(program?.default_points?.HARD ?? 250),
  });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [top, setTop] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const end = f.start_date && Number(f.duration_days) > 0 ? addDays(f.start_date, Number(f.duration_days) - 1) : '';

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name, description: f.description, start_date: f.start_date, duration_days: Number(f.duration_days), status: f.status,
        enrollment_open: f.enrollment_open, timezone: f.timezone, challenge_window_hours: Number(f.challenge_window_hours),
        certificate_enabled: f.certificate_enabled, streak_policy: f.streak_policy, streak_grace_days: f.streak_policy === 'GRACE_DAYS' ? Number(f.streak_grace_days) : 0,
        default_points: { EASY: Number(f.easy), MEDIUM: Number(f.medium), HARD: Number(f.hard) },
      };
      if (f.certificate_prefix) body.certificate_prefix = f.certificate_prefix.toUpperCase();
      return program ? api.patch<{ program: Program }>(`/admin/programs/${program.id}`, body) : api.post<{ program: Program }>('/admin/programs', body);
    },
    onSuccess: (r) => { toast(program ? 'Program updated' : 'Program created'); qc.invalidateQueries({ queryKey: ['admin-programs'] }); qc.invalidateQueries({ queryKey: ['admin-program'] }); onSaved(r.program); },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.fieldErrors) setErrs(Object.fromEntries(Object.entries(e.details.fieldErrors as Record<string, string[]>).map(([k, v]) => [k, v[0]])));
      else setTop(errorMessage(e));
    },
  });

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setErrs({}); setTop(''); save.mutate(); }}>
      <div className="sm:col-span-2"><Field label="Program name" error={errs.name}><Input required value={f.name} onChange={set('name')} placeholder="30 Days of DSA" /></Field></div>
      <div className="sm:col-span-2"><Field label="Description"><Textarea rows={3} value={f.description} onChange={set('description')} /></Field></div>
      <Field label="Start date" error={errs.start_date}><Input type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
      <Field label="Duration (days)" hint={end ? `Ends ${end} (calculated)` : undefined} error={errs.duration_days}><Input type="number" min={1} max={1000} required value={f.duration_days} onChange={set('duration_days')} /></Field>
      <Field label="Status" hint="DRAFT programs are invisible to students."><Select value={f.status} onChange={set('status')}>{['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Timezone" hint="Release times and streak days use this zone."><Input list="tzs" value={f.timezone} onChange={set('timezone')} /><datalist id="tzs">{TZ.map((t) => <option key={t} value={t} />)}</datalist></Field>
      <Field label="Solve window (hours)" hint="How long after release a solve earns the day's points." error={errs.challenge_window_hours}><Input type="number" min={1} max={720} value={f.challenge_window_hours} onChange={set('challenge_window_hours')} /></Field>
      <div className="flex items-end pb-2"><Toggle checked={f.enrollment_open} onChange={(v) => setF((s) => ({ ...s, enrollment_open: v }))} label="Enrollment open" /></div>

      <fieldset className="grid grid-cols-3 gap-3 sm:col-span-2"><legend className="mb-1.5 text-sm font-semibold">Default points by difficulty</legend>
        <Field label="Easy"><Input type="number" min={0} value={f.easy} onChange={set('easy')} /></Field><Field label="Medium"><Input type="number" min={0} value={f.medium} onChange={set('medium')} /></Field><Field label="Hard"><Input type="number" min={0} value={f.hard} onChange={set('hard')} /></Field></fieldset>

      <Field label="When a day is missed" hint="Resets to 0, or forgive a few consecutive misses."><Select value={f.streak_policy} onChange={set('streak_policy')}><option value="RESET_ON_MISS">Reset streak immediately</option><option value="GRACE_DAYS">Grace days</option></Select></Field>
      {f.streak_policy === 'GRACE_DAYS' && <Field label="Grace days"><Input type="number" min={0} max={30} value={f.streak_grace_days} onChange={set('streak_grace_days')} /></Field>}

      <div className="flex items-end pb-2"><Toggle checked={f.certificate_enabled} onChange={(v) => setF((s) => ({ ...s, certificate_enabled: v }))} label="Certificates enabled" /></div>
      {f.certificate_enabled && <Field label="Certificate ID prefix" hint={`e.g. CC-${f.certificate_prefix || 'DSA'}-2026-000182`} error={errs.certificate_prefix}><Input value={f.certificate_prefix} onChange={set('certificate_prefix')} placeholder="auto" maxLength={8} /></Field>}

      {top && <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm font-medium text-bad sm:col-span-2">{top}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}<Button type="submit" loading={save.isPending}>{program ? 'Save changes' : 'Create program'}</Button></div>
    </form>
  );
}
