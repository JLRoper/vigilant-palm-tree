# Plan: Auth Wiring + Per-Game Membership

*Authored 2026-08-17. Sibling to `plan/2026-08-17-consolidated-phase-1-5-track-map.md` (master Phase 1–5 track map — this doc sits outside it deliberately; §7.1's "Phase 5.A continuation" item 3 already names the event-cursor/SSE ownership decision that this work gates on). Triggered by the verification audit's findings (`plan/2026-08-17-track-map-doc-audit-findings.md`) and live environment check (`plan/2026-08-17-verification-and-next-steps.md`): while standing the dev environment up, the full auth surface was reviewed and `requireAuth` was found defined but never wired into any route. This is not in scope of the Phase 1–5 plan and is not on the track map; it's a fresh piece of work that's time-pinned because the in-flight Phase 5.A event-cursor PR will turn `/games/:name/events` from a low-traffic endpoint into the high-throughput live sync channel.*

**Status (2026-08-17): not started.** No PRs open. Owner: this session. Time-pinned: must land before Phase 5.A's `multiplayerSync.ts` rewrite merges, because that PR inherits the events endpoint as-is and is otherwise shipping a high-throughput unauthenticated read of every player's game state.

---

## 1. Context & motivation

### 1.1 What's broken today (verified by reading the code)

`server/auth.ts` defines the full auth surface — magic-link request/verify (`/auth/request-code`, `/auth/verify-code`), session lookup (`loadSession`), bearer-token middleware (`requireAuth`, line 69) — and the client side (`src/io/auth.ts:46`) sends `Authorization: Bearer <token>` on `/auth/*` calls. The pattern is complete.

A repo-wide grep finds **zero** call sites of `requireAuth` and **zero** uses of `req.authEmail` as an authorization check anywhere in `server/`. Concretely, every one of these routes is unauthenticated:

| Route | File:line | Reads / writes |
|---|---|---|
| `GET /games/:name/events` | `server/routes.ts:475` | Full event stream for the game — all `game_events` rows |
| `POST /games/:name/commands` | `server/http/routes/commands.ts:272` (mounted at `server/routes.ts:25`) | The **only** authoritative mutation path in the app |
| `GET /games/:name/tiles` | `server/routes.ts:491` | Procedural map (regenerable from `seed`/`map_size`, low-sensitivity) |
| `POST /games/:name/lobby/claim` | `server/routes.ts:204` | Seat claim with arbitrary `handle` string — no identity binding |
| `POST /games/:name/lobby/start` | `server/routes.ts:257` | Game start (requires all seats claimed) |
| `PATCH /games/:name` | `server/routes.ts:??` (full-state push) | Still exercised by `SessionManager.manualSave()` |
| `GET /games`, `GET /games/:name`, `GET /games/:name/validate` | `server/routes.ts:159`/`:166`/`:186` | Game list / metadata |

Anyone who can reach the server can read every game's full event stream and issue commands as any seat by passing `actor: <seatIndex>`. `commandHandler.ts`'s in-handler seat checks (`forbidden_not_your_turn`, `forbidden_not_your_hero`, etc.) catch some of this — they verify the seat exists and it's your turn, but they don't verify "you" is actually you.

### 1.2 Why this is time-pinned

Per `plan/2026-08-17-consolidated-phase-1-5-track-map.md` §7.1 and §12 item 3, the developer's in-flight Phase 5.A work turns `GET /games/:name/events` into the live multiplayer state-sync channel (rewriting `src/io/multiplayerSync.ts` from full-state polling to delta-event polling). Once that lands:

- Every player will be streaming every game event in real time through `GET /games/:name/events`.
- The endpoint still has no auth — meaning any unauthenticated client who guesses a game name can read every other player's moves, gold totals, captures, battles.
- The same unauthenticated `POST /commands` becomes the only mutation path (`PATCH /games/:name` is being deprecated in favor of the commands bus per the Phase 3–5 plan).

§8 of the master plan assigns `server/routes.ts` to Track A as **"delete-only as commands port"** — the in-flight event-cursor work is not going to add auth. If we don't land auth before the event-cursor PR merges, the high-throughput live sync channel ships without it.

### 1.3 What this plan does NOT do

- Doesn't replace magic-link auth with anything stronger (passkeys, OAuth) — separate design doc.
- Doesn't add token rotation / refresh tokens.
- Doesn't add per-route rate limiting on `POST /commands`.
- Doesn't add an audit-log `actor_email` column on `game_events` (the `actor_seat INTEGER` added by `010_event_seq.sql` is the only audit dimension for now).
- Doesn't change `Player` (the `@heroes/contracts` type stays email-free; auth lives in JSONB).

---

## 2. Architectural decisions

### 2.1 Email → seat mapping uses `games.lobby.claimed[seat].email` (JSONB), not a new table

The `lobby` JSONB column was added by `server/migrations/008_lobby.sql` with shape `{ claimed: Record<seatIndex, { handle: string; claimedAt: string }> }`. We're extending the per-seat shape to `{ email: string, claimedAt: string }`. **Zero schema changes, zero migrations for the auth surface itself.**

A `game_players(game_id, seat, email)` junction table was considered and rejected — queryability benefit is small (membership is always keyed by `games.name` for the cursor-sync workload), and a JSONB extract + a small per-process cache (5s TTL) inside `requireGamePlayer` is plenty.

### 2.2 Two-layer middleware: `requireAuth` → `requireGamePlayer`

Order is fixed and enforced by fail-loud assertion in `requireGamePlayer` (throws if `req.authEmail` is unset, since that means middleware order is silently broken — the kind of bug that only surfaces in production).

| Middleware | On failure | Sets |
|---|---|---|
| `requireAuth` (existing, `server/auth.ts:69`) | `401 { error: "unauthorized" }` | `req.authEmail: string` |
| `requireGamePlayer` (NEW) | `403 { error: "not_a_player" }` (or `404 { error: "game_not_found" }`) | `req.playerSeat: number` |

401 vs 403 follows REST convention. `requireGamePlayer` also invalidates its own per-process cache after a successful `lobby/claim` write, so a player who just claimed a seat can immediately act.

### 2.3 Client attaches Bearer automatically via `api.ts`, not per-call

Today every function in `src/io/commands.ts` builds its own `headers` — none attach the token (verified by grepping `src/io/commands.ts` for `Authorization`: zero hits). Fix at the lowest layer:

```
function withBearer(init: RequestInit = {}): RequestInit {
  const auth = getCachedAuth();  // from src/io/auth.ts:36
  if (!auth) return init;
  const headers = { ...(init.headers as Record<string,string> ?? {}), Authorization: `Bearer ${auth.token}` };
  return { ...init, headers };
}
```

Every `fetchWithTimeout` call site in `src/io/api.ts` (15 of them per the grep) wraps with `withBearer()`. The command functions in `src/io/commands.ts` need **zero** changes — they call `apiFetch` which goes through `fetchWithTimeout`. Existing `authHeader(token)` export in `src/io/auth.ts:105` stays for explicit-overrides if anything ever needs them.

### 2.4 Actor-vs-seat defense at the commands route layer

`commandHandler.ts`'s existing per-command checks (`forbidden_not_your_turn`, `forbidden_not_your_hero`, `forbidden_not_your_settlement`) are seat-based — they verify "the seat you're acting as exists and has authority," not "the seat you're acting as is yours." We add **one new check at the route layer** before `handleCommandTransactional`:

```
if (command.actor !== req.playerSeat) {
  res.status(403).json({ error: "actor_mismatch" });
  return;
}
```

Belt-and-suspenders. The seat-level checks in `commandHandler.ts` are still correct and stay as-is — they catch logic bugs (wrong seat index that *does* belong to someone), the new check catches identity spoofing.

### 2.5 Smoke-test gets a `lobby/claim` step

`test/smoke.ts` currently creates games and issues commands without claiming a seat. Once `POST /commands` requires membership, smoke tests fail. The fix is one extra step per game: log in via magic-link, claim seat 0, then proceed. This is the only test-suite change in scope.

---

## 3. PR breakdown & status chart

| PR | Title | Status | Files | Depends on |
|---|---|---|---|---|
| **PR-A1** | `requireGamePlayer` middleware + tests | ⬜ not started | 1 new src, 1 new test | — |
| **PR-A2** | Wire `requireAuth` + `requireGamePlayer` into `/games/:name/*` routes + `lobby/claim` body change | ⬜ blocked on A1 | 1 modified (routes.ts), 1 modified (commands.ts), 1 modified (smoke.ts) | A1 |
| **PR-A3** | Client `withBearer` helper + 15 call-site wraps in `api.ts` | ⬜ blocked on A1 | 1 modified (api.ts) | — (parallel-safe) |
| **PR-A4** | Data cleanup migration `011_clear_unbound_lobby_claims.sql` | ⬜ blocked on A1 | 1 new migration | — (parallel-safe) |
| **PR-A5** | `docs/auth-model.md` — middleware order, 401-vs-403, public-route list, follow-ups | ⬜ not started | 1 new doc | A1, A2 |

**Status legend:** ⬜ not started · 🟡 in progress · ✅ merged · 🚫 blocked / deferred

### 3.1 Combined / can-merge-together status

| Combo | Why it can land together | When |
|---|---|---|
| **A1 alone** | Pure middleware addition + its own tests; no behavior change | First, as scaffolding |
| **A1 + A4** | A4 is one SQL file, no code dependency on A1; landing together keeps migration+app in lockstep | Strongly preferred |
| **A2 + A3** | A2 hardens server, A3 hardens client — they fail the auth check from opposite sides; merge together = "from this commit on, all `/games/:name/*` requires auth, and the client sends the token" | After A1+A4 merge |
| **A5** | Pure doc, lands anytime after A1/A2 exist | Last |

### 3.2 Recommended PR shape

If we want to minimize PR count: **merge A1+A4 as one PR**, then **merge A2+A3 as one PR**, then **A5 standalone**. That's 3 PRs total. The split is: (server middleware + migration) → (server route wiring + client wiring) → (doc).

---

## 4. File-level changes per PR

### 4.1 PR-A1 — `requireGamePlayer` middleware + tests

**New files:**

- `server/middleware/requireGamePlayer.ts`
  - Single Express middleware factory: `requireGamePlayer(req, res, next): Promise<void>`.
  - Asserts `req.authEmail` is set (fail-loud if middleware order is wrong).
  - `SELECT lobby->'claimed' AS claimed FROM games WHERE name = $1`.
  - Iterates claimed entries; matches by `email === req.authEmail`.
  - Sets `req.playerSeat: number`, calls `next()`.
  - 404 if game not found, 403 if seat not found.
  - Exports `invalidateMembershipCache(gameName: string)` (called by `lobby/claim` after a successful write).
  - Internal cache: `Map<gameName, { claimed: Record<string, …>, loadedAt: number }>` with 5s TTL.

- `test/server/requireGamePlayer.test.ts`
  - Unit-level tests against a minimal Express app (no need for supertest; `node:http` works).
  - Cases: missing `req.authEmail` → throws; valid auth + missing game → 404; valid auth + game + no matching seat → 403; valid auth + matching seat → `next()` called with `req.playerSeat`; cache hit within TTL; cache invalidated after `invalidateMembershipCache`.

**No production behavior change** — the middleware is added but not yet wired into any route.

### 4.2 PR-A2 — Wire middleware + `lobby/claim` body change

**Modified files:**

- `server/routes.ts`
  - Add `requireAuth` + `requireGamePlayer` to:
    - `GET /games/:name/events` (line 475)
    - `GET /games/:name/tiles` (line 491)
    - `POST /games/:name/lobby/start` (line 257) — only members can start
  - Add `requireAuth` only (not `requireGamePlayer`) to:
    - `POST /games/:name/lobby/claim` (line 204) — claim is the only route that's auth-required-but-not-yet-a-member; you must be logged in to claim, but you're claiming *into* membership
  - Modify `lobby/claim` body: drop `handle` body param, set `lobby.claimed[seat] = { email: req.authEmail, claimedAt: new Date().toISOString() }`. Derive `players[i].name` from `req.authEmail.split("@")[0].slice(0, 32)`.
  - **Leave public** (documented in A5): `GET /health`, `GET /units`, `GET /games`, `GET /games/:name`, `GET /games/:name/validate`, `PATCH /games/:name` (deprecated; `SessionManager.manualSave()` still uses it).

- `server/http/routes/commands.ts`
  - After `export const commandsRouter = Router({ mergeParams: true })` (line 54), add `commandsRouter.use(requireAuth, requireGamePlayer)`.
  - In the `POST /` handler (~line 272), after `parseCommand` succeeds and before `getLiveDeps()`, add the actor-vs-seat check (see §2.4).
  - The existing 403 on `forbidden_not_your_turn` stays unchanged.

- `test/smoke.ts`
  - Add a "log in + claim seat" step before any existing game-creation flow.
  - Verify the existing assertions still pass (most should — they're testing post-conditions, not pre-conditions).

### 4.3 PR-A3 — Client `withBearer` helper

**Modified files:**

- `src/io/api.ts`
  - Add `function withBearer(init: RequestInit = {}): RequestInit` (see §2.3).
  - Import `getCachedAuth` from `./auth`.
  - Wrap every `fetchWithTimeout(url, init, …)` call site (15 of them) to `fetchWithTimeout(url, withBearer(init), …)`.
  - No public API change — `api.health()`, `api.listGames()`, etc., signatures unchanged.

### 4.4 PR-A4 — Data cleanup migration

**New file:**

- `server/migrations/011_clear_unbound_lobby_claims.sql`
  - For every game where `lobby->'claimed'` contains any entry without an `email` field, remove that entry from `claimed`.
  - Resets that `players[i].faction` to its pre-claim value (`"ai"` or the original faction from game creation).
  - Idempotent: re-running is a no-op (clearing already-cleared entries).
  - Backfill note: games created *after* A2 lands will only have `email`-bound claims, so this migration is a one-shot cleanup.
  - SQL sketch:
    ```sql
    -- For each game, walk lobby.claimed entries; remove any that lack an email key.
    UPDATE games
       SET lobby = jsonb_set(
         lobby,
         '{claimed}',
         (
           SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
             FROM jsonb_each(lobby->'claimed')
            WHERE value ? 'email'
         ),
         false
       )
     WHERE lobby->'claimed' IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jsonb_each(lobby->'claimed') AS e(key, value)
          WHERE NOT (value ? 'email')
       );
    ```

**Decision needed before merge:** whether to ship A4 (clear + force rejoin) or skip it and ship only A1/A2/A3 (players rejoin manually on first 403). See §5.

### 4.5 PR-A5 — `docs/auth-model.md`

**New file:**

- `docs/auth-model.md`
  - Middleware order (`requireAuth` then `requireGamePlayer`) and the fail-loud assertion rationale.
  - 401 vs 403 distinction.
  - Email-to-seat mapping (JSONB path; why no new table).
  - Public-route list with rationale (what's *not* auth'd and why): `/health`, `/units`, `/games`, `/games/:name`, `/games/:name/validate`, `PATCH /games/:name` (deprecated).
  - `actor` vs `req.playerSeat` defense-in-depth.
  - **Open follow-ups** (out of scope, tracked here so they don't get lost):
    1. Client-side 401 handling: detect token expiry, trigger re-magic-link. Currently `CommandError` doesn't distinguish 401 from 409.
    2. Audit log: backfill `actor_email` to `game_events` for forensic queries (currently only `actor_seat INTEGER` from `010_event_seq.sql`).
    3. Token rotation / refresh tokens.
    4. Rate limiting on `POST /commands`.
    5. Replace magic-link with passkeys / OAuth.
    6. Grandfather policy decision if A4 is skipped (see §5).

---

## 5. Backward-compat / migration policy decision

Existing `lobby.claimed[seat]` entries have shape `{ handle, claimedAt }` — no `email`. Under A1+A2 alone (without A4), the new membership check 403s every such seat, locking existing players out of their own games. Three options:

| Option | Behavior | Ships |
|---|---|---|
| **A. Force-clear + rejoin** | A4 runs on migration. Players with old games get a "your seat needs to be re-bound — click to reclaim" UX prompt on first 403. | A1 + A2 + A3 + A4 together |
| **B. Grandfather with placeholder email** | Migration backfills `email = 'legacy:<seat>@unbound.local'` to all un-bound seats. App code accepts the `legacy:` prefix in dev only, real sessions always have real emails. | A1 + A2 + A3 + A4 (different SQL) |
| **C. No backfill, manual rejoin** | A4 is skipped. Every existing player hits 403 on their next command, sees the rejoin prompt, re-claims. One-time disruption per player. | A1 + A2 + A3 only |

**Recommendation: Option A.** Smallest migration (~10 lines SQL, idempotent), no backdoor in the security model, rejoin UX is a single button on the home page or a toast on first command failure, and the in-game seat number is preserved across the rejoin so players keep their position.

**Option B is a security smell** — the `legacy:` prefix is a permanent backdoor unless we add a TTL or a "first-rejoin-clears-it" mechanism, and either of those re-introduces the migration complexity Option A avoids.

**Option C is acceptable but worse UX** than Option A — every existing player hits a broken state instead of a clean one-shot migration.

---

## 6. What the player sees (UX impact summary)

| Change | Severity | Recurring? |
|---|---|---|
| Login becomes mandatory (was skippable) | Medium friction for casual / first-time players | Yes |
| Handle becomes email-derived (`alex@example.com` → `alex`) | Low (cosmetic) | Yes |
| Old games need re-claim (Option A) | High for affected players, bounded | One-time |
| Token expiry → silent 401 (no client-side handling yet) | Medium, fixable in follow-up | Yes |
| Both players in a multiplayer game must sign in | Medium social-friction bump | Yes |
| Anonymous play goes away | Medium for casual, low for engaged players | Yes |
| Smoke test breaks CI until claim step added | None for players; blocks deploys | Until A2's smoke-test edit lands |

Decisions surfaced:
1. **Home page copy** needs updating — "Sign In" should read more like "Sign In to play" with the public-browse affordance preserved (the `/games` list).
2. **Re-claim UX** needs a one-screen design — a toast on first 403, or a "session expired" modal that walks the player through re-claim. Either is fine; doesn't need to be polished for v1.

---

## 7. Validation gates

Every PR must pass:
1. `npm run build` (tsc strict + vite build; checks `server/` too)
2. `npm run lint:deps` (zero `dependency-cruiser.cjs` violations)
3. `npm run validate-assets`
4. `npm run test:all` (smoke + multiplayer.smoke + cityView + domain unit tests)

**Additional gate for A2:** every existing smoke assertion still passes after the `lobby/claim` step is added.

**Additional gate for A4:** the migration script runs cleanly against a Postgres containing a sample game with both email-bound and unbound claims; re-running is a no-op; the sample game's player can re-claim and proceed normally.

---

## 8. Cross-Plan references

- `plan/2026-08-17-consolidated-phase-1-5-track-map.md` §7.1 / §8 / §12 item 3 — the Phase 5.A event-cursor work this plan gates on.
- `plan/2026-08-17-track-map-doc-audit-findings.md` Finding 3 — names PR #106's auth-adjacent changes (`fix/issue-98-100-error-handling-and-feedback`) that touched Track 5.A's surface; this plan picks up the auth gap that PR #106 didn't address.
- `plan/2026-08-17-verification-and-next-steps.md` §2.2 / §4 P0 — the fresh-clone onboarding gaps (`pwsh`, `engines`, `postinstall`) are unrelated to auth and stay on the P0 list.
- `server/auth.ts` — existing middleware being wired (this plan is the missing consumer).
- `server/migrations/008_lobby.sql` — the JSONB column this plan extends (additively, no schema change).
- `server/migrations/010_event_seq.sql` — adds `actor_seat INTEGER` to `game_events`; pairs with this plan's actor-vs-seat defense.

---

## 9. Open questions (resolved before merge)

1. **§5 decision: which backward-compat option (A / B / C)?** Default: A. Confirm with stakeholder before A2 merges.
2. **Home page UX copy**: who owns the "Sign In to play" rewording? Track A (this plan) can ship the code; UX text lands with whoever owns the home page. Flag in PR-A2 description.
3. **Re-claim UX flow**: single button + magic-link re-trigger, or auto-redirect on first 403? Trivial either way; defer to whoever touches the home page next.
4. **Client-side 401 handling follow-up**: confirm this is a follow-up ticket, not in scope of A3. (`CommandError` currently doesn't branch on 401; the player will see a generic toast instead of a re-login prompt until the follow-up lands.)