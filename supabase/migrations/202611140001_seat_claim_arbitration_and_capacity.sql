alter table public.rooms
  drop constraint if exists rooms_capacity_check;

alter table public.rooms
  add constraint rooms_capacity_check check (capacity between 1 and 20);

create table public.seat_claim_attempts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat_no smallint not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  foreign key (room_id, seat_no) references public.seats (room_id, seat_no)
);

create index seat_claim_attempts_room_seat_time_idx
  on public.seat_claim_attempts (room_id, seat_no, requested_at);

alter table public.seat_claim_attempts enable row level security;
revoke all on public.seat_claim_attempts from public, anon, authenticated;

create or replace function public.begin_seat_claim(p_seat_no smallint)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  cafe_room_id uuid;
  room_capacity smallint;
  attempt_id uuid;
  request_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  select id, capacity into cafe_room_id, room_capacity
  from public.rooms
  where slug = 'cafe-vi';

  if cafe_room_id is null then
    raise exception using errcode = 'P0001', message = 'cafe_room_not_found';
  end if;

  if p_seat_no is null or p_seat_no not between 1 and room_capacity then
    raise exception using errcode = '22023', message = 'invalid_seat_number';
  end if;

  delete from public.seat_claim_attempts
  where requested_at < request_time - interval '5 seconds';

  insert into public.seat_claim_attempts (room_id, seat_no, user_id, requested_at)
  values (cafe_room_id, p_seat_no, current_user_id, request_time)
  returning id into attempt_id;

  return attempt_id;
end;
$$;

create or replace function public.claim_seat(p_seat_no smallint, p_attempt_id uuid)
returns public.seats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  cafe_room_id uuid;
  room_capacity smallint;
  claim_attempt public.seat_claim_attempts%rowtype;
  contender_count integer;
  current_seat public.seats%rowtype;
  claimed_seat public.seats%rowtype;
  operation_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select * into claim_attempt
  from public.seat_claim_attempts
  where id = p_attempt_id and user_id = current_user_id
  for update;

  if not found
    or claim_attempt.seat_no <> p_seat_no
    or claim_attempt.requested_at < operation_time - interval '5 seconds' then
    raise exception using errcode = 'P0001', message = 'seat_claim_attempt_expired';
  end if;

  if claim_attempt.requested_at > operation_time - interval '250 milliseconds' then
    raise exception using errcode = 'P0001', message = 'seat_claim_pending';
  end if;

  select count(*) into contender_count
  from public.seat_claim_attempts attempt
  where attempt.room_id = claim_attempt.room_id
    and attempt.seat_no = claim_attempt.seat_no
    and attempt.requested_at between claim_attempt.requested_at - interval '250 milliseconds'
                                 and claim_attempt.requested_at + interval '250 milliseconds';

  if contender_count > 1 then
    raise exception using errcode = 'P0001', message = 'seat_claim_collision';
  end if;

  select id, capacity into cafe_room_id, room_capacity
  from public.rooms
  where slug = 'cafe-vi';

  if cafe_room_id is null or claim_attempt.room_id <> cafe_room_id then
    raise exception using errcode = 'P0001', message = 'cafe_room_not_found';
  end if;

  if p_seat_no is null or p_seat_no not between 1 and room_capacity then
    raise exception using errcode = '22023', message = 'invalid_seat_number';
  end if;

  update public.work_sessions session
  set status = case when session.ends_at <= operation_time then 'completed' else 'cancelled' end,
      finished_at = operation_time
  where session.status = 'active'
    and exists (
      select 1 from public.seats seat
      where seat.room_id = session.room_id
        and seat.seat_no = session.seat_no
        and (
          (seat.state = 'reserved' and seat.reserved_until <= operation_time)
          or (seat.state = 'occupied' and seat.last_seen_at <= operation_time - interval '10 seconds')
        )
    );

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where (state = 'reserved' and reserved_until <= operation_time)
    or (state = 'occupied' and last_seen_at <= operation_time - interval '10 seconds');

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

    delete from public.seat_claim_attempts where id = p_attempt_id;
    return claimed_seat;
  end if;

  update public.seats
  set occupant_id = current_user_id,
      state = 'occupied',
      reserved_until = null,
      last_seen_at = operation_time,
      updated_at = operation_time
  where room_id = cafe_room_id
    and seat_no = p_seat_no
    and seat_no <= room_capacity
    and state = 'available'
  returning * into claimed_seat;

  if not found then
    raise exception using errcode = 'P0001', message = 'seat_unavailable';
  end if;

  delete from public.seat_claim_attempts where id = p_attempt_id;
  return claimed_seat;
end;
$$;

revoke all on function public.claim_seat(smallint) from public, anon, authenticated;
revoke all on function public.begin_seat_claim(smallint) from public, anon, authenticated;
revoke all on function public.claim_seat(smallint, uuid) from public, anon, authenticated;
grant execute on function public.begin_seat_claim(smallint) to authenticated;
grant execute on function public.claim_seat(smallint, uuid) to authenticated;

create or replace function public.get_public_cafe_occupants()
returns table (seat_no smallint, username text, avatar_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select seat.seat_no, profile.username, profile.avatar_id
  from public.seats as seat
  join public.profiles as profile on profile.id = seat.occupant_id
  join public.rooms as room on room.id = seat.room_id
  where room.slug = 'cafe-vi'
    and seat.seat_no <= room.capacity
    and seat.state <> 'available'
    and seat.occupant_id is not null
  order by seat.seat_no;
$$;
