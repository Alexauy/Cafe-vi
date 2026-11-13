create or replace function public.mark_cafe_disconnected()
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
  set state = 'reserved',
      reserved_until = clock_timestamp() + interval '10 seconds',
      last_seen_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where occupant_id = auth.uid() and state = 'occupied';
end;
$$;

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
        and seat.state = 'reserved'
        and seat.reserved_until <= operation_time
    );

  update public.seats
  set state = 'available', occupant_id = null, reserved_until = null, updated_at = operation_time
  where state = 'reserved' and reserved_until <= operation_time;

  update public.seats
  set state = 'reserved',
      reserved_until = operation_time + interval '10 seconds',
      updated_at = operation_time
  where state = 'occupied'
    and last_seen_at <= operation_time - interval '10 seconds';
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;
