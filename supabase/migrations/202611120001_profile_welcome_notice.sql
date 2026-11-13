alter table public.profiles
  add column welcome_seen boolean not null default false;

grant update (welcome_seen) on public.profiles to authenticated;
