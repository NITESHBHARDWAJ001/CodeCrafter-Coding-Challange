import { createClient, SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { env } from '../config/env';
import { AppError } from './errors';

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Service-role client: bypasses RLS. Server-side only; never expose. */
export const admin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);
/** Anon client used only for flows that must behave like a public caller (sign-up emails). */
export const anon: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);

export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw new AppError(500, 'DB_ERROR', res.error.message, { code: res.error.code });
  return res.data as T;
}
export function unwrapMaybe<T>(res: { data: T | null; error: PostgrestError | null }): T | null {
  if (res.error) throw new AppError(500, 'DB_ERROR', res.error.message, { code: res.error.code });
  return res.data;
}
