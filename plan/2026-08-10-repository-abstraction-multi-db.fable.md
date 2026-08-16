# Plan (fable): Multi-backend repositories — Postgres-first, dialect-ready

**Status:** Second-opinion rewrite of `plan/2026-08-10-repository-abstraction-multi-db.md`. Written 2026-08-11, **after** the circular-dependency cleanup landed on `architecture/circular-dep-cleanup` (commit `526398e`) — the "current shape" here reflects that branch, not pre-cleanup main.
**Companion:** `plan/2026-08-10-database-abstraction-module.fable.md` (module shape + lifecycle). The two fable plans share ONE module location and ONE interface definition — see companion §1.
**Source request (unchanged):** switch between postgres/oracle/mysql or variations/versions. **Concrete trigger (unchanged):** the `docker-postgress-v-1` host on the tailscale mesh; New Game dropdown selects the backend.

---

## 1. What's different from the original plan

| # | Original | Fable version | Why |
|---|---|---|---|
| 1 | Named bind params (`$name`) as "lowest common denominator" | **Positional params** (`$1, $2`), matching every existing query in `routes.ts` | `pg` does NOT support named binds natively — the original's claim is wrong. Named binds would require a translation layer (yesql/pg-promise style) for zero benefit while both backends are Postgres. Add translation only in the same PR that adds a non-Postgres driver. |
| 2 | Full dialect matrix (upsert/identity/UUID/JSON/boolean per vendor) shapes the plan | **Deferred to Appendix A.** The interface stays dialect-ready (a `dialect` field exists), but no dialect-dispatch code is written until an Oracle or MySQL container actually runs in CI or locally | Two Postgres hosts share 100% of their SQL. Building vendor absorption now is speculation; the repository seam is what matters, and it doesn't change shape later. |
| 3 | Module at `server/db/` with `adapters/` (conflicts with companion's `server/database-abstraction/` + `drivers/`) | **One location: `server/db/`** with `drivers/` (see companion §1) | Two draft plans defining the same interface in two places is how you end up implementing both halfway. |
| 4 | §2 current-shape verified pre-cleanup | Re-verified post-cleanup (§2 below) | The cleanup moved `server/routes.ts` imports to `shared/`; depcruise now exists and can machine-enforce the driver boundary this plan wants (original §6 wished for this — it now exists). |
| 5 | Schema bootstrap question left open (§8.3) | **Decided:** per-boot for default adapter, lazy for others (companion §4) | Companion plan owns lifecycle; this plan just consumes the decision. |

Everything else — per-game `db_adapter_id`, the dropdown, the five-step sequencing shape, repos-as-factories — survives from the original. It was right.

---

## 2. Current shape (re-verified 2026-08-11 against `architecture/circular-dep-cleanup`)

- `server/db.ts` — single `pg.Pool`, `withTransaction`, Postgres-flavored `initSchema()` at boot. Unchanged by the cleanup.
- `server/routes.ts` (~1160 lines) — still calls `pool.query`/`withTransaction` directly, but its type/value imports now come from `shared/` (`shared/map/gameMap`, `shared/rng`, `shared/gameState`, `shared/units`, `shared/constants`). One remaining `src/` import: `makeInitialStatePayload` from `src/game/initState` (R11, documented depcruise exception).
- `server/auth.ts`, `server/assetRoutes.ts` — direct `pool.query`.
- **`dependency-cruiser.cjs` exists** with 8 rules and `npm run lint:deps` wired into the precommit gate. Adding a driver-boundary rule is a 6-line diff, not a new tool.
- `.env` carries port allocations only; no `PG*` vars yet.
- `src/views/newGameScreen.ts` — form has no DB selector field.

---

## 3. Target shape (delta view)

Module structure and `DatabaseAdapter` interface live in the companion plan (§1–§3 there). This plan owns:

### 3.1 Repositories

```ts
// server/db/repositories/games.ts
export interface GamesRepository {
  create(input: NewGame): Promise<GameRow>;
  findByName(name: string): Promise<GameRow | null>;
  updateState(name: string, state: GameStatePayload): Promise<void>;
  endTurn(name: string): Promise<EndTurnResult>;
  listSummaries(ownerId: string): Promise<GameSummary[]>;
}
export function createGamesRepository(adapter: DatabaseAdapter): GamesRepository { /* SQL lives here */ }
```

Factories over adapters, exactly as the original proposed. SQL strings stay positional (`$1, $2`) — no rewrite of existing queries during the move, which makes each migration step a mechanical cut-paste-wrap instead of a query-by-query audit.

Initial repo split (mirrors the actual table usage in `routes.ts`):
- `games.ts` — the big one (create/load/save/end-turn/summaries)
- `auth.ts` — users/sessions
- `assets.ts` — asset rows
- `units.ts` — unit_types catalog
- `lobby.ts` — lobby/seat state

`tiles`, `events`, `snapshots`, `resources` from the original list fold into `games.ts` until their query count justifies a file. Premature file-splitting of repos recreates the flat-folder problem the architecture pass is fixing elsewhere.

### 3.2 Per-game adapter (unchanged from original, one decision made)

- `games.db_adapter_id TEXT` column, set at create, **immutable** (original §8.1 asked; answer: immutable — moving a live game between backends is a data-migration feature, not a column update).
- Reads resolve `game.db_adapter_id ?? DB_DEFAULT_ADAPTER`.
- Non-game endpoints (auth, lobby, health) use the default adapter.

### 3.3 UI dropdown (unchanged from original)

`GET /api/db/adapters` → `[{ id, label }]`; `<select name="dbAdapterId">` in `newGameScreen.ts` following the existing `makeFieldRow` pattern; POST includes the id. Note: the id `docker-postgress-v-1` carries a typo ("postgress") — if it isn't already a live hostname, fix it to `docker-postgres-v-1` before it fossilizes in env files and game rows.

---

## 4. Machine enforcement (new — possible now, wasn't when the original was written)

Add to `dependency-cruiser.cjs`:

```js
{
  name: "no-reaching-past-db-facade",
  severity: "error",
  comment: "server code talks to server/db/index.ts only; drivers and internals are private.",
  from: { path: "^server/(?!db/)" },
  to: { path: "^server/db/(drivers|schema|registry)" },
},
```

This is the regression guard the original wanted as a unit test (§6, "stub adapter" check). A depcruise rule is cheaper and runs in the existing precommit gate. The stub-adapter unit test is still worth adding later, but it's not the first line of defense.

---

## 5. Sequencing (rewritten against the post-cleanup shape)

Each step ends with `npm run build` + `npm run lint:deps` + `npm run test:all` green (the gate now includes lint:deps).

1. **Skeleton + Postgres driver.** `server/db/` per companion §1. `server/db.ts` becomes a compat shim re-exporting the default adapter's pool. No call sites change. *(Merge note: do this AFTER `architecture/circular-dep-cleanup` merges — both touch `server/`.)*
2. **Schema runner + `schema_migrations` + advisory lock** (companion §4–§5). Move `server/schema.sql` + `server/migrations/*` → `server/db/schema/postgres/`. Boot still bootstraps the default adapter eagerly — behaviour identical to today.
3. **`auth.ts` → `createAuthRepository`.** Smallest blast radius. Smoke `/api/auth/*`.
4. **`assetRoutes.ts` → `createAssetsRepository`.**
5. **`routes.ts` → repos.** Biggest diff. Split incrementally: games first, then units/lobby. Delete the `server/db.ts` shim when the last `pool` import dies. Add the depcruise rule from §4 in this step.
6. **Second adapter + dropdown.** Register `docker-postgres[s]-v-1` via `DB_ADAPTERS_JSON`, `bootstrap: false` (pre-existing schema, per companion §4.2). Add `games.db_adapter_id` migration, `GET /api/db/adapters`, the dropdown, and the POST field.
7. **(Deferred indefinitely) Oracle/MySQL.** See Appendix A. Do not start until a real second-dialect container exists somewhere.

---

## 6. Validation

- Steps 1–5: build + lint:deps + test:all green; behaviour byte-identical (same SQL, same pool settings).
- Step 6 manual: create a game against the second backend via dropdown; end turn; reload; confirm `db_adapter_id` round-trips and the default backend's tables are untouched.
- Failure-mode test: second backend unreachable (tailscale down) → API boots fine, default-backend games unaffected, creating a game against the dead backend returns a clean 503-style error, not a crash. (This is the payoff of lazy init for non-default adapters.)

---

## Appendix A — Dialect differences (parked, not deleted)

The original plan's §4 dialect matrix (binds, RETURNING, upsert, identity, UUID, JSON, boolean, locks, IF-NOT-EXISTS, transactions) is correct and worth keeping as reference — **when** a non-Postgres driver lands. At that point:
1. Add a named→positional bind translation (or adopt named binds across repos in that same PR).
2. Add `server/db/schema/<dialect>/` with rewritten DDL.
3. Add upsert/returning helpers on the adapter interface (`adapter.upsert(...)`) so repos stay dialect-free.

None of that changes the repository interface this plan builds, which is the point: the seam is dialect-ready without paying the dialect cost today.

---

## Revision log

- **2026-08-11** — fable rewrite: positional binds (fixes factual error), dialect work parked to appendix, module location unified with companion, current-shape re-verified post-cleanup, depcruise enforcement added, immutable `db_adapter_id` decided.
