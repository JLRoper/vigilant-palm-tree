# Auth model

Issue #179 (plus its optional-sign-in follow-up). Magic-link auth
(`server/auth.ts`) plus per-game membership (`server/middleware/
attachPlayerSeat.ts`), wired into the routes that benefit from knowing who's
calling. **Sign-in is optional everywhere** -- see `src/screens/home/
homeView.ts`'s footer message. Nothing rejects an anonymous caller; being
signed in only ever adds protection on top of what an anonymous caller
already gets.

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

## Testing

`server/auth.ts`'s `POST /auth/request-code` returns `devCode` whenever
`NODE_ENV !== "production"`, so tests that care about the signed-in path
drive the real login flow end-to-end (`test/helpers/authFlow.ts`,
`test/server/attachPlayerSeat.test.ts`, `test/server/commandsRoute.test.ts`)
instead of mocking auth. Most of the suite (`test/smoke.ts`, `test/
multiplayer.smoke.ts`, `test/cityView.test.ts`, `test/visualRegression.test.ts`)
deliberately runs anonymously, since that's the default experience now.
