import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { ChallengeState, Difficulty, ProgramStatus } from '../lib/types';
import { DIFF_LABEL } from '../lib/format';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* ───────── Buttons ───────── */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; size?: 'sm' | 'md' | 'lg' };
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3.5 text-base' }[size];
  const v = {
    primary: 'bg-ink-900 text-white hover:bg-ink-700 shadow-sm',
    accent: 'bg-saffron-500 text-ink-950 hover:bg-saffron-400 shadow-sm',
    secondary: 'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50',
    ghost: 'text-ink-700 hover:bg-ink-100',
    danger: 'bg-bad text-white hover:opacity-90',
  }[variant];
  return (
    <button className={cx(base, sizes, v, className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────── Surfaces ───────── */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-2xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(15,27,61,.04),0_8px_24px_-12px_rgba(15,27,61,.12)]', className)} {...rest}>{children}</div>;
}
export const CardHeader = ({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
    <div><h3 className="text-base font-semibold">{title}</h3>{sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}</div>
    {action}
  </div>
);

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'info' | 'accent' | 'dark'; children: ReactNode; className?: string }) {
  const t = {
    neutral: 'bg-ink-100 text-ink-700', ok: 'bg-ok-bg text-ok', bad: 'bg-bad-bg text-bad', warn: 'bg-saffron-100 text-saffron-600',
    info: 'bg-ink-100 text-ink-600', accent: 'bg-saffron-500 text-ink-950', dark: 'bg-ink-900 text-white',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', t, className)}>{children}</span>;
}

export const DifficultyBadge = ({ d }: { d: Difficulty }) => (
  <Badge tone={d === 'EASY' ? 'ok' : d === 'MEDIUM' ? 'warn' : 'bad'}>{DIFF_LABEL[d]}</Badge>
);
export const ProgramStatusBadge = ({ s }: { s: ProgramStatus }) => (
  <Badge tone={s === 'ACTIVE' ? 'ok' : s === 'SCHEDULED' ? 'info' : s === 'COMPLETED' ? 'neutral' : s === 'DRAFT' ? 'warn' : 'neutral'}>{s}</Badge>
);
export const StateBadge = ({ s }: { s: ChallengeState }) => (
  <Badge tone={s === 'ACTIVE' ? 'accent' : s === 'COMPLETED' ? 'neutral' : s === 'CANCELLED' ? 'bad' : 'info'}>{s}</Badge>
);

export function ProgressBar({ value, max, className, tone = 'brand' }: { value: number; max: number; className?: string; tone?: 'brand' | 'ok' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cx('h-3 w-full overflow-hidden rounded-full bg-ink-100', className)} role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label="Progress">
      <div className={cx('h-full rounded-full transition-all duration-700', tone === 'ok' ? 'bg-ok' : 'bg-gradient-to-r from-ink-700 to-saffron-500')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'dark' }) {
  return (
    <div className={cx('rounded-2xl p-4', tone === 'dark' ? 'bg-ink-900 text-white' : 'bg-white border border-ink-100')}>
      <div className={cx('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider', tone === 'dark' ? 'text-ink-200' : 'text-ink-500')}>{icon}{label}</div>
      <div className="num mt-1.5 text-2xl font-bold leading-none sm:text-3xl">{value}</div>
      {hint && <div className={cx('mt-1.5 text-xs', tone === 'dark' ? 'text-ink-200' : 'text-ink-500')}>{hint}</div>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton', className)} />;
export const PageSkeleton = () => (
  <div className="space-y-4"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>
);

export function EmptyState({ title, body, action, icon = '🗂️' }: { title: string; body?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-4xl" aria-hidden>{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="max-w-md text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Card className="border-bad/30 bg-bad-bg/40 p-6 text-center">
      <p className="font-semibold text-bad">Couldn&apos;t load this</p>
      <p className="mt-1 text-sm text-ink-700">{error instanceof Error ? error.message : 'Unknown error'}</p>
      {retry && <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>Try again</Button>}
    </Card>
  );
}

/* ───────── Forms ───────── */
export const inputCls = 'w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm placeholder:text-ink-400 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-200 disabled:bg-ink-50 disabled:text-ink-500';
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-800">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-bad">{error}</span>}
    </label>
  );
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, 'pr-8', p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />;
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3 text-sm font-medium">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 rounded-full transition', checked ? 'bg-ok' : 'bg-ink-200')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Close">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition', value === t.id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ───────── Toasts ───────── */
type Toast = { id: number; tone: 'ok' | 'bad'; msg: string };
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg', t.tone === 'ok' ? 'bg-ink-900 text-white' : 'bg-bad text-white')}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────── Brand ───────── */
export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="14" fill={light ? '#f2a20c' : '#0f1b3d'} /><path d="M24 20 12 32l12 12M40 20l12 12-12 12" fill="none" stroke={light ? '#0f1b3d' : '#f2a20c'} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {!compact && (
        <div className="leading-tight">
          <div className={cx('font-display text-[15px] font-bold', light ? 'text-white' : 'text-ink-900')}>CodeCrafter Club</div>
          <div className={cx('text-[10px] font-semibold uppercase tracking-[.18em]', light ? 'text-saffron-400' : 'text-ink-500')}>IIT Madras</div>
        </div>
      )}
    </div>
  );
}

export const Streak = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-1 font-semibold">{n > 0 ? <span className="flame" aria-hidden>🔥</span> : <span aria-hidden>🧊</span>}<span className="num">{n}</span><span className="text-ink-500 font-medium">{n === 1 ? 'day' : 'days'}</span></span>
);
