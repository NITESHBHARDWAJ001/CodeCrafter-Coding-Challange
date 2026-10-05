import { admin, unwrap, unwrapMaybe } from '../lib/supabase';
import type { CertificateRules, Program, ProgramStatus } from '../types/db';

export const programsRepo = {
  async get(id: string): Promise<Program | null> {
    return unwrapMaybe(await admin.from('programs').select('*').eq('id', id).maybeSingle<Program>());
  },
  async getBySlug(slug: string): Promise<Program | null> {
    return unwrapMaybe(await admin.from('programs').select('*').eq('slug', slug).maybeSingle<Program>());
  },
  async list(): Promise<Program[]> {
    return unwrap(await admin.from('programs').select('*').order('start_date', { ascending: false }).returns<Program[]>());
  },
  async insert(p: Partial<Program>): Promise<Program> {
    return unwrap(await admin.from('programs').insert(p).select('*').single<Program>());
  },
  async update(id: string, patch: Partial<Program>): Promise<Program> {
    return unwrap(await admin.from('programs').update(patch).eq('id', id).select('*').single<Program>());
  },
  async setStatus(id: string, status: ProgramStatus): Promise<void> {
    unwrap(await admin.from('programs').update({ status }).eq('id', id).select('id'));
  },
  async remove(id: string): Promise<void> {
    unwrap(await admin.from('programs').delete().eq('id', id).select('id'));
  },

  async getRules(programId: string): Promise<CertificateRules | null> {
    return unwrapMaybe(await admin.from('certificate_rules').select('*').eq('program_id', programId).maybeSingle<CertificateRules>());
  },
  async upsertRules(rules: CertificateRules): Promise<CertificateRules> {
    return unwrap(await admin.from('certificate_rules').upsert(rules).select('*').single<CertificateRules>());
  },
};
