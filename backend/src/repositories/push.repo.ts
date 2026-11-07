import { admin, unwrap } from '../lib/supabase';

export interface PushSubscriptionRow {
  id: string; user_id: string; endpoint: string; p256dh: string; auth: string; user_agent: string | null; created_at: string;
}
export type AnnouncementAudience = 'ALL' | 'PROGRAM' | 'STUDENT';
export interface AnnouncementRow {
  id: string; title: string; body: string; audience: AnnouncementAudience; program_id: string | null; user_id: string | null; url: string | null;
  sent_count: number; failed_count: number; created_by: string | null; created_at: string;
}

export const pushRepo = {
  async upsertSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }): Promise<void> {
    unwrap(await admin.from('push_subscriptions')
      .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.userAgent ?? null }, { onConflict: 'endpoint' })
      .select('id'));
  },
  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    unwrap(await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint).select('id'));
  },
  async removeByEndpoint(endpoint: string): Promise<void> {
    unwrap(await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).select('id'));
  },
  async listAll(): Promise<PushSubscriptionRow[]> {
    return unwrap(await admin.from('push_subscriptions').select('*').returns<PushSubscriptionRow[]>());
  },
  async listForUsers(userIds: string[]): Promise<PushSubscriptionRow[]> {
    if (!userIds.length) return [];
    return unwrap(await admin.from('push_subscriptions').select('*').in('user_id', userIds).returns<PushSubscriptionRow[]>());
  },
  async insertAnnouncement(a: Pick<AnnouncementRow, 'title' | 'body' | 'audience' | 'program_id' | 'user_id' | 'url' | 'created_by'>): Promise<AnnouncementRow> {
    return unwrap(await admin.from('announcements').insert(a).select('*').single<AnnouncementRow>());
  },
  async updateCounts(id: string, sentCount: number, failedCount: number): Promise<AnnouncementRow> {
    return unwrap(await admin.from('announcements').update({ sent_count: sentCount, failed_count: failedCount }).eq('id', id).select('*').single<AnnouncementRow>());
  },
  async list(limit: number, offset: number): Promise<AnnouncementRow[]> {
    return unwrap(await admin.from('announcements').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1).returns<AnnouncementRow[]>());
  },
  async remove(id: string): Promise<void> {
    unwrap(await admin.from('announcements').delete().eq('id', id).select('id'));
  },
};
