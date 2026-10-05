import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { Certificate } from '../types/db';

export const certificatesRepo = {
  async listByProgram(programId: string): Promise<Certificate[]> {
    return unwrap(await admin.from('certificates').select('*').eq('program_id', programId).order('certificate_code').returns<Certificate[]>());
  },
  async listByUser(userId: string): Promise<Certificate[]> {
    return unwrap(await admin.from('certificates').select('*').eq('user_id', userId).order('issued_at', { ascending: false }).returns<Certificate[]>());
  },
  async getByCode(code: string): Promise<Certificate | null> {
    return unwrapMaybe(await admin.from('certificates').select('*').eq('certificate_code', code).maybeSingle<Certificate>());
  },
  async countByUser(userId: string): Promise<number> {
    const { count, error } = await admin.from('certificates').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) throw error;
    return count ?? 0;
  },
  async nextCode(prefix: string): Promise<string> {
    return unwrap(await admin.rpc('next_certificate_code', { p_prefix: prefix })) as string;
  },
  async insert(row: Omit<Certificate, 'id' | 'issued_at'> & { issued_by: string | null }): Promise<Certificate> {
    return unwrap(await admin.from('certificates').insert(row).select('*').single<Certificate>());
  },
};
