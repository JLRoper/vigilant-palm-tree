# Consolidated Phase Map (1–5) — Two-Track Parallel Development

*Authored: 2026-08-17*
*Consolidates: `plan/2026-08-15-parallel-dev-split.md`, `plan/2026-08-16-parallel-dev-phases-3-5.md`, `plan/2026-08-16-phase-3-parallel-dev-plan.md`, `plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md`, `sessionTracking/2026-08-16.md`, PRs #81/#83/#84/#86/#87/#91/#92/#93/#95.*
*Status legend: ✅ done & merged · 🟡 in progress / open PR · ⬜ not started · 🚫 blocked / deferred · ⚠️ done with a caveat worth reading*
*Revision note (2026-08-17, post-#94): syncs in PR #93 (Phase 4 Track B — granular entity tables, repos, JSONB backfill). PR #94's own doc-sync branch was cut before #93 merged, so that revision of this file missed it. This revision also corrects two rows in §5.2 that had misattributed `heroRepo.ts`/`settlementRepo.ts` to PR #84 — that PR's own commit message says it explicitly did not add them.*
*Revision note 2 (2026-08-17, same day): reflects Track 4.A's `hydrate.ts` + `commandHandler.ts` dual-write work, committed as `20704d4`/`3aad7d3` on branch `phase4/track-a-hydrate-dualwrite`, pushed, open as **PR #95**. Marked 🟡, not ✅, until it's merged (per this doc's own legend, "✅ done & merged"); see §6.1.*
*Revision note 3 (2026-08-17, from worktree `20260817_0211_phase5trackA`): **PR #95 merged** (commit `2554711`, this worktree's `HEAD`/`main`/`github main`) — flips every 🟡-pending-#95 row below to ✅; Phase 4 is now fully done and Sync Point 2 (§6.3) is fully met. PR #95 merged with 5 Copilot review comments that were never addressed (posted ~2 min after merge, no follow-up commit) — all 5 fixed in this worktree: `hydrate.ts`'s fallback logging is now rate-limited to once per game per process, `hydrateFromRepos()` no longer queries `charterRepo` on a path that's about to discard it and fall back to JSONB, `hydrate.ts`/`commandHandler.ts` comment blocks trimmed per this repo's own AGENTS.md rule against unrequested comments, and `test/persistence/hydrate.test.ts` now uses `node:test`'s `t.mock.method` instead of a global `console.info` monkey-patch. Phase 5 Track A also partially started in this worktree (§7.1): `src/io/commands.ts` created (consolidates the client's command-POST functions out of `src/io/api.ts`) and the human-initiated `MoveHero`/`TransferGold` round-trip gap (R4, §10) fully closed via two new `TurnControllerHooks` (`onHumanMove`, `onTransferGold`). `multiplayerSync.ts`'s event-cursor rewrite, `GameSessionManager.ts` cursor init, and deleting `SessionManager.ts`'s full-state save push are deliberately still deferred (see §7.1). Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (76/76 unit + smoke + multiplayer + cityView) all green.*
*Revision note 4 (2026-08-17, from worktree `20260817_0335_phase5TrackB`): merged `main` (PR #96 — the Track 5.A partial work from revision note 3) into this branch, fast-forward, no conflicts. Made real progress on Track 5.B (§7.2, table updated below): fixed a real bug in `adventureScene.ts` (its relative imports were one directory level too shallow, so it never actually compiled — this had shipped uncaught in the prior session since it was never run through `npm run build`), then added `entityMirror.ts` and `sceneBuilder/cityScene.ts`, both pure and fully unit-tested (24 new tests in `test/render/`, now wired into `test:unit`). Also relocated `computeCityScale` out of `cityRenderer.ts` into `src/core/cityGrid.ts` (re-exported from its old location for the two existing call sites) — `cityRenderer.ts` has module-scope Vite-only `?url` PNG imports, so nothing importable from it (or from the `cityBuildingDraw.ts` barrel, which pulls in `assetDescriptors.ts`'s PNG imports the same way) can be safely imported from a plain `node:test` context. This is a real, general pitfall for whoever builds `battleScene.ts` or `paint2d/` next: import pure helpers from their actual leaf module (e.g. `cityBuildingDraw/primitives.ts`) rather than through an asset-loading barrel. `battleScene.ts`, `paint2d/`, the `manualBattleArena.ts` decomposition, and the `renderer.ts`/`cityRenderer.ts` rewrite itself all remain ⬜ — none of Track 5.B's output is wired into the live render path yet, so regression risk so far is still zero. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (100/100 unit + smoke + multiplayer + cityview) all green.*
*Revision note 5 (2026-08-17, from worktree `20260817_0542_battleSceneRewrite`, branch `phase5/track-b-battlescene-renderer-rewrite`): added `src/render/scene/sceneBuilder/battleScene.ts` (§7.2, table updated below) — a pure decomposition of `manualBattleArena.ts`'s `draw()`/`renderPixelFor()`, plus 8 new node kinds in `scene/types.ts` and 15 new tests in `test/render/battleScene.test.ts`. Confirms revision note 4's predicted pitfall never actually triggered: `manualBattleArena.ts` imports nothing from `src/render/` today, so `battleScene.ts` needed no barrel workaround. Two corrections to this doc's own earlier research-pass notes (verified by tracing every `ctx.*` call in the 2261-line file, all of which live inside `draw()`): (1) the directional-melee hover latch (`pendingTarget`/`approachHexes`/`approachChoice`) has no canvas-visible effect at all today — it only changes the DOM help text and the CSS cursor, so it's deliberately excluded from `BattleSceneInput` rather than modeled as a node nothing would populate; (2) `ATTACKER_ACCENT`/`DEFENDER_ACCENT`/`humanAccent` are DOM-panel-only and never read inside `draw()`, so they're excluded too. `BattleSceneInput` bundles `ManualBattleState` plus the transient UI/animation state `draw()` actually reads (`selectedSlot`, `moveRange`, `attackTargets`, `aiActing`/`aiActingSlot`/`aiTargetHex`, `moveAnim`/`impact`/`floats`, `humanSide`/`aiSide`, `hexSize`/`offsetX`/`offsetY`) plus an explicit `nowMs` field so the builder stays pure instead of reading `performance.now()` internally (the same "don't own a clock" principle `entityMirror.ts` follows, applied inline since these overlays have no `Hero`-style ticked class of their own). `paint2d/`, the `manualBattleArena.ts` decomposition, and the `renderer.ts`/`cityRenderer.ts` rewrite itself all remain ⬜ — `battleScene.ts`'s output is additive/unwired, same zero-regression-risk posture as `adventureScene.ts`/`cityScene.ts` had when first added. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (116/116 unit + smoke + multiplayer + cityview) all green.*
*Revision note 6 (2026-08-17, from worktree `20260817_0726_paint2D`, branch `phase5/track-b-paint2d-canvas2d-painter`): this is the session that *actually triggers* the Vite-`?url` pitfall revision note 4 predicted — `paint2d/` is the first module that has to consume the Vite-coupled asset pipeline. The previous item (revision note 5) dodged it because `manualBattleArena.ts` imports nothing from `src/render/`, but `paint2d/` will need to draw every sprite, including the four `?url`-loaded skybox variants and hundreds of building/hero/castle/resource sprites. Added the module skeleton (§7.2, table updated below): `src/render/scene/paint2d/{index,deps,colors,geometry,README}.ts`. The dispatcher (`paintScene`) switches on every `node.kind` and dispatches to a per-kind `paint<X>(ctx, node, deps)` function — 28 stubs in this session, all no-ops, leaving the actual 1:1 Canvas transcription for follow-up commits (Commits 3-10 in the design doc). The Vite seam is the headline design decision: `paint2d/` declares a `Paint2DDep` interface with four per-kind sprite-resolution helpers (`resolveSpriteForResource/Hero/Building/Castle`) plus a `SkyboxProvider` dep + state-getters + `colorForOwner`/`battleAccent`/`fontFamily`/`charterStyle`. The painter never names a key string, never reads `settings()` directly, never imports `assetDescriptors.ts`/`assets.ts`/`sprites.ts`/`cityRenderer.ts`/`cityBuildingDraw.ts` (barrel) — all Vite-`?url`-coupled or with a cleanup lifecycle the painter shouldn't drive. The default-deps builder at `src/render/paint2dDefaults.ts` (forthcoming) and the skybox module at `src/render/skybox.ts` (forthcoming) are the *only* files in the painter project that touch those — they live outside `paint2d/`. Boundary enforced two ways: (1) a new dependency-cruiser rule `paint2d-cannot-import-asset-descriptors` + `paint2d-cannot-value-import-state` (404 modules, 911 deps, 0 violations); (2) a runtime seam test `test/render/paint2d.seam.test.ts` that does a string-scan of `paint2d/` source AND a `node:test`-loader `import()` of the module — fails loudly the moment the boundary leaks. The runtime smoke test is the critical one: it caught the dep-cruiser config schema error (my `mainFields`/`tsPreCompilationDeps` ended up in the wrong nesting level) and the seam test's own false-positive on doc comments mentioning `"assetDescriptors"` (fixed by stripping `//` and `/* */` comments before scanning). Recorded per-session memoization for the per-kind commits: `paint2d/colors.ts` holds the byte-exact RGBA constants from the live renderers, `paint2d/geometry.ts` holds `hexPath`/`diamondPath` (no module state, no asset deps), `test/render/_helpers.ts` gained `makeRecordingCtx()` + `makeNoopPaint2DDep()` for the actual transcription tests that will land with each commit. The actual Canvas paint per node kind (Commits 3-10) and the `paint2dDefaults.ts`/`skybox.ts` modules (Commit 2) remain ⬜ — `paint2d/` is additive/unwired, same zero-regression-risk posture as the previous scene-builder commits. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (still 116/116 unit + smoke + multiplayer + cityview, since nothing new from this branch reaches the live render path) all green.*
*Revision note 7 (2026-08-17, from worktree `20260817_0528_charterPort`, branch `phase3/track-a-charter-port`): merged `main` (PR #104 — Track 5.B's `battleScene.ts`, revision note 5 above) into this branch after opening this branch's own PR (#105); one conflict, in this doc's own revision-note numbering (both branches independently added a "Revision note 5" at the same insertion point) — resolved by keeping PR #104's as note 5 (unchanged, already landed in `main`) and renumbering this one to note 6 [since renumbered again to note 7 — this branch's "note 6" silently collided with the paint2d branch's own independently-numbered note 6, see the doc audit findings]; no other conflicts (the two branches' real content changes never touched the same file region). Re-verified after merging: `npm run build`, `npm run lint:deps`, `npm run test:all` all green. Substance of this branch's own work, unaffected by the merge: ported **`StartCharter`** end-to-end (the one remaining Track 3.A deferred item — §5.1, §10 R5) and closed most of what "AdvanceCharter" needed. New `packages/contracts/src/commands/startCharter.ts` (`{heroId, targetQ, targetR, settlementName}` only — settlementId/charterId/resourceRates/foundedOnResource/citySpots are all server-recomputed, not client-trusted, following `ResolveBattle`'s own precedent) + `CharterStarted` `EngineEvent` variant. `commandHandler.ts`'s new `StartCharter` case reconstructs a `GameMap` from `row.seed`/`row.map_size` (no command had done this before — verified equivalent to the client's own `GameMap.fromTiles()` reconstruction path in new `test/server/gameMapReconstruction.test.ts`), mirrors `turnController.ts`'s own `isPassable`/too-close-to-settlement pre-checks, and allocates `charterId`/`settlementId` from `state.nextCharterId`/`nextSettlementId`. Found and closed a real counter-persistence gap first: `next_charter_id`/`next_settlement_id` (added to the `games` table by PR #93) were never actually read or written anywhere (`GAME_COLUMNS`, `GameRow`, `HydratableGameRow`, and `saveHeroesAndSettlements()`'s extra param all omitted them) — a second `StartCharter` in the same game would have collided ids with the first; fixed, with a regression test (`test/server/commandHandler.test.ts`) plus a `next_settlement_id`-floors-at-settlementCount test for rows that predate the fix (`test/persistence/hydrate.test.ts`). **AdvanceCharter scoping decision:** the days-remaining countdown + settlement founding (`advanceCharters()`) is now fully server-authoritative — `EndTurn`'s case now calls `charterRepo.upsertMany()` after `advanceRound()` runs (previously deliberately skipped, per that case's own now-removed comment). The hex-by-hex travel *stepping* (`stepTravelCharter()`) stays purely client-local (`TurnController.advanceAutoTravel()`'s loop) — deliberately deferred, not attempted in this PR; making it server-authoritative needs its own command + hook (fired once per hex-step, the way `onHumanMove` is), a materially bigger change than this port's scope. Also wired `ResolveBattle`'s case to call `cleanupDefeatedHeroCharters()` when the defender loses all troops (mirroring `turnController.ts`'s own `resolveCurrentBattle()` check exactly, including that it only ever checks the defender's defeat) — closes the orphaned-charter-row risk now that charters are server-persisted. Client-side wiring: `onStartCharter` added to `TurnControllerHooks`/`turnHooks.ts`/`src/io/commands.ts`, fired fire-and-forget from `TurnController.startCharter()` right after the local reducer call, matching every other Week-3+ action's exact pattern. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (111/111 unit + smoke + multiplayer + cityview) all green.*
*Revision note 8 (2026-08-17, from worktree `pr-review-alignment-d8d903`, branch `chore/p0-onboarding-and-doc-fixes`, open as PR #111): acts on PR #110's audit findings — the P0 batch plus a status-symbol correction pass over this doc. **Symbol fixes:** §1 and §5.2 both still marked Track 3.B `🟡 PARTIAL` even though every row in §5.2's own table had long since flipped to ✅ — the "partial" referred to `heroRepo`/`settlementRepo`/`charterRepo`/`tileRepo` being deferred out of Phase 3, and all four landed in Phase 4 via PR #93 (confirmed present in `server/persistence/repositories/`). Both now ✅. §11 claimed "*None open*" while PR #111 was in fact open; it now leads with the open PR and lists merged history separately, extended through #110. Legend gained ⚠️, which §5.1 was already using without defining it. **Substantive P0 work (code, not docs):** `docker/Dockerfile` had been broken since the `shared/` → `packages/engine` rename — fixed by copying the whole `packages/` workspace (both `@heroes/engine` and `@heroes/contracts`, since engine depends on contracts) *before* `npm ci` in each stage, so npm links the workspaces correctly; verified by actually running `docker build` against both the `api-runtime` and `web-runtime` targets rather than trusting the edit. Also added an `engines` pin matching CI's Node 22.x and a Playwright `postinstall` — the naive form of that hook broke both Docker runtime stages (they run `npm ci --omit=dev`, and `playwright` is a devDependency, so the hook died with `playwright: not found` and took the whole image build with it), so it is guarded to skip when playwright isn't resolvable. Worth remembering: a `postinstall` hook runs in every install context, including production-only ones. **Status re-verification (all claims below spot-checked against the repo, not taken from this doc's own narrative):** `paint2d/index.ts` still carries 33 stub/no-op/TODO markers; `paint2dDefaults.ts`/`skybox.ts` still do not exist; `renderer.ts`/`cityRenderer.ts` still have zero `SceneNode`/`paintScene` references; `GET /games/:name/events` still has no `?after=` cursor filtering; `multiplayerSync.ts` is still a full-state poller. Nothing in Phase 5 has drifted — §12 is re-ordered to lead with the event-cursor/SSE ownership decision, which is the one genuine blocker. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` (148/148 unit + smoke + multiplayer + cityview), `npm run validate-assets` all green.*

---

## 1. Phase Map at a Glance

```
Phase 1  Workspaces & Contracts foundation              [✅ DONE]
Phase 2  Pure deterministic engine extraction           [✅ DONE]
Phase 3  Server Command Loop & Repositories             [✅ DONE]
   ├── 3.A  Command bus, EngineCtx, command handlers    [✅ Dev A — PRs #86, #87, #91, #92 merged]
   └── 3.B  Typed repositories & persistence layer      [✅ Dev B — PR #84 + PR #90 merged; the deferred tile/charter/hero/settlement repos all landed in Phase 4 via PR #93]
Phase 4  Database De-blobbing & Dual-Write              [✅ DONE]
   ├── 4.A  Dual-write integration & state hydration     [✅ Dev A — PR #95 merged]
   └── 4.B  SQL migrations & historical-game backfill    [✅ Dev B — PR #93 merged]
Phase 5  Client Event Sync & Scene Renderer Seam        [🟡 IN PROGRESS]
   ├── 5.A  Client command dispatcher & event-cursor sync [🟡 Dev A — commands.ts created + R4 closed; cursor sync/manualSave deletion still pending]
   └── 5.B  Scene graph builder & entity-mirror animation [🟡 Dev B — adventureScene/cityScene/entityMirror/battleScene done+tested; paint2d dispatcher shell + seam done; manualBattleArena decomp (CB-1 + CB-2 + CB-3 merged in PR #112 + #113 + #115 — orchestrator is now a thin shim and lives in arena/openManualBattleArena.ts; CB-4 🟡 in progress in branch phase5/track-b-combat-decomposition-cb4 — paint.ts wiring behind useSceneBuilder flag with drawLegacy fallback while battle-kind painters remain no-op stubs), paint2d per-kind transcription, renderer rewrite still ⬜]
```

Sync points between phases:
- **Sync 1 (Phase 3 → 4):** Track 3.A's `commandHandler.ts` and Track 3.B's repos both stable; `EngineEvent` discriminated union in `@heroes/contracts/events/`.
- **Sync 2 (Phase 4 → 5):** Normalized tables populated; `hydrateGameState` round-trip-equivalent to legacy JSONB; `event_seq` monotonic cursor available client-side. ✅ **fully met** (PR #95 merged — see §6.3).

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
- `StartCharter` / `AdvanceCharter` — was blocked on the `activeCharters` schema gap (no DB column existed). **Schema gap closed 2026-08-17 by Phase 4 Track B, PR #93** (`charters` table + `next_charter_id`/`next_settlement_id` counters); **read-side wired the same day by Track 4.A's `hydrate.ts` work** (committed `20704d4`, §6.1 — `GameState.activeCharters` now reads from the real table on the granular path). ✅ **`StartCharter` closed** (worktree `20260817_0528_charterPort`) — new command, new `CharterStarted` event, `commandHandler.ts` case allocates `charterId`/`settlementId` and calls `charterRepo.upsertMany`; also fixed the `next_charter_id`/`next_settlement_id` counter-persistence gap this port's audit found (see §10 R5). ✅ **`AdvanceCharter`'s countdown/founding closed** too, same worktree — `EndTurn`'s case now syncs `charterRepo` after `advanceRound()`'s `advanceCharters()` runs. 🚫 **Still deferred:** the hex-by-hex travel-stepping sub-piece (`stepTravelCharter()`) stays client-local only — see §10 R5 for why.
- `BuildStructure` — blocked on missing `@heroes/engine` validate+apply function (Stage 6 deferred item). 🚫
- Lobby claim / start — session/social layer, lowest priority; not game-rules. 🚫
- Human-initiated `MoveHero`/`TransferGold` server round-trip — pre-existing gap (only AI moves + EndTurn were wired client-side; surfaced in PR #91 description). ✅ **closed** (worktree `20260817_0211_phase5trackA`, Phase 5.A — see §10 R4).

### 5.2 Track 3.B — Persistence Repositories & Test Harness (Dev B) `[✅ DONE]`

*Status corrected 2026-08-17 (revision note 8): this header read `[🟡 PARTIAL]` long after every row in its own table had flipped to ✅. The "partial" referred to `heroRepo`/`settlementRepo`/`charterRepo`/`tileRepo` being deferred out of Phase 3 — all four landed in Phase 4 via PR #93 and exist in `server/persistence/repositories/` today (verified directly).*

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

### 6.1 Track 4.A — Dual-Write Integration & State Hydration (Dev A) `[✅ DONE — PR #95 merged]`

**2026-08-17 update:** every item below shipped in **PR #95** (`phase4/track-a-hydrate-dualwrite` → `main`, commits `20704d4`/`3aad7d3`/`4b4789e`), now merged (`2554711`). Design matches the deep-dive doc (granular-first read with per-game JSONB fallback in `hydrate.ts`; dual-write scoped to only the entities a command touched, same transaction as the existing JSONB write). PR #95 merged with 5 unaddressed Copilot review comments (posted after the merge went through); all 5 are fixed in worktree `20260817_0211_phase5trackA`: fallback logging rate-limited to once per game per process, the doomed-to-fall-back path no longer queries `charterRepo`, several comment blocks trimmed per AGENTS.md, and `hydrate.test.ts`'s global `console.info` patch replaced with `t.mock.method`.

| Item | Status |
| :--- | :--- |
| `server/persistence/hydrate.ts` (reconstructs `GameState` from `gameRepo` + `heroRepo` + `settlementRepo` + `charterRepo` + `tileRepo`) | ✅ merged (PR #95) — `hydrateFromRepos()` + a `hydrateGame()` convenience wrapper. Deliberately does **not** read `tileRepo`: tiles are map-generation-time data, never part of `GameState`. Post-merge fix (this worktree): only queries `charterRepo` on the granular path, not before the fallback check. |
| `commandHandler.ts` dual-write step (write to `games.state` JSONB AND normalized tables) | ✅ merged (PR #95) — `dualWriteEntities()` helper wired into all 10 currently-ported commands (MoveHero, TransferGold, EndTurn, TradeResources, ResolveBattle, RecruitHero, UpgradeTownHall, SetAutoTrade, ReorderStack, CaptureSettlement). Scoped via a reference-equality check against pre-command state (decides whether `heroRepo`/`settlementRepo` need calling at all) rather than a per-field diff — necessary because `upsertMany` is a full sync, so calling it with a filtered subset would wrongly delete untouched rows. |
| Read-path cutover with fallback: if granular rows missing, fall back to legacy JSONB; log a telemetry marker | ✅ merged (PR #95) — per-game fallback keyed on "**either** `heroes` or `settlements` granular table empty for this game" (OR, not AND — defensive against a hypothetically-partial dual-write, even though that shouldn't be reachable given both are upserted in the same DB transaction as the JSONB write). `console.info`-based `[hydrate]`-tagged telemetry marker fires on fallback, rate-limited to once per game per process (post-merge fix, this worktree). |
| Close `activeCharters` schema gap (introduce `charters` table; backfill from JSONB) | ✅ schema done in Track 4.B (PR #93); read-side wired in PR #95 — `hydrate.ts`'s granular path reads real rows via `charterRepo`. Write-side also now wired (worktree `20260817_0528_charterPort`, §5.1, §10 R5): `StartCharter`'s `commandHandler.ts` case calls `charterRepo.upsertMany` on creation, and `EndTurn`'s case calls it after every `advanceRound()` so charters founded via `advanceCharters()` sync too. |
| Close the pre-existing human-initiated `MoveHero`/`TransferGold` round-trip gap surfaced in PR #91 | ⬜ untouched by PR #95 itself (confirmed unrelated to and unaffected by the dual-write/read-cutover work) — ✅ **closed separately**, in Phase 5.A (worktree `20260817_0211_phase5trackA`); see §10 R4. |
| Round-trip equivalence tests: hydrate identical `GameState` from both paths | ✅ merged (PR #95), at two layers — `test/server/commandHandler.test.ts` (mocked repos) and `test/persistence/hydrate.test.ts` (real Postgres via `pgTestTx.withRollback`). Post-merge fix (this worktree): the fallback test's `console.info` capture now uses `t.mock.method` instead of a manual global monkey-patch. |

**Exit criteria:** commands persist to normalized tables; server hydrates byte-identical `GameState` from normalized tables as it did from JSONB. — **met, verified, and merged**: `npm run build`, `npm run lint:deps`, and `npm run test:all` (smoke + multiplayer + cityView + `test:unit` 76/76) all pass, including after this worktree's post-merge Copilot-comment fixes.

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

**Exit criteria:** migration runs idempotently; 100% of sampled historical games round-trip without loss — **met for Track B's scope.** The other half of Phase 4's overall exit criteria (this section's intro: "commands persist to normalized tables; server hydrates byte-identical `GameState`...") is Track 4.A's — ✅ also met (PR #95 merged, see §6.1). **Phase 4 is fully done.**

### 6.3 Sync Point 2 (Phase 4 → 5)

✅ **Fully met** (PR #95 merged): `hydrateGameState` round-trip-equivalent to legacy JSONB (✅ — see §6.1); monotonic event cursor available client-side (✅ — `game_events.id`, already `BIGSERIAL`, is the cursor per PR #93's `010_event_seq.sql`; no separate `event_seq` column was added); `charters` table exists (✅ PR #93).

---

## 7. Phase 5 — Client Event Sync & Scene Renderer Seam

**Goal:** Replace full-state client pushing (`POST /api/games/:id/save`) with command emission + event-cursor sync. Decouple canvas rendering from game state via pure scene builders.

### 7.1 Track 5.A — Client Command Dispatcher & Event-Cursor Sync (Dev A) `[🟡 IN PROGRESS]`

**2026-08-17 update (worktree `20260817_0211_phase5trackA`):** started after merging `main` (PR #95) in. Scoped deliberately: the client-command-relocation and R4-closing items below are done; the event-cursor sync rewrite is not, because it has two unresolved dependencies (see the ⬜ rows) that need their own decision before that work starts.

**Untracked touch:** PR #106 (`fix/issue-98-100-error-handling-and-feedback` — global error middleware, `NODE_ENV` handling, command-rejection toasts) also modified `src/io/commands.ts` and `src/game/turnHooks.ts`, both inside this track's owned surface, without being recorded here at the time.

| Item | Status |
| :--- | :--- |
| `src/io/commands.ts` (client command dispatcher) | 🟡 **partial.** Created — consolidates the command-POST functions (`endTurn`, `spendMovement`, `resolveBattle`, `transferGold`, `tradeResources`, `recruitHero`, `upgradeTownHall`, `setAutoTrade`, `reorderStack`, `captureSettlement`, `startCharter`) that used to live inline in `src/io/api.ts`, which now holds only plain REST calls. Does **not** replace `src/managers/GameActions.ts` — that file still does battle-flow/end-turn UI orchestration (`syncFromController`, `maybeAutoResolveBattle`, `startBattleFlow`, `handleEndTurn`), which is a separate concern from the raw command-POST relocation and was left untouched. `startCharter` added 2026-08-17 (worktree `20260817_0528_charterPort`) alongside the `StartCharter` command port itself (§5.1, §10 R5) — same fire-and-forget shape as the other Week-3+ actions, wired via a new `onStartCharter` `TurnControllerHooks` entry fired from `TurnController.startCharter()`. |
| `src/io/multiplayerSync.ts` polls `GET /api/games/:id/events?after=<seq>` OR receives SSE; applies events through `@heroes/engine` | ⬜ **not started.** The file already exists today, but as a full-state poller (`api.getGame()` → `hydrateGameState()`) predating this design — this item is a rewrite, not a from-scratch build. Deferred: `server/routes.ts`'s `GET /games/:name/events` has no `?after=<seq>` cursor filtering yet (returns every event), and the ownership matrix (§8) doesn't assign that server-side slice to a track. |
| `src/managers/GameSessionManager.ts` new/load lifecycle initializes event cursor | ⬜ **not started**, blocked on the multiplayerSync.ts rewrite above — `loadGame()` currently wires up the old full-state poller (`getMultiplayerSync().start()`) instead. |
| Delete full-state save push from `SessionManager.ts` | ⬜ **not started, deliberately deferred.** `SessionManager.manualSave()` still `PATCH`es full state (`hero_q/hero_r/turn/gold/enemy_positions`). Deferred alongside the two rows above (same "how does the client know state is persisted" concern), and because `test/smoke.ts` currently exercises the Save button + asserts the HUD "Last saved" text and the server row's `updated_at` advancing — removing this needs either a replacement persistence-confirmation mechanism or a deliberate test update, not just a deletion. |
| All client actions emit commands against `POST /commands` (close the pre-existing human-initiated MoveHero/TransferGold gap + ensure all 10 ports have client wiring) | ✅ **done.** Closed the R4 gap: added `onHumanMove` (fired from `TurnController.requestMove()`) and `onTransferGold` (fired from `TurnController.transferGold()`) to `TurnControllerHooks`, implemented in `src/game/turnHooks.ts` using the relocated `spendMovement`/`transferGold` command functions — mirrors the existing fire-and-forget pattern the other 6 Week-3+ actions already used. All 10 ported commands (EndTurn, MoveHero, ResolveBattle, TransferGold, TradeResources, RecruitHero, UpgradeTownHall, SetAutoTrade, ReorderStack, CaptureSettlement) now have client wiring for both AI- and human-initiated paths. Verified: `npm run build`, `npm run lint:deps`, `npm run test:all` all green. |

**Exit criteria:** client actions execute exclusively as commands (✅ met); multiplayer state syncs exclusively via delta events (⬜ not met — still full-state polling via `multiplayerSync.ts`).

#### Constraints before starting the cursor-sync rewrite (added 2026-08-17)

Decisions and gotchas that resolve the ⬜ rows' blockers. All file:line refs below verified against the tree at the time of writing.

1. **Cursor is `game_events.id` (BIGSERIAL). Do not add a new column.** §6.3 and PR #93's `010_event_seq.sql` explicitly chose this — `game_events.id` is already monotonic per game, and `game_events_game_id_idx` (`server/schema.sql:31`) plus the `id` primary key already back the query. Settled; not open for re-litigation.

2. **Polling, not SSE.** Neither was assigned, so this defaults to polling: the existing `GET /games/:name/events` route (`server/routes.ts:475`) only needs `?after=<id>` folded into its `WHERE` clause — no new infrastructure. SSE brings reconnect, replay, and buffering complexity the plan has not justified. If SSE is wanted, it gets its own design doc; it is not a Track 5.A implementation detail.

3. **The server-side `?after=<id>` slice is the actual blocker, and §8 assigns it to nobody.** `server/routes.ts:485` currently reads `... WHERE game_id = $1 ORDER BY id ASC` and needs `AND id > $2` filtering. Decide ownership before the `multiplayerSync.ts` rewrite starts — most likely Track 5.A absorbs it, since it is a one-line `WHERE` change, but confirm rather than assume.

4. **`eventRepo.append()` returns `void` today — this is the gotcha.** `server/persistence/repositories/eventRepo.ts:14` discards the inserted row. For the cursor to flow back to the client, the insert needs `RETURNING id` and `commandHandler.ts` must surface that id in the `POST /commands` response, so the client can advance its cursor after its own writes. Without it the client has no way to account for events it caused. This is the **first concrete sub-step** of the `multiplayerSync.ts` rewrite. Note the change spans three places, not one: the `EventRepo` interface (`eventRepo.ts:9`, declared `Promise<void>`), the implementation, and the `server/app/liveRepos.ts` placeholder its header comment points at.

5. **`SessionManager.manualSave()` is a separate decision — do not bundle it.** `test/smoke.ts` exercises the Save button (`:225`), asserts the HUD "Last saved" text (`:231`), and asserts `games.updated_at` advancing (`:238`). Removing the full-state push needs a replacement persistence-confirmation mechanism — probably deriving "saved" from a `POST /commands` 200, since the dual-write already shares the DB transaction (PR #95). Land the cursor sync first; take `manualSave()` in a follow-up PR.

**Bonus constraint:** §7.2's `entityMirror.ts` row notes that `StructureBuilt` is not an `EngineEvent` variant (plan-doc prose only, blocked on R6's `BuildStructure`) — confirmed by grep: zero occurrences across `packages/`, `src/`, `server/`. The new event-sync path must not assume it exists. Subscribe only to variants actually declared in `packages/contracts/src/events/engineEvent.ts`: `HeroMoved`, `GoldTransferred`, `TurnEnded`, `ResourcesTraded`, `BattleResolved`, `HeroRecruited`, `TownHallUpgradeStarted`, `AutoTradeToggled`, `StackReordered`, `SettlementCaptured`, `CharterStarted`.

### 7.2 Track 5.B — Scene Graph Builder & Entity Mirror (Dev B) `[🟡 IN PROGRESS]`

**2026-08-17 update (worktree `20260817_0335_phase5TrackB`):** the pure, inert half of this track is done and unit-tested; nothing below is wired into the live render path yet, so regression risk so far is zero. `SceneNode`'s actual shape (`src/render/scene/types.ts`) diverged from the Fable-era `{ spriteKey, facing, gridPos, ... }` sketch — it's a ~20-variant discriminated union keyed by `kind`, one variant per drawable thing, not one flat shape.

**2026-08-17 update (worktree `20260817_0542_battleSceneRewrite`):** added `battleScene.ts` (see revision note 5 and the table row below) — `SceneNode` is now a ~28-variant union.

| Item | Status |
| :--- | :--- |
| `src/render/scene/sceneBuilder/adventureScene.ts` (pure decomposition of `Renderer.draw()`) | ✅ done + unit-tested (`test/render/adventureScene.test.ts`, 11 tests). Takes today's `Hero[]`/`Castle[]`/`GameMap` wrapper inputs (`Renderer.draw()`'s real signature), not raw `GameState` — replacing that mirror is `entityMirror.ts`'s job. |
| `src/render/scene/sceneBuilder/cityScene.ts` (pure decomposition of `cityRenderer.ts`'s `drawCityView()`) | ✅ done + unit-tested (`test/render/cityScene.test.ts`, 6 tests). The skybox's image loading/caching/parallax-layer-splitting stays a `paint2d` concern (stateful asset loading, not scene data) — the `citySkybox` node only carries the resolved variant/parallax decision. |
| `src/render/scene/sceneBuilder/battleScene.ts` | ✅ done + unit-tested (`test/render/battleScene.test.ts`, 15 tests). Pure decomposition of `manualBattleArena.ts`'s `draw()`/`renderPixelFor()` into `BattleSceneInput -> SceneNode[]` — 8 new node kinds (`battleHex`, `battleAttackTargetRing`, `battleAiTelegraphHex`, `battleMovePath`, `battleImpactRing`, `battleAiActingRing`, `battleCombatant`, `battleFloatingText`), emitted in `draw()`'s exact paint order. Takes an explicit `nowMs` field to resolve moveAnim/impact/float animation progress without reading `performance.now()` internally, since (unlike `Hero`) `manualBattleArena.ts` has no ticked class already resolving that timing beforehand. Deliberately does not model the directional-melee hover latch (`pendingTarget`/`approachHexes`/`approachChoice`) or the `ATTACKER_ACCENT`/`DEFENDER_ACCENT`/`humanAccent` consts — verified via a full trace of `draw()`'s `ctx.*` calls that none of the five are actually read there (see revision note 5). |
| `src/render/scene/paint2d/` (Canvas2D painter reading `SceneNode[]`) | 🟡 **partial, dispatcher shell + dep seam only.** `paintScene(ctx, nodes, deps, frame?)` switches on every node kind and dispatches to a per-kind `paint<X>()` function — 28 stubs, all no-ops, the actual 1:1 Canvas transcription is Commits 3-10 of the design doc (not yet done). The headline design decision is the Vite-`?url` seam: `paint2d/` declares a `Paint2DDep` interface with four per-kind sprite-resolver helpers (`resolveSpriteForResource/Hero/Building/Castle`) plus a `SkyboxProvider` + state-getters + `colorForOwner`/`battleAccent`/`fontFamily`/`charterStyle`. The painter never names a key string, never reads `settings()` directly, never imports `assetDescriptors.ts`/`assets.ts`/`sprites.ts`/`cityRenderer.ts`/`cityBuildingDraw.ts` (barrel) — all Vite-coupled or with a cleanup lifecycle. The default-deps builder at `src/render/paint2dDefaults.ts` (forthcoming) and the skybox module at `src/render/skybox.ts` (forthcoming) are the *only* files in the project that touch those — they live outside `paint2d/`. Boundary enforced two ways: dependency-cruiser rule `paint2d-cannot-import-asset-descriptors` + `paint2d-cannot-value-import-state`, plus a runtime seam test (`test/render/paint2d.seam.test.ts`) that string-scans `paint2d/` source AND `import()`s the module under bare `node:test` — fails loudly the moment the boundary leaks. Unit-tested (`test/render/paint2d.test.ts`, 4 tests + seam test = 9 total). |
| `src/render/scene/entityMirror.ts` (subscribes to `HeroMoved`, `StructureBuilt` events; smooth tweening without rAF full-state re-polling) | 🟡 **partial, by necessity.** `HeroMoved` is implemented (tweens via the existing `Hero.startMoveToPath()`/`Hero.update()`) and `SettlementCaptured` (updates `ownerId`). `StructureBuilt` doesn't exist as an `EngineEvent` variant yet (confirmed via repo-wide grep — it's plan-doc prose only, blocked on `BuildStructure`, R6 §10) so it can't be implemented; every other real `EngineEvent` variant is a documented no-op for now (either the event doesn't carry enough data to reconstruct the entity, e.g. `HeroRecruited`, or wasn't needed yet — callers should `bootstrap()` from a fresh `GameState` to cover those). Unit-tested (`test/render/entityMirror.test.ts`, 7 tests). Still unwired anywhere live — depends on Track 5.A's event-cursor delivery, which doesn't exist client-side yet either (§7.1). |
| Decompose `src/screens/combat/manualBattleArena.ts` into modular components (4-step plan in `plan/2026-08-17-combat-decomposition-finishing-breakout.md`) | 🟡 **CB-1 + CB-2 + CB-3 merged (PR #112 + #113 + #115); CB-4 in progress** — `arena/{index,constants,layout,view,input,leaveBehind,state,ai,openManualBattleArena,paint}.ts` extracted (orchestrator now delegates from `arena/openManualBattleArena.ts`; `manualBattleArena.ts` shrunk from 1514 lines to a 16-line shim, `-1498` net); `test/screens/combat/arena.test.ts` (17 tests, Proxy-based DOM mock + paint tests) added. CB-4 adds `paint.ts` (`paintSceneForArena` + `buildArenaPaint2dDeps` + `readUseSceneBuilder`) wired into the orchestrator behind a `?paint=scenebuilder` URL flag; `drawLegacy()` fallback keeps the visual byte-identical until each battle-kind painter in `paint2d/` is transcribed (5.B P1 #5). |
| `src/render/renderer.ts` and `src/render/cityRenderer.ts` rewritten to consume `SceneNode[]` instead of state directly | ⬜ not started — deliberately last; the highest-risk step since it's the only one that touches the live render path. |

**Notable side-fix:** `computeCityScale` used to live in `cityRenderer.ts`, which has module-scope Vite-only `?url` PNG imports — so nothing could import it (or anything from the `cityBuildingDraw.ts` barrel, which pulls in `assetDescriptors.ts`'s PNG imports the same way) from a plain `node:test` context. Relocated its implementation to `src/core/cityGrid.ts` (zero asset deps); `cityRenderer.ts` now imports + re-exports it, so its two existing call sites (`buildingPlacer.ts`, `cityView.ts`) are unaffected (confirmed via the `cityview` browser suite in `test:all`). This predicted pitfall did **not** end up hitting `battleScene.ts` or `arena/`: `manualBattleArena.ts` imports nothing from `src/render/` at all today, so neither builder needed a barrel workaround. The pitfall is still real for whoever builds `paint2d/` next, though — that module *will* need the asset-loading pipeline it's meant to paint through. (2026-08-17 update: confirmed the same for `src/screens/combat/arena/` extracted in PR #112.)

**Exit criteria:** canvas rendering runs from immutable `SceneNode[]` lists; hero movement animations interpolate smoothly driven by event subscriptions. — not yet met; no `SceneNode[]` output is consumed by the live renderer yet.

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
| R4 | Human-initiated `MoveHero`/`TransferGold` have no server round-trip | P3/4/5 | ✅ **Closed** (worktree `20260817_0211_phase5trackA`, Phase 5.A). Pre-existing gap, surfaced in PR #91, independently reproduced live 2026-08-17 during Track 4.A manual testing (symptom: hero snaps back to its last-persisted position on every `EndTurn`, traced to `src/state/turnController.ts`'s `requestMove()` never calling the server for human moves). Confirmed unrelated to and unaffected by Track 4.A's dual-write/read-cutover work. Fixed by adding `onHumanMove`/`onTransferGold` hooks to `TurnControllerHooks` (`src/state/turnController.ts`, `src/game/turnHooks.ts`) — not via a `GameActions.ts` replacement as originally sketched in §7.1/§8; that file's battle-flow/end-turn orchestration role turned out to be a separate concern from the raw command-POST relocation. |
| R5 | `activeCharters` schema gap | P4 | ✅ **Schema closed 2026-08-17 (PR #93):** `charters` table + `next_charter_id`/`next_settlement_id` counters exist and are migration-backfill-covered. Read-side wired PR #95 (`hydrate.ts` populates `activeCharters` from the real table). ✅ **Write-side closed 2026-08-17 (worktree `20260817_0528_charterPort`):** `StartCharter` ported end-to-end (new command + `CharterStarted` event + `commandHandler.ts` case, which reconstructs a `GameMap` from `row.seed`/`row.map_size` — verified equivalent to the client's `GameMap.fromTiles()` path in `test/server/gameMapReconstruction.test.ts` — and allocates `charterId`/`settlementId` from server-side counters); `EndTurn`'s case now also syncs `charterRepo` after `advanceRound()`, so `advanceCharters()`'s days-remaining countdown + settlement founding ("AdvanceCharter") is fully server-authoritative too. Found and fixed a real counter-persistence bug along the way: `next_charter_id`/`next_settlement_id` were added to the schema by PR #93 but never actually read (`GAME_COLUMNS`) or written (`saveHeroesAndSettlements`'s extra param) anywhere — a second `StartCharter` in the same game would have collided ids with the first; regression-tested. **Explicitly still deferred, scoped out of this port:** the hex-by-hex travel *stepping* a "traveling"-phase charter's hero does toward its target (`stepTravelCharter()`) has no server equivalent — it's still purely `TurnController.advanceAutoTravel()`'s client-local loop. Making that server-authoritative needs its own command + hook (fired once per hex-step, the way `onHumanMove` is), which is a materially bigger change than this port attempted. Also closed in the same worktree: `ResolveBattle`'s case now calls `cleanupDefeatedHeroCharters()` when the defender loses all troops, so a chartering hero killed in a server-resolved battle no longer leaves an orphaned charter row (mirrors `turnController.ts`'s own `resolveCurrentBattle()` check). |
| R6 | `BuildStructure` blocked on missing engine validate+apply | ∞ | Stage 6 prerequisite. Track whenever next engine module is added. |
| R7 | Multi-DB portability (Oracle/MySQL) parked | ∞ | Per multi-DB `.fable.md` appendix decision; revisit when a second DB vendor container actually exists. |
| R8 | Lobby claim/start never ported to commands | P3 (skipped) | Session/social layer, not game-rules; Decision 1.C keeps reads/CRUD as plain REST. |

---

## 11. Open PRs Awaiting Merge (as of 2026-08-17)

**Currently open:** 🟡 **#111** (`chore/p0-onboarding-and-doc-fixes`) — the P0 batch from #110's audit: `docker/Dockerfile` workspace-COPY fix (the image build was broken on every attempt since the `shared/` → `packages/engine` rename), `engines` pin + guarded Playwright `postinstall`, README prerequisites, and this doc's own bookkeeping fixes (revision-note renumbering, the §11 refresh below, PR #106's untracked touch in §7.1, and the §5.2/§1 status-symbol corrections). No app-code changes.

**Merged.** Merge order on 2026-08-17 (all EDT): **#92** (01:21, Phase 3 Track A — `#89` closure) → **#91** (01:30, Phase 3 Track A Week 3 ports) → **#93** (01:53, Phase 4 Track B — granular entity tables/repos/backfill) → **#94** (01:58, docs-only sync of this file; its branch was cut before #93 merged, so it missed #93 — corrected in a later revision) → **#95** (02:53, Phase 4 Track A — `hydrate.ts` + `commandHandler.ts` dual-write step; see §6.1). **Phase 4 is now fully done.** Continuing since Phase 5 work started: **#96** → **#104** (06:39, Track 5.B — `battleScene.ts`, revision note 5) → **#105** (06:54, Track 3.A — `StartCharter` port, revision note 7) → **#106** (fix/issue-98-100 — global error middleware + command-rejection toasts; touches Track 5.A's surface, see §7.1) → **#107** (Copilot review follow-up on #105) → **#108** (12:24, Track 5.B — `paint2d/` dispatcher shell + Vite-`?url` seam, revision note 6) → **#109** (doc-only stale-status refresh; despite reusing the `phase5/track-b-battlescene-renderer-rewrite` branch name from #104, this PR does **not** touch `renderer.ts` — don't misread the branch name as a second renderer-rewrite pass) → **#110** (22:21, doc-only — the track-map audit + live-verification findings that this revision acts on).

---

## 12. What's Next (Immediate)

1. ~~**Phase 4.A review & merge**~~ — done; PR #95 merged (§6.1, §11). The still-open #89 follow-up (unit-level regression assertions in `commandHandler.test.ts`) has **not** been absorbed by this branch — still a separate follow-up.
2. ~~**`StartCharter`/`AdvanceCharter` command ports**~~ — done (worktree `20260817_0528_charterPort`, §5.1, §10 R5): `StartCharter` fully ported (new command/event/`commandHandler.ts` case + the counter-persistence fix it needed first); `AdvanceCharter`'s countdown/founding lifecycle is server-authoritative via `EndTurn`'s new `charterRepo` sync. Remaining, deliberately deferred: making charter *travel-stepping* (`stepTravelCharter()`) server-authoritative needs its own command + hook, a separate, larger piece of work.
3. **Phase 5.A continuation** — `src/io/commands.ts` exists and R4 is closed (§7.1). Remaining: decide who owns adding `?after=<seq>` cursor support to the events endpoint (or an SSE alternative) — not currently assigned in the ownership matrix (§8) — then rewrite `multiplayerSync.ts` against it, wire `GameSessionManager.ts`'s cursor init, and either replace or deliberately retire `SessionManager.manualSave()`'s full-state push (currently still exercised by `test/smoke.ts`'s Save-button assertion).
4. **Phase 5.B continuation** — `adventureScene.ts`, `cityScene.ts`, `entityMirror.ts`, `battleScene.ts`, and `paint2d/` (dispatcher shell + dep seam) are done and unit-tested (§7.2); the `manualBattleArena.ts` decomposition has CB-1 + CB-2 + CB-3 merged (PRs #112, #113, #115) and CB-4 in progress in branch `phase5/track-b-combat-decomposition-cb4` (`arena/paint.ts` + `useSceneBuilder` flag + `drawLegacy()` fallback; 5 new tests, total 17 in `test/screens/combat/arena.test.ts`). Remaining, roughly in ascending risk order: `paint2d/` per-kind Canvas transcription (the 28 stubs → real Canvas calls, Commits 3-10 of the design doc) plus `src/render/paint2dDefaults.ts` and `src/render/skybox.ts` (Commit 2, which is the only file allowed to touch the Vite-coupled assets); then flipping CB-4's `useSceneBuilder` default from false to true once `paint2d/` transcription is complete (currently the `drawLegacy()` fallback handles every battle-kind node); and finally rewriring `renderer.ts`/`cityRenderer.ts` to actually consume `SceneNode[]` (deliberately last — the only step touching the live render path).

---

*This map supersedes ad-hoc reading of `2026-08-15-parallel-dev-split.md`, `2026-08-16-parallel-dev-phases-3-5.md`, `2026-08-16-phase-3-parallel-dev-plan.md`, and `2026-08-17-phase-4-db-deblobbing-dev-plan.md` for status/ownership purposes. The source plans remain authoritative for design rationale; this doc tracks what is done vs not.*