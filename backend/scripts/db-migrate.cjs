// Apply backend/supabase/migrations/*.sql to the database in DATABASE_URL, each file in its own transaction.
// Usage: DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' npm run db:migrate
const { Client } = require('pg'); const fs = require('fs'); const path = require('path');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (Supabase -> Project Settings -> Database -> Connection string)'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('create table if not exists _migrations (name text primary key, applied_at timestamptz default now())');
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if ((await c.query('select 1 from _migrations where name=$1', [f])).rowCount) { console.log('skip   ', f); continue; }
    try { await c.query('begin'); await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('insert into _migrations(name) values ($1)', [f]); await c.query('commit'); console.log('applied', f); }
    catch (e) { await c.query('rollback'); console.error('FAILED ', f, e.message); process.exit(1); }
  }
  await c.end();
})();
