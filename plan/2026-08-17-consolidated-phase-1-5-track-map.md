# Consolidated Phase Map (1–5) — Two-Track Parallel Development

*Authored: 2026-08-17*
*Consolidates: `plan/2026-08-15-parallel-dev-split.md`, `plan/2026-08-16-parallel-dev-phases-3-5.md`, `plan/2026-08-16-phase-3-parallel-dev-plan.md`, `plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md`, `sessionTracking/2026-08-16.md`, PRs #81/#83/#84/#86/#87/#91/#92/#93.*
*Status legend: ✅ done & merged · 🟡 in progress / open PR · ⬜ not started · 🚫 blocked / deferred*
*Revision note (2026-08-17, post-#94): syncs in PR #93 (Phase 4 Track B — granular entity tables, repos, JSONB backfill). PR #94's own doc-sync branch was cut before #93 merged, so that revision of this file missed it. This revision also corrects two rows in §5.2 that had misattributed `heroRepo.ts`/`settlementRepo.ts` to PR #84 — that PR's own commit message says it explicitly did not add them.*
*Revision note 2 (2026-08-17, same day): reflects Track 4.A's `hydrate.ts` + `commandHandler.ts` dual-write work, now present as uncommitted changes on local branch `phase4/track-a-hydrate-dualwrite` (still at `main`'s tip `208f8c0` — no commits, not pushed, no PR). Marked 🟡, not ✅, until it's committed and merged; see §6.1.*

---

## 1. Phase Map at a Glance

```
Phase 1  Workspaces & Contracts foundation              [✅ DONE]
Phase 2  Pure deterministic engine extraction           [✅ DONE]
Phase 3  Server Command Loop & Repositories             [✅ DONE]
   ├── 3.A  Command bus, EngineCtx, command handlers    [✅ Dev A — PRs #86, #87, #91, #92 merged]
   └── 3.B  Typed repositories & persistence layer      [🟡 Dev B — PR #84 + PR #90 (gameRepo write methods) merged; tile/charter repos deferred to Phase 4]
Phase 4  Database De-blobbing & Dual-Write              [🟡 IN PROGRESS]
   ├── 4.A  Dual-write integration & state hydration     [🟡 Dev A — implemented, uncommitted on local branch `phase4/track-a-hydrate-dualwrite`, no PR yet]
   └── 4.B  SQL migrations & historical-game backfill    [✅ Dev B — PR #93 merged]
Phase 5  Client Event Sync & Scene Renderer Seam        [⬜ NOT STARTED]
   ├── 5.A  Client command dispatcher & event-cursor sync
   └── 5.B  Scene graph builder & entity-mirror animation
```

Sync points between phases:
- **Sync 1 (Phase 3 → 4):** Track 3.A's `commandHandler.ts` and Track 3.B's repos both stable; `EngineEvent` discriminated union in `@heroes/contracts/events/`.
- **Sync 2 (Phase 4 → 5):** Normalized tables populated; `hydrateGameState` round-trip-equivalent to legacy JSONB; `event_seq` monotonic cursor available client-side.

---

## 2. Track Assignment (Dev A vs Dev B)

| Track | Lead | Owned trees (across phases 3–5) |
| :--- | :--- | :--- |
| **A — Server & Client Logic** | **Dev A** | `packages/contracts/src/commands/`, `packages/contracts/src/events/`, `packages/engine/src/ctx.ts`, `server/app/`, `server/http/routes/`, `src/io/`, `src/managers/`, `src/game/turnHooks.ts`, `src/state/turnController.ts`, `server/routes.ts` (delete-only as commands port) |
| **B — Persistence & Rendering** | **Dev B** | `server/persistence/repositories/`, `server/persistence/db.ts`, `server/migrations/`, `scripts/migrate-jsonb-to-tables.ts`, `test/helpers/mockRepos.ts`, `test/helpers/pgTestTx.ts`, `src/render/scene/`, `src/screens/combat/` refactors |

Conflict surface is near zero by design: Track A never imports from `server/persistence/` directly (only via `commandHandler.ts`, enforced by `dependency-cruiser.cjs`); Track B never edits `server/routes.ts` or `server/app/`.

---

## 3. Phase 1 — Workspaces & Contracts Foundation

**Goal:** Stand up `@heroes/contracts` (shared types/IDs) and `@heroes/engine` (deterministic rules) as separately importable workspaces; move view code out of `src/` into `src/screens/`.

| Item | Status | Notes |
| :--- | :--- | :--- |
| Root npm workspaces (`packages/contracts`, `packages/engine`) | ✅ | `tsconfig.json` `include` extended to both `packages/*/src` |
| Branded ID types (`HeroId`, `SettlementId`, `PlayerId`, etc.) in `packages/contracts/src/ids.ts` | ✅ | |
| Hex geometry + axial coords (`packages/contracts/src/geometry.ts`) | ✅ | |
| Resource / Warehouse / Building contracts | ✅ | |
| SettlementState, CharterState, UpgradeState, GameState contracts | ✅ | |
| Views moved to `src/screens/` | ✅ | |

**Track split for Phase 1:** n/a (sequential pre-work).

---

## 4. Phase 2 — Pure Deterministic Engine Extraction

**Goal:** Extract every game-rule domain out of the old monolithic `src/state/gameState.ts` into pure, deterministic `@heroes/engine` modules.

| Domain | Status | Modules |
| :--- | :--- | :--- |
| Economy | ✅ | `economy/{income,consumption,settlementRates,trade,transfer}.ts` |
| Charter | ✅ | `charter/{start,travel,advance,cleanup}.ts` |
| Settlement | ✅ | `settlement/{advance,autoTrade,capture,citySpots,populationGrowth,produceResources,upgradeBuilding,upgradeSettlement,upgradeTownHall}.ts` |
| Hero | ✅ | `hero/{move,recruit,stacks,upkeep}.ts` |
| Combat | ✅ | `combat/{grid,damage,resolveBattle,manualBattle,types}.ts` |
| Map | ✅ | `map/{gameMap,terrain,resourceTiles}.ts` |
| Registries | ✅ | `buildingRegistry.ts`, `buildingModifiers.ts`, `styleResolver.ts`, `control.ts` |
| Round / Upkeep | ✅ | `turn/{round,phases}.ts` (`advanceRound`, `applyWeeklyUpkeep`) |
| Unit tests | ✅ | `test/charter/`, `test/combat/`, `test/state/`, `test/map/` |
| `validateGameRow` invariant validator | ✅ | `validation/gameIntegrity.ts` |

**Track split for Phase 2:** n/a (single-track sequential extraction).

---

## 5. Phase 3 — Server Command Loop & Repositories

**Goal:** Replace ad-hoc REST mutation routes with a unified `commandHandler.ts` command-execution pipeline (validate → apply → persist delta → append event), backed by typed repositories.

### 5.1 Track 3.A — Server Command Bus & Handlers (Dev A) `[✅ DONE]`

| Item | Status | PR |
| :--- | :--- | :--- |
| Add `"server"` to `tsconfig.json` `include` | ✅ | #81 |
| Fix two latent tsconfig-surfaced bugs (`routes.ts:7` unused import, `routes.ts:513` orphaned `GameRow`) | ✅ | #81 |
| New `dependency-cruiser.cjs` rule: `server/http/` and `server/app/` (other than `commandHandler.ts`) cannot import `server/persistence/repositories/*` directly | ✅ | #83 |
| `EngineCtx = { rng: Rng; catalog: Catalog }` real type in `packages/engine/src/ctx.ts` (per `2026-08-15_OVERVIEW.md` — no actor, no clock; actor on each command) | ✅ | #83 |
| `EngineEvent` (renamed from `GameEvent` to dodge `src/core/events.ts` collision) in `packages/contracts/src/events/engineEvent.ts` | ✅ | #83 |
| `packages/contracts/src/commands/{moveHero,transferGold}.ts` (discriminated-union, Zod-validated, `actor: PlayerSeat`) | ✅ | #83 |
| `server/app/commandHandler.ts` skeleton (load → validate → apply → persist → append event loop) | ✅ | #83 |
| `server/http/routes/commands.ts` — `POST /api/games/:id/commands` | ✅ | #83 |
| `test/helpers/mockRepos.ts` shared by both tracks' tests | ✅ | #83 |
| `moveHero` + `transferGold` validation gaps closed (`isChartering` + tile-occupancy for MoveHero) | ✅ | #86 |
| Per-field request validation in `commands.ts` (Zod parse before dispatch) | ✅ | #86 |
| `src/io/api.ts` rewired to `POST /commands` for MoveHero + TransferGold | ✅ | #86 |
| `EndTurn` command (`packages/contracts/src/commands/endTurn.ts` + `TurnEnded` event) | ✅ | #87 |
| `advanceCharters` + `advanceSettlementUpgrades` + population-growth server-side (no longer trusts client) | ✅ | #87 |
| Real repos replace `server/app/liveRepos.ts` (`createLiveCommandDeps()` async, lazy memoized catalog query) | ✅ | #87 |
| Delete legacy `PATCH /games/:name` `spend_movement` and `transfer` branches in `server/routes.ts` | ✅ | #87 |
| **Week 3 ports** (all 7 candidates per `2026-08-16-phase-3-parallel-dev-plan.md`): | | #91 |
| — `TradeResources` (lowest-effort, already partially wired) | ✅ | #91 |
| — `ResolveBattle` (closes obstacle-seed replay gap: seed via `ctx.rng()`, persisted on `BattleResolved` event payload, not `Date.now()`) | ✅ | #91 |
| — `RecruitHero` | ✅ | #91 |
| — `UpgradeTownHall` | ✅ | #91 |
| — `SetAutoTrade` | ✅ | #91 |
| — `ReorderStack` | ✅ | #91 |
| — `CaptureSettlement` (closes pre-existing gap: never checked hero.position vs settlement.position) | ✅ | #91 |
| Delete legacy `POST /games/:name/resolve-battle` and `POST /games/:name/trade` routes | ✅ | #91 |
| `unit_types` live catalog query for ResolveBattle (12 seeded types) | ✅ | #91 |
| **#89 closure** (`settlement_snapshots` / `resource_transactions` audit writes restored on `EndTurn`): | | #92 |
| — `mockRepos.ts`: no-op `insertSettlementSnapshots` / `insertResourceTransactions` (no recorded-call arrays) | ✅ | #92 |
| — `commandHandler.ts` EndTurn case builds snapshot rows per settlement owned by `command.actor` + passes `transfers` straight through; `snapshotDay = wrapped ? finalState.day : row.day ?? finalState.day`; `effectiveIncome()` reused from `@heroes/engine` (D1, D3, D4) | ✅ | #92 |
| — Legacy `game_events` `kind` strings preserved (`turn_ended` / `round_ended` / `round_started` / `ai_turn_started`) | ✅ | #92 |
| — `commandHandler.test.ts` regression assertions that the writes fired | ⬜ | (follow-up; flagged in `2026-08-17-issue-89-track-and-phase-assignment.md` audit — Phase 4.A natural owner) |
| — D2 settlements slice: used `finalState.settlements` (post-`advanceRound`), **not** the post-`applyEndOfTurnDetailed` slice the scoping plan recommended | ⚠️ | (acceptable today: nothing reads `settlement_snapshots`; flagged so Phase 4 hydration does not assume slice parity on `day % 7 === 0` rows) |

**Track 3.A deferred (out of Phase 3 scope):**
- `UpgradeSettlement` — needs `GameMap`+RNG wired into `CommandDeps`, larger lift than pre-agreed repo interface covers. 🚫
- `StartCharter` / `AdvanceCharter` — was blocked on the `activeCharters` schema gap (no DB column existed). **Schema gap closed 2026-08-17 by Phase 4 Track B, PR #93** (`charters` table + `next_charter_id`/`next_settlement_id` counters); **read-side wired the same day by Track 4.A's uncommitted `hydrate.ts` work** (§6.1 — `GameState.activeCharters` now reads from the real table on the granular path). Still blocked: nothing in the command-bus path *writes* a charter yet (no command allocates a `CharterId` / calls `charterRepo.upsertMany`) — that's the one remaining port, not a schema or read-plumbing gap anymore. 🚫
- `BuildStructure` — blocked on missing `@heroes/engine` validate+apply function (Stage 6 deferred item). 🚫
- Lobby claim / start — session/social layer, lowest priority; not game-rules. 🚫
- Human-initiated `MoveHero`/`TransferGold` server round-trip — pre-existing gap (only AI moves + EndTurn are wired client-side today; surfaced in PR #91 description). 🟡 follow-up needed.

### 5.2 Track 3.B — Persistence Repositories & Test Harness (Dev B) `[🟡 PARTIAL]`

| Item | Status | PR |
| :--- | :--- | :--- |
| `server/persistence/db.ts` (move `pool`/`withTransaction` out of flat `server/db.ts`; `server/db.ts` keeps only `initSchema`) | ✅ | #84 |
| `server/persistence/repositories/gameRepo.ts` (`load`, `saveHeroesAndSettlements` + round/day/active_player_id extra param) | ✅ | #84 |
| `server/persistence/repositories/gameRepo.ts` additions: `insertSettlementSnapshots` (batched, `ON CONFLICT (game_id, settlement_id, day) DO NOTHING`), `insertResourceTransactions` (batched, `reason` defaults to `'auto_trade'`, nullable `fromSettlementId`); `resolveGameId` + `GameNotFoundError`; empty-array short-circuit | ✅ | #90 |
| `test/persistence/gameRepo.test.ts` — 7 new tests (row-per-settlement, idempotency, empty no-op, missing game, per-transfer rows) | ✅ | #90 |
| `package.json` `test:unit` widened to `test/server/*.test.ts test/persistence/*.test.ts` (consequence: `npm run test:all` now requires `npm run db:up`) | ✅ | #90 |
| `server/persistence/repositories/eventRepo.ts` (`append(gameId, kind, payload)`) | ✅ | #84 |
| `test/helpers/pgTestTx.ts` (per-test isolated transaction rollback) | ✅ | #84 |
| `test/persistence/*.test.ts` repo unit tests against real Postgres | ✅ | #84 |
| `server/persistence/repositories/heroRepo.ts` / `settlementRepo.ts` (corrected 2026-08-17: previously miscredited to #84 in this doc — #84's own commit message says it explicitly did *not* add these, "heroes/settlements are JSONB columns... gameRepo.ts covers both for now"; actually created in Phase 4 Track B, see §6.2) | ✅ | #93 |
| `server/persistence/repositories/charterRepo.ts` (landed in Phase 4 Track B once the `charters` table existed, not deferred-within-Phase-3 as first planned; see §6.2) | ✅ | #93 |
| `server/persistence/repositories/tileRepo.ts` (landed in Phase 4 Track B as its own file rather than folded into `gameRepo.ts`; see §6.2) | ✅ | #93 |

### 5.3 Phase 3 Verification (already green)

- `npm run build` (now checks `server/` too): ✅
- `npm run lint:deps` (286 modules / 783 deps, 0 violations): ✅
- `npm run test:all` (test:unit 23/23; smoke + multiplayer + cityView green): ✅
- Live round-trip against dev Postgres for TradeResources, SetAutoTrade, RecruitHero, UpgradeTownHall, ReorderStack, CaptureSettlement (followed up via GETs to confirm persistence): ✅
- #89 regression guard: live `SELECT count(*) FROM settlement_snapshots WHERE game_id = …` returns one row per settlement owned by the ending player after one `POST /games/:name/commands` EndTurn; `resource_transactions` gains a row per auto-trade transfer that fired: ✅ (PR #92; the corresponding `commandHandler.test.ts` unit-level guard is the still-open follow-up noted in §5.1).

---

## 6. Phase 4 — Database De-blobbing & Dual-Write

**Goal:** Stop saving/loading the monolithic `games.state` JSONB blob; hydrate identical `GameState` from discrete normalized tables. Migrate historical games without data loss.

*Deep dive: `plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md` (current-state audit, DDL, pre-agreed repo interface, week-by-week order, risks — same structure as the Phase 3 deep dive).*

### 6.1 Track 4.A — Dual-Write Integration & State Hydration (Dev A) `[🟡 IMPLEMENTED — uncommitted, no PR yet]`

**2026-08-17 update:** every item below is implemented on local branch `phase4/track-a-hydrate-dualwrite` — same commit as `main` (`208f8c0`, no new commits yet); the work exists only as uncommitted working-tree edits + 2 new untracked files, not pushed, no PR opened. Marked 🟡 rather than ✅ per this doc's own status legend ("✅ done & merged") until that happens. Design matches the deep-dive doc (granular-first read with per-game JSONB fallback in `hydrate.ts`; dual-write scoped to only the entities a command touched, same transaction as the existing JSONB write).

| Item | Status |
| :--- | :--- |
| `server/persistence/hydrate.ts` (reconstructs `GameState` from `gameRepo` + `heroRepo` + `settlementRepo` + `charterRepo` + `tileRepo`) | 🟡 implemented, uncommitted — `hydrateFromRepos()` + a `hydrateGame()` convenience wrapper. Deliberately does **not** read `tileRepo`: tiles are map-generation-time data, never part of `GameState`, so hydration has nothing to consume there. |
| `commandHandler.ts` dual-write step (write to `games.state` JSONB AND normalized tables) | 🟡 implemented, uncommitted — new `dualWriteEntities()` helper wired into all 10 currently-ported commands (MoveHero, TransferGold, EndTurn, TradeResources, ResolveBattle, RecruitHero, UpgradeTownHall, SetAutoTrade, ReorderStack, CaptureSettlement). Scoped per the plan via a reference-equality check against pre-command state (decides whether `heroRepo`/`settlementRepo` need calling at all) rather than a per-field diff — necessary because `upsertMany` is a full sync, so calling it with a filtered subset would wrongly delete untouched rows. |
| Read-path cutover with fallback: if granular rows missing, fall back to legacy JSONB; log a telemetry marker | 🟡 implemented, uncommitted — per-game fallback keyed on "**either** `heroes` or `settlements` granular table empty for this game" (OR, not AND — deliberately defensive against a hypothetically-partial dual-write leaving only one side populated, even though that shouldn't be reachable given both are upserted in the same DB transaction as the JSONB write; see `hydrate.ts`'s own comment). `console.info`-based `[hydrate]`-tagged telemetry marker fires on fallback. |
| Close `activeCharters` schema gap (introduce `charters` table; backfill from JSONB) | ✅ **schema done in Track 4.B, PR #93.** Read-side now also wired 🟡 (uncommitted, this branch) — `hydrate.ts`'s granular path reads real rows via `charterRepo`. Write-side (`charterRepo.upsertMany`) still deliberately unwired anywhere: nothing produces a non-empty `activeCharters` yet since `StartCharter`/`AdvanceCharter` remain unported (see §5.1). |
| Close the pre-existing human-initiated `MoveHero`/`TransferGold` round-trip gap surfaced in PR #91 | ⬜ untouched by this branch — client-side gap, still a Phase 5.A item (R4). |
| Round-trip equivalence tests: hydrate identical `GameState` from both paths | 🟡 implemented, uncommitted, at two layers — `test/server/commandHandler.test.ts` (mocked repos: asserts which repo(s) fire per command and with what data, plus that granular rows override/fall back to JSONB correctly) and new `test/persistence/hydrate.test.ts` (real Postgres via `pgTestTx.withRollback`: JSONB-fallback + telemetry-log assertion, granular-read equivalence, `activeCharters` by-design divergence between the two paths, and a "granular table partially populated" case that intentionally stays on the JSONB path per the OR-based fallback above). |

**Exit criteria:** commands persist to normalized tables; server hydrates byte-identical `GameState` from normalized tables as it did from JSONB. — **met and verified**: `npm run build`, `npm run lint:deps`, and `npm run test:all` (smoke + multiplayer + cityView + `test:unit` — 76/76, up from Phase 3's 23) all pass against this branch's diff; additionally live-verified against the real dev server + Postgres (`POST /commands` end-to-end, granular tables confirmed populated). Commit/push/PR is the remaining step (see §11, §12).

### 6.2 Track 4.B — SQL Migrations & Historical Backfill (Dev B) `[✅ Week 1–2 DONE]`

| Item | Status | PR |
| :--- | :--- | :--- |
| `server/migrations/009_granular_entities.sql` (`heroes`, `hero_platoons`, `settlements`, `settlement_resources`, `settlement_buildings`, `charters`; also closes the previously-unpersisted `games.next_charter_id`/`next_settlement_id` counter gap found in `packages/engine/src/hydrate.ts:160-161`) | ✅ | #93 |
| `server/migrations/010_event_seq.sql` — shipped design differs from the original plan: no new `seq` column; `game_events.id` (already `BIGSERIAL PRIMARY KEY`) is the monotonic cursor instead, so this migration only adds `actor_seat INTEGER` + a `(game_id, actor_seat)` index | ✅ | #93 |
| `server/persistence/repositories/heroRepo.ts`, `settlementRepo.ts`, `charterRepo.ts`, `tileRepo.ts` (`loadAllForGame`/`upsertMany`, gameName-keyed; `upsertMany` is a full sync — deletes rows missing from the given record rather than merging, so hero death / charter completion fall out for free with no separate delete path) | ✅ | #93 |
| `server/persistence/repositories/gameRepo.ts`: `resolveGameId` exported so the 4 new repos share it instead of duplicating the lookup | ✅ | #93 |
| `scripts/migrate-jsonb-to-tables.ts` CLI migration script (idempotent, one transaction per game; deliberately skips `charters` — no JSONB source for `activeCharters` ever existed) | ✅ | #93 |
| `test/migrations/migration.test.ts` (round-trip integrity of migrated game rows) + `test/persistence/{hero,settlement,charter,tile}Repo.test.ts` (21 new tests total) | ✅ | #93 |
| `dependency-cruiser.cjs` boundary-rule coverage for the 4 new repo files | ✅ (no change needed — existing rule matches the `server/persistence/repositories/` directory path, not an enumerated file list) | — |
| Idempotency: rerunning migration is a no-op | ✅ (dedicated test: "backfillGame is idempotent: running it twice converges to the same rows") | #93 |
| Backfill 100% of sample games without data loss | ✅ verified against representative fixtures (varied stacks, in-flight upgrades, a partial `resourceRates` incl. a `gold` rate) via round-trip deep-equality. No real production historical dataset has been run through it yet — that's an ops step whenever real data needs it, not a code gap. | #93 |

**Exit criteria:** migration runs idempotently; 100% of sampled historical games round-trip without loss — **met for Track B's scope.** The other half of Phase 4's overall exit criteria (this section's intro: "commands persist to normalized tables; server hydrates byte-identical `GameState`...") is Track 4.A's, still ⬜.

### 6.3 Sync Point 2 (Phase 4 → 5)

`hydrateGameState` round-trip-equivalent to legacy JSONB (🟡 implemented on local branch `phase4/track-a-hydrate-dualwrite`, uncommitted, no PR yet — see §6.1); monotonic event cursor available client-side (✅ resolved — `game_events.id`, already `BIGSERIAL`, is the cursor per PR #93's `010_event_seq.sql`; no separate `event_seq` column was added); `charters` table exists (✅ PR #93).

---

## 7. Phase 5 — Client Event Sync & Scene Renderer Seam

**Goal:** Replace full-state client pushing (`POST /api/games/:id/save`) with command emission + event-cursor sync. Decouple canvas rendering from game state via pure scene builders.

### 7.1 Track 5.A — Client Command Dispatcher & Event-Cursor Sync (Dev A)

| Item | Status |
| :--- | :--- |
| `src/io/commands.ts` (client command dispatcher — replaces `src/managers/GameActions.ts`) | ⬜ |
| `src/io/multiplayerSync.ts` polls `GET /api/games/:id/events?after=<seq>` OR receives SSE; applies events through `@heroes/engine` | ⬜ |
| `src/managers/GameSessionManager.ts` new/load lifecycle initializes event cursor | ⬜ |
| Delete full-state save push from `SessionManager.ts` | ⬜ |
| All client actions emit commands against `POST /commands` (close the pre-existing human-initiated MoveHero/TransferGold gap + ensure all 9 ports have client wiring) | ⬜ |

**Exit criteria:** client actions execute exclusively as commands; multiplayer state syncs exclusively via delta events.

### 7.2 Track 5.B — Scene Graph Builder & Entity Mirror (Dev B)

| Item | Status |
| :--- | :--- |
| `src/render/scene/sceneBuilder/{adventureScene,cityScene,battleScene}.ts` (pure: `GameState + Camera -> SceneNode[]`) | ⬜ |
| `src/render/scene/paint2d/` (Canvas2D painter reading `SceneNode[]`) | ⬜ |
| `src/render/scene/entityMirror.ts` (subscribes to `HeroMoved`, `StructureBuilt` events; smooth tweening without rAF full-state re-polling) | ⬜ |
| Decompose `src/screens/combat/manualBattleArena.ts` into modular components | ⬜ |
| `src/render/renderer.ts` and `src/render/cityRenderer.ts` rewritten to consume `SceneNode[]` instead of state directly | ⬜ |

**Exit criteria:** canvas rendering runs from immutable `SceneNode[]` lists; hero movement animations interpolate smoothly driven by event subscriptions.

---

## 8. Cross-Phase Ownership Matrix (Track A vs Track B)

| File / Directory | P3 owner | P4 owner | P5 owner |
| :--- | :--- | :--- | :--- |
| `tsconfig.json` | Shared (first PR) | – | – |
| `dependency-cruiser.cjs` | **A** (additive) | **A** (additive if needed) | **A** |
| `packages/contracts/src/commands/` | **A** | **A** | Shared |
| `packages/contracts/src/events/` | **A** | Shared | Shared |
| `packages/engine/src/ctx.ts` | **A** | – | – |
| `server/app/commandHandler.ts` | **A** | **A** | Shared |
| `server/app/turnService.ts` | **A** | **A** | – |
| `server/http/routes/commands.ts` | **A** | **A** | Shared |
| `server/routes.ts` (delete-only) | **A** | **A** | – |
| `server/persistence/repositories/*` | **B** | **B** | – |
| `server/persistence/db.ts` | **B** | **B** | – |
| `server/migrations/*` | – | **B** | – |
| `scripts/migrate-jsonb-to-tables.ts` | – | **B** | – |
| `src/io/commands.ts` | – | – | **A** |
| `src/io/multiplayerSync.ts` | – | – | **A** |
| `src/managers/GameActions.ts` (→ `src/io/commands.ts`) | – | – | **A** |
| `src/render/scene/*` | – | – | **B** |
| `src/screens/combat/*` (decompose) | – | – | **B** |
| `test/helpers/mockRepos.ts` | **B** (shared) | **B** | – |
| `test/helpers/pgTestTx.ts` | **B** (shared) | **B** | – |

---

## 9. Per-Phase Verification Gates

Every PR — Phase 3, 4, and 5 — must pass all four gates:

1. `npm run build` (tsc strict + vite build; Phase 3+ also type-checks `server/`)
2. `npm run lint:deps` (zero `dependency-cruiser.cjs` boundary violations)
3. `npm run validate-assets` (sprite descriptors resolved)
4. `npm run test:all` (smoke + multiplayer.smoke + cityView + domain unit tests)

Additional Phase 4 gate: live round-trip equivalence between JSONB and normalized hydration paths on historical game samples.

Additional Phase 5 gate: Canvas-render screenshot diffs vs. previous render path on a fixed replay set (no visual regressions from scene-graph rewrite).

---

## 10. Open Risks & Deferred Items (consolidated)

| # | Item | Phase | Mitigation / Owner |
| :--- | :--- | :--- | :--- |
| R1 | Legacy-patch fallback becoming the "everything not yet ported" catch-all | P3 | Port order in `2026-08-16-phase-3-parallel-dev-plan.md` § "Port order Week 3+" — track all 12 candidates, not just the easy wins. Already 7/12 done in PR #91. |
| R2 | `EndTurn` port silently changes multiplayer behavior | P3 | Side-by-side path comparison against recorded game histories before deleting old code (drift-safe). Done in PR #87. |
| R3 | `EngineCtx` shape churn | P3 | `EngineCtx = { rng, catalog }` only (no actor, no clock); `actor` on each command. Fixed per `2026-08-15_OVERVIEW.md`. |
| R4 | Human-initiated `MoveHero`/`TransferGold` have no server round-trip | P3/4/5 | Pre-existing gap, surfaced in PR #91. **Needs to be closed in Phase 5.A** when `src/io/commands.ts` replaces `GameActions.ts`. Independently reproduced live 2026-08-17 during Track 4.A manual testing (user-observed symptom: hero snaps back to its last-persisted position on every `EndTurn`, since `turnHooks.ts`'s `mergeFromEndTurn()` unconditionally overwrites local `heroes` state with the server's response — traced to `src/state/turnController.ts:115`'s `requestMove()` never calling the server for human moves). Confirmed unrelated to and unaffected by Track 4.A's dual-write/read-cutover work (both JSONB and the granular tables reflect the same server-side position either way); left for Phase 5.A per this doc's existing plan. |
| R5 | `activeCharters` schema gap | P4 | ✅ **Schema closed 2026-08-17 (PR #93):** `charters` table + `next_charter_id`/`next_settlement_id` counters exist and are migration-backfill-covered. Read-side also wired 🟡 (2026-08-17, uncommitted, `phase4/track-a-hydrate-dualwrite`) — `hydrate.ts` now populates `activeCharters` from the real table. `StartCharter`/`AdvanceCharter` command ports themselves remain deferred — the only thing left blocking them is the port itself (no command writes a charter yet), not schema or read plumbing. |
| R6 | `BuildStructure` blocked on missing engine validate+apply | ∞ | Stage 6 prerequisite. Track whenever next engine module is added. |
| R7 | Multi-DB portability (Oracle/MySQL) parked | ∞ | Per multi-DB `.fable.md` appendix decision; revisit when a second DB vendor container actually exists. |
| R8 | Lobby claim/start never ported to commands | P3 (skipped) | Session/social layer, not game-rules; Decision 1.C keeps reads/CRUD as plain REST. |

---

## 11. Open PRs Awaiting Merge (as of 2026-08-17)

- *None open.* Merge order on 2026-08-17 (all EDT): **#92** (01:21, Phase 3 Track A — `#89` closure) → **#91** (01:30, Phase 3 Track A Week 3 ports) → **#93** (01:53, Phase 4 Track B — granular entity tables/repos/backfill) → **#94** (01:58, docs-only sync of this file; its branch was cut before #93 merged, so it missed #93 — corrected in this revision).
- **Not yet a PR:** local branch `phase4/track-a-hydrate-dualwrite` (still at `main`'s tip `208f8c0`; changes are uncommitted, not pushed) implements Track 4.A's `hydrate.ts` + `commandHandler.ts` dual-write step. See §6.1.

---

## 12. What's Next (Immediate)

1. **Phase 4.A review & land** — `hydrate.ts` + `commandHandler.ts` dual-write step are implemented on local branch `phase4/track-a-hydrate-dualwrite` (uncommitted; see §6.1). Next: run the full verification gate (§9), commit, push, open a PR. The still-open #89 follow-up (unit-level regression assertions in `commandHandler.test.ts`) has **not** been absorbed by this branch — still a separate follow-up.
2. **`StartCharter`/`AdvanceCharter` command ports** — schema (Track 4.B, PR #93) and the hydration read-side (Track 4.A, this branch) are both in place; only the write-side command port itself is left (see §5.1, §10 R5).
3. **Phase 5.A kickoff** — `src/io/commands.ts` dispatcher. Should absorb the human-initiated MoveHero/TransferGold round-trip gap (R4) as its first deliverable.

---

*This map supersedes ad-hoc reading of `2026-08-15-parallel-dev-split.md`, `2026-08-16-parallel-dev-phases-3-5.md`, `2026-08-16-phase-3-parallel-dev-plan.md`, and `2026-08-17-phase-4-db-deblobbing-dev-plan.md` for status/ownership purposes. The source plans remain authoritative for design rationale; this doc tracks what is done vs not.*