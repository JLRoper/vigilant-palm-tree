# heroes-js — SRP Module Reorganization (Target Architecture)

*Authored 2026-08-11. Supersedes the layering discussion in `plan/2026-08-09-architecture-module-expansion-plan.md` §3-4 where they conflict. Companion to `.kilo/plans/1786339629694-circular-dependency-cleanup.md` (which remains the correct first mechanical step).*

**Design brief from the owner:**
- Many small SRP classes/modules; the current 1000+ line files are the disease.
- Turn-based forever — lean on it (determinism, command/event model, no realtime tick pressure).
- Games range from 10-minute skirmishes to months-long campaigns (persistence and resumability are first-class).
- CRUD-style persistence: many small tables loosely coupled by IDs, with room for semi-unstructured/customizable fields.
- Owner is an event-driven-systems engineer; the architecture should speak that language natively.
- Near future: 4-direction rotatable pixel art (.png/.svg), rotatable city view, more castle level sizes. Far future: possible clean 3D models. Renderer must be a swappable seam.

---

## 1. Diagnosis — what SRP violation actually looks like here

| File | Lines | Responsibilities crammed in |
|---|---|---|
| `src/views/manualBattleArena.ts` | 1562 | grid canvas painting, unit tiles, action bar, retreat/surrender modals, AI turn driving, animation, layout |
| `src/state/gameState.ts` | 1290 | 6 core types, 30+ reducers across turn/trade/build/hero/charter/combat domains, constants, calendar math |
| `server/routes.ts` | 1094 | 17 endpoints, raw SQL, lobby logic, end-turn pipeline, battle resolution, validation, event logging |
| `src/views/toolbar.ts` | 703 | every toolbar button + its modal wiring |
| `src/game/initState.ts` | 359 | map gen orchestration + castle placement + hero seeding + economy defaults + hydration |

Two systemic causes:

1. **Domain concepts have no home of their own.** "Hero", "Settlement", "Charter", "Economy" each live as slices *inside* `gameState.ts`, so every feature edits the same file.
2. **The transport shape leaked into the domain.** The `games` table's JSONB blobs mirror the client's in-memory `GameState`, so the server can't reason about a hero without deserializing the world.

The existing event bus (`core/eventBus.ts`, 14 event kinds, 2 subscribers) and `game_events` table (append-only, written on every action, never replayed) are the unused foundations of the fix.

---

## 2. Target shape — four packages in one monorepo

Not separate repos. Separate **npm workspaces** in this repo — independent `package.json`, enforced boundaries (a package physically cannot deep-import another's internals), one `git clone`, atomic cross-package PRs.

```
heroes-js/
  package.json                  # workspaces root
  packages/
    contracts/                  # @heroes/contracts — the wire. Zero dependencies.
    engine/                     # @heroes/engine — pure rules. Depends on contracts only.
    client/                     # @heroes/client — Vite browser app. Depends on engine + contracts.
    server/                     # @heroes/server — Express + pg. Depends on engine + contracts.
  tools/
    art-pipeline/               # sprite manifest gen, validation, preview (exists as tools/sprites)
  docs/ plan/ test/             # cross-cutting; test/ gains per-package suites over time
```

**Dependency law (dependency-cruiser enforced, one rule per edge):**

```
contracts  ←  engine  ←  client
                      ←  server
```

`contracts` and `engine` never import from client, server, DOM, Canvas, or `pg`. This is the "shared/ is the leaf" rule from the cleanup plan, promoted to a physical package boundary so it can't erode.

### 2.1 `@heroes/contracts` — types and vocabulary only

One concept per file, no logic:

```
contracts/
  ids.ts              # GameId, HeroId, SettlementId, PlayerSeat, CharterId — branded string/number types
  resources.ts        # ResourceType, Warehouse, WAREHOUSE_RESOURCES
  geometry.ts         # Axial, Facing ("N"|"E"|"S"|"W"), MapSize
  commands/           # one file per command (see §3)
    moveHero.ts, endTurn.ts, buildStructure.ts, tradeResources.ts, ...
  events/             # one file per event (see §3)
    heroMoved.ts, turnEnded.ts, structureBuilt.ts, ...
  dto/                # HTTP request/response shapes, one file per endpoint
  catalog/            # shapes of data-driven content rows (BuildingDefRow, CastleLevelRow, UnitTypeRow)
```

### 2.2 `@heroes/engine` — deterministic rules, organized by domain

The replacement for `gameState.ts`. Each domain owns its state slice, its commands, and its events:

```
engine/
  state/
    gameState.ts        # the composed GameState interface ONLY (~60 lines, just the shape)
    calendar.ts         # round/day/month math
  hero/
    types.ts            # HeroState
    move.ts             # validate + apply for MoveHero        (~80 lines)
    recruit.ts
    stacks.ts           # platoon reorder/normalize
  settlement/
    types.ts            # SettlementState
    capture.ts
    buildStructure.ts
    upgradeTownHall.ts
    upgradeSettlement.ts
  economy/
    income.ts           # (exists as src/economy/income.ts — moves here)
    consumption.ts
    morale.ts
    trade.ts            # tradeResources + runAutoTrade
    transfer.ts         # hero<->settlement gold
  charter/
    start.ts, travel.ts, advance.ts, cleanup.ts
  turn/
    endTurn.ts          # the pipeline: sequences economy/*, charter/advance, settlement upgrades
    phases.ts           # GamePhase transitions
  combat/               # shared/combat/* moves here unchanged (already well-factored)
    grid.ts, damage.ts, resolveBattle.ts, manualBattle.ts, ai.ts (extracted from arena view)
  map/
    gameMap.ts, terrain.ts, resourceTiles.ts, pathfinding.ts, castlePlacement.ts
  init/
    newGame.ts          # today's makeInitialStatePayload, split: castles / heroes / players seeding
  catalog/
    buildingCatalog.ts  # lookup over BuildingDefRow[] (replaces hard-coded buildingRegistry union)
    castleLevels.ts     # lookup over CastleLevelRow[] (unlocks "more castle sizes" as data)
  rng.ts, hex.ts
  validation/
    gameIntegrity.ts    # exists in shared/validation
```

**File rule: one command or one query per file, target < 200 lines.** A command file exports exactly two functions:

```ts
export function validate(state: GameState, cmd: MoveHero, ctx: EngineCtx): Violation[];
export function apply(state: GameState, cmd: MoveHero, ctx: EngineCtx): { state: GameState; events: GameEvent[] };
```

`EngineCtx` carries the injected non-determinism: `{ rng, catalog }`. Nothing in engine/ touches Date.now, Math.random, fetch, or storage.

### 2.3 `@heroes/server` — thin HTTP over command handlers over repositories

The replacement for `routes.ts`:

```
server/
  http/
    routes/              # one file per endpoint, ~30 lines each: parse DTO → call handler → serialize
      createGame.ts, getGame.ts, postCommand.ts, getEvents.ts, lobby/*.ts, auth/*.ts, assets/*.ts
  app/
    commandHandler.ts    # THE core loop: load state (repos) → engine.validate → engine.apply
                         #   → persist deltas + append events, one transaction  (~100 lines)
    turnService.ts       # end-turn orchestration (weekly upkeep day%7, round advance)
    lobbyService.ts
  persistence/
    repositories/        # one repo per table, plain CRUD, one file each
      gameRepo.ts, heroRepo.ts, settlementRepo.ts, buildingRepo.ts, platoonRepo.ts,
      charterRepo.ts, tileRepo.ts, eventRepo.ts, unitTypeRepo.ts, buildingDefRepo.ts, ...
    db.ts, migrations/
```

**The command loop is the whole trick.** Today `POST /end-turn` receives the *entire client GameState* and re-runs the math "drift-safely." In the target, the client sends *commands* (`{ kind: "EndTurn", seat: 0 }`); the server is authoritative; both sides run the identical `@heroes/engine` code so client prediction is free. The 409-on-mismatch behavior you have today becomes structural.

### 2.4 `@heroes/client` — screens, scene building, painting

```
client/
  boot/                  # main.ts, GameEngine composition root (managers/ shrink into this)
  session/               # SessionManager, GameSessionManager, multiplayerSync (event-cursor polling, §5)
  screens/               # views/ split by screen — each screen a folder of small components
    home/  adventure/  city/  combat/  heroes/  multiplayer/  shared/
  scene/                 # NEW — the renderer seam (§6)
    sceneBuilder/        # pure: GameState → SceneNode[] (adventureScene.ts, cityScene.ts, battleScene.ts)
    paint2d/             # Canvas2D painter for SceneNode[] (today's render/ drawing code)
    camera.ts
  sprites/
    manifest.ts          # sprite key resolution: {set}.{entity}.{variant}.{level}.{facing}
    assets.ts, assetApi.ts
  settings/, debug/, data/
```

Splitting example — `manualBattleArena.ts` (1562 lines) becomes `screens/combat/`:
`arenaScreen.ts` (mount/lifecycle), `gridCanvas.ts`, `platoonTile.ts`, `actionBar.ts`, `retreatModal.ts`, `surrenderModal.ts`, `banner.ts` — and its embedded AI heuristic moves to `engine/combat/ai.ts` where the server can use it too.

---

## 3. The turn-based backbone: Command → Events → State

This is where your event-driven background pays off, and it's the natural fit for turn-based:

```
player intent            engine (pure)                    persistence           consumers
─────────────  ────────────────────────────────  ─────────────────────  ─────────────────────
Command  ───►  validate(state, cmd) → Violation[]
               apply(state, cmd) ───────────────►  UPDATE small tables    client scene rebuild
                        │                          INSERT game_events     other players (poll/WS)
                        └──► GameEvent[] ────────►   (same transaction)   replay / debugging
```

- **Commands** are the only way state changes. One TypeScript type per file in `contracts/commands/`. The turn structure gives you a free total order: commands are sequenced per game, no concurrency resolution needed beyond "is it your turn" + optimistic version check on the `games` row.
- **Events** are facts, persisted to `game_events` with a per-game monotonic `seq`. Your existing table is 90% there — it just needs `seq` and to become *load-bearing*:
  - **Multiplayer sync** stops re-fetching the whole game row every 2s; it polls `GET /games/:id/events?after=seq` and applies events locally (and this endpoint is exactly what the dormant WS_PORT will push over later — same contract, different transport).
  - **Replay/observability** falls out for free (months-long games justify this — "what happened while I was away" is an event query).
  - **The event bus** finally gets real subscribers: the scene layer subscribes to events for dirty-region redraws instead of GameEngine's current "state:committed → rebuild everything".
- **State tables remain the source of truth** (your CRUD preference — this is *not* event sourcing; events are a durable log and sync mechanism, state is authoritative). You never rebuild state from events except in a debugging tool.

---

## 4. Database — many small tables, ID-coupled, `props` for the unstructured tail

Replaces the JSONB-blob columns on `games`. One table per concept; every entity table gets a `props JSONB NOT NULL DEFAULT '{}'` column as the escape hatch for customizable/experimental fields — promote a prop to a real column when it stabilizes.

```sql
-- game shell
games              (id, name, seed, map_size, round, day, active_seat, phase, status, version, props)
game_players       (game_id, seat, user_id NULL, faction, color, name, props)          -- PK (game_id, seat)

-- entities
heroes             (id, game_id, owner_seat, name, q, r, movement_remaining, gold,
                    horse_variant, chartering_charter_id NULL, props)
hero_platoons      (hero_id, slot, entries JSONB, PRIMARY KEY (hero_id, slot))          -- entries stays semi-structured: it's a value object
settlements        (id, game_id, owner_seat NULL, name, q, r, level, population, gold_tax,
                    gold, morale, auto_trade, founded_on_resource NULL, castle_variant, props)
settlement_resources (settlement_id, resource, amount, PRIMARY KEY (settlement_id, resource))
settlement_buildings (id, settlement_id, gx, gy, def_id, level, style, facing SMALLINT DEFAULT 0, props)
settlement_spots   (settlement_id, gx, gy, resource, vein)
settlement_mines   (settlement_id, gx, gy, resource, level)
charters           (id, game_id, hero_id, target_q, target_r, phase, days_remaining, props)

-- world + log (already exist, keep)
tiles              (game_id, q, r, terrain, resource)
game_events        (id, game_id, seq, actor_seat, kind, payload JSONB, created_at)      -- add seq + actor_seat
settlement_snapshots, resource_transactions                                             -- keep as-is

-- data-driven content catalogs (this is how "more castle levels" becomes a data change)
unit_types         (exists)
building_defs      (id, kind, label, footprint_w, footprint_h, max_level,
                    per_level JSONB,        -- [{cost:{...}, effects:{...}, populationGate}, ...]
                    props)
castle_levels      (level, label, city_grid_size, build_slots, upgrade_cost JSONB, requirements JSONB, props)
sprite_sets        (id, label, notes)       -- pixel-art style packs (§6)
sprites            (set_id, key, facing, mime, data BYTEA / url, props)
```

Notes for a non-DB-engineer, from your stated preferences:
- **Loose coupling by ID, no cross-game FKs beyond `game_id`** — deleting a game cascades; nothing else entangles.
- **`hero_platoons.entries` stays JSONB deliberately**: a platoon's entries are a value object always read/written whole; rows-per-entry would be normalization theater.
- **The `version` column on `games`** gives optimistic concurrency for the command loop (`WHERE version = $expected` on update; retry on miss). With turn order enforced, conflicts are rare — this is a cheap safety net, not a locking scheme.
- **Catalogs in tables, not TypeScript unions**: today `BuildingKind` is a hard-coded 13-string union and `buildingRegistry.ts` is 289 lines of constants. As rows, adding castle level 4 or a new building is an INSERT + sprites, no engine release. The engine consumes catalogs through `EngineCtx.catalog`, so it stays pure.

---

## 5. Sync model for 10-minute and months-long games

Same mechanism serves both:

1. Client sends a Command; server validates/applies/persists; response includes the new events.
2. Other clients poll `GET /games/:id/events?after=<lastSeq>` (today's 2s poll, but delta-sized instead of whole-row). Applying events through the engine keeps them in lockstep.
3. Rejoining a months-old game: `GET /games/:id` hydrates from the small tables (fast, indexed), then event-polls from the current seq. No blob parsing.
4. When WS lands (port already reserved), the server pushes the exact same event frames; polling remains the fallback. Zero contract change.

---

## 6. Rendering seam — pixel art with facings now, 3D later

The core move: **split "what to draw" from "how to draw it."**

```
GameState ──► sceneBuilder (pure) ──► SceneNode[] ──► paint2d (Canvas2D)   ← today
                                              └────► paint3d (WebGL/three) ← far future, additive
```

A `SceneNode` is plain data: `{ spriteKey, facing, gridPos | worldPos, elevation?, tint?, z }`. Scene builders live beside the engine's mental model (they read GameState + camera); painters know nothing about the game.

**Facing model (the rotation requirement):**
- `Facing = "N" | "E" | "S" | "W"` on every placeable (already in the `settlement_buildings.facing` column above).
- Sprite manifest key: `{setId}.{entity}.{variant}.{level}.{facing}`, e.g. `classic.townHall.1.2.E`. Missing facings fall back to `S` (draw-one-direction is a valid art budget).
- **City view rotation is then trivial math, not an art problem:** rotating the camera by 90° remaps rendered facing as `(facing + cameraTurns) % 4` and transforms grid coords. The scene builder does this; painters never know.
- SVG sources fit this: one master SVG per building per facing (or a parametric template), rasterized to PNG at build time by `tools/art-pipeline` into the manifest. When you later pay for an AI art model that outputs 4 cardinal views, it slots into the same manifest with zero code changes — that's the point of keying by facing now.
- **Sprite sets as data** (`sprite_sets` table): you haven't picked a pixel style yet — make the style a per-game or per-user setting over the same keys, so trying styles is content-swapping, not refactoring. (The existing `buildingStyles.ts` registry is this idea, hard-coded; it becomes rows.)
- 3D later: `paint3d` consumes the same SceneNode[]; facing becomes a Y-rotation; nothing upstream changes.

---

## 7. Migration path — strangler, always green

Do **not** big-bang this. Order chosen so every step ships alone:

| Phase | What | Why first |
|---|---|---|
| 0 | ✅ **DONE** (commit `526398e` on `architecture/circular-dep-cleanup`) — executed the cleanup plan (`.kilo/plans/1786339629694-...`) incl. dependency-cruiser (`dependency-cruiser.cjs`, `npm run lint:deps`, wired into precommit gate). Remaining: merge the branch to `main` | Makes shared/ a true leaf — it becomes `engine/` + `contracts/` seed material |
| 1 | ✅ **DONE** — root npm workspaces (`packages/*`); `shared/` moved to `packages/engine` (only the `shared/gameState.ts` re-export shim remains as a stepping-stone); `packages/contracts` extracted (`ids.ts`, `geometry.ts`, `resources.ts`, `units.ts`, `buildings.ts`, `castle.ts`, `settlement.ts`, `gameState.ts`) | Physical boundary before anything else grows |
| 2 | 🔶 **IN PROGRESS** — carving `gameState.ts` into engine domains **one domain at a time** (economy → charter → settlement → hero → turn); `gameState.ts` shrinks to re-exports until empty. Done: `economy/*`, `charter/*` (PR #72, commit `f6ce118`), `settlement/*` (PR #74, commit `a0a638a`), `hero/*` (PR #75, commit `cd494b3`). Next: `turn/endTurn.ts` (starting now) — the last Phase 2 domain | Highest-traffic file; every future feature benefits immediately |
| 3 | ⬜ Server: introduce `commandHandler.ts` + repos; port endpoints one at a time onto commands (start with `spend_movement` — it's already action-shaped); `routes.ts` shrinks per endpoint | De-risks the DB migration by putting repos in place first |
| 4 | ⬜ DB: migrations to small tables, dual-write JSONB + tables for one release, then flip reads, then drop blobs | Months-long live games must survive the migration |
| 5 | 🔶 **IN PROGRESS** — Event `seq` + cursor polling (Track 5.A) and scene builder/painter split (Track 5.B) in client; screens split as touched (§4.4 rule: a view moves when it next gets a non-trivial edit) — note: the mechanical `views/` → `screens/` folder move already landed (Decision 3.C, runs `add78d5` + `ba9f359` on 2026-08-16 per `plan/2026-08-15-parallel-dev-split.md`). **Track 5.B scene-graph work landed**: `src/render/scene/sceneBuilder/adventureScene.ts`, `cityScene.ts`, `battleScene.ts` + `entityMirror.ts` + `types.ts` are in (PRs #101, #104 — additive/unwired, zero regression risk so far). **Still ⬜ in Phase 5**: `paint2d/` dispatcher shell + Canvas2D painter (PR #108 open), `manualBattleArena.ts` decomposition (as-touched rule), the `renderer.ts` / `cityRenderer.ts` rewrite to consume `SceneNode[]`, and the Track 5.A event-cursor polling + manual-save deletion. See `plan/2026-08-17-consolidated-phase-1-5-track-map.md` for the live status. | Sync + render seams, independently shippable |
| 6 | ⬜ Catalog tables (`building_defs`, `castle_levels`, `sprite_sets`) + facing column consumed by city view | Unlocks castle sizes + rotation as content work |

Rules that keep it honest (add to AGENTS.md when adopted):
- New code lands in its target package/domain from day one. No new function enters a >300-line file.
- dependency-cruiser gates every phase; each phase adds its edges to the ruleset.
- A domain migration PR moves files AND their tests; `test/` grows mirrors of the engine domains.

---

## 8. Explicitly considered and rejected

- **Separate repos per package** — versioning/PR overhead with zero isolation benefit at one-team scale; workspaces give the same boundary enforcement.
- **Full event sourcing (state rebuilt from events)** — seductive for an event-driven engineer, wrong for this stage: months-long games would accumulate huge replay chains, snapshotting becomes mandatory infrastructure, and CRUD tables already satisfy the query patterns. Events as durable log + sync transport captures 80% of the value at 20% of the cost. Revisit only if replay-as-a-feature becomes a product goal.
- **One row per platoon entry** — normalization past the point of usefulness; entries are value objects.
- **ECS (entity-component-system)** — fits realtime sims with many homogeneous entities; a turn-based game with ~5 heroes and ~10 settlements per player gets nothing from it but indirection.
- **Keeping client-authoritative state with server re-verification** (status quo) — it's the root cause of "send the whole GameState on end-turn" and blocks trustworthy multiplayer.

## 9. Open decisions (owner input wanted)

Each decision below lists options A/B/C with pros, cons, and the situations where each wins. Pick a letter (or a mix where noted) per decision.

### Decision 1 — Command transport granularity

**A. Single generic endpoint: `POST /games/:id/commands`** *(recommended)*

- Pros:
  - One route file, one auth/turn-order/version check, one transaction wrapper — the command loop in §2.3 exists exactly once.
  - Adding a command = add a contracts file + engine file. Zero HTTP-layer work.
  - Matches the event-driven mental model: the endpoint is a command bus.
  - Trivially becomes the WS message frame later — same envelope, different transport.
- Cons:
  - Not conventionally REST; generic 400s unless validation errors carry the command kind.
  - One fat discriminated-union parser instead of per-route DTO parsing.
  - Rate-limiting/logging per command kind needs a `kind` dimension, not a URL path.
- Best when: commands multiply steadily (they will — every feature adds 1-3) and one team owns both sides of the wire. That's this project.

**B. One route per command: `POST /games/:id/move-hero`, `/games/:id/end-turn`, ...**

- Pros:
  - Conventional REST/CRUD; discoverable in any HTTP tool; per-route middleware (rate limits, caching headers) is native Express.
  - Per-command DTO validation is small and local; 404/405 semantics free.
  - Matches your stated CRUD comfort.
- Cons:
  - N routes × (auth + turn check + version check + transaction) — the shared loop gets copy-pasted or wrapped anyway, at which point you've built A with more files.
  - Each new command touches contracts + engine + a new route + route registration.
- Best when: external/third-party API consumers need a self-describing surface, or different commands genuinely need different middleware stacks (public vs authed, different rate tiers).

**C. Hybrid: generic command bus + REST routes for reads and non-game CRUD**

- Pros:
  - Commands (writes) flow through one bus (A's benefits); queries (`GET /games/:id`, `/events`, `/units`, lobby, auth, assets) stay plain REST where CRUD semantics are natural.
  - Read caching / ETags stay idiomatic on the GET side.
- Cons:
  - Two idioms in one server — contributors must know which side a thing belongs on (rule of thumb is easy though: mutates game state → command; else → REST).
- Best when: you want A's write path without giving up conventional reads. Realistically A drifts into C anyway, since reads were never going to be commands.

**Verdict to pick from: A, B, or C.** Plan's recommendation: **C** (it's A for writes, stated honestly — the plan's §2.3 already assumes reads stay REST).

### Decision 2 — Client prediction vs server ack

**A. Await server ack per command** *(recommended as the starting point)*

- Pros:
  - Dead simple: send command → receive events → apply → repaint. No rollback machinery, no divergence bugs.
  - Server authority is absolute from day one; client engine is used for validation UX only (graying out illegal moves).
  - LAN/localhost dev (~5-20ms) makes latency invisible during development.
- Cons:
  - Every action costs a round trip (~50-150ms WAN). Rapid sequences — moving a hero 8 tiles tile-by-tile — feel sluggish if implemented as 8 commands.
  - Feel depends on network quality; months-long async players won't care, but a 10-minute skirmish player might.
- Best when: correctness first, polish later; team size of one; turn-based cadence (it is).

**B. Optimistic prediction with rollback**

- Pros:
  - Zero perceived latency — apply locally, reconcile on ack. Best possible feel.
  - Both sides already run identical engine code in this architecture, so prediction is *mostly* free — mispredictions only from stale state (out-of-turn races) or server-side RNG.
- Cons:
  - Needs rollback: keep pre-command snapshot(s), on rejection restore + replay. State snapshots exist (`structuredClone` of GameState) but animation/UI state must survive a rollback gracefully — that's the actual hard part.
  - RNG-dependent outcomes (combat) can't be predicted without sharing the seed pre-command, which leaks information in multiplayer.
- Best when: real-time feel matters commercially, or WAN multiplayer with fast players becomes the norm.

**C. Ack-first with batched/composite commands for the hot paths**

- Pros:
  - Keeps A's simplicity but kills its worst case: `MoveHero` takes a full path (already how `spend_movement` works today — one request per multi-tile move), `EndTurn` is one command. The 8-round-trip problem never exists.
  - Animation plays *while* the request is in flight (start the walk animation optimistically, only the *state* waits for ack) — perceived latency ≈ 0 for the common case without rollback machinery, because animation is cosmetic and the server rarely rejects a client-validated move.
- Cons:
  - Command design must think in user gestures, not micro-steps (arguably a pro — coarser commands = fewer events = smaller log).
  - The "cosmetic optimism" trick needs a defined failure UX for the rare rejection (snap hero back).
- Best when: turn-based games exactly like this one — which is why it's what the current codebase already half-does.

**Verdict to pick from: A, B, or C.** Plan's recommendation: **C** — it's A plus command-granularity discipline you want anyway; B stays available later since both sides share the engine.

### Decision 3 — When to split `views/` into `screens/`

**A. As-touched (strangler rule)** — a view file moves to its `screens/<screen>/` folder and gets decomposed the next time it receives a non-trivial edit.

- Pros:
  - Zero dedicated churn; every move is paid for by a feature that was already testing that screen.
  - No big-bang PR to review; git blame stays useful per move.
- Cons:
  - Sprawl persists for months; untouched files (e.g. `tradeModal.ts`) may never move, leaving a mixed layout indefinitely.
  - Contributors must check two places for view code during the entire transition.
- Best when: solo/small team, feature pressure is high, and the mixed state doesn't confuse anyone because one person holds the map.

**B. One dedicated mechanical PR** — move all ~25 view files into screen folders in a single change, no decomposition, imports updated, done.

- Pros:
  - Transition over in a day; one layout everywhere; import paths stabilize before other phases build on them.
  - Pure-move PR is easy to review (renames + import rewrites, no logic).
- Cons:
  - Invalidates every open branch touching views; git blame takes a knock across the whole layer at once.
  - Tempting scope creep ("while I'm here...") must be resisted or the PR becomes unreviewable.
  - Moving without decomposing means big files still big, just relocated — the SRP work still happens later.
- Best when: about to onboard collaborators (human or AI agents in parallel worktrees) who need a predictable layout, or before a phase that touches many views at once.

**C. Hybrid: mechanical folder move now (B), decomposition as-touched (A)**

- Pros:
  - Cheap immediate win: layout communicates the architecture from day one; the expensive part (splitting 1562-line files into components) still happens only when justified by feature work.
  - The folder move PR is safe and fast; decomposition risk is spread over time.
- Cons:
  - Two-step history for each file (moved, then split) — mildly noisier blame than pure A.
- Best when: you value the layout signal now but not the decomposition cost now. Given AI agents work in this repo across parallel worktrees, a stable folder layout has outsized coordination value.

**Verdict to pick from: A, B, or C.** Plan's recommendation: **C**.

### Decision 4 — Auth/user scoping for months-long games

**A. Defer entirely** — keep seats as they are today: claimed by bare `{ seat, handle }` with no binding to any session or user (`routes.ts` lobby/claim records only a handle string; the localStorage bearer token from the auth flow is not consulted). `game_players.user_id` stays NULL-able and unused.

- Pros:
  - Zero work now; migration plan untouched; single-machine/LAN play unaffected.
  - The schema hook (`user_id NULL`) means deferring costs nothing structurally.
- Cons:
  - Months-long games are fragile: lose the browser session/localStorage, lose the seat. Recovery becomes a manual DB poke.
  - No cross-device play (desktop at home, laptop travelling) for long campaigns.
- Best when: current phase — all players are you, on your LAN, and session loss is a dev inconvenience, not a product failure.

**B. Bind seats to existing auth users at claim time** — the `auth_codes`/`user_sessions` tables already exist; `lobby/claim` writes `user_id`; rejoining authenticates and reclaims by user, not session.

- Pros:
  - Solves the actual months-long-game risk (seat recovery, cross-device) with modest work: one column write, one reclaim query, login-before-claim in the lobby UI.
  - No new auth infrastructure — reuses what's built.
- Cons:
  - Forces login for multiplayer (friction for casual LAN games unless guest seats stay allowed — making it optional adds a small conditional path).
  - Touches the lobby flow, which works today; regression risk in a flow with no automated tests.
- Best when: the first real multi-week multiplayer game with another human is about to start. That's the trigger.

**C. Full identity layer** — accounts, profiles, per-user game lists, permissions, spectators, email notifications for "your turn" in slow games.

- Pros:
  - The complete product answer for months-long async multiplayer; "your turn" email is genuinely valuable at that cadence.
  - Spectator/permission model enables sharing replays (§3's event log makes replay cheap).
- Cons:
  - Weeks of work spanning server, client, and email delivery; almost all of it premature before there are external users.
  - Expands attack surface and operational burden (email deliverability, account recovery).
- Best when: the game has players who aren't you. Not before.

**Verdict to pick from: A, B, or C.** Plan's recommendation: **A now, with B pre-planned as its own small plan doc, triggered by the first real long-running multiplayer game. C only when external users exist.**

**Owner direction (2026-08-12):** Early development keeps all games visible to everyone (no per-user game lists yet). Identity model confirmed as localStorage bearer token with email-based recovery — which `server/auth.ts` already implements (email → 6-digit single-use code, 10-min TTL → mints 32-byte token in `user_sessions`, 30-day sliding TTL). Recovery is "request a new code" (mints a fresh token), never resending an existing token by email. Remaining gaps when B triggers: (1) real email delivery — codes are currently `console.log`-only; (2) `lobby/claim` must consult the bearer token and record `user_id`. Dev note: localStorage is scoped to scheme+host+port, and this repo's per-worktree OS-assigned ports mean dev tokens "vanish" when the port changes between runs — expected behavior, not a bug.
