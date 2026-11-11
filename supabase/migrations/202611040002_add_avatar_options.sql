alter table public.profiles
  drop constraint if exists profiles_avatar_id_check;

alter table public.profiles
  add constraint profiles_avatar_id_check
  check (avatar_id in (
    'brownie', 'cookie', 'matcha', 'mocha', 'tart',
    'clown', 'orange', 'green'
  ));
