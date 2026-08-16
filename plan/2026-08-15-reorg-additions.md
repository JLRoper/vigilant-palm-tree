# heroes-js — Reorg Plan Additions & Engineering Review

*Companion to `plan/2026-08-11-srp-module-reorganization.fable.md`. Each section either adds a missing item, refines an under-specified one, or pushes back. Read as the second pass; not standalone.*

## 1. Phase ordering corrections

### 1.1 `endTurn.ts` must be the last domain extracted

The plan (§7 Phase 2) lists the carve order as "economy → charter → settlement → hero → turn." That order matters and is under-specified as written.

`engine/turn/endTurn.ts` *orchestrates* every other domain: economy upkeep, charter advance, settlement upgrades, hero resupply. If you extract it before economy/charter/settlement exist as engine domains, you either build a new 400-line monster that re-implements their logic, or you create circular domain imports (turn → economy → turn).

The plan's order is right; make it a hard rule: **each prior phase must have stable, tested boundaries before the next phase is extracted.** Otherwise the strangler turns into a 6-month swap.

### 1.2 Catalogs belong in Phase 2, not Phase 6

The plan defers `building_defs` / `castle_levels` / `sprite_sets` to Phase 6. This blocks a stated near-term owner goal ("more castle level sizes"). The registry must become table-backed so the engine consumes it via `EngineCtx.catalog` — and `EngineCtx.catalog` is itself a Phase 2 engine change.

Move into Phase 2:

- `packages/contracts/catalog/buildingDef.ts`, `castleLevel.ts` (shapes only)
- `engine/catalog/buildingCatalog.ts` (lookup over `BuildingDefRow[]`, replaces the 289-line `core/buildingRegistry.ts` constants)
- `engine/catalog/castleLevels.ts`
- `server/persistence/repositories/buildingDefRepo.ts`, `castleLevelRepo.ts`
- Seed migration populating the existing 13 building kinds + 3 castle levels as rows

Phase 6 then becomes: consume the rotation/facing column on buildings (per §6) and add UI for castle-size selection. The data work is unblocked earlier.

### 1.3 `commandHandler.ts` before porting endpoints

The plan (§7 Phase 3) says "port endpoints one at a time onto commands (start with `spend_movement`)." Risk: if `commandHandler.ts` doesn't exist first, every new endpoint reimplements auth + turn-check + version-check + transaction wrapping.

Order: build the empty `commandHandler.ts` loop in Phase 3.0. Then port endpoints that delegate to it. Each new endpoint is a thin wrapper: parse DTO → call handler → serialize. The shared loop exists exactly once.

## 2. `managers/` split — folder map, not "shrinks into `boot/`"

The plan (§2.4) says "`managers/` shrinks into `boot/`." That's wrong — only the composition root shrinks. Each responsibility in `managers/` gets its own folder; nothing re-coagulates.

Current state (7 files, ~1,481 lines):

- `GameEngine.ts` (422) — composition root + frame loop + raw canvas input + charter placement mode
- `GameStateManager.ts` (151) — `GameState` + `TurnController` + visual entity mirror (Hero[]/Castle[] with tweens)
- `GameSessionManager.ts` (183) — load/new/save lifecycle, hydrates state from server
- `SessionManager.ts` (120) — thin server-API client, tracks save status
- `GameActions.ts` (80) — high-level game-flow triggers (end turn, battle flow)
- `ViewManager.ts` (101) — canvas + camera + renderer + `AdventureView`
- `UIManager.ts` (424) — toolbar, HUD, all roster/info menus, city view parent, keydown

Target split (all under `packages/client/`):

```
client/
├── boot/game.ts                    # ex-GameEngine (composition only, target ~80 lines)
├── state/
│   ├── gameStateStore.ts          # ex-GameStateManager minus the visual mirror
│   └── visualEntities.ts          # the Hero[]/Castle[] tween mirror
├── session/
│   ├── apiClient.ts               # ex-SessionManager (HTTP only)
│   ├── gameSession.ts             # ex-GameSessionManager (lifecycle)
│   └── commands.ts                # ex-GameActions, rewritten as command dispatcher
├── scene/
│   ├── viewShell.ts               # ex-ViewManager minus AdventureView
│   ├── adventureScene.ts          # ex-AdventureView
│   └── entityMirror.ts            # the visual mirror, subscribed to events
└── screens/
    ├── shared/{toolbar,hud}.ts
    ├── adventure/{charterPlacement,inputBindings}.ts
    ├── heroes/{heroInfoMenu,heroRosterMenu}.ts
    ├── settlements/{settlementInfoMenu,settlementRosterMenu,cityView/}.ts
    └── multiplayer/multiplayerSync.ts
```

Three SRP wins this surfaces:

1. **`charterPlacementMode` boolean on `GameEngine.ts:43`** leaks UI state into the root. Moves to `screens/adventure/charterPlacement.ts`. The validation in `canStartCharter` (lines 229-244) and `computeValidCharterHexes` (256-290) are pure functions of state → they become validators in `engine/hero/recruit.ts` and `engine/charter/start.ts`. The hex-set visual application stays in the screen; the computation becomes engine code that's also server-callable.

2. **`GameStateManager` mixes two things** (state subscription + visual tweens). In the target, the visual mirror subscribes to events instead of being rebuilt wholesale on `state:committed`. The `bus.on("state:committed", ...)` at `GameEngine.ts:192` is replaced by per-event handlers: `heroMoved` → tween, `turnEnded` → HUD refresh, etc.

3. **`GameActions.handleEndTurn` calls `tc.endHumanTurn()` directly** — meaning the client is authoritative for rules. In the target, it builds a `Command<EndTurn>`, sends to `POST /games/:id/commands`, receives events, applies locally. The current `manualSave` PATCH (which sends `hero_q`/`hero_r`/`turn`/`gold`/`enemy_positions` as columns) is replaced by periodic server snapshots — `manualSave` likely disappears entirely.

## 3. Subsystem interface: split `subscribe` from `apply`

I initially proposed `{ subscribe, apply, teardown }` as a uniform shape. That's over-specified — real subsystems don't all need all three:

| Subsystem | subscribe | apply | teardown |
|---|---|---|---|
| Toolbar | ✓ | ✗ | ✓ |
| HUD | ✓ | ✗ | ✓ |
| Visual entity mirror | ✓ | ✗ | ✓ |
| API client | ✗ | ✓ | ✗ (long-lived) |
| GameSession (load/new/save) | ✓ | ✓ | ✓ |
| Command dispatcher | ✓ | ✓ | ✓ |

Replace the uniform interface with two orthogonal ones:

```ts
interface Subscribes {
  subscribe(bus: EventBus): Unsubscribe;
}
interface Applies {
  apply(cmd: Command): Promise<CommandResult>;
}
```

A module implements whichever halves it needs. `boot/game.ts` composes generically: every `Subscribes` gets its `subscribe` called and its unsubscribe handle stashed for shutdown; every `Applies` is wired into the command router.

## 4. The bus is the read side; commands never use it

This deserves to be explicit in the plan rather than implicit in §3. Commands and events are on opposite sides of CQRS:

- **Commands** (write side): user intent → `commands.ts` → `POST /games/:id/commands` → server's `commandHandler.ts` → `engine.validate(state, cmd)` → `engine.apply(state, cmd)`. Returns `{ state, events }`.
- **Events** (read side): returned from `engine.apply`, persisted to `game_events` (server), polled or pushed to client, applied through `engine.apply` locally, then `bus.emit(eachEvent)` for in-process UI subscribers.

The bus is **never** on the write path. The engine's contract is pure: `apply` returns events as a return value, not by emitting to the bus. The command handler (server) or dispatcher (client) is responsible for publishing events to the bus after `apply` returns.

Two reasons not to mix commands and events on the same bus:

1. Commands need total order (one per game, sequential). Pub/sub gives you fan-out, not sequencing.
2. Type discrimination matters: a "command" channel and an "event" channel want different error contracts (commands fail loudly; events are facts you can't reject).

In-process UI signals that aren't game mutations (e.g., "open hero roster menu") stay as DOM events, not the game bus.

## 5. Event-driven as concurrency substrate (future-leaning)

This may feel like overkill at current scale, but it's load-bearing for three concrete futures:

1. **Buffer between heavy client↔server round-trips.** Today the server's command pipeline runs synchronously inside the request (end-turn, AI turn resolution, battle resolution all complete before the response). Once any of these grows beyond ~50ms, the client sits waiting. With the event-driven model, `commandHandler.ts` does `engine.apply` (fast, pure), appends events, and returns immediately. Heavy downstream work (AI, replay indexing, analytics) subscribes via the bus or the durable log and processes async. The client doesn't wait on work it doesn't need.

2. **Multithreading / process isolation.** Node.js is single-threaded but the architecture unlocks:
   - Worker threads for CPU-heavy `engine.apply` during replay (months-long games, full history)
   - A separate process consuming `game_events` for AI bot turns — no need to be in the request path
   - Queue workers (BullMQ / pg-boss) for snapshotting, replay indexing, email "your turn" notifications

   The event log is the queue substrate. The engine is the CPU work. The bus is the in-process fan-out. Each scales independently.

3. **Multiple concurrent consumers, no coupling.** Once events are first-class, these run concurrently without touching each other or the request path:
   - **AI bots** for non-human seats: subscribe to `turn:ended`, decide, send a `Command` back
   - **Multiplayer sync**: poll/tail the log, deliver to other clients
   - **Replay tool**: tail the log, render history
   - **Analytics**: aggregate per-game metrics
   - **Debug/event-log UI**: subscribe in-process
   - **Audit**: append to a separate immutable store

The "smoothness edge": in a turn-based game, every interaction feels best when it feels instant. Decoupling the response from heavy work is what makes that possible at scale, and the event-driven model is how you decouple without growing request latency.

This is the "invest now for compounding returns" argument. The work is the same either way — commands and events are needed anyway for sync and replay. Building it event-first means the concurrency story is a deployment change, not a rewrite.

## 6. The rAF frame loop dies

`GameEngine.loop` (`GameEngine.ts:324-333`) runs every frame:

- `state.update(dt)` ticks every hero's animation + the `TurnController`
- Unconditionally `fullFrame()` (draw + HUD refresh)

A turn-based game doesn't need 60fps simulation. Replace with:

- **Animation ticker**: rAF only while `entityMirror.hasActiveTweens()` is true (hero move tween: 200-400ms)
- **State change**: `bus.on` any game event → `scene.redrawDirty()`
- **HUD**: refresh on relevant events (`turn:ended`, `resource:changed`)

This is a substantial clarity + perf win that falls out for free once the visual mirror subscribes to events instead of being rebuilt on `state:committed`.

## 7. `EngineCtx` needs more than `{ rng, catalog }`

The plan (§2.2) defines `EngineCtx = { rng, catalog }`. Anemic. Two additions it should name now so the contract doesn't churn mid-reorg:

- **Actor identity** (`actor: PlayerSeat`): combat and charter events need to know who caused them for attribution in the multiplayer event log and for "is it your turn" validation. Today this is implicit in `tc.endHumanTurn()` knowing the local player.
- **Clock** (`now: () => number` — a *deterministic* clock, e.g., `currentDay` from state): for time-based effects when they appear (spell durations, exposed-hero windows). Not needed today; name where it slots in.

Explicit non-goals to prevent drift: no `Date.now`, no `Math.random`, no `fetch`, no storage. Those all live outside engine and get injected only via `ctx`.

## 8. `props JSONB` promotion rule

The plan (§4) introduces `props JSONB DEFAULT '{}'` as an escape hatch on every entity table. Good instinct; without a concrete promotion rule, props become permanent junk drawers. Add to AGENTS.md:

> **Rule:** any field in `props` that gets queried (`WHERE`, `ORDER BY`, `JOIN`) or referenced in 2+ business-logic sites within a release gets promoted to a real column in the next schema migration. Review triggered by: a) any `props->>'field'` in a query, b) any code path that branches on a prop value, c) any test that asserts on a prop.

Without this rule the schema degenerates; with it, `props` is a real staging area.

## 9. Decision 2.C is already half-implemented

The plan (§9 Decision 2.C) describes "batched/composite commands for the hot paths." Look at `spend_movement` today: it already takes a full path, not single tiles. That's the batched-command pattern in disguise. The plan should acknowledge: "We already half-do C — `spend_movement` is one command per multi-tile move. The redesign is just to formalize the boundary; we're not adopting a new pattern, we're codifying the existing one."

This also means Decision 2.A (await server ack) is the actual change in flight — currently the client is authoritative. Ack-first is the safer starting point and matches what the code already half-does on the wire (whole-state PATCH on end-turn = "ack the whole new state").

## 10. Verify `tools/sprites` exists before Phase 6

§6 assumes an art pipeline exists. If `tools/sprites` is aspirational rather than actual, Phase 6 needs a "build the pipeline first" substep. Confirm before scheduling Phase 6 work.

## 11. Items the plan doesn't address but should

- **`docs/architecture.md` updates**: the `managers/` diagram and the `core/` leaf-only rule both change once the package split lands. Schedule a doc-update PR for the same release as Phase 1.
- **`dependency-cruiser.cjs` rule expansion**: the current rules cover `core/` leaf-only and `render/` → `systems|views`. Phase 1 needs new rules for the four package boundaries, one per edge. Each phase adds its edges as packages form.
- **`AGENTS.md` updates**: add the `props` promotion rule (§8), the no-`state:committed`-rebuild rule (per §2/§5), and the "new code lands in its target package from day one" rule that the plan (§7) implies.

## 12. Net changes summary

The plan is sound. These additions address execution risk and SRP gaps that the original plan under-specified or got wrong. No architectural rework needed.

- **Phase ordering**: §1.1–1.3
- **Managers split**: §2 (replaces §2.4's "shrinks into boot/")
- **Subsystem interface**: §3 (refines my own earlier over-specified version)
- **Bus vs commands**: §4 (explicit CQRS separation)
- **Concurrency substrate**: §5 (future-leaning justification)
- **Frame loop**: §6
- **`EngineCtx`**: §7
- **`props` rule**: §8
- **Decision 2.C**: §9
- **Tools verification**: §10
- **Adjacent doc work**: §11
