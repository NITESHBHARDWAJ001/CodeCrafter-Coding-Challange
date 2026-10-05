-- CodeCrafter Club — core schema.
-- Conventions: snake_case, uuid PKs, timestamptz everywhere, enums for closed sets.
-- Anything that awards points / marks solved / issues certificates is written ONLY by the
-- backend using the service-role key (see 0002_rls.sql — no client write policies exist for them).

-- ───────────── enums ─────────────
create type user_role           as enum ('STUDENT', 'ADMIN');
create type user_level          as enum ('FOUNDATION', 'DIPLOMA', 'DEGREE');
create type program_status      as enum ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
create type challenge_provider  as enum ('LEETCODE', 'CODEFORCES', 'HACKERRANK', 'CODECHEF', 'OTHER');
create type challenge_difficulty as enum ('EASY', 'MEDIUM', 'HARD');
-- Stored status is only SCHEDULED/CANCELLED. UPCOMING/ACTIVE/COMPLETED are *derived* from time (never stored,
-- so they can never be stale). See backend/src/domain/challengeState.ts.
create type challenge_status    as enum ('SCHEDULED', 'CANCELLED');
create type participant_status  as enum ('ENROLLED', 'WITHDRAWN');
create type streak_policy       as enum ('RESET_ON_MISS', 'GRACE_DAYS');
create type sync_type           as enum ('MANUAL', 'SCHEDULED');
create type sync_status         as enum ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
create type relink_status       as enum ('PENDING', 'COMPLETED', 'EXPIRED');

-- ───────────── helpers ─────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────── profiles ─────────────
create table profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null check (char_length(btrim(full_name)) between 2 and 120),
  email               text not null,
  leetcode_username   text not null check (leetcode_username ~ '^[A-Za-z0-9_\-]{1,40}$'),
  level               user_level not null,
  role                user_role not null default 'STUDENT',
  leetcode_linked_at  timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index profiles_leetcode_username_uq on profiles (lower(leetcode_username));
create unique index profiles_email_uq             on profiles (lower(email));
create index profiles_leetcode_username_idx       on profiles (leetcode_username);
create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();

-- LeetCode relink: the user proves ownership of the new username by putting `code` in their public
-- LeetCode profile summary. Historical submissions keep the username they were verified under.
create table leetcode_relinks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  new_username  text not null,
  code          text not null,
  status        relink_status not null default 'PENDING',
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index leetcode_relinks_user_idx on leetcode_relinks (user_id, status);

-- ───────────── programs ─────────────
create table programs (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description            text not null default '',
  banner_url             text,
  start_date             date not null,
  end_date               date not null,
  duration_days          int  not null check (duration_days > 0),
  status                 program_status not null default 'DRAFT',
  enrollment_open        boolean not null default true,
  timezone               text not null default 'Asia/Kolkata',
  -- how long a challenge stays "solvable for today's points" after release
  challenge_window_hours int  not null default 24 check (challenge_window_hours between 1 and 720),
  default_points         jsonb not null default '{"EASY":100,"MEDIUM":150,"HARD":250}',
  streak_policy          streak_policy not null default 'RESET_ON_MISS',
  streak_grace_days      int  not null default 0 check (streak_grace_days between 0 and 30),
  certificate_enabled    boolean not null default false,
  certificate_prefix     text not null default 'GEN' check (certificate_prefix ~ '^[A-Z0-9]{2,8}$'),
  created_by             uuid references profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (end_date >= start_date)
);
create index programs_status_idx on programs (status);
create trigger programs_updated_at before update on programs for each row execute function set_updated_at();

create table program_participants (
  id                 uuid primary key default gen_random_uuid(),
  program_id         uuid not null references programs (id) on delete cascade,
  user_id            uuid not null references profiles (id) on delete cascade,
  status             participant_status not null default 'ENROLLED',
  enrolled_at        timestamptz not null default now(),
  unique (program_id, user_id)
);
create index program_participants_user_idx on program_participants (user_id);

-- ───────────── challenges ─────────────
create table challenges (
  id                   uuid primary key default gen_random_uuid(),
  program_id           uuid not null references programs (id) on delete cascade,
  day_number           int  not null check (day_number > 0),
  title                text not null,
  -- provider-agnostic problem identity (LeetCode: external_problem_id = titleSlug)
  provider             challenge_provider not null default 'LEETCODE',
  external_problem_id  text not null,
  external_problem_url text not null,
  category             text not null default 'General',
  difficulty           challenge_difficulty not null,
  -- null = use programs.default_points[difficulty]; non-null = explicit admin override
  points_override      int check (points_override is null or points_override >= 0),
  release_at           timestamptz not null,
  closes_at            timestamptz not null,
  status               challenge_status not null default 'SCHEDULED',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (program_id, day_number),
  check (closes_at > release_at)
);
create index challenges_program_release_idx on challenges (program_id, release_at);
create index challenges_release_idx         on challenges (release_at);
create trigger challenges_updated_at before update on challenges for each row execute function set_updated_at();

-- ───────────── submissions (verified solves only) ─────────────
create table challenge_submissions (
  id                     uuid primary key default gen_random_uuid(),
  challenge_id           uuid not null references challenges (id) on delete cascade,
  program_id             uuid not null references programs (id) on delete cascade,
  user_id                uuid not null references profiles (id) on delete cascade,
  provider               challenge_provider not null,
  external_submission_id text,
  verified_username      text not null,          -- username it was verified under (survives relinks)
  submitted_at           timestamptz not null,   -- timestamp reported by the provider
  verified_at            timestamptz not null default now(),
  awarded_points         int not null check (awarded_points >= 0), -- frozen at award time
  -- THE guard against double points, even across concurrent/overlapping syncs:
  unique (challenge_id, user_id)
);
create index challenge_submissions_user_solved_idx on challenge_submissions (user_id, submitted_at);
create index challenge_submissions_program_idx     on challenge_submissions (program_id, user_id);

create table program_progress (
  program_id       uuid not null references programs (id) on delete cascade,
  user_id          uuid not null references profiles (id) on delete cascade,
  solved_count     int not null default 0,
  total_points     int not null default 0,
  current_streak   int not null default 0,
  longest_streak   int not null default 0,
  missed_days      int not null default 0,
  last_solved_at   timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (program_id, user_id)
);
create index program_progress_rank_idx on program_progress (program_id, total_points desc, solved_count desc, last_solved_at);

-- ───────────── certificates ─────────────
create table certificate_rules (
  program_id          uuid primary key references programs (id) on delete cascade,
  min_challenges      int check (min_challenges is null or min_challenges >= 0),
  min_completion_pct  numeric(5,2) check (min_completion_pct is null or min_completion_pct between 0 and 100),
  min_points          int check (min_points is null or min_points >= 0),
  max_missed_days     int check (max_missed_days is null or max_missed_days >= 0),
  updated_at          timestamptz not null default now()
);
create trigger certificate_rules_updated_at before update on certificate_rules for each row execute function set_updated_at();

create sequence certificate_number_seq;
create or replace function next_certificate_code(p_prefix text) returns text
language sql volatile as $$
  select 'CC-' || upper(p_prefix) || '-' || extract(year from now())::int || '-' ||
         lpad(nextval('certificate_number_seq')::text, 6, '0')
$$;

create table certificates (
  id                   uuid primary key default gen_random_uuid(),
  certificate_code     text not null unique,
  program_id           uuid not null references programs (id) on delete restrict,
  user_id              uuid not null references profiles (id) on delete restrict,
  -- snapshots: a certificate must stay valid and printable even if names/programs are edited later
  recipient_name       text not null,
  program_name         text not null,
  challenges_completed int not null,
  total_challenges     int not null,
  issued_at            timestamptz not null default now(),
  storage_path         text,
  issued_by            uuid references profiles (id) on delete set null,
  unique (program_id, user_id)
);
create index certificates_user_idx on certificates (user_id);

-- ───────────── sync ─────────────
create table sync_logs (
  id                   uuid primary key default gen_random_uuid(),
  program_id           uuid references programs (id) on delete cascade,
  sync_type            sync_type not null,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  participants_total   int not null default 0,
  participants_checked int not null default 0,
  new_submissions      int not null default 0,
  failed_users         int not null default 0,
  failures             jsonb not null default '[]',   -- [{user_id, username, error}] (capped)
  status               sync_status not null default 'RUNNING',
  error_message        text,
  triggered_by         uuid references profiles (id) on delete set null
);
create index sync_logs_started_idx on sync_logs (started_at desc);
create index sync_logs_program_idx on sync_logs (program_id, started_at desc);

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_settings (key, value) values
  ('sync', '{"mode":"BOTH","enabled":true,"time":"23:00","timezone":"Asia/Kolkata","frequency":"DAILY"}');

-- ───────────── leaderboard functions ─────────────
-- Tie-break (deterministic): points DESC, solved DESC, earliest time of reaching that score ASC, user id.
-- Ranks are computed over the WHOLE cohort first, then paginated.
create or replace function program_leaderboard(p_program_id uuid, p_limit int default 100, p_offset int default 0)
returns table (rank bigint, user_id uuid, full_name text, level user_level, solved int, points int,
               current_streak int, last_solved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select row_number() over (
             order by coalesce(pr.total_points, 0) desc, coalesce(pr.solved_count, 0) desc,
                      pr.last_solved_at asc nulls last, p.id) as rank,
           p.id, p.full_name, p.level,
           coalesce(pr.solved_count, 0), coalesce(pr.total_points, 0),
           coalesce(pr.current_streak, 0), pr.last_solved_at
    from program_participants pp
    join profiles p on p.id = pp.user_id
    left join program_progress pr on pr.program_id = pp.program_id and pr.user_id = pp.user_id
    where pp.program_id = p_program_id and pp.status = 'ENROLLED'
  ) t
  order by rank
  limit p_limit offset p_offset
$$;

create or replace function overall_leaderboard(p_limit int default 100, p_offset int default 0)
returns table (rank bigint, user_id uuid, full_name text, level user_level, solved int, points int,
               current_streak int, last_solved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select row_number() over (
             order by sum(pr.total_points) desc, sum(pr.solved_count) desc,
                      max(pr.last_solved_at) asc nulls last, p.id) as rank,
           p.id, p.full_name, p.level,
           sum(pr.solved_count)::int, sum(pr.total_points)::int,
           max(pr.current_streak)::int, max(pr.last_solved_at)
    from program_progress pr
    join profiles p on p.id = pr.user_id
    group by p.id, p.full_name, p.level
  ) t
  order by rank
  limit p_limit offset p_offset
$$;

create or replace function weekly_leaderboard(p_program_id uuid, p_since timestamptz, p_limit int default 100, p_offset int default 0)
returns table (rank bigint, user_id uuid, full_name text, level user_level, solved int, points int,
               current_streak int, last_solved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select row_number() over (
             order by sum(s.awarded_points) desc, count(*) desc, max(s.submitted_at) asc, p.id) as rank,
           p.id, p.full_name, p.level,
           count(*)::int, sum(s.awarded_points)::int,
           coalesce(max(pr.current_streak), 0)::int, max(s.submitted_at)
    from challenge_submissions s
    join profiles p on p.id = s.user_id
    left join program_progress pr on pr.program_id = s.program_id and pr.user_id = s.user_id
    where s.program_id = p_program_id and s.submitted_at >= p_since
    group by p.id, p.full_name, p.level
  ) t
  order by rank
  limit p_limit offset p_offset
$$;

-- Daily leaderboard: who solved a given challenge, fastest first.
create or replace function challenge_leaderboard(p_challenge_id uuid, p_limit int default 100, p_offset int default 0)
returns table (rank bigint, user_id uuid, full_name text, level user_level, solved int, points int,
               current_streak int, last_solved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select row_number() over (order by s.submitted_at asc, p.id) as rank,
           p.id, p.full_name, p.level, 1, s.awarded_points,
           coalesce(pr.current_streak, 0), s.submitted_at
    from challenge_submissions s
    join profiles p on p.id = s.user_id
    left join program_progress pr on pr.program_id = s.program_id and pr.user_id = s.user_id
    where s.challenge_id = p_challenge_id
  ) t
  order by rank
  limit p_limit offset p_offset
$$;

create or replace function program_rank(p_program_id uuid, p_user_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select rank from program_leaderboard(p_program_id, 1000000, 0) where user_id = p_user_id
$$;

create or replace function overall_rank(p_user_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select rank from overall_leaderboard(1000000, 0) where user_id = p_user_id
$$;
