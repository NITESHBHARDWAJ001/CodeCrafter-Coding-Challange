-- Row Level Security.
-- Principle: the browser may only READ its own data + public data. There are deliberately NO insert/update/delete
-- policies on submissions, progress, certificates, challenges, programs, sync_logs or settings for ordinary users:
-- every mutation goes through the Express API, which uses the service-role key (bypasses RLS) after verifying
-- the caller and the LeetCode evidence.

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'ADMIN')
$$;

-- Is the program visible to students (not DRAFT/ARCHIVED)? Uses dates so it's right even if the status job lags.
create or replace function program_is_visible(p_program_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs p
    where p.id = p_program_id and p.status in ('SCHEDULED', 'ACTIVE', 'COMPLETED')
  )
$$;

-- Has the program started (so its released challenges may be shown)?
create or replace function program_has_started(p_program_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs p
    where p.id = p_program_id
      and p.status in ('SCHEDULED', 'ACTIVE', 'COMPLETED')
      and (now() at time zone p.timezone)::date >= p.start_date
  )
$$;

alter table profiles              enable row level security;
alter table leetcode_relinks      enable row level security;
alter table programs              enable row level security;
alter table program_participants  enable row level security;
alter table challenges            enable row level security;
alter table challenge_submissions enable row level security;
alter table program_progress      enable row level security;
alter table certificate_rules     enable row level security;
alter table certificates          enable row level security;
alter table sync_logs             enable row level security;
alter table app_settings          enable row level security;

-- profiles: read/update own row. Sensitive columns are frozen by the trigger below.
create policy profiles_select_own  on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_own  on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function protect_profile_columns() returns trigger language plpgsql as $$
begin
  -- Only end-user (JWT 'authenticated') sessions are restricted; service-role / migrations pass through.
  if auth.role() = 'authenticated' then
    if new.role is distinct from old.role
       or new.leetcode_username is distinct from old.leetcode_username
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'role, email and leetcode_username cannot be changed directly (use the relink flow)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_protect before update on profiles for each row execute function protect_profile_columns();

create policy relinks_select_own on leetcode_relinks for select using (user_id = auth.uid() or is_admin());

-- programs: students see non-draft, non-archived programs; admins everything (and may write, as an alternative to the API).
create policy programs_select on programs for select using (program_is_visible(id) or is_admin());
create policy programs_admin_write on programs for all using (is_admin()) with check (is_admin());

create policy participants_select_own on program_participants for select using (user_id = auth.uid() or is_admin());
create policy participants_admin_write on program_participants for all using (is_admin()) with check (is_admin());

-- challenges: students can ONLY see released, non-cancelled challenges. Future days are invisible even to a
-- hand-written PostgREST query with a valid user token.
create policy challenges_select_released on challenges for select using (
  is_admin()
  or (status <> 'CANCELLED' and release_at <= now() and program_has_started(program_id))
);
create policy challenges_admin_write on challenges for all using (is_admin()) with check (is_admin());

create policy submissions_select_own on challenge_submissions for select using (user_id = auth.uid() or is_admin());
create policy progress_select_own    on program_progress      for select using (user_id = auth.uid() or is_admin());

create policy cert_rules_select on certificate_rules for select using (program_is_visible(program_id) or is_admin());
create policy cert_rules_admin_write on certificate_rules for all using (is_admin()) with check (is_admin());

create policy certificates_select_own on certificates for select using (user_id = auth.uid() or is_admin());

create policy sync_logs_admin    on sync_logs    for select using (is_admin());
create policy app_settings_admin on app_settings for select using (is_admin());

-- Function grants: leaderboard functions expose only name/level/points → safe for signed-in users.
revoke execute on all functions in schema public from public;
grant execute on function is_admin(), program_is_visible(uuid), program_has_started(uuid) to authenticated, service_role;
grant execute on function program_leaderboard(uuid, int, int), overall_leaderboard(int, int),
                          weekly_leaderboard(uuid, timestamptz, int, int), challenge_leaderboard(uuid, int, int),
                          program_rank(uuid, uuid), overall_rank(uuid) to authenticated, service_role;
-- Certificate numbering is service-role only.
grant execute on function next_certificate_code(text) to service_role;
