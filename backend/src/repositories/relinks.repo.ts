import { admin, unwrap, unwrapMaybe } from '../lib/supabase';

export interface Relink { id: string; user_id: string; new_username: string; code: string; status: 'PENDING' | 'COMPLETED' | 'EXPIRED'; expires_at: string }

export const relinksRepo = {
  async expirePending(userId: string): Promise<void> {
    unwrap(await admin.from('leetcode_relinks').update({ status: 'EXPIRED' }).eq('user_id', userId).eq('status', 'PENDING').select('id'));
  },
  async create(row: Omit<Relink, 'id' | 'status'>): Promise<Relink> {
    return unwrap(await admin.from('leetcode_relinks').insert(row).select('*').single<Relink>());
  },
  async getPending(userId: string): Promise<Relink | null> {
    return unwrapMaybe(await admin.from('leetcode_relinks').select('*').eq('user_id', userId).eq('status', 'PENDING')
      .order('expires_at', { ascending: false }).limit(1).maybeSingle<Relink>());
  },
  async complete(id: string): Promise<void> {
    unwrap(await admin.from('leetcode_relinks').update({ status: 'COMPLETED' }).eq('id', id).select('id'));
  },
};
