create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index chat_messages_room_created_at_idx
  on public.chat_messages (room_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy "Authenticated users can read chat messages"
  on public.chat_messages for select to authenticated using (true);

create policy "Users can send chat messages as themselves"
  on public.chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()));

grant select, insert on public.chat_messages to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_messages'
    ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;
