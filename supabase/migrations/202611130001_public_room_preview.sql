create policy "Anonymous users can read the café room"
  on public.rooms for select to anon using (true);

grant select on public.rooms to anon;

create function public.get_public_cafe_occupants()
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
    and seat.state <> 'available'
    and seat.occupant_id is not null
  order by seat.seat_no;
$$;

revoke all on function public.get_public_cafe_occupants() from public;
grant execute on function public.get_public_cafe_occupants() to anon, authenticated;
