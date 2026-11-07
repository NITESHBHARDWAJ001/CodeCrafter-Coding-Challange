-- Push notifications + admin announcements.
-- Additive only: no existing table, column, row, function or policy is touched.
-- Same convention as 0001/0002: backend writes with the service-role key; RLS only grants reads.

create type announcement_audience as enum ('ALL', 'PROGRAM');

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

create table announcements (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 2 and 140),
  body          text not null check (char_length(btrim(body)) between 1 and 1000),
  audience      announcement_audience not null default 'ALL',
  program_id    uuid references programs (id) on delete cascade,
  url           text,
  sent_count    int not null default 0,
  failed_count  int not null default 0,
  created_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (audience = 'ALL' or program_id is not null)
);
create index announcements_created_idx on announcements (created_at desc);

alter table push_subscriptions enable row level security;
alter table announcements      enable row level security;

-- push_subscriptions: deliberately no client policies at all (read or write) — every access goes through the
-- backend's service-role key, same as challenge_submissions / sync_logs.

-- announcements: students may read the ones aimed at them directly too (defense in depth); all writes stay backend-only.
create policy announcements_select on announcements for select using (
  is_admin()
  or audience = 'ALL'
  or (audience = 'PROGRAM' and exists (
       select 1 from program_participants pp
       where pp.program_id = announcements.program_id and pp.user_id = auth.uid() and pp.status = 'ENROLLED'
     ))
);
