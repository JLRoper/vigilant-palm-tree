# Auth model

Issue #179 (plus its optional-sign-in follow-up). Magic-link auth
(`server/auth.ts`) plus per-game membership (`server/middleware/
attachPlayerSeat.ts`), wired into the routes that benefit from knowing who's
calling. **Sign-in is optional everywhere** -- see `src/screens/home/
homeView.ts`'s footer message. Nothing rejects an anonymous caller; being
signed in only ever adds protection on top of what an anonymous caller
already gets. As of 2026-10-12 a signed-in caller also has a persistent
user account behind the session (`users` + `user_stats`, migration `029`) --
see [User accounts and profile](#user-accounts-and-profile-2026-10-12)
below. The optional-everywhere rule is unchanged: anonymous play works
exactly as before.

## Middleware: `attachAuth` -> `attachPlayerSeat`

Both are non-blocking. `attachAuth` sets `req.authEmail` if the caller sent a
valid bearer token; if not (no token, expired session, whatever), it just
calls `next()` with `req.authEmail` left unset -- never a 401. `attachPlayerSeat`
only does anything if `req.authEmail` is already set: it looks up whether
that email has claimed a seat in the target game and sets `req.playerSeat` if
so. An anonymous caller, or a signed-in caller who hasn't claimed a seat in
this particular game, ends up with `req.playerSeat` unset and proceeds
exactly like they would have before #179 -- trusted on the `actor` field they
send.

Order still matters (`attachPlayerSeat` needs `req.authEmail` to already be
set to do anything), but there's no fail-loud assertion anymore since running
`attachPlayerSeat` alone just means it never resolves a seat, not a bug.

## Where this is wired, and why

- **`commandsRouter`** (`server/http/routes/commands.ts`) -- both, because the
  actor-vs-seat check below depends on `req.playerSeat`.
- **`POST /games/:name/lobby/claim`** (`server/routes.ts`) -- `attachAuth`
  only. Claiming is how a signed-in caller's identity gets bound to a seat in
  the first place; an anonymous caller can still claim, they just don't get
  that binding.
- **`POST /games`** (`server/routes.ts`) -- `attachAuth` only (2026-10-12).
  A signed-in caller's `games_started` stat is incremented atomically
  (`userRepo.incrementGamesStarted`) inside the same `withTransaction` that
  creates the game; an anonymous caller skips that step and nothing else
  changes.
- **Everything else** (`GET .../events`, `GET .../tiles`, `POST .../lobby/
  start`, game list/metadata) -- no auth middleware at all. Nothing in those
  handlers reads `req.authEmail`/`req.playerSeat`, so attaching it would be
  pure overhead with no behavior to justify it.

## Actor-vs-seat: the one real protection layer

`commandHandler.ts`'s existing per-command checks (`forbidden_not_your_turn`,
`forbidden_not_your_hero`, `forbidden_not_your_settlement`) are seat-based --
they verify the seat named in the command has the authority it claims, not
that the caller sending the command actually owns that seat. The commands
route adds one more check in front of that, but only when it can:

```ts
if (req.playerSeat !== undefined && command.actor !== req.playerSeat) {
  res.status(403).json({ error: "actor_mismatch" });
}
```

If the caller is signed in and has claimed the seat they're acting as, a
spoofed `actor` gets caught here. If not, the request falls through to
`commandHandler.ts`'s seat-based checks -- the same trust model the app had
before #179. Signing in is what upgrades "trusted seat" to "trusted seat you
proved you own."

## Email-to-seat mapping

`games.lobby.claimed[seat]` (JSONB, from `008_lobby.sql`) has an optional
`email` field alongside the existing cosmetic `handle`:

```
claimed[seat] = { handle: string, email?: string, claimedAt: string }
```

`email` is server-derived from `req.authEmail` at claim time -- never
client-supplied -- and is only present if the claimer was signed in. `handle`
stays a free-text display name either way; it carries no security weight. No
new table: `attachPlayerSeat` does a per-request `SELECT lobby->'claimed'
FROM games WHERE name = $1` and matches by email, cached in-process per game
name for 5 seconds. `POST .../lobby/claim` calls `invalidateMembershipCache(name)`
after a successful claim so a player who just signed in and claimed can act
on that identity immediately rather than waiting out the TTL.

## User accounts and profile (2026-10-12)

The profile scheme adds a persistent user row behind the optional session.
`server/migrations/029_users_and_stats.sql` creates two tables (fully
idempotent -- `initSchema()` re-runs every migration on each boot, so every
statement is `IF NOT EXISTS` and the CHECK constraint is added via a `DO`
block):

- `users` -- `id`, `account_name`, `email`, `email_verified_at`, `created_at`,
  `updated_at`. Two case-folding unique indexes (`lower(trim(account_name))`
  and `lower(email)`) are the DB-level backstop behind the app's
  normalize-before-insert, and a CHECK constraint (`users_account_name_check`)
  restricts account names to `^[A-Za-z0-9_ .-]{1,64}$`.
- `user_stats` -- one row per user (`user_id` PK, `REFERENCES users(id) ON
  DELETE RESTRICT`), `games_started`, `last_played_at`. `games_completed`/
  `games_won` are deliberately reserved until a win condition exists.

`server/persistence/repositories/userRepo.ts` is the access layer:
`createUser` (normalizes lower + trim before inserting), `getUserByEmail`,
`getUserByAccountName`, `getUser`, and `incrementGamesStarted` -- a single
atomic `INSERT ... ON CONFLICT (user_id) DO UPDATE`.

Route surface (`server/auth.ts`):

- `POST /auth/register` -- creates an unverified `users` row (account name +
  email) and deliberately returns **no token**; signing in still happens via
  the email login-code flow. Duplicate account name or email -> `409`.
- `GET /auth/me` -- session required; returns the profile plus
  `{ games_started, last_played_at }` (`404` if no `users` row exists yet for
  the session email).
- `PATCH /auth/me` -- account name only; the email is identity and stays
  locked. Duplicate name -> `409`.
- `POST /auth/verify-code` -- creates the `users` row on the account's **first**
  login (`ON CONFLICT (lower(email)) DO NOTHING`), so every signed-in email
  always resolves to an account. It accepts an optional `account_name` in the
  body (the login modal does not send one); the stored name is the supplied
  value, or a default derived from the email local-part, and is never
  overwritten by a later login. Duplicate account name -> `409`.

Client side, `src/io/authTypes.ts` defines the `UserProfile` type and
`src/io/userProfile.ts` keeps a server-authoritative in-memory cache
(`getProfile`/`setSignedIn`/`clearProfile` -- deliberately no
`localStorage`; `src/io/userGames.ts` remains the only persisted client-side
game index). `src/io/auth.ts` gained `register`/`getMe`/`updateMe`, and
`verifyLoginCode` accepts an optional account name. The UI surface is one
component, `src/screens/shared/profilePanel.ts`: editable account name,
read-only email, stats (games won reads "N/A (no win condition yet)"), Save
+ Sign out. It opens from the home screen -- whose Sign In button becomes
"Profile" once signed in, beside a separate Sign Out button -- and from the
settings menu's foldable Profile section (a not-signed-in hint there points
back to the home screen's Sign In button). Sign-in itself stays optional
everywhere; the footer message in `homeView.ts` still says so.

## Testing

`server/auth.ts`'s `POST /auth/request-code` returns `devCode` whenever
`NODE_ENV !== "production"`, so tests that care about the signed-in path
drive the real login flow end-to-end (`test/helpers/authFlow.ts`,
`test/server/attachPlayerSeat.test.ts`, `test/server/commandsRoute.test.ts`)
instead of mocking auth. Most of the suite (`test/smoke.ts`, `test/
multiplayer.smoke.ts`, `test/cityView.test.ts`, `test/visualRegression.test.ts`)
deliberately runs anonymously, since that's the default experience now. The
profile routes have their own suite, `test/server/authRoutes.test.ts` (8
route tests against the shared test DB); it imports the router directly
instead of booting `initSchema()`, so it applies migration `029` itself in
`before()` and namespaces every fixture by email prefix so repeat runs don't
collide.
