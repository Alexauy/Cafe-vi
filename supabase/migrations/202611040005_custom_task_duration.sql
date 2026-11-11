create or replace function public.start_work_session(p_task_name text, p_duration_minutes smallint)
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
