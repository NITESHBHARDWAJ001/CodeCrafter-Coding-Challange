/**
 * One-time production cleanup for the seeded demo environment.
 *
 * Deletes only the seeded student accounts and the seeded 15-days-of-sql
 * program. The admin account and 30-days-of-dsa are explicitly protected.
 */
import { admin } from '../src/lib/supabase';

const DEMO_EMAILS = [
  'rahul@students.test', 'aman@students.test', 'nitesh@students.test', 'priya@students.test',
  'ishita@students.test', 'karthik@students.test', 'meera@students.test', 'vikram@students.test',
];
const ADMIN_EMAIL = 'admin@codecrafter.test';
const PROTECTED_PROGRAM = '30-days-of-dsa';
const REMOVE_PROGRAMS = ['15-days-of-sql', 'leetcode-live-demo'];

async function main() {
  const { data: adminProfile, error: adminError } = await admin.from('profiles').select('id, role').eq('email', ADMIN_EMAIL).maybeSingle();
  if (adminError) throw adminError;
  if (!adminProfile || adminProfile.role !== 'ADMIN') throw new Error('Protected admin account was not found as ADMIN; aborting');

  const { data: protectedProgram, error: protectedError } = await admin.from('programs').select('id').eq('slug', PROTECTED_PROGRAM).maybeSingle();
  if (protectedError) throw protectedError;
  if (!protectedProgram) throw new Error('Protected 30-days-of-dsa program was not found; aborting');

  for (const slug of REMOVE_PROGRAMS) {
    const { data: removeProgram, error: removeProgramError } = await admin.from('programs').select('id, name').eq('slug', slug).maybeSingle();
    if (removeProgramError) throw removeProgramError;
    if (removeProgram) {
      const { error } = await admin.from('programs').delete().eq('id', removeProgram.id);
      if (error) throw error;
      console.log(`Deleted program: ${removeProgram.name}`);
    } else {
      console.log(`Program not found: ${slug}`);
    }
  }

  for (const email of DEMO_EMAILS) {
    const { data: profile, error } = await admin.from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!profile) {
      console.log(`User not found: ${email}`);
      continue;
    }
    if (profile.role === 'ADMIN' || profile.id === adminProfile.id) throw new Error(`Refusing to delete protected account: ${email}`);
    const { error: certificatesError } = await admin.from('certificates').delete().eq('user_id', profile.id);
    if (certificatesError) throw certificatesError;
    const result = await admin.auth.admin.deleteUser(profile.id);
    if (result.error) throw result.error;
    console.log(`Deleted demo user: ${email}`);
  }

  console.log('Cleanup complete. Admin and 30-days-of-dsa were preserved.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
