-- Private bucket for generated certificate PDFs and other platform assets.
-- No storage.objects policies are created for end users: the API uploads with the service role and hands out
-- short-lived signed URLs. (Guarded so the file also runs on a plain Postgres used for tests.)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false)
      on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('assets', 'assets', true)
      on conflict (id) do nothing;
  end if;
end $$;
