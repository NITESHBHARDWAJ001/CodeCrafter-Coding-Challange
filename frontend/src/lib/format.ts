export const LEVEL_LABEL = { FOUNDATION: 'Foundation', DIPLOMA: 'Diploma', DEGREE: 'Degree' } as const;
export const DIFF_LABEL = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' } as const;
export const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-IN');

export function fmtDate(iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }, tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: tz }).format(new Date(iso));
}
export const fmtTime = (iso: string | Date, tz = 'Asia/Kolkata') =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(iso));
export const fmtDateTime = (iso: string | Date, tz = 'Asia/Kolkata') => `${fmtDate(iso, { day: '2-digit', month: 'short', year: 'numeric' }, tz)} · ${fmtTime(iso, tz)}`;
export const fmtDay = (n: number) => `Day ${String(n).padStart(2, '0')}`;
export const fmtDuration = (a: string, b: string | null) => {
  if (!b) return '…';
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
