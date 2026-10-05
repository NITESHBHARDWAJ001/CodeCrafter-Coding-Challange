import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { SyncLog, SyncSettings } from '../types/db';

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  mode: 'BOTH', enabled: true, time: '23:00', timezone: 'Asia/Kolkata', frequency: 'DAILY',
};

export const syncRepo = {
  async createLog(row: Partial<SyncLog>): Promise<SyncLog> {
    return unwrap(await admin.from('sync_logs').insert(row).select('*').single<SyncLog>());
  },
  async updateLog(id: string, patch: Partial<SyncLog>): Promise<void> {
    unwrap(await admin.from('sync_logs').update(patch).eq('id', id).select('id'));
  },
  async listLogs(programId: string | null, limit: number, offset: number): Promise<SyncLog[]> {
    let q = admin.from('sync_logs').select('*');
    if (programId) q = q.eq('program_id', programId);
    return unwrap(await q.order('started_at', { ascending: false }).range(offset, offset + limit - 1).returns<SyncLog[]>());
  },
  async runningFor(programId: string, sinceIso: string): Promise<SyncLog | null> {
    return unwrapMaybe(await admin.from('sync_logs').select('*').eq('program_id', programId).eq('status', 'RUNNING').gte('started_at', sinceIso).limit(1).maybeSingle<SyncLog>());
  },
  async lastCompleted(programId: string | null): Promise<SyncLog | null> {
    let q = admin.from('sync_logs').select('*').neq('status', 'RUNNING');
    if (programId) q = q.eq('program_id', programId);
    return unwrapMaybe(await q.order('started_at', { ascending: false }).limit(1).maybeSingle<SyncLog>());
  },
  /** Crash recovery: a RUNNING row that survived a restart can never finish. */
  async failStaleRunning(): Promise<number> {
    const rows = unwrap(await admin.from('sync_logs').update({
      status: 'FAILED', completed_at: new Date().toISOString(), error_message: 'Server restarted while the sync was running',
    }).eq('status', 'RUNNING').select('id'));
    return rows.length;
  },

  async getSettings(): Promise<SyncSettings> {
    const row = unwrapMaybe(await admin.from('app_settings').select('value').eq('key', 'sync').maybeSingle<{ value: SyncSettings }>());
    return { ...DEFAULT_SYNC_SETTINGS, ...(row?.value ?? {}) };
  },
  async saveSettings(s: SyncSettings): Promise<SyncSettings> {
    unwrap(await admin.from('app_settings').upsert({ key: 'sync', value: s, updated_at: new Date().toISOString() }).select('key'));
    return s;
  },
};
