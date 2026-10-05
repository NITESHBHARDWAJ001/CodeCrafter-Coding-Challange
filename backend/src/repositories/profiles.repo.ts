import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { Profile, UserRole } from '../types/db';

export const profilesRepo = {
  async get(id: string): Promise<Profile | null> {
    return unwrapMaybe(await admin.from('profiles').select('*').eq('id', id).maybeSingle<Profile>());
  },
  async getMany(ids: string[]): Promise<Profile[]> {
    if (!ids.length) return [];
    return unwrap(await admin.from('profiles').select('*').in('id', ids).returns<Profile[]>());
  },
  async findByEmail(email: string): Promise<Profile | null> {
    return unwrapMaybe(await admin.from('profiles').select('*').ilike('email', email).maybeSingle<Profile>());
  },
  async findByLeetCode(username: string): Promise<Profile | null> {
    return unwrapMaybe(await admin.from('profiles').select('*').ilike('leetcode_username', username).maybeSingle<Profile>());
  },
  async insert(p: Pick<Profile, 'id' | 'full_name' | 'email' | 'leetcode_username' | 'level' | 'role'>): Promise<Profile> {
    return unwrap(await admin.from('profiles').insert(p).select('*').single<Profile>());
  },
  async update(id: string, patch: Partial<Pick<Profile, 'full_name' | 'level' | 'leetcode_username' | 'leetcode_linked_at'>>): Promise<Profile> {
    return unwrap(await admin.from('profiles').update(patch).eq('id', id).select('*').single<Profile>());
  },
  async setRole(id: string, role: UserRole): Promise<Profile> {
    return unwrap(await admin.from('profiles').update({ role }).eq('id', id).select('*').single<Profile>());
  },
  async listAdmins(): Promise<Profile[]> {
    return unwrap(await admin.from('profiles').select('*').eq('role', 'ADMIN').order('full_name').returns<Profile[]>());
  },
  async count(): Promise<number> {
    const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  },
};
