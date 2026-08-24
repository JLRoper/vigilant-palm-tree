# Auth model

Issue #179. Magic-link auth (`server/auth.ts`) plus per-game membership
(`server/middleware/requireGamePlayer.ts`), wired into every route that reads
or mutates a specific game.

## Middleware order: `requireAuth` -> `requireGamePlayer`

`requireGamePlayer` asserts `req.authEmail` is already set and throws if it
isn't -- that only happens if the two are wired in the wrong order (or
`requireGamePlayer` is used alone), and it should fail loud in that case
rather than surface as a confusing 403 with no clear cause. Express 5
auto-forwards a rejected async middleware's promise to `errorHandler`
(`server/errorHandler.ts`), which turns it into a `500`.

## 401 vs 403

- **401** (`requireAuth`): no valid bearer token. The caller isn't logged in,
  or their session expired/was revoked.
- **403** (`requireGamePlayer`, `not_a_player`): the caller is logged in, but
  their email has no claimed seat in this game.
- **403** (commands route, `actor_mismatch`): the caller is logged in and is
  a member of this game, but the `actor` seat on the command they sent isn't
  the seat they claimed.
- **404** (`requireGamePlayer`, `game_not_found`): the named game doesn't
  exist.

## Email-to-seat mapping

`games.lobby.claimed[seat]` (JSONB, from `008_lobby.sql`) gained an `email`
field alongside the existing cosmetic `handle`:

```
claimed[seat] = { handle: string, email: string, claimedAt: string }
```

`email` is always server-derived from `req.authEmail` at claim time -- never
client-supplied -- so it's the identity-binding field `requireGamePlayer`
matches against. `handle` stays a free-text display name; it carries no
security weight. No new table: `requireGamePlayer` does a per-request
`SELECT lobby->'claimed' FROM games WHERE name = $1` and matches by email,
cached in-process per game name for 5 seconds. `POST .../lobby/claim` calls
`invalidateMembershipCache(name)` after a successful claim so a player who
just joined can act immediately rather than waiting out the TTL.

## Actor-vs-seat defense in depth

`commandHandler.ts`'s existing per-command checks (`forbidden_not_your_turn`,
`forbidden_not_your_hero`, `forbidden_not_your_settlement`) are seat-based --
they verify the seat named in the command has the authority it claims, not
that the caller sending the command actually owns that seat. The commands
route adds one more check in front of that: `command.actor !== req.playerSeat`
-> `403 actor_mismatch`. The seat-level checks stay as-is; they catch logic
bugs (an existing seat that lacks authority for this specific action), the
route-level check catches identity spoofing (a seat the caller was never
bound to).

## Public routes (no auth)

- `GET /health`
- `GET /units`
- `GET /games`, `GET /games/:name`, `GET /games/:name/validate` -- game
  list/metadata; not sensitive enough to gate, and gating them would block
  the pre-login lobby browse.
- `PATCH /games/:name` -- deprecated full-state push, superseded by the
  commands bus; not worth adding auth to a path already on its way out.

## Backward-compat: pre-auth lobby claims

Claims made before this landed have `{ handle, claimedAt }` with no `email`.
Migration `012_clear_unbound_lobby_claims.sql` clears any such entry
(idempotent -- a no-op once every remaining entry has an `email`), so those
seats go back to unclaimed and get re-claimed under the new flow. No
`legacy:`-prefixed placeholder backdoor.

## Testing

`server/auth.ts`'s `POST /auth/request-code` returns `devCode` whenever
`NODE_ENV !== "production"`, so tests drive the real login flow end-to-end
(`test/helpers/authFlow.ts`) instead of mocking auth.
