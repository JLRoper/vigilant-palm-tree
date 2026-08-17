
# Plan: Phase 4 — Database De-blobbing & Dual-Write (Deep Dive)

*Authored 2026-08-17. Sibling to `plan/2026-08-16-parallel-dev-phases-3-5.md` (that doc's §4 "Phase 4" section gives the track split and file ownership at a glance) and `plan/2026-08-16-phase-3-parallel-dev-plan.md` (the Phase 3 deep dive this one follows the same structure as: current-state audit, concrete DDL, a pre-agreed repo interface, week-by-week port order, file ownership, risks/rollback). Adopts the master plan's Track 4.A/4.B split as given — this is a refinement, not a competing scheme.*

**Status (2026-08-17): Track 4.B's Week 1–2 scope is implemented** — `009_granular_entities.sql`, `010_event_seq.sql`, `heroRepo.ts`/`settlementRepo.ts`/`charterRepo.ts`/`tileRepo.ts`, `scripts/migrate-jsonb-to-tables.ts`, and their tests (`test/persistence/{hero,settlement,charter,tile}Repo.test.ts`, `test/migrations/migration.test.ts`) all pass against a live Postgres, along with `npm run build`/`lint:deps`/`test:unit`. Two design fixes surfaced during implementation and are reflected in both the shipped SQL and this doc: the `heroes.charter_id`↔`charters.hero_id` circular FK (see "heroes<->charters" note below) and `settlements.gold_rate` as its own column rather than a sixth `settlement_resources` value (Risk 4).

**Status update (2026-08-17, later same day): Track 4.A is also implemented**, on local branch `phase4/track-a-hydrate-dualwrite`, built directly against this doc's design below (PR #91 and #89 had landed by the time Track A started, so the sequencing prerequisite was already satisfied). `server/persistence/hydrate.ts` (`hydrateFromRepos()` + `hydrateGame()`), `commandHandler.ts`'s `dualWriteEntities()` step wired into all 10 ported commands, and the read-path cutover with per-game JSONB fallback + `[hydrate]` telemetry marker are all in place, with tests at both the mocked-repo (`test/server/commandHandler.test.ts`) and real-Postgres (`test/persistence/hydrate.test.ts`) layers. One deliberate deviation from the fallback condition as first worded below: the shipped fallback triggers when **either** `heroes` or `settlements` is empty (OR), not only when both are — see that section's own note. `npm run build`/`lint:deps`/`test:all` all pass; see `plan/2026-08-17-consolidated-phase-1-5-track-map.md` §6.1 for the full status table. Committed as `20704d4`/`3aad7d3`, pushed, open as **PR #95**.

## Context: Phase 3 status as of 2026-08-17

Phase 3's command bus is functionally complete:

- **Merged**: `MoveHero`, `TransferGold`, `EndTurn` (PRs #83/#84/#86/#87).
- **Open, mergeable, CI green**: [PR #91](https://github.com/JLRoper/vigilant-palm-tree/pull/91) ports `TradeResources`, `ResolveBattle`, `RecruitHero`, `UpgradeTownHall`, `SetAutoTrade`, `ReorderStack`, `CaptureSettlement`. Closes #88 once merged.
- **Deferred past Phase 3** (per PR #91's own scope note): `UpgradeSettlement` (needs `GameMap`+RNG in `CommandDeps`), `StartCharter`/`AdvanceCharter` (blocked on the schema gap this doc closes, below), `BuildStructure` (blocked on a missing `@heroes/engine` function), lobby claim/start.
- **Open loose end, Track A's half**: [#89](https://github.com/JLRoper/vigilant-palm-tree/issues/89) — `gameRepo.insertSettlementSnapshots`/`insertResourceTransactions` exist (Track 3.B, merged) but aren't called from `commandHandler.ts`'s `EndTurn` case yet. Doesn't block this doc's scope; flagged in Risks below since Phase 4's dual-write touches the same case.

**Two real gaps this audit found, both grounding Phase 4's design (not previously written down anywhere):**

1. **`activeCharters` has no DB column at all.** `packages/engine/src/hydrate.ts:159` hard-defaults it to `[]`, reading a field (`(row as unknown as { activeCharters?: ... }).activeCharters`) that no query ever populates. This is *why* `StartCharter`/`AdvanceCharter` are blocked — Phase 3 explicitly ruled out schema changes, so the fix was always deferred here.
2. **`nextCharterId`/`nextSettlementId` are also unpersisted**, same file, lines 160–161 — both fall back to a derived default (`0` / current settlement count) on every load instead of reading a real counter. Undiscovered until now because nothing has exercised charter creation through the command bus yet (`StartCharter` isn't ported). Folding a real column for both into `009_granular_entities.sql` is cheap and closes this before `StartCharter` needs it.

## What's in scope

Per `plan/2026-08-16-parallel-dev-phases-3-5.md` §4 Phase 4:

- **Track 4.B (Dev B)** — SQL migrations for granular tables, new repo files for those tables, the historical-game backfill script, migration round-trip tests.
- **Track 4.A (Dev A)** — dual-write in `commandHandler.ts` (write to both the legacy JSONB columns and the new granular tables), `server/persistence/hydrate.ts` (reconstructs `GameState` from the granular repos), read-path cutover with JSONB fallback.

**Coupling, and why this doc covers both tracks' interface (like the Phase 3 doc did):** Track A's dual-write step needs Track B's repo *write* methods to exist before it can call them, and Track A's `hydrate.ts` needs Track B's repo *read* methods. Unlike Phase 3 (where Track A could stub against `mockRepos.ts` and never block), Phase 4's whole point is the granular tables themselves — there's less to mock meaningfully. **Recommendation: agree the repo interfaces below Day 1, Dev B builds real implementations first (or in lockstep), Dev A's dual-write PRs land command-by-command against whichever repo methods already exist**, same incremental-PR discipline Phase 3 used.

## Current schema audit (grounding for the migration design)

`server/schema.sql` + `server/migrations/001–008`:

| Table | Status | Relevant to Phase 4? |
|---|---|---|
| `games.heroes`, `games.settlements` | JSONB blobs, the thing being de-blobbed | Yes — source of truth for the backfill |
| `games.players` | JSONB blob | **Out of scope.** `Player[]` is small (per-game, not per-entity) and has no independent query need; leave as JSONB. Not listed in the master plan's Phase 4 table list either. |
| `game_events` | Exists (`id BIGSERIAL`, `kind`, `payload JSONB`) | `id` is already a global, strictly-monotonic, per-row auto-increment — see "seq decision" below |
| `tiles` | **Already granular** (`server/schema.sql:33-41`, `game_id`, `q`, `r`, `terrain`, `resource`, unique on `(game_id, q, r)`) | No migration needed. `tileRepo.ts` is a pure wrapper needed for `hydrate.ts` to read it — a Track B repo task, not a schema task |
| `settlement_snapshots`, `resource_transactions` | Exist (migration 003) | Append-only audit tables, not part of live `GameState` — out of scope for de-blobbing (nothing hydrates from them) |
| `unit_types` | Exists (migration 002), static catalog | Referenced by FK from the new `hero_platoons` table (below) |

So the actual net-new schema work is narrower than "six new tables" — `tiles` already exists, `players`/audit tables are explicitly out of scope. What's left: **heroes, hero platoons/stacks, settlements, settlement resources, settlement buildings, charters**, plus the two small counter columns found above.

## Migration design

### `009_granular_entities.sql`

```sql
CREATE TABLE IF NOT EXISTS heroes (
  id                          TEXT PRIMARY KEY,          -- HeroId, matches games.heroes JSONB key today
  game_id                     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  owner_id                    INTEGER NOT NULL,
  q                           INTEGER NOT NULL,
  r                           INTEGER NOT NULL,
  movement_remaining          INTEGER NOT NULL,
  previous_q                  INTEGER,
  previous_r                  INTEGER,
  previous_movement_remaining INTEGER,
  trail                       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- {q,r}[] breadcrumb; too small/positional to normalize
  gold                        INTEGER NOT NULL DEFAULT 0,
  troops                      INTEGER NOT NULL DEFAULT 0,
  is_chartering               BOOLEAN NOT NULL DEFAULT false,
  charter_id                  TEXT,   -- soft pointer, not FK'd -- see note below charters' definition
  horse_variant               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS heroes_game_idx ON heroes(game_id);

-- Flattens HeroState.stacks: Platoon[] (Platoon = { entries: PlatoonEntry[] }).
-- One row per (hero, stack, unit type) rather than a second normalization
-- level for "platoons" and a third for "entries" -- stack_index reconstructs
-- grouping, unit_type_id + count is the leaf data, and this shape makes
-- "how many archers does player X have total" a plain GROUP BY instead of a
-- JSONB traversal, which is the whole motivation for this phase.
CREATE TABLE IF NOT EXISTS hero_platoons (
  hero_id      TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
  stack_index  INTEGER NOT NULL,   -- position in HeroState.stacks[]
  unit_type_id TEXT NOT NULL REFERENCES unit_types(id),
  count        INTEGER NOT NULL,
  PRIMARY KEY (hero_id, stack_index, unit_type_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id                  TEXT PRIMARY KEY,          -- SettlementId
  game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  owner_id            INTEGER,
  q                   INTEGER NOT NULL,
  r                   INTEGER NOT NULL,
  level               SMALLINT NOT NULL CHECK (level IN (1, 2, 3)),
  population          INTEGER NOT NULL,
  gold_tax            INTEGER NOT NULL,
  founded_on_resource TEXT,
  gold                INTEGER NOT NULL DEFAULT 0,
  gold_rate           NUMERIC,        -- resourceRates.gold -- ResourceType includes "gold" (gold tiles exist), Warehouse doesn't
  morale              INTEGER NOT NULL DEFAULT 100,
  auto_trade          BOOLEAN NOT NULL DEFAULT true,
  castle_variant      SMALLINT NOT NULL DEFAULT 0,
  city_spots          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- generation-time anchor data, not gameplay state -- kept JSONB
  city_mines          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- same
  -- UpgradeState is a single optional in-flight upgrade, not a collection --
  -- one nullable JSONB column, not a separate table. Re-evaluate only if a
  -- concrete query need over "settlements currently upgrading" shows up.
  upgrade             JSONB
);
CREATE INDEX IF NOT EXISTS settlements_game_idx ON settlements(game_id);

-- Replaces SettlementState.warehouse (always-present amount per resource)
-- and .resourceRates (a *partial* record -- only resources the settlement
-- actually produces). One row per resource actually present in either
-- source; rate is nullable to preserve "doesn't produce this" vs "produces
-- it at rate 0", which the current Partial<Record<...>> type distinguishes
-- and a NOT NULL default-0 rate column would silently collapse.
CREATE TABLE IF NOT EXISTS settlement_resources (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  resource      TEXT NOT NULL CHECK (resource IN ('wood', 'stone', 'iron', 'arcane', 'food')),
  amount        INTEGER NOT NULL DEFAULT 0,
  rate          NUMERIC,
  PRIMARY KEY (settlement_id, resource)
);

CREATE TABLE IF NOT EXISTS settlement_buildings (
  id            BIGSERIAL PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  gx            INTEGER NOT NULL,
  gy            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  level         INTEGER NOT NULL,
  style         TEXT NOT NULL,
  w             INTEGER,
  h             INTEGER,
  UNIQUE (settlement_id, gx, gy)
);

CREATE TABLE IF NOT EXISTS charters (
  id                  TEXT PRIMARY KEY,        -- CharterId
  game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hero_id             TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
  owner_id            INTEGER NOT NULL,
  target_q            INTEGER NOT NULL,
  target_r            INTEGER NOT NULL,
  settlement_name     TEXT NOT NULL,
  phase               TEXT NOT NULL CHECK (phase IN ('traveling', 'constructing')),
  days_remaining      INTEGER NOT NULL,
  settlement_id       TEXT NOT NULL,           -- the not-yet-founded settlement's future id; FK added once founded
  resource_rates      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- small partial record, generation config -- JSONB is fine
  founded_on_resource TEXT,
  city_spots          JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS charters_game_idx ON charters(game_id);

-- heroes.charter_id deliberately has no matching FK back to charters(id):
-- charters.hero_id already references heroes(id), and a two-way FK would
-- make heroRepo/charterRepo's upsert order load-bearing for no real
-- integrity gain -- this pointer isn't enforced anywhere else in the
-- codebase today either (it's an internal "which charter is this hero on"
-- hint, same trust level GameState already gives it).

-- Closes the two unpersisted-counter gaps found in packages/engine/src/
-- hydrate.ts:160-161 (activeCharters' companion counters, not activeCharters
-- itself -- that's the charters table above). Both currently silently
-- reset to a derived default on every load; real columns close this before
-- StartCharter (which allocates from next_charter_id) is ported.
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_charter_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_settlement_id INTEGER NOT NULL DEFAULT 0;
```

### `010_event_seq.sql`

**Decided: `game_events.id` is the cursor.** It's already `BIGSERIAL PRIMARY KEY` — a strictly monotonic per-row sequence — so Phase 5 Track A's `GET /games/:id/events?after=<seq>` cursor sync works directly against it: a client remembers the last `id` it saw for that game and queries `WHERE game_id = $1 AND id > $2 ORDER BY id`. No redundant `seq` column. This migration is just the `actor_seat` gap:

```sql
-- actor_seat is the real gap: game_events has no column recording which
-- player/seat triggered an event today, only whatever happens to be in
-- payload for some kinds. Nullable because historical rows and some kinds
-- (round_started, ai_turn_started) aren't attributable to a single actor.
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS actor_seat INTEGER;
CREATE INDEX IF NOT EXISTS game_events_actor_idx ON game_events(game_id, actor_seat);
```

Filename kept as `010_event_seq.sql` to match the master plan's numbering/naming, even though it no longer adds a literal `seq` column — the migration's job is still "make `game_events` cursor-sync-ready," just accomplished by using the existing `id` instead of adding a new one. Any future caller that wants an explicit `seq` alias can add a generated column later against a real need; not speculative here.

## Pre-agreed repo interface (lets both tracks start Day 1)

Mirrors Phase 3's approach exactly — Dev A codes `hydrate.ts` and the dual-write step against this immediately, Dev B fills in real Postgres implementations:

```ts
// server/persistence/repositories/heroRepo.ts
export interface HeroRepo {
  loadAllForGame(gameName: string): Promise<HeroState[]>;
  upsertMany(gameName: string, heroes: Record<HeroId, HeroState>): Promise<void>;
}

// server/persistence/repositories/settlementRepo.ts
export interface SettlementRepo {
  loadAllForGame(gameName: string): Promise<SettlementState[]>;
  upsertMany(gameName: string, settlements: Record<SettlementId, SettlementState>): Promise<void>;
}

// server/persistence/repositories/charterRepo.ts
export interface CharterRepo {
  loadAllForGame(gameName: string): Promise<CharterState[]>;
  upsertMany(gameName: string, charters: CharterState[]): Promise<void>;
}

// server/persistence/repositories/tileRepo.ts
export interface TileRepo {
  loadAllForGame(gameName: string): Promise<TileRow[]>; // read-only for Phase 4 -- tiles are generated once, not mutated by commands
}
```

Two deviations from the first draft, both found while actually building this against the real call site rather than sketching in the abstract:

- **`gameName: string`, not `gameId: number`.** `commandHandler.ts`'s own `GameRepo` interface types `load()`'s return as `HydratableGameRow` (`packages/engine/src/hydrate.ts`), which has no `id` field — only the real Postgres `GameRow` does. Keying the new repos by `gameId` would require widening that interface before Track A could call them at all. Keying by `gameName` instead matches every existing repo (`gameRepo`, `eventRepo`) and needs no interface change upstream; each method resolves the numeric id internally, same as `gameRepo.insertSettlementSnapshots` already does.
- **`upsertMany` is a full sync, not a merge, and there is no separate `deleteMany`.** `commandHandler.ts` always calls `gameRepo.saveHeroesAndSettlements` with the *entire* `heroes`/`settlements` record from the post-`engine.apply()` state (every `@heroes/engine` reducer returns the whole `GameState`, not a delta) — never just the touched entity. The granular repos mirror that: `upsertMany` deletes any row for that game whose id isn't in the given record/array, then upserts everything that is. This is what makes hero death or a charter completing (leaving `activeCharters`) fall out for free, with no separate deletion path to keep in sync with the JSONB writes.

## Dual-write & read-path design (Track A, documented here since Track B's interface must match it)

- **Write path**: `commandHandler.ts` keeps calling `gameRepo.saveHeroesAndSettlements` (legacy JSONB) exactly as today, and *additionally* calls the relevant new repo's `upsertMany` in the same transaction, scoped to only the entities that command actually touched (not a full-game re-sync every command). Both writes commit or roll back together — `server/persistence/db.ts`'s existing `withTransaction` wraps both.
- **Read path**: `hydrate.ts` tries the granular tables first; if a game has zero rows in `heroes`/`settlements` (pre-migration game, backfill hasn't reached it yet), fall back to `hydrateGameState()` (today's JSONB-based path, `packages/engine/src/hydrate.ts`, unchanged). This is a per-game fallback, not a global flag — lets the backfill script (below) migrate games incrementally without a cutover moment.
- **Verification**: for every command, the JSONB write and the granular write are computed from the *same* post-`engine.apply()` state — there is no independent second computation to drift, unlike the historical `EndTurn` round-wrap bug (#88) that motivated this whole phase's caution. Structurally lower-risk than that regression.

## Backfill script (Track B)

`scripts/migrate-jsonb-to-tables.ts`:

- For each row in `games`, read `heroes`/`settlements` JSONB (and `[]` for charters, since none are currently persisted — see gap #1 above; historical games simply backfill zero charter rows, which is correct, not lossy).
- Upsert into the granular tables via the same repo `upsertMany` methods `commandHandler.ts` uses — no separate INSERT logic to keep in sync with the repo layer.
- **Idempotent**: safe to re-run over the same game (upsert semantics, `ON CONFLICT (id) DO UPDATE`), so it can run as a one-off CLI pass over all games and again later over any game that was created/updated between runs, without double-inserting.
- Runs outside any live game's write path — reads a consistent snapshot per game (single transaction per game, not one global transaction over the whole table, so one game's migration failure doesn't roll back every other game's).

`test/migrations/migration.test.ts`: for a handful of representative seeded games (varied hero counts, multi-stack armies, settlements at each level with in-flight upgrades), run the backfill, then assert `hydrate.ts`'s granular-table read produces a `GameState` deep-equal to `hydrateGameState()`'s JSONB read for the same row — the round-trip integrity check the master plan's exit criteria already call for.

## File ownership table

| Path | Owner | Notes |
|---|---|---|
| `server/migrations/009_granular_entities.sql`, `010_event_seq.sql` | Dev B | Design above; `010` pending the seq-vs-id decision |
| `server/persistence/repositories/heroRepo.ts`, `settlementRepo.ts`, `charterRepo.ts`, `tileRepo.ts` | Dev B | Against the pre-agreed interface above |
| `scripts/migrate-jsonb-to-tables.ts` | Dev B | |
| `test/migrations/migration.test.ts` | Dev B | |
| `server/app/commandHandler.ts` (dual-write step) | Dev A | Additive per command, same pattern as Phase 3's incremental ports |
| `server/persistence/hydrate.ts` (new) | Dev A | Granular-first, JSONB-fallback per game |
| `server/persistence/repositories/gameRepo.ts` | Neither, unchanged | Keeps its existing JSONB read/write role — not being replaced, just no longer the *only* read path |
| `dependency-cruiser.cjs` | Dev B, additive | Extend the existing Track A/B boundary rule (`server/http/`+`server/app/` can't import `server/persistence/repositories/*` directly, except `commandHandler.ts`) to cover the four new repo files the same way `gameRepo`/`eventRepo` are already covered — no new rule shape needed |

**Conflict surface:** near zero, same as Phase 3 — Dev B adds new files under `server/persistence/repositories/` and `server/migrations/`; Dev A's changes to `commandHandler.ts` are additive per-command blocks, same file Phase 3 already had both tracks' review conventions for.

## Suggested order

```
Week 1:
  Either: confirm the two Decisions below before Dev B writes 010.
  Dev B: 009_granular_entities.sql, heroRepo.ts + settlementRepo.ts
         (heroes/settlements are needed first -- charters/tiles are read-only
         additions once StartCharter/AdvanceCharter actually port).
  Dev A: hydrate.ts skeleton against the pre-agreed interface, granular-first/
         JSONB-fallback logic, wired for heroes+settlements only.

Week 2:
  Dev B: charterRepo.ts, tileRepo.ts, 010_event_seq.sql,
         migrate-jsonb-to-tables.ts, migration.test.ts.
  Dev A: dual-write wired into MoveHero/TransferGold/EndTurn/TradeResources/
         RecruitHero/UpgradeTownHall/SetAutoTrade/ReorderStack/CaptureSettlement
         (whichever of these are merged by then -- PR #91 lands first, see
         Risks) one command at a time, each its own PR per the established
         convention.

Week 3+:
  Dev A: run the backfill against a copy of prod-shaped data, verify
         migration.test.ts's round-trip equality holds, then flip the
         default read path (still falls back per-game if a row somehow
         has no granular data).
  Both: StartCharter/AdvanceCharter unblocked now that charters has a real
        table -- picked up as Phase 3's remaining deferred item, not new
        Phase 4 scope, once Dev A has bandwidth.
```

## Risks and rollback

**Risk 1: PR #91 and this doc's Track A work touch the same file (`commandHandler.ts`) back-to-back.** Low risk of an actual conflict (PR #91 adds new `case` blocks, dual-write is an edit inside each existing case), but sequencing matters for review clarity. **Mitigation:** merge PR #91 before Track A's first dual-write PR lands, so dual-write's diffs are against a stable case list, not fighting an in-flight PR.

**Risk 2: #89's Track A half (wiring `insertSettlementSnapshots`/`insertResourceTransactions` into `EndTurn`) is still open and touches the exact case Phase 4's dual-write also touches.** **Mitigation:** land #89's fix first (it's small, already has the repo methods built) — same reasoning as Risk 1, avoid two unrelated changes competing for the same `EndTurn` case block.

**Risk 3: Backfilling a large number of historical games is slow or lock-contentious against a live DB.** **Mitigation:** per-game transactions (not one global transaction), and the script is explicitly a one-off CLI tool, not something that runs inside a request path — run it during low-traffic hours if the games table is large enough to matter, verify with `EXPLAIN ANALYZE` on the actual row count before assuming this is a problem.

**Risk 4: `settlement_resources`'s nullable `rate` column is the one genuinely subtle modeling call in this doc** (distinguishing "doesn't produce this resource" from "produces it at rate 0"). **Mitigation:** the migration test's representative-games fixture should explicitly include a settlement with a partial `resourceRates` (some resources absent, not just zero) to catch a backfill bug here before it ships, not just the happy-path full-resource-set case. Also include a settlement with a non-empty `resourceRates.gold` specifically — caught during implementation that `ResourceType` includes `"gold"` (gold resource tiles are real map data) while `Warehouse` doesn't, which is why `gold_rate` ended up as its own column on `settlements` rather than a sixth value in `settlement_resources`' CHECK constraint.

**Rollback:** each migration and each dual-write command-port is its own PR, same discipline as Phase 3. A migration can be rolled back by dropping the new tables (nothing reads them yet until `hydrate.ts`'s granular path is live) with zero data loss, since the JSONB columns remain the write-through source of truth until the read-path cutover in Week 3+.

## What this doc does NOT cover

- Phase 5 (client command dispatcher, event-cursor sync, scene renderer seam) — `plan/2026-08-16-parallel-dev-phases-3-5.md` §4 Phase 5, unchanged by this doc. The `seq`-vs-`id` decision above is flagged for Phase 5 Track A to weigh in on, not decided here.
- `StartCharter`/`AdvanceCharter`'s actual command-bus port — this doc only unblocks it (real `charters` table). Porting the commands themselves is Phase 3's remaining deferred scope, picked up whenever Track A has bandwidth, not new Phase 4 work.
- `UpgradeSettlement`, `BuildStructure`, lobby claim/start — still blocked on their own Phase-3-noted prerequisites, untouched by this doc.

## Decisions

1. ~~`game_events.seq`~~ **Resolved 2026-08-17: use the existing `id BIGSERIAL` as the cursor.** No redundant `seq` column; `010_event_seq.sql` only adds `actor_seat`. See "010_event_seq.sql" above.
2. ~~Order of operations vs. PR #91 / #89~~ **Resolved 2026-08-17: PR #91, then #89's `EndTurn` wiring fix, then Track A's first Phase 4 dual-write PR — owned by Dev A.** Track B's files (migrations, new repos, backfill script) don't touch `commandHandler.ts` at all, so this sequencing doesn't block Track B starting immediately.

Both decisions resolved: Dev B starts `009_granular_entities.sql` + `010_event_seq.sql` + `heroRepo.ts`/`settlementRepo.ts`/`charterRepo.ts`/`tileRepo.ts` against the interface above now. Dev A starts `hydrate.ts`'s skeleton whenever PR #91 and #89 land, per the sequencing above.
