# Username/password auth + per-user game ownership + server-backed settings

*Sibling to `plan/2026-08-17-auth-wiring-and-per-game-membership.md`, which wires `requireAuth` onto the currently-unauthenticated game routes (events/commands/tiles/lobby) using the *existing* magic-link identity and explicitly defers replacing that auth mechanism to "a separate design doc" (its §1.3). This is that doc — it replaces the magic-link identity with username/password. The two land independently: that plan can wire `requireAuth` against `req.authEmail` first; this plan's session-shape change (`req.authEmail` → `req.userId`/`req.username`) is a mechanical follow-up wherever that lands.*

## Context

Today the app has passwordless login (email → 6-digit code → session token, in `auth_codes`/`user_sessions`, `server/auth.ts`) that nothing else in the app actually uses — `requireAuth` middleware exists but isn't mounted on any route. Games (`games` table) have no owner concept; "my games" is purely a `localStorage` cache (`src/io/userGames.ts`). Gameplay settings (`src/state/settings.ts`) are `localStorage`-only, read by 14 files across rendering/gameplay code.

The user wants real accounts (username/password, replacing the email-code flow), server-persisted settings per account, and games tied to an owning account — with a cap on how many games an account can own, since each game drags along a `tiles` row set (~227KB for a small map, scales with map size) via `ON DELETE CASCADE`. No real users exist yet (dev/test data only — 8 games in the local DB), so there's no migration-of-existing-accounts concern.

Single Postgres DB throughout (`game_poc`) — new tables, not new databases. Schema changes are applied automatically on every server boot via `initSchema()` (`server/db.ts`), which runs `schema.sql` then every file in `server/migrations/*.sql` in lexical order — new migrations just need to be idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) and numbered `012_*.sql` onward.

## Schema changes (new migrations)

**`server/migrations/012_users_password_auth.sql`**
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE user_sessions ALTER COLUMN email DROP NOT NULL;
```
`auth_codes` and `user_sessions.email` are left in place, unused, rather than dropped — avoids a destructive `DROP TABLE`/`DROP COLUMN` in a migration for no operational benefit; they're dead weight, not a hazard.

**`server/migrations/013_games_owner.sql`**
```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS games_owner_idx ON games(owner_user_id);
```
Nullable — anonymous game creation keeps working exactly as today (owner stays NULL, visible only via the existing local cache).

**`server/migrations/014_user_settings.sql`**
```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Server changes

**`server/auth.ts`** — replace the request-code/verify-code pair with register/login:
- `POST /auth/register {username, password}` — validate (username length/charset, password min length), hash password with `node:crypto`'s `scrypt` (salt + hash stored together in `password_hash`, verified with `timingSafeEqual` — same hand-rolled-with-`node:crypto` style already used in this file, no new dependency), insert into `users`, create a session, return `{token, username}`.
- `POST /auth/login {username, password}` — look up by username, verify with `scrypt`+`timingSafeEqual`, create session, return `{token, username}`.
- `GET /auth/session` / `POST /auth/logout` — same shape, now keyed on `user_id` instead of `email`.
- `requireAuth` sets `req.userId`/`req.username` instead of `req.authEmail`; add a non-throwing `optionalAuth` (reads the bearer token if present, sets `req.userId` if valid, otherwise just calls `next()`) for routes that should work both signed-in and anonymous.

**`server/routes.ts`**
- `POST /games`: run `optionalAuth` first. If `req.userId` is set, check `SELECT count(*) FROM games WHERE owner_user_id = $1` against `MAX_GAMES_PER_USER = 20` and reject with 409 (`"game limit reached"`) if at cap; otherwise insert with `owner_user_id = req.userId` (NULL when anonymous). Also fixes the existing `GAME_COLUMNS` inconsistency in this file (missing `next_charter_id`/`next_settlement_id` vs. `gameRepo.ts`'s copy) while touching this code.
- New `GET /games/mine` behind `requireAuth`: `SELECT ... FROM games WHERE owner_user_id = $1 ORDER BY id DESC`.
- Leave the existing unfiltered `GET /games` as-is (dev/debug use, e.g. `devConsole.ts`).

**New `server/settingsRoutes.ts`**, mounted at `/api/settings`, behind `requireAuth`:
- `GET /settings` → the row's `settings` JSONB, or `{}` if none.
- `PUT /settings {settings}` → upsert (`INSERT ... ON CONFLICT (user_id) DO UPDATE`).

## Client changes

**`src/io/auth.ts`** — replace `requestLoginCode`/`verifyLoginCode` with `register(username, password)` / `login(username, password)`; `AuthState` becomes `{token, username}`; localStorage key `heroesJs.authEmail` → `heroesJs.authUsername`. `checkSession`/`logout`/`authHeader` keep their shape, just typed on `username`.

**`src/screens/home/homeView.ts`** — replace the email+code modal (~lines 470-560) with a username+password form: two inputs, "Sign in" and "Create account" buttons calling `login`/`register` directly (no two-step code exchange needed anymore). `refreshAuthUi`/`authBtn` label swaps `authState.email` → `authState.username`.

**`src/io/userGames.ts`** — left as the anonymous/offline fallback cache, unchanged. Add a sibling function (or extend this module) `fetchMyGames()` calling `GET /games/mine`; `homeView.ts` uses it to populate the games list when `authState` is set, falling back to `listUserGames()` when logged out. `SessionManager.ts`/`toolbar.ts` keep using the local cache as today — not in scope.

**`src/state/settings.ts`** — keep `localStorage` as the always-on fast path (all 14 consumers keep calling `settings()`/`updateSettings()`/`subscribeSettings()` unchanged). Add, gated on `getCachedAuth()` from `src/io/auth.ts`:
- On module load / login: `GET /api/settings`, merge over the local copy if present.
- On `updateSettings()`: keep the existing synchronous `localStorage.setItem`, additionally fire a debounced (~500ms) `PUT /api/settings` when authed.

## Caps & storage impact

- `MAX_GAMES_PER_USER = 20`, enforced in the `POST /games` handler (app-level check, not a DB constraint — consistent with how other validation in this codebase lives in route handlers).
- No versioned/checkpoint saves (per your call) — one row per game, so no snapshot-pruning logic needed.
- Storage math: current avg game row ~2.4KB, but `tiles` dominates at ~227KB/game for a small map (scales up for medium/large) via `ON DELETE CASCADE` from `games`. At the cap, worst case is ~20 games × a few hundred KB ≈ single-digit MB per account — trivial for Postgres even at hundreds of accounts. Deleting a game already cascades cleanly to `tiles`/`game_events`/`settlement_snapshots`.

## Verification

- Rebuild the dockerized stack (`sync-and-rebuild` agent or `docker compose up --build`) and confirm via `docker exec game_db psql -U gameuser -d game_poc -c '\d users'` / `\d user_settings` / `\d games` that the new migrations applied.
- Manually through the UI: register a user, log out, log back in with the password; create a game while logged in and confirm `owner_user_id` is set (`SELECT owner_user_id FROM games ...`); create games past the cap (temporarily lower `MAX_GAMES_PER_USER` for the test) and confirm the 409; change a setting while logged in, then check `SELECT settings FROM user_settings WHERE user_id = ...` reflects it.
- Run `npm test` (`test/smoke.ts`) — no existing tests reference `auth_codes`/the email-code flow/`user_sessions`, so this is low-risk, but confirm it still passes since `POST /games` behavior changed.
