# Consolidated Phase Map (1–5) — Two-Track Parallel Development

*Authored: 2026-08-17*
*Consolidates: `plan/2026-08-15-parallel-dev-split.md`, `plan/2026-08-16-parallel-dev-phases-3-5.md`, `plan/2026-08-16-phase-3-parallel-dev-plan.md`, `sessionTracking/2026-08-16.md`, PRs #81/#83/#84/#86/#87/#91.*
*Status legend: ✅ done & merged · 🟡 in progress / open PR · ⬜ not started · 🚫 blocked / deferred*

---

## 1. Phase Map at a Glance

```
Phase 1  Workspaces & Contracts foundation              [✅ DONE]
Phase 2  Pure deterministic engine extraction           [✅ DONE]
Phase 3  Server Command Loop & Repositories             [🟡 TRACK A DONE / TRACK B PARTIAL]
   ├── 3.A  Command bus, EngineCtx, command handlers    [✅ Dev A — PRs #86, #87, #91 merged]
   └── 3.B  Typed repositories & persistence layer      [🟡 Dev B — PR #84 partial; tile/charter repos deferred to Phase 4]
Phase 4  Database De-blobbing & Dual-Write              [⬜ NOT STARTED]
   ├── 4.A  Dual-write integration & state hydration
   └── 4.B  SQL migrations & historical-game backfill
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

**Track 3.A deferred (out of Phase 3 scope):**
- `UpgradeSettlement` — needs `GameMap`+RNG wired into `CommandDeps`, larger lift than pre-agreed repo interface covers. 🚫
- `StartCharter` / `AdvanceCharter` — blocked on the `activeCharters` schema gap (no DB column exists; schema changes are Phase 4). 🚫
- `BuildStructure` — blocked on missing `@heroes/engine` validate+apply function (Stage 6 deferred item). 🚫
- Lobby claim / start — session/social layer, lowest priority; not game-rules. 🚫
- Human-initiated `MoveHero`/`TransferGold` server round-trip — pre-existing gap (only AI moves + EndTurn are wired client-side today; surfaced in PR #91 description). 🟡 follow-up needed.

### 5.2 Track 3.B — Persistence Repositories & Test Harness (Dev B) `[🟡 PARTIAL]`

| Item | Status | PR |
| :--- | :--- | :--- |
| `server/persistence/db.ts` (move `pool`/`withTransaction` out of flat `server/db.ts`; `server/db.ts` keeps only `initSchema`) | ✅ | #84 |
| `server/persistence/repositories/gameRepo.ts` (`load`, `saveHeroesAndSettlements` + round/day/active_player_id extra param) | ✅ | #84 |
| `server/persistence/repositories/eventRepo.ts` (`append(gameId, kind, payload)`) | ✅ | #84 |
| `server/persistence/repositories/heroRepo.ts` | ✅ | #84 |
| `server/persistence/repositories/settlementRepo.ts` | ✅ | #84 |
| `test/helpers/pgTestTx.ts` (per-test isolated transaction rollback) | ✅ | #84 |
| `test/persistence/*.test.ts` repo unit tests against real Postgres | ✅ | #84 |
| `server/persistence/repositories/charterRepo.ts` | ⬜ | (deferred — not needed until `activeCharters` schema column lands in Phase 4) |
| `server/persistence/repositories/tileRepo.ts` | ⬜ | (deferred — fold into `gameRepo.ts` per multi-DB-docs advice until ≥2 callers justify a file) |

### 5.3 Phase 3 Verification (already green)

- `npm run build` (now checks `server/` too): ✅
- `npm run lint:deps` (286 modules / 783 deps, 0 violations): ✅
- `npm run test:all` (test:unit 23/23; smoke + multiplayer + cityview green): ✅
- Live round-trip against dev Postgres for TradeResources, SetAutoTrade, RecruitHero, UpgradeTownHall, ReorderStack, CaptureSettlement (followed up via GETs to confirm persistence): ✅

---

## 6. Phase 4 — Database De-blobbing & Dual-Write

**Goal:** Stop saving/loading the monolithic `games.state` JSONB blob; hydrate identical `GameState` from discrete normalized tables. Migrate historical games without data loss.

### 6.1 Track 4.A — Dual-Write Integration & State Hydration (Dev A)

| Item | Status |
| :--- | :--- |
| `server/persistence/hydrate.ts` (reconstructs `GameState` from `gameRepo` + `heroRepo` + `settlementRepo` + `charterRepo` + `tileRepo`) | ⬜ |
| `commandHandler.ts` dual-write step (write to `games.state` JSONB AND normalized tables) | ⬜ |
| Read-path cutover with fallback: if granular rows missing, fall back to legacy JSONB; log a telemetry marker | ⬜ |
| Close `activeCharters` schema gap (introduce `charters` table; backfill from JSONB) — **unblocks deferred `StartCharter`/`AdvanceCharter` ports from Phase 3** | ⬜ |
| Close the pre-existing human-initiated `MoveHero`/`TransferGold` round-trip gap surfaced in PR #91 | ⬜ |
| Round-trip equivalence tests: hydrate identical `GameState` from both paths | ⬜ |

**Exit criteria:** commands persist to normalized tables; server hydrates byte-identical `GameState` from normalized tables as it did from JSONB.

### 6.2 Track 4.B — SQL Migrations & Historical Backfill (Dev B)

| Item | Status |
| :--- | :--- |
| `server/migrations/009_granular_entities.sql` (`heroes`, `hero_platoons`, `settlements`, `settlement_resources`, `settlement_buildings`, `charters`) | ⬜ |
| `server/migrations/010_event_seq.sql` (adds `seq BIGSERIAL` monotonic sequence + `actor_seat` to `game_events`) | ⬜ |
| `scripts/migrate-jsonb-to-tables.ts` CLI migration script | ⬜ |
| `test/migrations/migration.test.ts` (round-trip integrity of migrated game rows) | ⬜ |
| Idempotency: rerunning migration is a no-op | ⬜ |
| Backfill 100% of sample games without data loss | ⬜ |

**Exit criteria:** migration runs idempotently; 100% of sampled historical games round-trip without loss.

### 6.3 Sync Point 2 (Phase 4 → 5)

`hydrateGameState` round-trip-equivalent to legacy JSONB; monotonic `event_seq` available client-side; `charters` table exists.

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
| R4 | Human-initiated `MoveHero`/`TransferGold` have no server round-trip | P3/4/5 | Pre-existing gap, surfaced in PR #91. **Needs to be closed in Phase 5.A** when `src/io/commands.ts` replaces `GameActions.ts`. |
| R5 | `activeCharters` schema gap | P4 | Phase 4 migration introduces `charters` table; backfills from JSONB. Unblocks `StartCharter`/`AdvanceCharter` command ports. |
| R6 | `BuildStructure` blocked on missing engine validate+apply | ∞ | Stage 6 prerequisite. Track whenever next engine module is added. |
| R7 | Multi-DB portability (Oracle/MySQL) parked | ∞ | Per multi-DB `.fable.md` appendix decision; revisit when a second DB vendor container actually exists. |
| R8 | Lobby claim/start never ported to commands | P3 (skipped) | Session/social layer, not game-rules; Decision 1.C keeps reads/CRUD as plain REST. |

---

## 11. Open PRs Awaiting Merge (as of 2026-08-17)

- **#91** — Phase 3 Track A Week 3 ports (7 commands) — Dev A, status: addressing Copilot review (per `sessionTracking/2026-08-17.md`).

---

## 12. What's Next (Immediate)

1. **Land PR #91** with Copilot-review fixes (Dev A, in flight).
2. **Plan Phase 4.A kickoff** — `hydrate.ts` + dual-write step. Prereq: confirm the schema for `charters` table (Track B owns the migration in 4.B; coordinate before either track starts to avoid schema drift).
3. **Plan Phase 5.A kickoff** — `src/io/commands.ts` dispatcher. Should absorb the human-initiated MoveHero/TransferGold round-trip gap (R4) as its first deliverable.

---

*This map supersedes ad-hoc reading of `2026-08-15-parallel-dev-split.md`, `2026-08-16-parallel-dev-phases-3-5.md`, and `2026-08-16-phase-3-parallel-dev-plan.md` for status/ownership purposes. The source plans remain authoritative for design rationale; this doc tracks what is done vs not.*