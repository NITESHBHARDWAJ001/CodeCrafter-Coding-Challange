import { DateTime } from 'luxon';

/** "Releases today at 09:00" / "Releases tomorrow" / "Releases in 5 days" — computed in the program's timezone. */
export function releaseLabel(releaseAt: string | Date, zone: string, now: Date = new Date()): string {
  const rel = DateTime.fromJSDate(new Date(releaseAt)).setZone(zone);
  const today = DateTime.fromJSDate(now).setZone(zone).startOf('day');
  const days = Math.round(rel.startOf('day').diff(today, 'days').days);
  if (days <= 0) return `Releases today at ${rel.toFormat('HH:mm')}`;
  if (days === 1) return 'Releases tomorrow';
  if (days < 14) return `Releases in ${days} days`;
  return `Releases on ${rel.toFormat('dd LLL yyyy')}`;
}
