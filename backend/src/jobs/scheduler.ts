import cron, { ScheduledTask } from 'node-cron';
import { DateTime } from 'luxon';
import { logger } from '../lib/logger';
import { syncRepo } from '../repositories/sync.repo';
import { syncService } from '../services/sync.service';
import { programService } from '../services/program.service';
import type { SyncSettings } from '../types/db';

/** Admin-configured schedule -> cron expression (evaluated in the configured timezone). */
export function toCron(s: Pick<SyncSettings, 'time' | 'frequency'>): string {
  const [hh, mm] = s.time.split(':').map(Number);
  switch (s.frequency) {
    case 'HOURLY': return `${mm} * * * *`;
    case 'EVERY_6_HOURS': return `${mm} ${hh % 6}-23/6 * * *`;
    default: return `${mm} ${hh} * * *`;
  }
}

/** Next firing time, for display in the admin UI. */
export function nextRunFor(s: SyncSettings, from = DateTime.now()): string | null {
  if (!s.enabled || s.mode === 'MANUAL') return null;
  const now = from.setZone(s.timezone);
  const [hh, mm] = s.time.split(':').map(Number);
  if (s.frequency === 'DAILY') {
    let t = now.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
    if (t <= now) t = t.plus({ days: 1 });
    return t.toUTC().toISO();
  }
  let t = now.set({ minute: mm, second: 0, millisecond: 0 });
  while (t <= now || (s.frequency === 'EVERY_6_HOURS' && (t.hour % 6) !== (hh % 6))) t = t.plus({ hours: 1 });
  return t.toUTC().toISO();
}

let syncTask: ScheduledTask | null = null;
let statusTask: ScheduledTask | null = null;
let current: SyncSettings | null = null;

export const schedulerService = {
  async start(): Promise<void> {
    const stale = await syncRepo.failStaleRunning();
    if (stale) logger.warn({ stale }, 'marked stale RUNNING syncs as FAILED');
    // Keeps stored program statuses aligned with the calendar (reads never depend on it).
    statusTask = cron.schedule('*/5 * * * *', () => {
      programService.advanceStatuses().catch((err) => logger.error({ err }, 'status advance failed'));
    });
    await programService.advanceStatuses().catch((err) => logger.error({ err }, 'status advance failed'));
    await this.reload();
  },

  async reload(): Promise<void> {
    syncTask?.stop();
    syncTask = null;
    current = await syncRepo.getSettings();
    if (!current.enabled || current.mode === 'MANUAL') {
      logger.info('scheduled sync disabled');
      return;
    }
    const expr = toCron(current);
    syncTask = cron.schedule(expr, () => {
      syncService.start({ type: 'SCHEDULED' }).catch((err) => logger.error({ err }, 'scheduled sync failed to start'));
    }, { timezone: current.timezone });
    logger.info({ expr, tz: current.timezone }, 'scheduled sync armed');
  },

  nextRun(): string | null {
    return current ? nextRunFor(current) : null;
  },

  stop(): void {
    syncTask?.stop();
    statusTask?.stop();
  },
};
