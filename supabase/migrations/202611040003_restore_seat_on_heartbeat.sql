create or replace function public.heartbeat_cafe_presence()
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
  set state = 'occupied',
      reserved_until = null,
      last_seen_at = heartbeat_time,
      updated_at = heartbeat_time
  where occupant_id = current_user_id
    and (
      state = 'occupied'
      or (state = 'reserved' and reserved_until > heartbeat_time)
    );
end;
$$;
