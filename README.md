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
2. Run the SQL files in `supabase/migrations` in filename order in the Supabase SQL Editor. The initial migration creates the room, 20 fixed seats, profiles, work sessions, row-level security, and protected RPCs; later migrations allow all eight avatar choices, restore a user's seat during the reconnect grace period, add private diary entries and Pacific-day activity summaries, accept whole-minute work sessions up to 24 hours, restrict diary writing to the current Pacific day, add saved live chat messages, add protected chat moderator roles, allow signed-out visitors to preview occupied seats and public profile names/avatars without exposing work-session details or allowing seat claims, set the disconnect grace period to 10 seconds, release stale seats in a single cleanup pass, and arbitrate simultaneous seat claims within a 250 ms window. Competing claims for one seat within that window all fail with `failed to claim seat, please try again.` Room capacity can be adjusted between 1 and 20 for isolated tests. For an existing project, apply any newly added migration before expecting its change to take effect.
3. In Authentication URL Configuration, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to the allowed Redirect URLs. Password recovery returns through `/auth/callback` and then opens `/reset-password`; add the equivalent allowed URL pattern for each deployed app domain.
4. Confirm that `seats`, `profiles`, `work_sessions`, and `chat_messages` are in the `supabase_realtime` publication. The migrations add them when that publication exists.
5. Enable the `pg_cron` extension, then schedule cleanup once per minute in the SQL Editor with `select cron.schedule('cleanup-cafe-state', '* * * * *', $$select public.cleanup_cafe_state();$$);`. Heartbeats run every 5 seconds and stale seats are released after a 10-second timeout in one cleanup pass. Because the cleanup job runs once per minute, a crashed or disconnected user's seat can remain visible for up to about 60 seconds after the timeout (plus the signed-out preview's 5-second refresh interval). An explicit page close attempts immediate release.
6. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key from Supabase. Restart the dev server after changing environment variables.

To grant moderator access, find the account's UUID under **Authentication → Users** and run this in the Supabase SQL Editor, replacing the placeholder with that UUID:

```sql
insert into public.chat_moderators (user_id)
values ('<AUTH_USER_UUID>')
on conflict (user_id) do nothing;
```

Only add trusted accounts. The table has no client-side write access; moderator status is assigned through the SQL Editor. To revoke access, run `delete from public.chat_moderators where user_id = '<AUTH_USER_UUID>';`, then have the user reload the café.

The service-role key is not needed by the browser app and must never be put in a `NEXT_PUBLIC_` variable.

## Host on a public website

The PRD selects Vercel for the Next.js app and Supabase for hosted auth and data.

1. Push the repository to GitHub and import it into Vercel as a Next.js project. Keep the default build command (`next build`) and output settings.
2. In Vercel project settings, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Production and any Preview environments that should connect to Supabase. Never add the Supabase service-role key to the browser app.
3. Before launch, apply every SQL migration in filename order to the Supabase project, enable Realtime for the documented tables, and configure the `pg_cron` cleanup job described above.
4. In Supabase Authentication URL Configuration, set the Site URL to the production origin (for example, `https://cafe.example.com`) and add that origin's allowed redirect URLs, including `/auth/callback`. Add the Vercel preview URL patterns only if preview deployments should support authentication.
5. Before deploying to production, confirm the room capacity is restored to 20, apply any pending migrations, and test the production sign-up/sign-in, password recovery, seat claims, chat, and signed-out occupancy flows. Deploy from Vercel, then attach a custom domain in Vercel and follow its DNS instructions if desired.

Explicit sign-out ends any active work session and frees the seat before signing out the current browser session. Closing the page sends keepalive requests to perform the same seat release and local sign-out. Browsers can still terminate network requests during shutdown, so heartbeat timeout and scheduled cleanup remain the fallback for crashes, lost connections, or failed exit requests.

## Current full-stack functionality

With the migrations applied and environment configured, users can create accounts or sign in, edit their username/avatar, claim one of 20 seats, start fixed-duration work sessions, chat with other signed-in café guests, and leave. Signed-out visitors can view who is seated and how many seats are available, but cannot claim a seat. Chat history displays the latest 50 messages. Assigned moderators additionally see controls to delete chat messages for everyone; PostgreSQL row-level security enforces this permission. Seat claims and session timestamps are enforced by PostgreSQL. Seats, profiles, sessions, and chat messages update in connected rooms through Supabase Realtime; signed-out room previews refresh every 5 seconds, and a heartbeat and cleanup job manage abandoned seats.

Without configuration, the room remains a local UI preview and its sample state resets on refresh. Adjustable ambient audio is implemented. The user has verified task/avatar updates in multiple users' views, observed that diary entries are limited to their owner, tested room-full behavior at a temporary capacity of two, and confirmed simultaneous same-seat claims within 250 ms are rejected for both claimants. The full 20-seat load and 21st-user overflow at the normal capacity remain untested.

### Temporary two-seat capacity test

Only do this in a disposable local or test Supabase project, never while real users may be in the room. After applying all migrations, verify the room is empty:

```sql
select count(*) as occupied_seats
from public.seats
where occupant_id is not null;
```

If the count is zero, temporarily set capacity to two:

```sql
update public.rooms set capacity = 2 where slug = 'cafe-vi';
```

Reload the app in each test browser. It will show only seats 1 and 2, and the backend will reject attempts to claim any higher seat number. After testing, restore the normal capacity:

```sql
update public.rooms set capacity = 20 where slug = 'cafe-vi';
```

Reload test browsers again. The database continues to have its 20 seat records throughout; only the configured capacity changes.

With capacity set to two, verify that two distinct users can fill the room and a third sees the full-room state with no claimable seat. For the race case, leave one seat open, have two signed-in browsers click that same seat within 250 ms, and verify both see `failed to claim seat, please try again.` and neither is seated. Then retry with one browser alone; that claim should succeed.
