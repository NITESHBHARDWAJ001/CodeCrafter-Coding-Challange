-- Continues 0005: adds the target column, replaces the old audience check (whatever Postgres
-- auto-named it) with one that also allows STUDENT, and extends the read policy. Additive only —
-- existing ALL/PROGRAM rows are untouched (user_id defaults to null for them).

alter table announcements add column user_id uuid references profiles (id) on delete cascade;
create index announcements_user_idx on announcements (user_id);

do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.announcements'::regclass and contype = 'c' loop
    execute format('alter table announcements drop constraint %I', r.conname);
  end loop;
end $$;

alter table announcements add constraint announcements_audience_check check (
  (audience = 'ALL')
  or (audience = 'PROGRAM' and program_id is not null)
  or (audience = 'STUDENT' and user_id is not null)
);

drop policy if exists announcements_select on announcements;
create policy announcements_select on announcements for select using (
  is_admin()
  or audience = 'ALL'
  or (audience = 'PROGRAM' and exists (
       select 1 from program_participants pp
       where pp.program_id = announcements.program_id and pp.user_id = auth.uid() and pp.status = 'ENROLLED'
     ))
  or (audience = 'STUDENT' and user_id = auth.uid())
);
