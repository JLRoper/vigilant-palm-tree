# Architecture Review — heroes-js (fallows-of-elysiam)

Date: 2026-08-04

## 1. Overall shape

Single-repo monorepo, no workspace tooling (one `package.json`):

```
src/       client SPA — TypeScript + <canvas>, no UI framework, bundled by Vite
server/    Express 5 API, run directly via `tsx` (never compiled by tsc)
shared/    engine-neutral combat code imported by both src/ and server/
test/      Playwright smoke tests + a few unit tests
scripts/   PowerShell dev-env scripts + scripts/seed-assets.ts
tools/     sprite-generation tooling
docs/      design/architecture docs (partially stale — see §6)
```

Runtime deps are minimal and deliberate: `express`, `cors`, `pg`. No ORM, no state-management library, no test framework beyond Node's `assert/strict` + Playwright. This is a hand-rolled stack, not a framework-driven one — consistent with a small, fast-moving solo/duo project, but it means every cross-cutting concern (persistence, error shape, validation) is enforced by convention rather than by a framework.

**Build gap worth knowing about**: `tsconfig.json`'s `include` is `["src", "shared"]` only. `server/` is **never type-checked** — `npm run build` runs `tsc && vite build`, and `tsc` doesn't see `server/` at all. The server only gets "checked" by `tsx`'s on-the-fly transpile, which doesn't do type errors. This is not hypothetical: it already let a bug through (see §4.1).

## 2. Database — where and how

**Tech**: PostgreSQL 16 (`docker-compose.yml`, `postgres:16-alpine`), accessed via the raw `pg` driver. **No ORM/query builder** — every query is hand-written parameterized SQL.

**Connection** — `server/db.ts`:

```ts
export const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER || "gameuser",
  password: process.env.PGPASSWORD || "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});
```

One shared docker-compose Postgres container on a fixed host port; a code comment explains `DB_PORT` (the per-worktree dynamic port scripts write into `.env`) is deliberately *not* read here, only `PGPORT` as an explicit override. `.env.example` doesn't document the Postgres vars at all — it relies on `db.ts`'s fallback defaults matching `docker-compose.yml`, which currently holds but is fragile.

**Migrations** — `server/migrations/*.sql`, applied in an explicit hand-ordered sequence inside `initSchema()`, run on every server boot:

```
001_turn_state.sql → 002_unit_types.sql → 003_resource_tables.sql →
004_game_assets.sql → 005_unit_counters.sql → 007_unit_specialty.sql → 008_lobby.sql
```

All idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`). There's no migration framework (no `node-pg-migrate`, no `umzug`) — just a manually maintained list of `readFileSync` + `pool.query` calls. Note **`006` is missing** from the sequence with no comment explaining the gap — worth confirming whether it was intentionally reserved/skipped or a lost file.

**Schema** — dominant pattern is **"one big mutable JSON document per game," not normalized relational modeling**:

| Table | Purpose |
|---|---|
| `games` | Core session row: seed, round/day/active player, and three big **JSONB blobs** — `players`, `heroes`, `settlements` |
| `game_events` | Append-only per-game event log (`kind` + JSONB `payload`) — audit trail |
| `tiles` | Per-hex terrain/resource, generated once from seed and cached |
| `auth_codes` / `user_sessions` | Email magic-link auth — hashed codes + bearer sessions |
| `unit_types` | Static combat catalog, served via `GET /api/units` |
| `resource_transactions`, `settlement_snapshots` | Per-day economy audit trail |
| `game_assets` | Binary sprite store (`BYTEA`) — served through `server/assetRoutes.ts` |

Most mutating endpoints in `server/routes.ts` follow the same shape: `SELECT ... FROM games WHERE name = $1` → mutate the JS objects in memory → `UPDATE games SET heroes = $1::jsonb, settlements = $2::jsonb ...`. Postgres is mostly a document store here, with a handful of genuinely relational side-tables bolted on for things that don't fit the blob (events, tiles, unit catalog, economy audit).

**Data-access layer: there isn't one.** No repository/DAO abstraction anywhere. Every `pool.query()` / `withTransaction()` call is inlined directly inside the Express route handler in `server/routes.ts` (1163 lines, one file), interleaved with request validation, business logic (combat resolution, end-of-turn pipeline), and response shaping. `server/assetRoutes.ts` and `server/auth.ts` follow the same inline pattern. This is at least *consistent* — nothing partially adopts a repository pattern — but route handlers end up doing HTTP + business-logic + persistence in one function body, and `routes.ts` is already one of the two largest files in the repo.

**Duplicated connection config (real DRY violation)**: `server/db.ts`'s `Pool` config is re-implemented from scratch, with the same literal defaults, in two other places instead of importing `pool`:
- `scripts/seed-assets.ts` — its own `new Pool({...})`, and it additionally re-declares the `game_assets` table DDL inline rather than relying on migration `004_game_assets.sql`. If that migration's schema changes, this script silently drifts.
- `test/smoke.ts` — two more independent `new Pool({...})` instances, used to poll `games`/`game_events` rows directly, bypassing the HTTP API for assertions.

None of these three import the canonical `pool` from `server/db.ts`. Any future change to connection handling (SSL, credential source, etc.) has to be manually mirrored in three places.

**Seed data**: `scripts/seed-assets.ts` (`npm run assets:seed`) walks `src/resources/**/*.png` and inserts each into `game_assets` by derived key if not already present. `unit_types` has no separate seed — migration `002_unit_types.sql` doubles as DDL + seed via `INSERT ... ON CONFLICT DO NOTHING`.

## 3. Views/UI layer

`src/views/manualBattleArena.ts` and `src/views/testBattleSetup.ts` — the two files with uncommitted changes — are part of a **dev-only, fully client-side "Test Battle" sandbox**. Neither talks to the DB or persisted game state; they operate on in-memory `Platoon[]` arrays via `shared/combat/manualBattle.ts`. The only network call in that flow is a one-time cached `GET /api/units`. This is clean *for what it is* — a sandbox deliberately decoupled from persistence.

`manualBattleArena.ts` (1296 lines, the largest file in `src/`) is a full hex-grid tactical battle screen with a hardcoded-on debug logger (`const DEBUG_LOG = true`), justified by a comment saying the view is currently only reachable from the sandbox. If it's ever wired into the real battle flow, that logging ships to all players with no toggle.

**Uncommitted change in both files**: a real behavior change, not a pure rename. Previously the attacker/defender roster assignment *swapped* based on which side (`humanSide`) the human picked:
```ts
const attackerPlatoons = humanSide === "attacker" ? playerPlatoons : aiPlatoons;
```
Now blue is always attacker/always the fixed roster, and `humanSide` only controls which side the human is allowed to click:
```ts
const attackerPlatoons = bluePlatoons;
const defenderPlatoons = redPlatoons;
```
Framed in the surrounding comments as a fix for a mismatch — worth confirming that's the intent before merging, since it does change actual battle assignment semantics.

**Other views** (`cityView.ts`, `settlementPanel.ts`, `heroInfoMenu.ts`, `hud.ts`, `buildingMenu.ts`, etc.) follow a fairly consistent pattern: they receive `GameState`-derived data as arguments and never own persistence — they're presentational. A **minority** (`homeView.ts`, `toolbar.ts`, `multiplayerLobby.ts`) import `api` from `../io/api` and call it directly, bypassing the `managers/GameActions.ts` / `GameSessionManager.ts` layer that other views go through for anything persisted. That's the one real inconsistency in the view layer — not a DB-coupling problem (nothing in `src/` ever imports `pg`), but an inconsistent answer to "who owns I/O."

## 4. State management — three layers, two seams

1. **Server-authoritative persisted state** — the `games` JSONB blobs + `tiles`.
2. **Client in-memory state** — `GameState` (`src/state/gameState.ts`, ~1464 lines), mutated only through pure reducers, wrapped by `TurnController`.
3. **Render/animation state** — `GameStateManager` holds parallel `Hero`/`Castle` entities derived from `GameState` purely for tweened animation, resynced back via explicit rebuild functions.

**Deliberate duplication, acknowledged in code**: the end-of-turn economy pipeline runs **twice** — once client-side for immediate UI feedback, once server-side in `POST /games/:name/end-turn`, with a comment admitting: *"The client computes this too; we re-run here so DB matches client state (drift-safe)."* This is an intended "client-authoritative reducer, server reconciles" design (documented in `docs/module-documentation-and-relationships.md`), not an accident — but it means the same business logic (`src/state/gameState.ts`) is imported by both `src/` and `server/routes.ts` and must stay behaviorally identical across the boundary, with only the smoke test as a guardrail (no type-level enforcement).

**Combat splits the other way**: the real game's battle flow explicitly defers to the server as authoritative — client fetches the server's result before closing out the battle phase, no client pre-computation. The Test Battle sandbox does the opposite: full client-side resolution via `shared/combat/manualBattle.ts`, no server call, nothing persisted. So the codebase has two different persistence philosophies for combat sitting side by side — reasonable given the sandbox's stated scope, but it's the single largest structural fork in the codebase and there's currently no protocol for the richer interactive sandbox combat to become real, persisted combat.

## 5. Server/API layer

`server/routes.ts` (1163 lines, one `Router()`) plus `server/assetRoutes.ts` (mounted at `/api/assets`) and `server/auth.ts` (mounted at `/api/auth`). No controller/service split anywhere — see §2 for why.

**Inconsistent error handling**: most handlers wrap in `try/catch` and return a uniform `{error: "internal", message}` shape on failure. A handful don't — `GET /games`, `GET /games/:name`, and the legacy `PATCH /games/:name` body have no try/catch, so a DB failure there produces an unhandled rejection / Express default 500 instead of the app's own error contract. No apparent rule for which handlers got the treatment and which didn't.

`server/auth.ts` exports a `requireAuth` middleware that **is not applied to any game route** (confirmed in `docs/architecture.md`: "unused for now — game endpoints are still anonymous"). The auth system (magic-link email + sessions) is fully implemented DB-side but disconnected from authorization on actual gameplay endpoints — anyone can currently create/mutate any game by name with no session check.

Two combat engines are threaded through the server, but only one is reachable from it: `resolveBattleEngine` (auto-resolve, used by the real `/resolve-battle` route) vs. the interactive `manualBattle.ts` engine (client-only, never imported by `server/`).

## 6. Concrete bugs / inconsistencies to fix or track

1. **Untyped reference invisible to the compiler** — `server/routes.ts:512` uses `pool.query<GameRow>(...)`, but `GameRow` is never defined or imported anywhere in the repo (only `FullGameRow` is defined and used elsewhere). Runs fine because `tsx` doesn't type-check and `server/` is outside `tsconfig.json`'s `include`. This is the concrete cost of the build gap noted in §1 — worth either fixing the type reference or adding `server/` to the `tsc` build so this class of error gets caught going forward.

2. **Migration `006` is missing** from `server/migrations/` with no explanatory comment. Confirm intentional vs. lost file.

3. **Triplicated Postgres connection config** (`server/db.ts`, `scripts/seed-assets.ts`, `test/smoke.ts`) — all three should import the canonical `pool` from `server/db.ts` instead of re-declaring `new Pool({...})` with copy-pasted defaults. `seed-assets.ts` should also drop its inline `game_assets` DDL and rely on the migration.

4. **Inconsistent try/catch coverage** in `server/routes.ts` — a few handlers bypass the app's `{error, message}` error contract. Worth a pass to normalize.

5. **Debug logging hardcoded on** in `src/views/manualBattleArena.ts` (`DEBUG_LOG = true`) — fine today since the view is dev-only-reachable, but should get a real toggle before this view is ever wired into the live battle flow.

6. **Docs have drifted from code**:
   - `TECHNICAL_SPECIFICATIONS.MD` §7 claims "no auth layer present" — false, `server/auth.ts` + `auth_codes`/`user_sessions` exist and are wired client-side; the doc predates several features (also omits `shared/`, `assetRoutes.ts`, migrations past `001`, and the dev console).
   - `docs/module-documentation-and-relationships.md` (positioned as the maintained current-state doc) still says `initSchema()` applies "migrations 001–005," missing `007` and `008` which both exist and load. Even the doc meant to track drift has drifted.
   - `docs/architecture.md` is explicitly a historical "Status: Executed" snapshot with an appended addendum — reasonable as a design record, but between it and `module-documentation-and-relationships.md` there are two docs both implicitly claiming to be current, and neither fully is.

7. **No data-access abstraction** — not a bug, but the biggest structural lever available: introducing even a thin `server/repositories/*.ts` layer (one file per table/concern: games, events, units, assets, auth) would let `routes.ts` shrink to HTTP concerns and make the connection-duplication problem (#3) and the untested-error-path problem (#4) much easier to fix once instead of piecemeal.

## Summary

The architecture is coherent for its size and the boundaries that matter most are respected — the client never touches Postgres directly, and the shared combat math genuinely is shared. The main risks are: (a) `server/` sits outside the type checker entirely, which already produced one dangling type reference; (b) the DB is used almost entirely as a JSON document store around a single `games` table, with persistence logic, business logic, and HTTP handling all inlined together in one 1163-line routes file and no repository layer; and (c) three independent, hand-copied Postgres connection configs that will silently diverge the next time `db.ts` changes. None of these are urgent, but the routes file and the connection duplication are the two that will hurt most as the game grows.
