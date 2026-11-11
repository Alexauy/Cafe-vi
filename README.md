# Cafe-Vi

Cafe-Vi is a shared virtual café for focused work sessions. The app uses Next.js App Router, React, TypeScript, CSS Modules, and Supabase Auth, PostgreSQL, and Realtime.

## Run locally

Use Node.js 20.9 or newer:

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. Without Supabase credentials, the app runs the local preview with sample occupants.

## Supabase setup

The app needs a Supabase project for accounts and shared room state. No project credentials are needed to review the local preview.

1. Create a Supabase project and enable email/password authentication.
2. Run the SQL files in `supabase/migrations` in filename order in the Supabase SQL Editor. The initial migration creates the room, 20 fixed seats, profiles, work sessions, row-level security, and protected RPCs; later migrations allow all eight avatar choices, restore a user's seat during the reconnect grace period, add private diary entries and Pacific-day activity summaries, accept whole-minute work sessions up to 24 hours, restrict diary writing to the current Pacific day, add saved live chat messages, and add protected chat moderator roles. For an existing project, apply any newly added migration before expecting its change to take effect.
3. In Authentication URL Configuration, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the allowed Redirect URLs. Password recovery returns through `/auth/callback` and then opens `/reset-password`; add the equivalent allowed URL pattern for each deployed app domain.
4. Confirm that `seats`, `profiles`, `work_sessions`, and `chat_messages` are in the `supabase_realtime` publication. The migrations add them when that publication exists.
5. Enable the `pg_cron` extension, then schedule cleanup once per minute in the SQL Editor with `select cron.schedule('cleanup-cafe-state', '* * * * *', $$select public.cleanup_cafe_state();$$);`. This resolves expired timers and releases stale seats after the 45-second grace period.
6. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key from Supabase. Restart the dev server after changing environment variables.

To grant moderator access, find the account's UUID under **Authentication → Users** and run this in the Supabase SQL Editor, replacing the placeholder with that UUID:

```sql
insert into public.chat_moderators (user_id)
values ('<AUTH_USER_UUID>')
on conflict (user_id) do nothing;
```

Only add trusted accounts. The table has no client-side write access; moderator status is assigned through the SQL Editor. To revoke access, run `delete from public.chat_moderators where user_id = '<AUTH_USER_UUID>';`, then have the user reload the café.

The service-role key is not needed by the browser app and must never be put in a `NEXT_PUBLIC_` variable.

## Current full-stack functionality

With the migrations applied and environment configured, users can create accounts or sign in, edit their username/avatar, claim one of 20 seats, start fixed-duration work sessions, chat with other signed-in café guests, and leave. Chat history displays the latest 50 messages. Assigned moderators additionally see controls to delete chat messages for everyone; PostgreSQL row-level security enforces this permission. Seat claims and session timestamps are enforced by PostgreSQL. Seats, profiles, sessions, and chat messages update in connected rooms through Supabase Realtime; a heartbeat and cleanup job manage abandoned seats.

Without configuration, the room remains a local UI preview and its sample state resets on refresh. Ambient audio is still a placeholder. Multi-browser behavior cannot be verified until the app is connected to a Supabase project.
