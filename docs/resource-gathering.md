# Resource Gathering & the Settlement Economy (as-built)

**Status:** ✅ Current. This is the **as-built reference** for how resources are collected and how buildings use them, as the code actually behaves on 2026-09-27. Design *intent* lives in [resources.md](./resources.md) and [economy.md](./economy.md); where those older docs and this one disagree on numbers, this one matches the code (see the [drift appendix](#12-doc-drift-appendix)). Sections 9–10 were forward-looking specs when written and are **now implemented** (2026-09-27, same day) — they describe live behavior.

Source-of-truth paths cited below are in [`packages/engine/`](../packages/engine/src) and [`packages/contracts/`](../packages/contracts/src). The client under `src/` mirrors the same reducers (`src/state/turnController.ts` orchestrates locally; `server/app/turnService.ts` re-runs the same engine functions server-authoritatively).

---

## 1. Resource types & pools

Defined in [`packages/contracts/src/resources.ts`](../packages/contracts/src/resources.ts): six `ResourceType`s — `gold`, `wood`, `stone`, `iron`, `arcane`, `food`.

Gold is deliberately different from everything else — it has **no warehouse entry** and lives in **two separate pools**:

| Pool | Field | Moves with | Spent on |
|------|-------|-----------|----------|
| Hero purse | `HeroState.gold` | the hero | chartering (2500g), captured on defeat |
| Settlement treasury | `SettlementState.gold` | the settlement | building placement/upgrades, recruitment, trading, auto-trade |

The other five are `WarehouseResource`s, held in the per-settlement `Warehouse` (`{ wood, stone, iron, arcane, food }`).

**There are no storage caps** anywhere in the engine — warehouses accumulate without limit (see [finding F6](#F6)).

## 2. Where resource tiles come from

[`packages/engine/src/map/resourceTiles.ts`](../packages/engine/src/map/resourceTiles.ts):

- Each passable tile rolls once against a **per-terrain density table** (`RESOURCE_DENSITY`). Water and mountain are excluded entirely.
- **Mountain spillover:** a passable tile adjacent to a mountain gets its stone and iron density boosted ×1.5 (caps 0.2 / 0.15) — mountains themselves can't hold tiles, so ore "spills" onto their borders.
- Per-tile yields (`RESOURCE_YIELD`): **gold 20, wood 15, stone 12, iron 8, arcane 5, food 10**.
- **Food's density is 0 on every terrain**, so food tiles never spawn and `RESOURCE_YIELD.food = 10` is currently dead weight (see [finding F1](#F1)).

Density matrix as implemented:

| Resource ↓ \ Terrain → | Grass | Dirt | Forest | Desert | Mountain | Water |
|------------------------|-------|------|--------|--------|----------|-------|
| Gold   | 6%   | 5%   | 1%    | 1%    | 0% | 0% |
| Wood   | 2%   | 1%   | **18%** | 0.5% | 0% | 0% |
| Stone  | 2%   | 6%   | 1%    | 1%    | 0% (spills) | 0% |
| Iron   | 0.5% | 3%   | 0%    | 0%    | 0% (spills) | 0% |
| Arcane | 0%   | 2%   | 0%    | **8%** | 0% | 0% |
| Food   | 0%   | 0%   | 0%    | 0%    | 0% | 0% |

## 3. Settlement resource rates (collection)

A settlement does not tick tiles per turn. Its rates are **computed once** and stored on the settlement:

```
rate[r] = RESOURCE_YIELD[r] × level × count(resource-r tiles within radius)
radius  = settlementRateRadius(level) = level − 1     # L1 → 0, L2 → 1, L3 → 2
```

Source: `computeSettlementRates()` in [`packages/engine/src/economy/settlementRates.ts`](../packages/engine/src/economy/settlementRates.ts), radius in [`packages/engine/src/control.ts`](../packages/engine/src/control.ts) (`settlementRateRadius`, line 13).

> **Drift warning:** older docs say settlements aggregate over "radius 3". The code uses `level − 1` — an L1 settlement collects **only from its own tile**; L2 reaches 1 hex out; L3 reaches 2.

**When rates are computed (the full lifecycle):**

| Event | Where | Level used |
|-------|-------|-----------|
| Initial castles at game start | `src/game/initState.ts:118` | castle's level (1–3) |
| Charter initiated | `src/state/turnController.ts` `startCharter()` (client) / `server/app/commandHandler.ts:899` (server-authoritative) | 1 |
| Settlement upgrade initiated | `src/state/turnController.ts` `startSettlementUpgrade()` / `server/app/commandHandler.ts:1064` | target level, precomputed into `UpgradeState.newResourceRates` |
| Capture | — | **rates are NOT recomputed**; the stored rates carry over to the new owner |

Charter rates ride on `CharterState.resourceRates` until the settlement is founded (`packages/engine/src/charter/advance.ts` copies them verbatim). Consequence: an L1 charter founded on a resource-free tile has **all-zero rates** and produces nothing from tiles.

Also recorded at computation time: `foundedOnResource` (the tile under the settlement center, if resource-bearing).

## 4. Starting state

| | Initial castles | Charter-founded settlement |
|---|---|---|
| Population | 500 / 1,500 / 5,000 by level (`POP_BY_LEVEL`) | 50 |
| Gold tax | 1 / 2 / 3 by level (`SETTLEMENT_GOLD_TAX`) | 1 |
| Treasury gold | 300 (`STARTING_GOLD`, `src/game/initState.ts:31`) | 0 |
| Warehouse | 300 wood/stone/iron/arcane, 0 food (`STARTING_WAREHOUSE`, `initState.ts:32`) | all 0 |
| Morale | 100 | 50 |
| autoTrade | `true` | `false` |
| Buildings | `[]` (Town Hall appears when the city view first generates/persists buildings) | `[]` |

Each hero also starts with a 300g purse (`makeHeroes`, `initState.ts:100`).

## 5. The per-turn pipeline

Per player's **EndTurn** — [`applyEndOfTurnDetailed()`](../packages/engine/src/turn/endTurn.ts), mirrored server-side by `runEndTurn()` in [`server/app/turnService.ts`](../server/app/turnService.ts) (the same three engine reducers, run against the authoritative DB row):

1. Hero movement reset for the active player's heroes.
2. **Production** — `produceSettlementResources()` (`packages/engine/src/settlement/produceResources.ts`): for **every settlement regardless of owner**, `warehouse[r] += resourceRates[r]`.
3. **Auto-trade** for the active player's settlements (see §6.6).
4. **Consumption → morale decay → effective income**, in that order, for the **active player's settlements only** (`packages/engine/src/economy/consumption.ts`).

On the **round wrap** (last player ends) — [`advanceRound()`](../packages/engine/src/turn/round.ts):

5. Day +1, turn order resets to player 0, all heroes' movement reset.
6. `advanceCharters()` — constructing charters tick down; completed ones found their settlement.
7. `advanceSettlementUpgrades()` — town hall / settlement / building upgrade timers tick down; completed ones apply.
8. **Weekly upkeep** when `day % 7 === 0` (`applyWeeklyUpkeep`): hero upkeep (§6.7) + population growth (§6.1).

## 6. Resource sinks

### 6.1 Consumption, morale, and population growth

`packages/engine/src/economy/consumption.ts`:

- **Food:** `foodRequired = ceil(population / 100)` per turn (`FOOD_PER_POPULATION = 100`).
- **Building upkeep:** `Σ buildingUpkeep(kind, level)` where `upkeep = upkeepPerLevel × level`, paid in **wood and stone** from the warehouse.
- Both deductions clamp at 0 — a deficit never goes negative, it just stays empty.
- **Morale decay** per turn: `(foodDeficitRatio + suppliesDeficitRatio) × 10`, plus `+1` extra while morale < 50. Ratios are `(needed − have) / max(1, needed)`.
- **Effective gold income** per turn: `round(population × goldTax × morale / 100)` added to the treasury. This is the **only** thing that adds treasury gold during the turn loop.
- **Population growth** (weekly): only if `warehouse.food >= foodRequired`; growth `= max(1, ceil(pop × growthRate))` (setting, default 10%, range 1–50%), capped at the level's population max. No food → no growth; the morale system handles the penalty.

### 6.2 Gold income vs. the HUD number

There are two "income" functions and they **disagree** (see [finding F2](#F2)):

- `settlementIncome()` / `playerIncome()` (`packages/engine/src/economy/income.ts`) = `pop × tax` **+ Σ building `goldPerTurn`** — this feeds the HUD's next-turn-gold display (`src/managers/UIManager.ts:473`).
- `effectiveIncome()` (`consumption.ts:48`) = `pop × tax × morale/100` — this is what actually accrues.

Building `goldPerTurn` therefore *appears* in the HUD but never lands in the treasury.

*(2026-09-29: the HUD economy row now carries a hover tooltip — `economyBreakdown()` in `src/screens/shared/hud.ts` — that spells the discrepancy out line by line: gross taxes → morale scaling → upkeep/food → the `goldPerTurn` HUD-vs-accrual difference. Presentation only; the underlying inconsistency itself remains open as [F2](#F2).)*

### 6.3 Building placement

Placement happens in the city view as a client-side **shopping cart** (`src/screens/settlements/cityView/buildingPlacer.ts`):

- Placing a building adds its `placementCost` to a running net cost; entering **Destroy mode** and removing a building credits a **50% refund** (`DESTROY_REFUND_PCT = 0.5`, line 29). Gold comes from the treasury; wood/stone/iron/arcane from the warehouse (food is never a placement currency).
- Affordability is checked live and the Confirm button disables otherwise.
- **Costs are committed through the server (shipped — closes F4):** every placement/destroy change fires the **`PlaceBuildings` command** (`packages/contracts/src/commands/placeBuildings.ts`): the client applies it optimistically (`applyPlaceBuildings`, `packages/engine/src/settlement/placeBuildings.ts` — net cost re-derived, affordability revalidated, construction timers recomputed server-side for new placements), the server re-runs the same reducer against its own row, dual-writes, and appends a `BuildingsPlaced` event. The command is tracked by the turn controller, so End Turn drains it before the round wraps — placements made in the planner are guaranteed visible to the construction tick.
- **New placements now construct over time (shipped):** a newly placed building enters `BuildingDef.construction = { daysRemaining: buildDays }` (set at palette confirm), ticks down once per round wrap (`advanceBuildingConstructions`, `packages/engine/src/settlement/advance.ts`), produces nothing while in flight (`producerTurnOutput` skips it), and renders the same stage sprites as upgrades. The field persists via `settlement_buildings.construction` (migration 013) and is removed on completion. This closes finding F5.

### 6.4 Building, town hall, and settlement upgrades

All upgrades deduct costs **immediately at initiation** and are **server-authoritative** commands. One upgrade in flight per settlement; upgrades survive capture.

- **Generic buildings** (`buildingUpgradeCost`, `packages/engine/src/buildingRegistry.ts`): placement cost × **1.5** for L2, × **3.0** for L3; 4 days (L2) / 7 days (L3). Multiple buildings can be batched into one request — costs sum, days = max.
- **Town Hall** — canonical table [`packages/engine/src/settlement/upgradeTownHall.ts:3-6`](../packages/engine/src/settlement/upgradeTownHall.ts):

  | | L1→L2 | L2→L3 |
  |---|---|---|
  | Gold | 1,500 | 5,000 |
  | Wood | 15 | 40 |
  | Stone | 10 | 25 |
  | Days | 7 | 12 |

- **Settlement tier** (`packages/engine/src/settlement/upgradeSettlement.ts:4-7`):

  | | L1→L2 | L2→L3 |
  |---|---|---|
  | Gold | 5,000 | 15,000 |
  | Wood | 40 | 80 |
  | Stone | 30 | 60 |
  | Iron | 20 | 50 |
  | Arcane | — | 20 |
  | Days | 15 | 25 |

  Requires population ≥ the configurable gate (default 85% of level cap) and Town Hall level ≥ target. On completion, the precomputed `newResourceRates` (computed at the **target** level) replace the old rates.

- **In-progress visuals (shipped):** while an upgrade is in flight, the city view renders targeted buildings with shared construction-stage sprites instead of the finished building: stage 1 (staked plot + wood pile) below 5% progress, stage 2 (foundation + low scaffolding) from 5%, stage 3 (scaffolded near-complete shell) at ≥ 75%, then the real building sprite on completion. Progress = `1 − daysRemaining / totalDays`, where `totalDays` is derived from the cost tables (`upgradeTotalDays`, `packages/engine/src/settlement/construction.ts`) — TH 7/12d, buildings 4/7d (max across batch requests), settlement tier 15/25d. The `settlement`-tier upgrade stages nothing (it has no grid building). Wiring: `CitySceneInput.upgrades` → `CityBuildingNode.constructionStage` → `paintCityBuilding` resolves `building.pixel.underConstruction.{stage}`.

### 6.5 Charter provisioning

Founding a settlement costs, immediately and non-refundably (`packages/engine/src/charter/start.ts:10-12`): **2,500g from the hero's purse** + **20 wood + 15 stone from the provisioning settlement's warehouse**. Construction takes 10 days after travel; defeat at any point forfeits everything.

### 6.6 Trade between settlements

- **Manual** (`tradeResources`, `packages/engine/src/economy/trade.ts`): same-owner settlements only; the sending settlement pays `amount` **gold** (1:1) and ships up to `min(warehouse stock, gold)`. The engine accepts any warehouse resource, but the UI modal (`src/screens/settlements/tradeModal.ts:18`) offers only wood/stone/iron/arcane.
- **Auto-trade** (`runAutoTrade`, same file): runs in the EndTurn pipeline for the active player's settlements with `autoTrade: true`. It covers **deficits only**, for **food, wood, stone** — never iron/arcane (they have no upkeep, commented at `trade.ts:17`). Each deficit pulls from other owned settlements that have surplus stock *and* gold, at 1:1 gold; every leg is recorded as an `AutoTradeTransfer` and surfaced by the EndTurn result.

### 6.7 Hero gold flows

- **Weekly upkeep** (`packages/engine/src/hero/upkeep.ts`): 1g per troop, deducted from the purse; if the purse can't cover it, gold drops to 0 and **troops are lost down to the gold that was available**.
- **Hero recruitment**: `recruitHero` costs **1g** — a placeholder (max 5 heroes/player, `packages/engine/src/hero/recruit.ts:5-6`).
- **Deposit/withdraw** (`transferGold`, `packages/engine/src/economy/transfer.ts`): hero ↔ settlement treasury, same-hex only, **all-or-nothing** (see [finding F9](#F9)).
- **Combat**: the winner takes the loser's entire purse; a chartering hero's defeat forfeits all charter costs.

## 7. Buildings ↔ resources

The registry is [`packages/engine/src/buildingRegistry.ts`](../packages/engine/src/buildingRegistry.ts) (16 kinds). Placement gold → treasury; materials → warehouse.

| Kind | Placement cost | Build days | Upkeep ×level (wood/stone) | Settlement effects | Player effects | Recruits |
|------|---------------|-----------|---------------------------|--------------------|----------------|----------|
| townHall | — | 0 | 3 / 2 | — | control range +1 | — |
| house | 100g 5w | 2 | 1 / 0 | population +50 | — | — |
| tower | 300g 8w 5s | 4 | 1 / 1 | defense +1 | vision +2 | — |
| mageGuild | 400g 5w 8s 2a | 6 | 1 / 1 | arcane yield +3 | — | mage 500g + 2a |
| mine *(legacy, not in palette)* | 250g 6w 4s | 4 | 2 / 0 | wood/stone/iron yield +3 | — | — |
| stoneMine | 250g 6w 4s | 4 | 2 / 0 | stone yield +3 | — | — |
| ironMine | 250g 6w 4s | 4 | 2 / 0 | iron yield +3 | — | — |
| market | 200g 8w 5s | 3 | 1 / 1 | gold +40/turn | — | — |
| barracks | 300g 10w 6s | 5 | 2 / 1 | defense +2 | — | swordsman 200g |
| smithy | 250g 5w 6s | 4 | 1 / 1 | unit cost −10% | — | — |
| apartment | 300g 12w 6s | 5 | 2 / 0 | population +100 | — | — |
| farmField | 120g 3w | 2 | 0 / 0 | food +5/turn | — | — |
| farmhouse | 80g 4w | 2 | 1 / 0 | food +2/turn, population +20 | — | — |
| archeryRange | 350g 8w 5s | 4 | 1 / 1 | defense +1 | hero attack +1 | archer 250g + 2w |
| granary | 150g 8w 4s | 3 | 1 / 0 | food +3/turn | — | — |
| bank | 400g 6w 8s | 5 | 1 / 1 | gold +60/turn | — | — |
| goldMine | 300g 6w 4s | 4 | 2 / 0 | gold +40/turn | — | — |
| woodcutterHut | 150g 5w | 3 | 1 / 0 | wood yield +3 | — | — |
| arcaneFont | 350g 5w 6s | 4 | 1 / 1 | arcane yield +3 | — | — |

**Wired vs. dormant — which of these actually do anything:**

| Effect | Status |
|--------|--------|
| `controlRangeBonus` (townHall) | ✅ **Wired** — feeds territory/control range (`packages/engine/src/control.ts:5-11`) |
| `goldPerTurn` (market/bank/goldMine) | ⚠️ **HUD-only** — counted in the HUD income preview, never accrued ([F2](#F2)) |
| `foodPerTurn`, `populationBonus` | ❌ **Dormant** — displayed in building menus, never applied ([F3](#F3)) |
| `resourceYieldBonus` | ⚠️ **Producer-only** — dormant as a generic bonus, but its magnitude is the base output for producer mines, which *are* applied (§9) |
| `defenseBonus`, `unitCostReductionPct`, vision/speed/attack bonuses | ❌ **Display-only** — no combat or fog wiring reads them |

Level-scaling nuances (`buildingSettlementEffects`, `buildingRegistry.ts:249-261`): `goldPerTurn`, `foodPerTurn`, `populationBonus`, and `defenseBonus` scale ×level; `resourceYieldBonus` and `unitCostReductionPct` are returned **flat** (no ×level).

Recruit costs (`RecruitEntry`) are shown in the building menu; actual unit recruitment is not wired ([F7](#F7)).

## 8. City spots & mines (status)

`generateCitySpots()` (`packages/engine/src/settlement/citySpots.ts`) places **3 / 6 / 9** resource spots on the 5×5 / 10×10 / 15×15 city grids, drawn from the pool `gold, wood, stone, iron, arcane` (never food), and **always returns `mines: []`** (lines 35, 60). `SettlementState.cityMines` is therefore empty in all live state, and neither spots nor mines contribute anything to `resourceRates`. Spots themselves now matter through the producer system (§9–10): a spot cell's own resource rolls its multiplier on the 3.0 peak.

---

## 9. Producer mines on city cells (**Shipped 2026-09-27**)

User-directed design, locked and implemented 2026-09-27.

**Spot → producer mapping and base outputs (× cell multiplier, see §10):**

| Spot resource | Producer building | Base output (L1, before multiplier) | Output goes to |
|---|---|---|---|
| gold | `goldMine` | 40 gold × level | Settlement treasury |
| wood | `woodcutterHut` | 3 wood × level | Warehouse |
| stone | `stoneMine` | 3 stone × level | Warehouse |
| iron | `ironMine` | 3 iron × level | Warehouse |
| arcane | **"Arcane Font" (new kind, shipped)** | 3 arcane × level | Warehouse |

Legacy `mine` (pre-split saves) still produces — iron on an iron spot, stone otherwise — but is no longer offered in the build palette. Every resource now has exactly one dedicated gathering building in the palette, grouped together in the palette's **Production** section — the build list is classified into Troop Buildings / Production / Civilian by registry data (`buildListSections.ts`, 2026-09-28).

- **Placement:** producers are placeable on **any empty buildable cell** — not only on matching spots. A spot's value is that its own resource peaks at **3.0×** there (§10); off-spot placement is legal but usually mediocre. Existing overlap rules apply (footprint per cell, center reserved).
- **Output numbers** reuse existing registry constants (`goldMine.goldPerTurn = 40`; the shared `+3` magnitude). Level scaling follows the registry's ×level convention; producers upgrade via the existing L2/L3 path (cost ×1.5 / ×3).
- **Arcane Font stats** (as shipped in `buildingRegistry.ts`): placement `{gold 350, wood 5, stone 6}` — deliberately no arcane input, since it *is* the arcane source; upkeep `{wood 1, stone 1}`; `buildDays 4`.
- **Tick integration (shipped):** `produceSettlementResources(settlements, seed)` (`packages/engine/src/settlement/produceResources.ts`) sums `base × cellMultiplier(cell, producer resource)` over all producer buildings per settlement — gold to the treasury (rounded to 2 decimals), the rest to the warehouse. `applyEndOfTurnDetailed` passes `state.castleSeed`. Base amounts are read from the registry (`goldMine.goldPerTurn` = 40; `resourceYieldBonus` magnitudes = the shared `+3`), so there is one source of truth. This supersedes the dormant `resourceYieldBonus` semantics for producers ([F3](#F3) covers the remaining unwired effects).
- **Server authority:** placement currently has no server command ([F4](#F4)); this implementation keeps the client-side deduction. A future `PlaceBuildings` command remains the trustworthiness fix.
- **UI:** clicking a producer building in the city view shows a multiplier line — `Cell ×1.23 → +49.20 gold/turn` — computed from the same engine functions (`producerTurnOutput` via `CityView.cellOutputFor`, seeded with `GameState.castleSeed` passed into `CityView.open`).

## 10. Deterministic cell multipliers (**Shipped 2026-09-27**)

User-directed design, locked and implemented 2026-09-27. Every cell of the city grid carries a **resource multiplier for every resource**, computed on the fly and **never stored**.

**Equation:**

```
inputs:  seed (GameState.castleSeed -- a deterministic derivative of the persisted map seed),
         q, r (settlement position), gx, gy (cell), res (resource id)

h1 = hash32(seed, q, r, gx, gy, res, 0x9E3779B9);  u1 = h1 / 2³²   (guard u1 > 0)
h2 = hash32(seed, q, r, gx, gy, res, 0x85EBCA6B);  u2 = h2 / 2³²

z  = sqrt(-2 · ln u1) · cos(2π · u2)          # Box–Muller
m  = peak + 0.25 · z                          # σ = 0.25, UNCLAMPED
peak = 3.0  if (gx,gy) is a spot cell and res == spot.resource
      = 1.0  otherwise

display: round(m, 2);  producer output = base × m
```

Locked properties:

- **Distribution:** Gaussian. Normal (cell, resource) pairs peak at **1.0**; a spot's own resource peaks at **3.0** (user revised an earlier 2.0 → 3.0). σ = 0.25 with **no clamp** — normal cells mostly roll 0.5–1.5 with rare tails; a spot's resource mostly rolls 2.5–3.5, and a lucky off-spot cell can occasionally rival an unlucky spot.
- **Determinism:** `hash32` must be exact integer math (splitmix32/mulberry32-style — **not** `Math.sin` tricks or `Math.random`) so client, server, and reload compute bit-identical values. The function should be a pure module in `packages/engine` and unit-testable under the repo's `node:test` pattern; the doc-writing test includes a "same inputs → same outputs" determinism case.
- **Seed source (shipped):** the engine API (`cellMultiplier`, `packages/engine/src/settlement/cityMultipliers.ts`) takes an explicit `seed`; the EndTurn tick passes `GameState.castleSeed` — which is *deterministically derived from the persisted map seed* on both sides (client `src/game/initState.ts`, server `packages/engine/src/hydrate.ts:166`), because `GameState` does not carry the raw map seed and `castleSeed` has no dedicated server column. The zero-new-persistence guarantee holds: every hash input is either persisted (the map seed via its deterministic derivative, plus settlement position) or already in state (buildings, spots). The hash is versioned in-module (`CELL_MULTIPLIER_HASH_VERSION = 1`) so future re-rolls are explicit.
- **Storage win:** no multiplier columns or tables. The stored `citySpots` array (positions + resource, already persisted) stays as-is; the ~25–225 cells × 6 resource values per settlement are computed, never written.
- **Risks to document:** changing the hash, σ, or peaks silently re-rolls every existing city's multipliers (there is nothing stored to migrate) — acceptable pre-1.0; suggest naming/versioning the hash in `packages/engine`. Unclamped tails mean rare extreme cells (e.g., a 3.8× gold cell) — accepted by design choice.

Illustrative shape (values below are *examples* of the distribution, not precomputed):

| Cell | gold | wood | stone | iron | arcane | food |
|------|------|------|-------|------|--------|------|
| (3,4) — normal | 1.12 | 0.94 | 1.31 | 0.77 | 1.05 | 0.88 |
| (2,2) — **gold spot** | **3.08** | 1.03 | 0.91 | 1.17 | 0.96 | 1.10 |
| (0,1) — normal (unlucky tail) | 0.46 | 1.52 | 0.71 | 0.95 | 0.62 | 1.24 |

---

## 11. Findings & suggestions

Each finding: behavior, evidence, suggestion. All are documentation-only observations; none is a code change request.

<a id="F1"></a>
**F1 — Food is a dead-end resource (highest impact).** Food has no production source — zero tile density (§2), `foodPerTurn` never applied (§7) — yet every settlement consumes `ceil(pop/100)` per turn (§6.1). Warehouses hit 0 food almost immediately, so food-deficit morale decay is effectively permanent and gold income is permanently suppressed. *Suggest:* wire `foodPerTurn` into the production tick and/or give food a tile density; until then, the guaranteed-deficit behavior should at least be a conscious decision.

<a id="F2"></a>
**F2 — HUD income ≠ actual income.** `playerIncome()` includes building `goldPerTurn` and feeds the HUD's next-turn gold (`src/managers/UIManager.ts:473`), but `applyEffectiveIncome()` accrues only `pop × tax × morale/100` (§6.2). *Suggest:* either include `goldPerTurn` in `effectiveIncome` or exclude it from the HUD number. (The HUD hover breakdown added 2026-09-29 — see §6.2 — surfaces this in-game; the numbers themselves are unchanged.)

<a id="F3"></a>
**F3 — Defined-but-unwired building effects.** `foodPerTurn` (farmField/farmhouse/granary), `resourceYieldBonus` (mine/mageGuild/woodcutterHut), and `populationBonus` (house/apartment/farmhouse) exist in the registry and render in menus, but nothing applies them to warehouses or population. `defenseBonus`, `unitCostReductionPct`, and the vision/speed/attack player effects are display-only too — the only wired player effect is `controlRangeBonus`. *Suggest:* an `applyBuildingSettlementEffects` step in the EndTurn pipeline, a population-formula hook, and combat/fog wiring for the player effects — or delete the dead fields (the repo's own lesson: an unwired parallel implementation is not a safe intermediate state).

<a id="F4"></a>
**F4 — ~~Placement is client-trusted~~ RESOLVED (2026-09-27).** The `PlaceBuildings` command now commits the city view's working cart server-side (net cost re-derived and affordability revalidated against the server's own row; construction timers recomputed for new placements). *(Was: costs deducted client-side on city-view close via `UIManager.ts:189-215` with no server round-trip.)*

<a id="F5"></a>
**F5 — ~~`buildDays` is cosmetic~~ RESOLVED (2026-09-27).** Registry build days now gate new placements: `BuildingDef.construction` counts down per round wrap and the palette's displayed days are the real construction time. *(Was: placement was instant; only upgrades had timers.)*

<a id="F6"></a>
**F6 — No warehouse capacity.** Warehouses are uncapped, and granary's description ("increases food storage") promises a mechanic that doesn't exist. *Suggest:* either implement caps (granary/granary levels raising them) or reword the description.

<a id="F7"></a>
**F7 — Recruitment is display-only.** `RecruitEntry` costs render in the building menu, but the archery-range button's `onRecruitArcher` callback is never supplied (`initCityView` passes no such handler), so no unit recruitment deducts resources. Consistent with the army milestone deferral ([army.md](./army.md)). *Suggest:* wire recruitment through a server command when army.md lands.

<a id="F8"></a>
**F8 — Trade asymmetries.** The engine permits trading food; the UI excludes it. Auto-trade covers only food/wood/stone deficits (iron/arcane can never be deficit-covered — by design, they have no upkeep). The flat 1:1 gold rate is steep against high-yield tiles. *Suggest:* align UI and engine on food, and consider a rate/margin pass when the economy gets tuning.

<a id="F9"></a>
**F9 — `transferGold` is all-or-nothing**, same-hex only. *Suggest:* amount entry if it ever matters gameplay-wise.

<a id="F10"></a>
**F10 — `cityMines` dormant.** Always empty (`citySpots.ts:35,60`); spots/mines are decoupled from `resourceRates`. Resolved by §9–10 (shipped) — spots now matter through producer multipliers; the `cityMines` array itself remains unused scaffolding.

## 12. Doc drift appendix

Stale claims in older docs, with corrections. The older docs were intentionally left unedited (link-only edits); this doc is the as-built authority.

| Doc | Stale claim | As-built |
|-----|-------------|----------|
| [resources.md](./resources.md) | Aggregation over "radius of 3 hexes" | `level − 1` → 0/1/2 hexes for L1/L2/L3 (`control.ts:13`) |
| [resources.md](./resources.md) | "5 resource types" | Code has 6 — food is in the type union and warehouse, with zero production |
| [resources.md](./resources.md) | Source paths `src/map/resourceTiles.ts`, `src/economy/settlementRates.ts` | Engine lives in `packages/engine/src/map/` and `packages/engine/src/economy/` (client keeps `src/map/` mirrors) |
| [economy.md](./economy.md) | Warehouse lists wood/stone/iron/arcane only | `food` is a warehouse resource too (unproductive, see F1) |
| [economy.md](./economy.md), [settlements.md](./settlements.md) | Implementation pointers into `src/state/gameState.ts`, `src/views/…`, `src/economy/…` | Reducers are in `packages/engine/…` + `packages/contracts/…`; menus/screens under `src/screens/…`; the EndTurn pipeline is server-authoritative via `server/app/turnService.ts` |
| [README.md](./README.md) | "No food in v1" | Food exists end-to-end in the data model; only its production is zero |

## 13. Cross-references

- What the resources are and their intended roles: [resources.md](./resources.md)
- The per-turn loop from the design side: [economy.md](./economy.md)
- Settlements, charters, upgrades, capture: [settlements.md](./settlements.md)
- The city view the specs build on: [city-view-impl-plan.md](./city-view-impl-plan.md)
- Where army upkeep/recruitment picks up: [army.md](./army.md)
- Module dependency map: [module-documentation-and-relationships.md](./module-documentation-and-relationships.md)

[← Back to index](./README.md)
