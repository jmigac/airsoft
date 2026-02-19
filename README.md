# airsoft

Online Airsoft Quest tracker with maps integration.

## Time-critical missions (CET)

When creating a mission in Admin, you can optionally enable a CET time window.

- Mission can be redeemed only between the configured start/end times (CET).
- Outside that range, redemption returns a clear error message that the mission is time-critical.
- After the window expires, the mission is shown as failed on the map (red circle with red `X`).

## Supabase persistence setup

This app now stores game state in Supabase instead of local files.

### 1. Create the table in Supabase

Run the SQL migration in your Supabase project:

- `supabase/migrations/20260219130000_create_game_state.sql`

You can run it either in Supabase SQL Editor or with Supabase CLI migrations.

### 2. Configure environment variables

Set these server-side env vars (locally and on Vercel):

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Do not expose it in browser code.
Use the service-role secret key (`sb_secret_*` or legacy `service_role` JWT), not `sb_publishable_*`.

### 3. (Optional) Migrate existing local JSON data

To upload current `data/store.json` into Supabase:

```bash
npm run seed:supabase
```

Or provide a custom source file:

```bash
node scripts/seed-supabase-store.mjs ./path/to/store.json
```

### 4. Deploy

After env vars are set in Vercel, redeploy the app.
