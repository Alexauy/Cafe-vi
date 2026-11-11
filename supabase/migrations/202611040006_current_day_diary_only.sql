drop policy if exists "Users can create their own diary entries"
  on public.diary_entries;

create policy "Users can create today's diary entry"
  on public.diary_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and entry_date = ((now() at time zone 'America/Los_Angeles')::date)
  );

drop policy if exists "Users can edit their own diary entries"
  on public.diary_entries;

create policy "Users can edit today's diary entry"
  on public.diary_entries for update to authenticated
  using (
    user_id = (select auth.uid())
    and entry_date = ((now() at time zone 'America/Los_Angeles')::date)
  )
  with check (
    user_id = (select auth.uid())
    and entry_date = ((now() at time zone 'America/Los_Angeles')::date)
  );
