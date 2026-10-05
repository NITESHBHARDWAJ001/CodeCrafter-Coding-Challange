import { DateTime } from 'luxon';

export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

/** "2026-10-10" + "09:00" interpreted in `zone` -> absolute instant. Throws on invalid input. */
export function toInstant(date: string, time: string, zone: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new Error(`Invalid date/time "${date} ${time}" in ${zone}`);
  return dt.toJSDate();
}

export function startOfDate(date: string, zone: string): Date {
  return DateTime.fromISO(date, { zone }).startOf('day').toJSDate();
}
export function endOfDate(date: string, zone: string): Date {
  return DateTime.fromISO(date, { zone }).endOf('day').toJSDate();
}
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}
export function formatLocal(d: Date | string, zone: string): { date: string; time: string } {
  const dt = (typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(d)).setZone(zone);
  return { date: dt.toISODate()!, time: dt.toFormat('HH:mm') };
}
export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}
