import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Card, Logo, Skeleton } from '../components/ui';
import { LeaderboardPanel } from '../components/Domain';

interface Result { verified: boolean; recipient_name?: string; program_name?: string; challenges_completed?: number; total_challenges?: number; issued_at?: string; issuer?: string; certificate_code?: string }

export function VerifyPage() {
  const { code } = useParams();
  const q = useQuery({
    queryKey: ['verify', code], retry: false,
    queryFn: async (): Promise<Result> => {
      try { return await api.get<Result>(`/verify/${encodeURIComponent(code!)}`); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return { verified: false }; throw e; }
    },
  });
  const r = q.data;
  return (
    <div className="min-h-screen bg-ink-900 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Link to="/" className="mb-8 block"><Logo light /></Link>
        <Card className="overflow-hidden">
          {q.isLoading ? <div className="space-y-3 p-8"><Skeleton className="h-8 w-40" /><Skeleton className="h-16" /></div>
            : q.error ? <div className="p-8 text-center"><p className="font-semibold text-bad">Couldn&apos;t check right now.</p><p className="mt-1 text-sm text-ink-600">Please try again in a moment.</p></div>
            : r?.verified ? (
              <>
                <div className="bg-ok px-6 py-5 text-white"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-white/20 text-2xl">✓</span><div><div className="font-display text-2xl font-bold">VERIFIED</div><div className="text-sm text-white/85">This certificate is authentic</div></div></div></div>
                <dl className="space-y-5 p-6">
                  <Item k="Awarded to" v={<span className="font-display text-2xl font-bold">{r.recipient_name}</span>} />
                  <Item k="Program" v={<span className="text-lg font-semibold">{r.program_name}</span>} />
                  <div className="grid grid-cols-2 gap-4"><Item k="Completion" v={<span className="num font-bold">{r.challenges_completed} / {r.total_challenges}</span>} /><Item k="Issued" v={<span className="font-semibold">{fmtDate(r.issued_at!, { day: '2-digit', month: 'long', year: 'numeric' })}</span>} /></div>
                  <Item k="Issued by" v={<span className="font-semibold">CodeCrafter Club<br />IIT Madras</span>} />
                  <Item k="Certificate ID" v={<span className="num font-semibold">{r.certificate_code}</span>} />
                </dl>
              </>
            ) : (
              <div className="p-8 text-center"><div className="text-5xl">❌</div><h1 className="mt-3 text-2xl font-bold">Not verified</h1><p className="mt-2 text-sm text-ink-600">We couldn&apos;t find a certificate with ID <span className="num font-semibold">{code}</span>. Check the ID for typos.</p></div>
            )}
        </Card>
        <p className="mt-6 text-center text-xs text-ink-400">Only the recipient&apos;s name and program are shown. No private student information is disclosed.</p>
      </div>
    </div>
  );
}
const Item = ({ k, v }: { k: string; v: React.ReactNode }) => (<div><dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">{k}</dt><dd className="mt-1">{v}</dd></div>);
void LeaderboardPanel;
