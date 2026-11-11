create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

alter table public.diary_entries enable row level security;

create policy "Users can read their own diary entries"
  on public.diary_entries for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create their own diary entries"
  on public.diary_entries for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can edit their own diary entries"
  on public.diary_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.diary_entries to authenticated;

create index work_sessions_completed_user_started_idx
  on public.work_sessions (user_id, started_at, ends_at)
  where status = 'completed';

create function public.set_diary_entry_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger diary_entries_set_updated_at
  before update on public.diary_entries
  for each row execute function public.set_diary_entry_updated_at();

create function public.get_monthly_activity(p_month_start date)
returns table(activity_date date, seconds_worked bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  month_start_at timestamptz;
  month_end_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if p_month_start is null or extract(day from p_month_start) <> 1 then
    raise exception using errcode = '22023', message = 'invalid_month_start';
  end if;

  month_start_at := p_month_start::timestamp at time zone 'America/Los_Angeles';
  month_end_at := (p_month_start + interval '1 month')::timestamp at time zone 'America/Los_Angeles';

  return query
  with completed_sessions as (
    select session.started_at, session.ends_at
    from public.work_sessions as session
    where session.user_id = current_user_id
      and session.status = 'completed'
      and session.started_at < month_end_at
      and session.ends_at > month_start_at
  ), session_days as (
    select
      session.started_at,
      session.ends_at,
      days.local_midnight::date as local_date
    from completed_sessions as session
    cross join lateral generate_series(
      (((greatest(session.started_at, month_start_at) at time zone 'America/Los_Angeles')::date)::timestamp),
      ((((least(session.ends_at, month_end_at) - interval '1 microsecond') at time zone 'America/Los_Angeles')::date)::timestamp),
      interval '1 day'
    ) as days(local_midnight)
  )
  select
    session_days.local_date as activity_date,
    floor(sum(extract(epoch from (
      least(
        session_days.ends_at,
        ((session_days.local_date + 1)::timestamp at time zone 'America/Los_Angeles')
      ) - greatest(
        session_days.started_at,
        (session_days.local_date::timestamp at time zone 'America/Los_Angeles')
      )
    ))))::bigint as seconds_worked
  from session_days
  group by session_days.local_date
  order by session_days.local_date;
end;
$$;

revoke all on function public.get_monthly_activity(date) from public, anon;
grant execute on function public.get_monthly_activity(date) to authenticated;
