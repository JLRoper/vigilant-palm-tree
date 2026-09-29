# Event-Driven Architecture for heroes-js

> Status: 🟡 Partially shipped (2026-09-27). The bus, typed catalog, and registry
> files exist: `src/core/eventBus.ts` is a fully typed pub/sub (no `any` —
> handler payloads resolve via `Extract` on the `GameEvent` union), and
> `src/core/events.ts` holds the complete catalog incl. the `mp:*` multiplayer
> sync events (six since 2026-09-28's SSE event push, which added `mp:logRow` —
> every server `game_events` row, fanned out by `MultiplayerSync.applyRows`
> before state filtering, feeding the Log Message Panel). The bus is live
> across 10+ modules (state/turn/movement/economy emit; UI, toast, dev console,
> and network map listen). What remains of this plan is the Phase-2+ listener
> migration (single `registerAllListeners()` flow replacing callback chains).

## Overview

Replace imperative, cross-cutting function chains with a central `EventBus`. State changes emit typed events. UI, AI, economy, and modifier systems subscribe independently. No system imports another system's internals.

## Core components

### `src/core/eventBus.ts` — The bus

- `on(type, handler)` — register a synchronous or async listener
- `emit(event)` — fire all handlers for that event type concurrently
- `off(type, handler)` — unregister (rarely needed)
- `once(type, handler)` — fire once then auto-unregister
- Global singleton `bus` exported

Handlers receive a mutable event payload. They mutate it in-place. No return values. All handlers for a given event type are fire-and-forget — they can't block or cancel each other (by design for this game's needs).

### `src/core/events.ts` — Event type catalog

All events are a discriminated union on `type`. Each event has exactly the fields its handlers need — no more. The catalog includes the six `mp:*` multiplayer sync events; the sixth, `mp:logRow` (`MpLogRowEvent`, 2026-09-28), carries one server `game_events` row — engine or legacy audit kind, any seat — emitted by `MultiplayerSync.applyRows` before its own state filtering, so the Log Message Panel sees the whole log, not just state-relevant deltas.

### `src/core/eventRegistry.ts` — Handler registration

Called once at game init. Registers all listeners. Split by domain:

```typescript
export function registerAllListeners(): void {
  registerTurnListeners();
  registerMovementListeners();
  registerEconomyListeners();
  registerUiListeners();
  registerBuildingModifiers();
}
```

Each domain file registers its own handlers. Domain files never import each other.

---

## Phase 1: Foundation (files + types)

**New files:**

| File | Contents |
|---|---|
| `src/core/eventBus.ts` | EventBus class + singleton `bus` |
| `src/core/events.ts` | All `GameEvent` types — incl. the six `mp:*` multiplayer sync events (`mp:logRow` added 2026-09-28 with the SSE event push) |
| `src/core/eventRegistry.ts` | `registerAllListeners()` |

**`eventBus.ts` implementation (shipped 2026-09-27):**
```typescript
import type { GameEvent } from "./events";

class EventBus {
  on<K extends GameEvent["type"]>(type: K, handler: (ev: Extract<GameEvent, { type: K }>) => void): void;
  once<K extends GameEvent["type"]>(type: K, handler: (ev: Extract<GameEvent, { type: K }>) => void): void;
  off<K extends GameEvent["type"]>(type: K, handler: (ev: Extract<GameEvent, { type: K }>) => void): void;
  onAny(handler: (ev: GameEvent) => void): () => void;          // debug/log tooling
  emit(ev: GameEvent): void;
  emitRaw(ev: { type: string; [key: string]: unknown }): void;  // debug tooling only
  clear(): void;
  getListenerCounts(): Map<string, number>;
}

export const bus = new EventBus();
```

Fully typed — no `any`. `once`, `onAny`, and `emitRaw` extend the original
sketch below; the historical sketch is kept for the phase narrative.

---

## Phase 2: StateCommitted (biggest win, lowest risk)

**Problem:** 13+ call sites manually invoke:
```typescript
this.state.replaceState(tc.getState());
this.state.rebuildHeroesFromState();
this.state.syncHeroVisualsToState();
this.fullFrame();
```

**Solution:** One event replaces all of them.

**New event:**
```typescript
{ type: "state:committed" }
```

**Emitter:** `GameStateManager` after any public state mutation. Add a private `notifyStateChanged()` that calls `bus.emit({type: "state:committed"})`, called at the end of every command that produces a state change.

**Listener:** One handler in `eventRegistry.ts` runs the rebuild + refresh:
```typescript
bus.on("state:committed", () => {
  state.replaceState(tc.getState());
  state.rebuildHeroesFromState();
  state.syncHeroVisualsToState();
  // fullFrame is called by the game loop already — no extra call needed
});
```

**Files changed:**
- `src/state/gameState.ts`: `GameStateManager` gains `notifyStateChanged()`, calls it after every command
- `src/core/eventRegistry.ts`: registers the rebuild listener
- **Remove** the manual `replaceState + rebuildHeroes + syncHeroVisuals + fullFrame` quartet from all 13 call sites

**Call sites to clean:**
- `src/managers/GameActions.ts`: `handleEndTurn()` (L66), `startBattleFlow()` (L34)
- `src/managers/GameEngine.ts`: transferGold (L139), reorderStack (L151), `handleStartCharter()` (L285)
- `src/managers/UIManager.ts`: closeHeroInfoMenu (L110), closeSettlementInfoMenu (L124), `handleRosterHeroSelect()` (L263), `handleRecruitHero()` (L289)
- `src/screens/adventure/adventureView.ts`: click handling (`onClick`) — the charter/select/attack/settlement decision logic now lives in `src/screens/adventure/clickIntent.ts` as `resolveAdventureClick()` returning a `ClickIntent` union (2026-09-27 refactor); AdventureView consumes the intent.
- `src/io/debugCommands.ts`: `requestMove()` (L67), `captureSettlement()` (L81), `tradeResources()` (L89), `teleportHero()` (L99)
- **Note:** `debugCommands.ts` is also extended to forward `eventLog` into the
  `__gameDebug.events` surface (see [`dev-console.md`](./dev-console.md)). That
  wiring is purely additive and does not change the cleanup target above.

---

## Phase 3: Turn lifecycle events

**Events:**
```typescript
{ type: "turn:ended", playerId: number }
{ type: "phase:changed", oldPhase: string, newPhase: string }
{ type: "round:changed", round: number }
{ type: "day:changed", day: number }
```

**Emitter:** `turnController.endCurrentTurn()` fires `turn:ended`. `gameState.endTurn()` fires `phase:changed`. `gameState.advanceRound()` fires `round:changed` and `day:changed`.

**Listeners:**
- Economy pipeline (produce, consume, income, morale) subscribes to `turn:ended`
- ~~AI tick loop subscribes to `phase:changed` (detects AI_TURN)~~ — **shipped 2026-09-29, client-side**: the AI tick is `turnController.tick()` off the frame loop (checked each frame against `phase.kind === "AI_TURN"`, not a bus subscription — that still lands with the Phase-2+ listener migration), gated to the primary client (`isPrimaryActor` = local seat 0; non-primary browsers watch via sync)
- Fog-of-war recompute subscribes to `phase:changed`
- UI calendar/hud subscribes to `day:changed`

**Files changed:**
- `src/state/turnController.ts`: emit events in `endCurrentTurn()`
- `src/state/gameState.ts`: emit events in `endTurn()`, `advanceRound()`
- `src/core/eventRegistry.ts`: register economy/AI/fog listeners

---

## Phase 4: Hero movement events

**Events:**
```typescript
{ type: "hero:moved", heroId: string, from: Axial, to: Axial, playerId: number }
{ type: "settlement:captured", heroId: string, settlementId: string }
{ type: "battle:resolved", attackerId: string, defenderId: string, attackerSurvived: boolean }
```

**Emitter:** `turnController.requestMove()` fires `hero:moved`. `captureSettlementReducer()` fires `settlement:captured`. `resolveBattle()` fires `battle:resolved`.

**Listeners:**
- Settlement capture check listens to `hero:moved` (was `tryCaptureAt`)
- Enemy detection listens to `hero:moved` (was `detectAdjacentEnemy`)
- Charter completion listens to `hero:moved` (was in `advanceAutoTravel`)
- Fog-of-war recompute listens to `hero:moved`

**Files changed:**
- `src/state/turnController.ts`: emit `hero:moved` in `requestMove()`, emit in `advanceAutoTravel()`
- `src/state/gameState.ts`: emit `settlement:captured` in reducer, `battle:resolved` in resolver
- `src/core/eventRegistry.ts`: register capture/detection/charter listeners

---

## Phase 5: Resource change events

**Events:**
```typescript
{ type: "economy:goldChanged", entityId: string, entityType: "hero"|"settlement", newAmount: number }
{ type: "economy:warehouseChanged", settlementId: string, resource: string, newAmount: number }
{ type: "economy:moraleChanged", settlementId: string, newMorale: number }
```

**Emitter:** `applyEffectiveIncome()`, `transferGold()`, `captureSettlementReducer()`, `resolveBattle()`, `applyWeeklyUpkeep()`, `runAutoTrade()`, `tradeResources()`, `startCharterReducer()`, `applySettlementConsumption()`, `applyMoraleDecay()`

**Listeners:**
- HUD subscribes to `goldChanged` + `moraleChanged` for player-wide aggregates
- Settlement info menu subscribes to `warehouseChanged` + `goldChanged` + `moraleChanged`
- Hero info menu subscribes to `goldChanged`
- Settlement snapshots (daily) subscribe to `warehouseChanged`

**Files changed:**
- `src/state/gameState.ts`: emit resource events in all resource-mutating functions
- `src/views/hud.ts`: subscribe instead of full rescan every frame
- `src/views/settlementInfoMenu.ts`: subscribe instead of full rescan
- `src/views/heroInfoMenu.ts`: subscribe instead of full rescan
- `src/core/eventRegistry.ts`: register HUD/menu listeners

---

## Phase 6: Building modifiers via events

**Events (reuses existing calc pattern):**
```typescript
{ type: "calc:controlRange", settlementId: string, level: number, range: number }
{ type: "calc:visionRange", settlementId: string, level: number, range: number }
{ type: "calc:heroSpeed", heroId: string, baseSpeed: number, speed: number }
```

**Emitter:** `computeControlRange()`, `computeVision()`, pathfinding before move cost calc

**Listeners:** Registered in `registerBuildingModifiers()` — one handler per building type:
```typescript
bus.on("calc:controlRange", (ev) => {
  const s = state.getSettlement(ev.settlementId);
  if (s?.buildings.some(b => b.kind === "tower")) ev.range += 3;
});
```

**Files changed:**
- `src/core/buildingModifiers.ts`: new file with `registerBuildingModifiers()`
- `src/core/control.ts`: `computeControlRange()` fires event instead of hardcoded `level`
- `src/render/fog.ts`: `computeVision()` uses adjusted range from event
- `src/core/eventRegistry.ts`: call `registerBuildingModifiers()` in `registerAllListeners()`

---

## File tree after implementation

```
src/core/
  eventBus.ts         ← NEW: EventBus class + singleton bus
  events.ts           ← NEW: all GameEvent type definitions
  eventRegistry.ts    ← NEW: registerAllListeners() + domain registration files
  buildingModifiers.ts ← NEW: registerBuildingModifiers()

src/state/
  gameState.ts        ← MODIFIED: emit events, notifyStateChanged()
  turnController.ts   ← MODIFIED: emit turn/movement events

src/managers/
  GameActions.ts      ← MODIFIED: remove manual rebuild calls
  GameEngine.ts       ← MODIFIED: remove manual rebuild calls, call init
  UIManager.ts        ← MODIFIED: remove manual rebuild calls

src/views/
  adventureView.ts    ← MODIFIED: remove manual rebuild calls
  hud.ts              ← MODIFIED: subscribe to economy events
  settlementInfoMenu.ts ← MODIFIED: subscribe to economy events
  heroInfoMenu.ts     ← MODIFIED: subscribe to gold events

src/render/
  fog.ts              ← MODIFIED: use event-based computeVision
  overlays/territoryOutline.ts ← MODIFIED: use event-based computeControlRange

src/io/
  debugCommands.ts    ← MODIFIED: remove manual rebuild calls
```

---

## Migration order

1. **Phase 1** — Create bus, types, registry (zero behavioral change)
2. **Phase 2** — `state:committed` (visible: nothing changes, but 13+ call sites cleaned)
3. **Phase 3-4** — Turn + movement events (visible: no change, logic moves behind bus)
4. **Phase 5** — Resource events (visible: HUD flicker reduced)
5. **Phase 6** — Building modifiers (visible: territory + vision expansion)

Each phase compiles and runs independently. No phase blocks another.

## Design decisions

- **Synchronous only**: All handlers run synchronously for now. No `Promise.all`, no async emit. Add later if needed.
- **Commutative handlers**: Handlers only add deltas or set values from a single source. No handler depends on another handler's output.
- **No ordering guarantees**: If two handlers touch the same field, the result must be the same regardless of fire order (commutative). If non-commutative behavior is needed, split into sub-events that fire in sequence.
- **Bus as singleton**: One global bus. No namespacing, no scoping. Simple to start; add scoped buses later if needed.
- **Events are fire-and-forget**: No return values. No cancel semantics. Handlers mutate the event payload in place.
