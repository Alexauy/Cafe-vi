create table public.chat_moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.chat_moderators enable row level security;

create policy "Moderators can read their own role"
  on public.chat_moderators for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.chat_moderators to authenticated;

create policy "Moderators can delete chat messages"
  on public.chat_messages for delete to authenticated
  using (
    exists (
      select 1
      from public.chat_moderators
      where user_id = (select auth.uid())
    )
  );

grant delete on public.chat_messages to authenticated;

alter table public.chat_messages replica identity full;
