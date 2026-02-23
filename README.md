# airsoft

Online Airsoft Quest tracker with maps integration.

## Multi-game invite flow

- Landing page now supports `Join Existing Game` and `Create New Game`.
- Each game has its own invite code (`6` alphanumeric chars).
- Missions, completions, default map center, tactical icons and map shapes are isolated per game.
- Admin login/session is scoped to the selected game code.

## Time-critical missions (CET)

When creating a mission in Admin, you can optionally enable a CET time window.

- Mission can be redeemed only between the configured start/end times (CET).
- Outside that range, redemption returns a clear error message that the mission is time-critical.
- After the window expires, the mission is shown as failed on the map (red circle with red `X`).

## Default visitor map start

In Admin Panel, you can set a global playfield start position (lat/lng).

- New visitors start on that map position by default.
- You can pick the point directly from the map click picker.

## Tactical map icons

Admin can place persistent military markers on the map and remove them later from Admin Panel.

- Available presets: `Village`, `North Spawn`, `South Spawn`, `House`
- For each marker you can set custom name text (shown inside marker) and custom color.

## Map shapes

Admin can draw polygon overlays by picking multiple points on the map, then setting:

- Label text
- Color
- Transparency (`0` to `1`)

## Supabase persistence setup

This app now stores game state in Supabase using normalized tables instead of a single JSON blob.

### 1. Run Supabase migrations

Run the SQL migrations in your Supabase project:

- `supabase/migrations/20260219130000_create_game_state.sql`
- `supabase/migrations/20260219142000_game_state_service_role_policy.sql`
- `supabase/migrations/20260223083000_create_atomized_game_tables.sql`

You can run it either in Supabase SQL Editor or with Supabase CLI migrations.

The runtime now reads/writes `games`, `missions`, `mission_locations`, `completions`, `players`, `map_markers`, `map_shapes`, `map_shape_points`, and `map_signals`.

### 2. Configure environment variables

Set these server-side env vars (locally and on Vercel):

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Do not expose it in browser code.
Use the service-role secret key (`sb_secret_*` or legacy `service_role` JWT), not `sb_publishable_*`.

### 3. (Optional) Seed local JSON data

To upload current `data/store.json` into normalized Supabase tables:

```bash
npm run seed:supabase
```

Or provide a custom source file:

```bash
node scripts/seed-supabase-store.mjs ./path/to/store.json
```

You can also provide an explicit invite code for seeded data:

```bash
node scripts/seed-supabase-store.mjs ./path/to/store.json A1B2C3
```

### 4. Deploy

After env vars are set in Vercel, redeploy the app.
