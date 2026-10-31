# Common Ground — Virtual Café

An early Next.js prototype for the Virtual Café described in `virtual_cafe_codex_prd.md`. It renders a responsive room with 20 designated seats, sample occupants and public task cards. Selecting an open seat lets you enter a name and a fixed duration and add a local preview session; occupied sample seats can be vacated with the × control.

## Run locally

Requires Node.js 20.9 or newer. Install dependencies with `npm install`, then run `npm run dev` and open http://localhost:3000.

## Current milestone and limitations

This is a front-end room prototype. Seat occupancy, sample sessions, and task cards are held in browser memory and reset on refresh. It does not yet implement Supabase Auth, persistent profiles, atomic claims, realtime synchronization, authoritative timestamps, disconnect grace periods, audio playback, or backend cleanup. The task timer is presented as a compact design placeholder; it is not a running or authoritative countdown.

## Supabase setup for the backend milestone

Create a Supabase project before adding the authentication and room services. The planned application variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the current publishable key for the project), and server-only `SUPABASE_SERVICE_ROLE_KEY` if a privileged server operation is required. Keep real values in an ignored local `.env.local` and in deployment environment settings; never expose the service-role key to browser code. No credentials are needed for the current static prototype.

The backend milestone should introduce a 20-seat inventory and an atomic PostgreSQL claim operation, RLS-protected profiles and sessions, Supabase Realtime publication, and idempotent stale-seat cleanup. Seat ownership and work-session end timestamps must be server-authoritative.
