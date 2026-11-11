-- Cafe-Vi MVP foundation: one shared room, 20 fixed seats, public profiles,
-- authoritative work-session timestamps, and atomic room operations.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  capacity smallint not null check (capacity = 20),
  created_at timestamptz not null default now()
);

insert into public.rooms (id, slug, name, capacity)
values ('00000000-0000-4000-8000-000000000001', 'cafe-vi', 'Cafe-Vi', 20)
on conflict (slug) do nothing;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 1 and 24),
  avatar_id text not null default 'cookie'
    check (avatar_id in ('brownie', 'cookie', 'matcha', 'mocha', 'tart')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_ci_key on public.profiles (lower(username));

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_name text;
begin
  requested_name := left(
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''), 'CafeFriend'),
    13
  );

  insert into public.profiles (id, username)
  values (
    new.id,
    requested_name || '-' || left(replace(new.id::text, '-', ''), 10)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create table public.seats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat_no smallint not null check (seat_no between 1 and 20),
  occupant_id uuid references public.profiles (id) on delete set null,
  state text not null default 'available'
    check (state in ('available', 'occupied', 'reserved')),
  reserved_until timestamptz,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, seat_no),
  check (
    (state = 'available' and occupant_id is null and reserved_until is null)
    or (state = 'occupied' and occupant_id is not null and reserved_until is null)
    or (state = 'reserved' and occupant_id is not null and reserved_until is not null)
  )
);

create unique index seats_one_per_user_per_room
  on public.seats (room_id, occupant_id)
  where occupant_id is not null;

insert into public.seats (room_id, seat_no)
select '00000000-0000-4000-8000-000000000001'::uuid, seat_no::smallint
from generate_series(1, 20) as seat_no
on conflict (room_id, seat_no) do nothing;

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  seat_no smallint not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_name text not null check (char_length(btrim(task_name)) between 1 and 80),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  finished_at timestamptz,
  foreign key (room_id, seat_no) references public.seats (room_id, seat_no),
  check (ends_at > started_at)
);

create unique index work_sessions_one_active_per_user
  on public.work_sessions (user_id)
  where status = 'active';

create index work_sessions_room_active_idx
  on public.work_sessions (room_id, seat_no)
  where status = 'active';

alter table public.rooms enable row level security;
alter table public.profiles enable row level security;
alter table public.seats enable row level security;
alter table public.work_sessions enable row level security;

create policy "Authenticated users can read rooms"
  on public.rooms for select to authenticated using (true);
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy "Authenticated users can read seats"
  on public.seats for select to authenticated using (true);
create policy "Authenticated users can read work sessions"
  on public.work_sessions for select to authenticated using (true);

grant select on public.rooms, public.profiles, public.seats, public.work_sessions to authenticated;
grant update (username, avatar_id) on public.profiles to authenticated;

create function public.claim_seat(p_seat_no smallint)
returns public.seats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  cafe_room_id uuid;
  current_seat public.seats%rowtype;
  claimed_seat public.seats%rowtype;
  operation_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if p_seat_no is null or p_seat_no not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid_seat_number';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  select id into cafe_room_id from public.rooms where slug = 'cafe-vi';

  -- Expired reservations are cleaned lazily as well as by the scheduled cleanup.
  update public.work_sessions session
  set status = case when session.ends_at <= operation_time then 'completed' else 'cancelled' end,
      finished_at = operation_time
  where session.status = 'active'
    and exists (
      select 1 from public.seats seat
      where seat.room_id = session.room_id
        and seat.seat_no = session.seat_no
        and seat.state = 'reserved'
        and seat.reserved_until <= operation_time
    );

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where state = 'reserved' and reserved_until <= operation_time;

  select * into current_seat
  from public.seats
  where room_id = cafe_room_id and occupant_id = current_user_id
  for update;

  if found then
    if current_seat.seat_no <> p_seat_no then
      raise exception using errcode = 'P0001', message = 'already_seated';
    end if;

    update public.seats
    set state = 'occupied', reserved_until = null, last_seen_at = operation_time, updated_at = operation_time
    where room_id = cafe_room_id and seat_no = p_seat_no
    returning * into claimed_seat;
    return claimed_seat;
  end if;

  update public.seats
  set occupant_id = current_user_id,
      state = 'occupied',
      reserved_until = null,
      last_seen_at = operation_time,
      updated_at = operation_time
  where room_id = cafe_room_id and seat_no = p_seat_no and state = 'available'
  returning * into claimed_seat;

  if not found then
    raise exception using errcode = 'P0001', message = 'seat_unavailable';
  end if;

  return claimed_seat;
end;
$$;

create function public.leave_cafe()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  operation_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  update public.work_sessions
  set status = case when ends_at <= operation_time then 'completed' else 'cancelled' end,
      finished_at = operation_time
  where user_id = current_user_id and status = 'active';

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where occupant_id = current_user_id;
end;
$$;

create function public.mark_cafe_disconnected()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  update public.seats
  set state = 'reserved', reserved_until = clock_timestamp() + interval '45 seconds', last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
  where occupant_id = auth.uid() and state = 'occupied';
end;
$$;

create function public.heartbeat_cafe_presence()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  heartbeat_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  update public.seats
  set state = 'occupied', reserved_until = null,
      last_seen_at = heartbeat_time, updated_at = heartbeat_time
  where occupant_id = current_user_id
    and (
      state = 'occupied'
      or (state = 'reserved' and reserved_until > heartbeat_time)
    );
end;
$$;

create function public.start_work_session(p_task_name text, p_duration_minutes smallint)
returns public.work_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_seat public.seats%rowtype;
  new_session public.work_sessions%rowtype;
  operation_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if p_task_name is null or char_length(btrim(p_task_name)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_task_name';
  end if;

  if p_duration_minutes is null or p_duration_minutes not between 1 and 1440 then
    raise exception using errcode = '22023', message = 'invalid_session_duration';
  end if;

  select * into current_seat
  from public.seats
  where occupant_id = current_user_id and state = 'occupied'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'seat_required';
  end if;

  update public.work_sessions
  set status = 'completed', finished_at = ends_at
  where user_id = current_user_id and status = 'active' and ends_at <= operation_time;

  if exists (
    select 1 from public.work_sessions
    where user_id = current_user_id and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'session_already_active';
  end if;

  insert into public.work_sessions (room_id, seat_no, user_id, task_name, started_at, ends_at)
  values (
    current_seat.room_id,
    current_seat.seat_no,
    current_user_id,
    btrim(p_task_name),
    operation_time,
    operation_time + make_interval(mins => p_duration_minutes)
  )
  returning * into new_session;

  return new_session;
end;
$$;

create function public.end_work_session(p_session_id uuid)
returns public.work_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  ended_session public.work_sessions%rowtype;
  operation_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  update public.work_sessions
  set status = case when ends_at <= operation_time then 'completed' else 'cancelled' end,
      finished_at = operation_time
  where id = p_session_id and user_id = current_user_id and status = 'active'
  returning * into ended_session;

  if not found then
    raise exception using errcode = 'P0001', message = 'active_session_not_found';
  end if;

  return ended_session;
end;
$$;

create function public.complete_expired_work_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  completed_count integer;
begin
  update public.work_sessions
  set status = 'completed', finished_at = ends_at
  where status = 'active' and ends_at <= clock_timestamp();
  get diagnostics completed_count = row_count;
  return completed_count;
end;
$$;

create function public.release_expired_cafe_seats()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  released_count integer;
  operation_time timestamptz := clock_timestamp();
begin
  update public.work_sessions session
  set status = case when session.ends_at <= operation_time then 'completed' else 'cancelled' end,
      finished_at = operation_time
  where session.status = 'active'
    and exists (
      select 1 from public.seats seat
      where seat.room_id = session.room_id
        and seat.seat_no = session.seat_no
        and seat.state = 'reserved'
        and seat.reserved_until <= operation_time
    );

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where state = 'reserved' and reserved_until <= operation_time;

  update public.seats
  set state = 'reserved', reserved_until = operation_time + interval '45 seconds', updated_at = operation_time
  where state = 'occupied' and last_seen_at <= operation_time - interval '45 seconds';
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

create function public.cleanup_cafe_state()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.complete_expired_work_sessions();
  perform public.release_expired_cafe_seats();
end;
$$;

revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.claim_seat(smallint) from public;
revoke all on function public.leave_cafe() from public;
revoke all on function public.mark_cafe_disconnected() from public;
revoke all on function public.heartbeat_cafe_presence() from public;
revoke all on function public.start_work_session(text, smallint) from public;
revoke all on function public.end_work_session(uuid) from public;
revoke all on function public.complete_expired_work_sessions() from public;
revoke all on function public.release_expired_cafe_seats() from public, anon, authenticated;
revoke all on function public.cleanup_cafe_state() from public, anon, authenticated;

grant execute on function public.claim_seat(smallint) to authenticated;
grant execute on function public.leave_cafe() to authenticated;
grant execute on function public.mark_cafe_disconnected() to authenticated;
grant execute on function public.heartbeat_cafe_presence() to authenticated;
grant execute on function public.start_work_session(text, smallint) to authenticated;
grant execute on function public.end_work_session(uuid) to authenticated;
grant execute on function public.complete_expired_work_sessions() to authenticated;
grant execute on function public.release_expired_cafe_seats() to service_role;
grant execute on function public.cleanup_cafe_state() to service_role;

alter table public.seats replica identity full;
alter table public.profiles replica identity full;
alter table public.work_sessions replica identity full;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['seats', 'profiles', 'work_sessions'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
