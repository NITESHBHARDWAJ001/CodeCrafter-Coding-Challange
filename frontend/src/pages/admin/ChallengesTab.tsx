import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../../lib/api';
import type { AdminChallenge, Difficulty } from '../../lib/types';
import { fmtDay } from '../../lib/format';
import { Badge, Button, Card, CardHeader, DifficultyBadge, EmptyState, ErrorState, Field, Input, Modal, PageSkeleton, Select, StateBadge, Toggle, useToast } from '../../components/ui';

const COLS = ['day_number', 'title', 'leetcode_url', 'category', 'difficulty', 'points', 'release_date', 'release_time'] as const;
type Raw = Record<string, string | number | null>;
interface Report { validCount: number; invalidCount: number; errors: Array<{ row: number; field?: string; message: string }>; rows: Raw[] }

export const CSV_TEMPLATE = `${COLS.join(',')}
1,Two Sum,https://leetcode.com/problems/two-sum/,Arrays,Easy,100,2026-10-10,09:00
2,Valid Parentheses,https://leetcode.com/problems/valid-parentheses/,Stack,Easy,100,2026-10-11,09:00
3,Binary Search,https://leetcode.com/problems/binary-search/,Binary Search,Easy,100,2026-10-12,09:00
`;

export function ChallengesTab({ programId }: { programId: string }) {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['admin-challenges', programId], queryFn: () => api.get<{ challenges: AdminChallenge[] }>(`/admin/programs/${programId}/challenges`), refetchInterval: 60_000 });
  const [edit, setEdit] = useState<AdminChallenge | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-challenges', programId] }); qc.invalidateQueries({ queryKey: ['admin-program', programId] }); };

  const cancel = useMutation({ mutationFn: (c: AdminChallenge) => api.patch(`/admin/challenges/${c.id}/cancel`, { cancelled: c.status !== 'CANCELLED' }), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'bad') });
  const del = useMutation({ mutationFn: (c: AdminChallenge) => api.del(`/admin/challenges/${c.id}`), onSuccess: () => { toast('Challenge deleted'); refresh(); }, onError: (e) => toast(errorMessage(e), 'bad') });

  const list = q.data?.challenges ?? [];
  return (
    <>
      <Card>
        <CardHeader title="Challenges" sub={`${list.length} total · ${list.filter((c) => c.state === 'ACTIVE' || c.state === 'COMPLETED').length} released. The server only reveals a day to students at its release time.`}
          action={<div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => setBulk(true)}>⬆ Bulk upload CSV</Button><Button size="sm" onClick={() => setEdit('new')}>+ Add challenge</Button></div>} />
        {q.isLoading ? <div className="p-5"><PageSkeleton /></div> : q.error ? <div className="p-5"><ErrorState error={q.error} retry={() => q.refetch()} /></div>
          : !list.length ? <EmptyState icon="🧩" title="No challenges yet" body="Add them one by one, or upload a CSV with all days at once." action={<Button onClick={() => setBulk(true)}>Bulk upload CSV</Button>} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-500"><th className="px-5 py-2.5">Day</th><th>Problem</th><th>Category</th><th>Difficulty</th><th className="text-right">Points</th><th>Release (IST)</th><th>State</th><th className="px-5" /></tr></thead>
                <tbody>{list.map((c) => (
                  <tr key={c.id} className="border-t border-ink-100">
                    <td className="num px-5 py-3 font-bold">{fmtDay(c.day_number)}</td>
                    <td className="py-3 pr-3"><a href={c.external_problem_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{c.title}</a><div className="num text-xs text-ink-400">{c.external_problem_id}</div></td>
                    <td>{c.category}</td><td><DifficultyBadge d={c.difficulty} /></td>
                    <td className="num text-right font-semibold">{c.points}{c.points_override !== null && <span title="Admin override" className="ml-1 text-saffron-600">*</span>}</td>
                    <td className="num whitespace-nowrap text-xs">{c.release_date} {c.release_time}</td>
                    <td><StateBadge s={c.state} />{c.has_submissions && <Badge className="ml-1">solves</Badge>}</td>
                    <td className="whitespace-nowrap px-5 text-right">
                      <button className="px-2 py-1 text-xs font-semibold text-ink-600 hover:underline" onClick={() => setEdit(c)}>Edit</button>
                      <button className="px-2 py-1 text-xs font-semibold text-ink-600 hover:underline" onClick={() => cancel.mutate(c)}>{c.status === 'CANCELLED' ? 'Restore' : 'Cancel'}</button>
                      {!c.has_submissions && <button className="px-2 py-1 text-xs font-semibold text-bad hover:underline" onClick={() => confirm(`Delete ${fmtDay(c.day_number)}?`) && del.mutate(c)}>Delete</button>}
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>)}
      </Card>
      {edit && <ChallengeForm programId={programId} challenge={edit === 'new' ? null : edit} nextDay={Math.max(0, ...list.map((c) => c.day_number)) + 1} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {bulk && <BulkUpload programId={programId} onClose={() => setBulk(false)} onDone={refresh} />}
    </>
  );
}

function ChallengeForm({ programId, challenge, nextDay, onClose, onSaved }: { programId: string; challenge: AdminChallenge | null; nextDay: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    day_number: String(challenge?.day_number ?? nextDay), title: challenge?.title ?? '', leetcode_url: challenge?.external_problem_url ?? '',
    category: challenge?.category ?? '', difficulty: (challenge?.difficulty ?? 'EASY') as Difficulty,
    points: challenge?.points_override !== null && challenge?.points_override !== undefined ? String(challenge.points_override) : '',
    release_date: challenge?.release_date ?? '', release_time: challenge?.release_time ?? '09:00',
  });
  const [errs, setErrs] = useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => challenge ? api.put(`/admin/challenges/${challenge.id}`, f) : api.post(`/admin/programs/${programId}/challenges`, f),
    onSuccess: () => { toast('Saved'); onSaved(); },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.errors) setErrs((e.details.errors as Array<{ message: string }>).map((x) => x.message));
      else setErrs([errorMessage(e)]);
    },
  });
  return (
    <Modal open onClose={onClose} title={challenge ? `Edit ${fmtDay(challenge.day_number)}` : 'Add challenge'}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setErrs([]); save.mutate(); }}>
        <Field label="Day number"><Input type="number" min={1} required value={f.day_number} onChange={set('day_number')} /></Field>
        <Field label="Difficulty"><Select value={f.difficulty} onChange={set('difficulty')}><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></Select></Field>
        <div className="sm:col-span-2"><Field label="Title"><Input required value={f.title} onChange={set('title')} placeholder="Two Sum" /></Field></div>
        <div className="sm:col-span-2"><Field label="LeetCode URL" hint="The problem slug is extracted automatically (two-sum)."><Input required value={f.leetcode_url} onChange={set('leetcode_url')} placeholder="https://leetcode.com/problems/two-sum/" /></Field></div>
        <Field label="Category"><Input value={f.category} onChange={set('category')} placeholder="Arrays" /></Field>
        <Field label="Points" hint="Leave empty to use the program's default for this difficulty."><Input type="number" min={0} value={f.points} onChange={set('points')} /></Field>
        <Field label="Release date"><Input type="date" required value={f.release_date} onChange={set('release_date')} /></Field>
        <Field label="Release time (program timezone)"><Input type="time" required value={f.release_time} onChange={set('release_time')} /></Field>
        {errs.length > 0 && <ul className="rounded-xl bg-bad-bg p-3 text-sm font-medium text-bad sm:col-span-2" role="alert">{errs.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save challenge</Button></div>
      </form>
    </Modal>
  );
}

function BulkUpload({ programId, onClose, onDone }: { programId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [rows, setRows] = useState<Raw[]>([]);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number[] } | null>(null);

  const apply = (r: Report) => { setReport(r); setRows(r.rows); };
  const validate = useMutation({
    mutationFn: () => report ? api.post<Report>(`/admin/programs/${programId}/challenges/bulk/validate`, { rows }) : api.post<Report>(`/admin/programs/${programId}/challenges/bulk/validate`, { csv: text }),
    onSuccess: apply, onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const doImport = useMutation({
    mutationFn: () => api.post<{ imported: number; skipped: number[] }>(`/admin/programs/${programId}/challenges/bulk/import`, { rows, skipInvalid, onConflict: replace ? 'replace' : 'skip' }),
    onSuccess: (r) => { setResult(r); onDone(); }, onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const invalidIdx = useMemo(() => [...new Set((report?.errors ?? []).map((e) => e.row - 2))].filter((i) => i >= 0).sort((a, b) => a - b), [report]);
  const errFor = (rowNo: number, field: string) => report?.errors.find((e) => e.row === rowNo && e.field === field)?.message;
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' })); a.download = 'challenges-template.csv'; a.click(); };

  if (result) return (
    <Modal open onClose={onClose} title="Import complete">
      <div className="space-y-3 text-center"><div className="text-5xl">🎉</div><p className="text-lg font-semibold">{result.imported} challenge{result.imported === 1 ? '' : 's'} imported</p>
        {result.skipped.length > 0 && <p className="text-sm text-ink-600">Skipped existing days: {result.skipped.join(', ')}</p>}
        <p className="text-sm text-ink-600">They stay hidden from students until each release time.</p><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );

  return (
    <Modal open onClose={onClose} title="Bulk upload challenges" wide>
      {!report ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">Columns: <code className="num text-xs">{COLS.join(', ')}</code>. Blank <code>points</code> uses the program default. Times are in the program&apos;s timezone.</p>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>Choose CSV file…</Button><Button variant="ghost" size="sm" onClick={download}>Download template</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></div>
          <textarea className="num h-56 w-full rounded-xl border border-ink-200 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-ink-200" placeholder="…or paste CSV here" value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV content" />
          <div className="flex justify-end"><Button loading={validate.isPending} disabled={!text.trim()} onClick={() => validate.mutate()}>Validate</Button></div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-ok-bg p-4"><div className="text-xs font-semibold uppercase text-ok">Valid rows</div><div className="num text-3xl font-bold text-ok">{report.validCount}</div></div>
            <div className={`rounded-xl p-4 ${report.invalidCount ? 'bg-bad-bg' : 'bg-ink-50'}`}><div className={`text-xs font-semibold uppercase ${report.invalidCount ? 'text-bad' : 'text-ink-500'}`}>Invalid rows</div><div className={`num text-3xl font-bold ${report.invalidCount ? 'text-bad' : 'text-ink-500'}`}>{report.invalidCount}</div></div>
          </div>
          {report.errors.length > 0 && (
            <div><h3 className="mb-2 text-sm font-semibold">Errors</h3>
              <ul className="max-h-36 overflow-y-auto rounded-xl border border-ink-100 p-3 text-sm">{report.errors.map((e, i) => <li key={i}><span className="num font-bold">Row {e.row}</span> → {e.message}</li>)}</ul></div>
          )}
          {invalidIdx.length > 0 && (
            <div><h3 className="mb-2 text-sm font-semibold">Fix invalid rows, then re-validate</h3>
              <div className="overflow-x-auto rounded-xl border border-ink-100"><table className="w-full min-w-[900px] text-xs">
                <thead className="bg-ink-50 text-left uppercase tracking-wider text-ink-500"><tr><th className="px-2 py-2">Row</th>{COLS.map((c) => <th key={c} className="px-1 py-2">{c}</th>)}</tr></thead>
                <tbody>{invalidIdx.map((i) => (
                  <tr key={i} className="border-t border-ink-100"><td className="num px-2 font-bold">{i + 2}</td>
                    {COLS.map((c) => { const m = errFor(i + 2, c); return (
                      <td key={c} className="p-1"><input aria-label={`${c} row ${i + 2}`} title={m} value={String(rows[i]?.[c] ?? '')} onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [c]: e.target.value } : r))}
                        className={`w-full min-w-[80px] rounded-md border px-1.5 py-1 ${m ? 'border-bad bg-bad-bg/40' : 'border-ink-200'}`} /></td>); })}
                  </tr>))}</tbody></table></div></div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Toggle checked={skipInvalid} onChange={setSkipInvalid} label="Skip invalid rows" />
            <Toggle checked={replace} onChange={setReplace} label="Replace existing days" />
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => { setReport(null); }}>← Back</Button>
            <div className="flex gap-2">
              <Button variant="secondary" loading={validate.isPending} onClick={() => validate.mutate()}>Re-validate</Button>
              <Button variant="accent" loading={doImport.isPending} disabled={report.validCount === 0 || (report.invalidCount > 0 && !skipInvalid)} onClick={() => doImport.mutate()}>Import {skipInvalid ? report.validCount : rows.length} rows</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
