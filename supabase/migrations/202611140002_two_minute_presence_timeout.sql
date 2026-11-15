create or replace function public.release_expired_cafe_seats()
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
        and (
          (seat.state = 'reserved' and seat.reserved_until <= operation_time)
          or (seat.state = 'occupied' and seat.last_seen_at <= operation_time - interval '2 minutes')
        )
    );

  update public.seats
  set state = 'available',
      occupant_id = null,
      reserved_until = null,
      updated_at = operation_time
  where (state = 'reserved' and reserved_until <= operation_time)
    or (state = 'occupied' and last_seen_at <= operation_time - interval '2 minutes');
  get diagnostics released_count = row_count;
  return released_count;
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
          or (seat.state = 'occupied' and seat.last_seen_at <= operation_time - interval '2 minutes')
        )
    );

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where (state = 'reserved' and reserved_until <= operation_time)
    or (state = 'occupied' and last_seen_at <= operation_time - interval '2 minutes');

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
