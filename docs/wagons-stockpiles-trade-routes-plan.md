# Wagons, Stockpile Caps & Trade Routes — Design Plan

**Status:** ✅ Shipped (Phases 1–4, 2026-09-27). Decisions locked same day (§8 answers folded in): player wagon pool, **physical caravans**, gate-additions overflow, auto-trade unchanged v1. Numbers below are tunable constants, centralized in `packages/engine/src/settlement/capacity.ts` + `logistics.ts`. Phase 5 (auto-trade through routes, raiding, AI logistics) remains deferred.

---

## 1. Context (as-built baseline, 2026-09-27)

- **Gold** lives in two uncapped pools: hero purse (`HeroState.gold`) and settlement treasury (`SettlementState.gold`). `transferGold` is same-hex, all-or-nothing.
- **Warehouse** (`SettlementState.warehouse`: wood/stone/iron/arcane/food) is uncapped — finding F6 in [resource-gathering.md](./resource-gathering.md). The granary's "increases food storage" description promises a mechanic that doesn't exist.
- **Heroes carry no resources at all** — only gold. There is no hero↔settlement resource transfer.
- **Wagons don't exist.**
- **Trade** is instant and distance-blind: manual `tradeResources` (same-owner, 1 gold per unit) and auto-trade (end-turn deficit fill, same-owner, 1:1 gold, food/wood/stone only).
- Production/income/loot all add without limit; nothing clamps.
- Persistence: `Player` rides `games.players` JSONB (no granular players table — new player fields need **no migration**); `HeroState` rides the granular `heroes` table (migration 009) — new hero fields need a **migration**; settlements' caps will be **derived** (buildings + level), so no storage column; trade routes need a **new table**.

## 2. Goal

Every settlement and every hero owns a **capped stockpile** (resources + gold). Caps scale with logistics infrastructure: settlements by warehouse buildings, heroes by the **wagon carts** assigned to them. Wagons are a real, countable asset that can be **locked into trade routes**, whose per-round throughput throttles by wagon count and inter-settlement distance.

## 3. Non-goals (v1)

- No physical caravan travel on the map (routes are throughput-per-round, §5 — pending Q2).
- No raiding/pillaging of trade routes.
- No AI usage of routes (AI economy unchanged).
- No change to manual `tradeResources` or auto-trade semantics (pending Q6).

## 4. Stockpile caps (settlements + heroes)

### 4.1 Settlement caps — derived, never stored

```
resourceCap(settlement) = BASE_STORAGE[level] + Σ warehouse-buildings bonus
treasuryCap(settlement) = BASE_TREASURY[level] + Σ treasury-buildings bonus
```

| Source | Resource cap bonus | Treasury cap bonus |
|---|---|---|
| Base, by settlement level | L1 500 · L2 1,500 · L3 4,000 | L1 1,500 · L2 4,000 · L3 10,000 |
| `warehouse` (**new building kind**, 1×1) | +600 × level, all five resources | +500 × level |
| `granary` (existing kind, reworked) | +600 × level, **food only** | — |
| `bank` (existing kind) | — | +2,000 × level |

Granary's dormant `foodPerTurn` stays (its F3 wiring is a separate finding); its storage role becomes real here. All constants live in one engine module (`packages/engine/src/settlement/capacity.ts`) with unit tests.

### 4.2 Hero caps — wagons

```
heroResourceCap = wagons × 50     (per resource, all five)
heroGoldCap     = wagons × 500
```

New heroes start with **5 wagons** (2,500g purse cap exactly covers the 2,500g charter cost — this pairing is deliberate; wagons × 500 is the charter-compatibility reason gold's per-wagon capacity is 10× resources').

### 4.3 Overflow rule — soft caps (pending Q4)

**Caps gate additions; they never destroy what's already stored.** Production, taxes, auto-trade receipts, battle loot, trade-route arrivals, and command transfers all clamp to headroom; the excess is lost (with a UI warning when a pool is at cap). Old saves whose stockpiles already exceed the new caps keep their surplus until spent below the cap — no wipe-on-load.

Wagon-locking invariant: `Σ hero.wagons + Σ route.wagons + unassigned ≤ player.wagonsOwned`, enforced by the assign/remove commands.

## 5. Wagons & trade routes

### 5.1 Wagon model (pending Q1)

Player-level pool with explicit allocation:

```
Player.wagonsOwned      (JSONB players — no migration)
Player.wagonsUnassigned
HeroState.wagons        (per hero; migration 014)
TradeRouteState.wagons  (per route)
```

Buying wagons (at any owned settlement's market/panel): **200g + 5 wood each** → `wagonsOwned+1, wagonsUnassigned+1`. Assigning moves `wagonsUnassigned → hero/route`; unassigning reverses. Locked = allocated to a route.

### 5.2 Trade routes — physical caravans (LOCKED)

`TradeRouteState` on `GameState.tradeRoutes` (+ `trade_routes` table, migration 014):

```
{ id, fromSettlementId, toSettlementId, resource: WarehouseResource, wagons: number,
  caravan: CaravanState | null }        // null while loading initial cargo at origin

CaravanState {
  phase: "toDestination" | "toHome",
  cargo: number,                         // units currently carried
  path: { q: number; r: number }[],      // remaining path (A* on the hex map, water/mountain avoided)
  pathIndex: number,
}
```

Same-owner settlements only; one resource per route (changeable); distance = path length (not hex line — impassable terrain routes around). Caravan cycle, ticked once per round wrap in `advanceTradeRoutes(state, map)`:

1. **loading** (`caravan === null`): load `min(wagons × 50, source stock)` at origin; if > 0, A* the path and depart (`toDestination`). If the source is empty, wait.
2. **toDestination / toHome**: move `CARAVAN_TILES_PER_DAY = 4` tiles per wrap along the stored path. On arrival at destination: deliver `min(cargo, dest headroom)`; leftover cargo **stays on the caravan** (it waits at the destination and delivers more as headroom appears — nothing is lost); when empty, flip to `toHome` with the reversed path. On arrival home: `caravan = null` (loads again next wrap).

Distance throttles naturally: round-trip time ≈ `2 × pathLength / 4` days, so per-day throughput ≈ `wagons × 50 × 4 / (2 × pathLength)`. The path is computed with the engine's existing A* (`findPath`) — `advanceTradeRoutes` takes the `GameMap` as a parameter; the server's turn service loads tiles and builds one (caravans simply wait while no map is available). Wagons on a route are locked; removing a route returns them (carried cargo is lost — documented). Caravans are visible on the adventure map (owner-colored wagon marker, v1) and raidable in a later phase.

## 6. New server surface (each = contracts + engine reducer + hook + io + parse + handler case + dual-write + event, mirroring the `PlaceBuildings` pattern)

| Command | Payload | Notes |
|---|---|---|
| `TransferResources` | heroId, settlementId, direction, amounts per resource | same-hex check like `transferGold`; clamps both sides |
| `BuyWagons` | settlementId, count | deducts 200g+5w each |
| `AssignWagons` | target: heroId \| routeId, count (± to unassign) | invariant check |
| `CreateTradeRoute` | fromSettlementId, toSettlementId, resource, wagons | same-owner + wagons available |
| `UpdateTradeRoute` | routeId, { resource?, wagons?, remove? } | wagons delta vs player pool |

Events: `ResourcesTransferred`, `WagonsBought`, `WagonsAssigned`, `TradeRouteCreated`, `TradeRouteUpdated`, `TradeRouteRemoved` (entityMirror no-ops; resync boundary covers remote seats).

## 7. UI surface

1. Settlement panel: per-resource stockpile-vs-cap bars + treasury bar; "full" warning at ≥95%.
2. Hero panel: purse-vs-cap, cargo (per resource), wagons; load/unload transfer dialog (same-hex settlement: per-resource amount + All buttons).
3. Buy-wagons control + wagon allocation controls in the settlement panel/hero panel.
4. Trade-routes section in the settlement panel: list routes touching this settlement, create (target settlement picker + resource + wagons), change wagons/resource, remove.

## 8. Open questions — ALL LOCKED (2026-09-27)

- **Q1 Wagon model → player pool with explicit allocation.** ✅
- **Q2 Route mechanics → physical caravans** (hex-path travel over days, map-visible, raidable in a later phase). ✅ — see §5.2.
- **Q3 Hero cargo contents → all five resources including food** (uniform Warehouse shape). ✅
- **Q4 Overflow → gate additions**, never destroy stored surplus. ✅
- **Q5 Auto-trade → unchanged v1** (plus the phase-1 headroom check). ✅
- **Q6 Scope → Phases 1–4 this session.** ✅

## 9. Concerns / risks

1. **Scope.** Six new commands, one migration, three UI areas, plus rule changes in production/income/loot clamps. Phases must land sequentially with the build+test gate green between each; the session should stop at the last green phase rather than half-land phase 4.
2. **Save compat.** Soft caps (§4.3) avoid wiping legacy surpluses. Test fixtures seed `gold: 999999` — under gate-additions this stays valid, so no fixture churn.
3. **Balance.** Every number in §4/§5 is a first-pass recommendation; expect a tuning pass after play. Centralized constants make that cheap.
4. **Charter coupling.** Hero purse cap × starting wagons is deliberately paired so a fresh hero can still afford the 2,500g charter. If wagons-per-hero changes, that pairing must be re-checked.
5. **Fractional stock.** Producer amounts are 2-decimal floats (mine multipliers); clamping must floor only the *added* amount against headroom, not round stored stock — otherwise caps silently destroy fractions every tick.
6. **Auto-trade interplay.** `runAutoTrade` must respect destination headroom (small engine change in Phase 1) or it will "fill" full warehouses on paper while the clamp silently eats the difference — misleading UI.
7. **mergeFromEndTurn wholesale replacement.** Client optimistic applies of the new commands must mirror the server reducer exactly (the `PlaceBuildings` pattern), or the EndTurn merge will resurrect/lose resources. All six commands go through the same reducer-on-both-sides shape.
8. **Hero death.** Charter defeat already forfeits the purse; cargo should forfeit too (phase 2) so heroes aren't a loot-free transport hack.

## 10. Implementation phases (each gated green)

- **Phase 1 — Caps & clamps (engine):** `capacity.ts` (derived caps + helpers), clamps in production/income/loot/auto-trade-headroom, `warehouse` building kind, granary/bank rework, tests. No migration.
- **Phase 2 — Hero cargo & wagons:** `HeroState.resources` + `HeroState.wagons` (start 5) + migration 014 (heroes columns + heroRepo) + hero capacity formula + `TransferResources` + `AssignWagons` commands + hero cargo UI + battle-cargo loot.
- **Phase 3 — Wagon pool & purchases:** `Player.wagonsOwned`/`wagonsUnassigned` (JSONB) + `BuyWagons` + settlement-panel wagon UI.
- **Phase 4 — Trade routes (physical caravans):** `TradeRouteState` + `trade_routes` table (migration 014) + Create/Update/Remove commands + `advanceTradeRoutes(state, map)` with A* pathing (map threaded through `advanceRound`/turnService) + caravan map marker + settlement-panel routes UI.
- **Phase 5 (deferred):** auto-trade through routes, raiding, AI logistics.

## 11. Validation

- Unit: cap derivation per level/building mix; clamp behavior on each addition path; route throughput math (distance 0..6, wagons 0..N, headroom-limited); wagon invariant.
- Route tests over HTTP for each new command (mirroring `commandsRoute.test.ts`), including affordability 409s and malformed 400s.
- Persistence: heroes/trade_routes round-trips through the repos (construction-pattern).
- Existing suites stay green (fixtures unaffected under gate-additions).
