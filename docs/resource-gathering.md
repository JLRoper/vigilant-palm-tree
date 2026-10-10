# Resource Gathering & the Settlement Economy (as-built)

**Status:** ✅ Current. This is the **as-built reference** for how resources are collected and how buildings use them, as the code actually behaves on **2026-10-01** (economy/storage/storage-cap milestone), with §4/§5/§6.6/§6.7 re-verified against the **2026-10-02 no-shared-storage / caravan logistics rework** (trade routes, caravan maintenance, recommendations, the `lobby.legacyAutoTrade` gate). Design *intent* lives in [resources.md](./resources.md) and [economy.md](./economy.md); where those older docs and this one disagree on numbers, this one matches the code (see the [drift appendix](#12-doc-drift-appendix)). Sections 9–10 were forward-looking specs when written and are **now implemented** (2026-09-27, same day) — they describe live behavior.

Source-of-truth paths cited below are in [`packages/engine/`](../packages/engine/src) and [`packages/contracts/`](../packages/contracts/src). The client under `src/` mirrors the same reducers (`src/state/turnController.ts` orchestrates locally; `server/app/turnService.ts` re-runs the same engine functions server-authoritatively).

---

## 1. Resource types & pools

Defined in [`packages/contracts/src/resources.ts`](../packages/contracts/src/resources.ts): six `ResourceType`s — `gold`, `wood`, `stone`, `iron`, `arcane`, `food`.

Gold is deliberately different from everything else — it has **no warehouse entry** and lives in **two separate pools**:

| Pool | Field | Moves with | Spent on |
|------|-------|-----------|----------|
| Hero purse | `HeroState.gold` | the hero | chartering (2500g); looted by the winner **on defeat** only (2026-09-29 outcomes) — retreat keeps it, surrender pays its gold cost |
| Settlement treasury | `SettlementState.gold` | the settlement | building placement/upgrades, recruitment, trade-route caravan loading, legacy auto-trade |

The other five are `WarehouseResource`s, held in the per-settlement `Warehouse` (`{ wood, stone, iron, arcane, food }`). Hero pools are capped by wagons: the purse by **treasury carts** (`heroGoldCap = treasuryWagons × 500`), wagon cargo by the army slot (`heroResourceCap = wagons × 50` per resource) — see §6.7.

Stockpiles are **capped, softly** (`packages/engine/src/settlement/capacity.ts`): a derived per-level base (`BASE_STORAGE` 500 / 1,500 / 4,000) plus every building's `storageBonus` (granary +600 food, warehouse +600 on all five, both ×level). A cap gates *additions* only — stock above cap is never destroyed, it just cannot grow. Gold has a parallel treasury cap (`BASE_TREASURY` 1,500 / 4,000 / 10,000 + every `treasuryBonus`; treasury +2,000, bank +2,000, warehouse +500, all ×level). See [finding F6](#F6).

## 2. Where resource tiles come from

[`packages/engine/src/map/resourceTiles.ts`](../packages/engine/src/map/resourceTiles.ts):

- Each passable tile rolls once against a **per-terrain density table** (`RESOURCE_DENSITY`). Water and mountain are excluded entirely.
- **Mountain spillover:** a passable tile adjacent to a mountain gets its stone and iron density boosted ×1.5 (caps 0.2 / 0.15) — mountains themselves can't hold tiles, so ore "spills" onto their borders.
- Per-tile yields (`RESOURCE_YIELD`): **gold 20, wood 15, stone 12, iron 8, arcane 5, food 10**.
- **Food's density is 0 on every terrain**, so food tiles never spawn and `RESOURCE_YIELD.food = 10` remains dead weight. That is a **deliberate design ruling, not a gap**: food comes from farm *buildings* inside a city, never from map tiles — see §9.

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
radius  = settlementRateRadius(level) = level          # L1 → 1, L2 → 2, L3 → 3
```

Source: `computeSettlementRates()` in [`packages/engine/src/economy/settlementRates.ts`](../packages/engine/src/economy/settlementRates.ts), radius in [`packages/engine/src/control.ts`](../packages/engine/src/control.ts) (`settlementRateRadius`, line 13).

> **Radius corrected (2026-10-01).** The function used to return `level − 1`, so an L1 settlement scanned **exactly one hex — its own tile** — and castles cannot stand on a resource tile (`map/castlePlacement.ts`), which made L1 tile income provably zero. It now returns `level`. Measured effect: an L1 gains **+10 wood/turn**.
>
> **Drift warning:** older docs say settlements aggregate over "radius 3". The code uses `level` — 1/2/3 hexes for L1/L2/L3.

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
| autoTrade | `false` (2026-10-02 — every settlement is born `false`, and the game-level `lobby.legacyAutoTrade` gate that `runAutoTrade` also reads is `false` on every new game) | `false` |
| Buildings | seeded with the starter set — see below | `[]` (the free starter set lands when the city view first opens) |

Each hero also starts with a 300g purse (`makeHeroes`, `initState.ts:100`).

**Starting buildings (2026-10-01; second woodcutter 2026-10-02; farmhouse 2026-10-04).** `buildStarterLayout` ([`packages/engine/src/settlement/starterLayout.ts`](../packages/engine/src/settlement/starterLayout.ts)) is the single definition of a new settlement's city: `townHall L1 + farmField L1 + 2× house L1 + 2× woodcutterHut L1 + stoneMine L1 + farmhouse L1` — **10 wood + 2 stone** per turn, with the farm fields as the food source and the three producers making wood and stone income a function of the *settlement* rather than of where the map happened to roll its resource tiles. It replaced the old behavior, which handed an empty settlement `cityBuildingGen`'s denseUrban layout (~14 buildings, a level-2 town hall, **no producer at all**) for free: ~24 wood + 14 stone per turn against a 300/300 starting stock, bankruptcy by roughly turn 12.

**Every** settlement is seeded with it at init (`seedStarterBuildings`, `init.ts`), town hall included — not just the ones too big for the base set. A settlement that already has buildings skips the city view's free commit, so one created empty would never be handed a city at all. The old rule returned `[]` for anything the base set could feed and bet on that free commit, which is why the level-1 keep was created empty in **60/60** seeds and produced nothing.

**Each settlement is sized against its OWN bill (2026-10-02).** Farms are 2×2 cells that live in one city grid. `starterFarmsNeeded(foodRequiredPerTurn)` takes a **food bill, not a population**, and `init.ts`'s `seedStarterBuildings` sizes every settlement against **its own** mouths: its population bill, plus the weekly bill of the seat's starting hero **on the settlement that hero stands on** (the seat's first castle) — `hero/upkeep.ts`'s narrowed rule draws that bill out of only the city the hero occupies, so that is the city the sizing must feed. There is no owner-wide pool anymore: the pool existed to feed the instant auto-trade teleport, and the teleport is gone for new games (`lobby.legacyAutoTrade: false`). With auto-trade off, each settlement **accumulates** its own production surplus instead of being drained to exactly `foodRequired` every turn, which is what makes per-settlement sizing survivable (it was not under the pooled-teleport regime).

A 1-player game seats 0 on a level-1 keep (500 → 5/turn **plus the starting hero's 40/week ≈ 5.7/turn**) **and** a level-2 town (1,500 → 15/turn); the two neutral level-3 castles (5,000 → 50/turn) eat only their own bills:

| Settlement | Population | Own food bill | Farm fields | Layout |
|---|---|---|---|---|
| L1 keep (player start) | 500 | ~10.7/turn (pop + hero) | **3** placed (`starterFarmsNeeded(10.7)` asks 4; a 5×5 grid physically holds 3 farm fields beside the town hall) | `townHall1 + farmField1 + house×2 + woodcutterHut×2 + stoneMine1 + farmhouse1` on 5×5, requested with `farms: 4` |
| L2 town | 1,500 | 15/turn | **4** (`= starterFarmsNeeded(15)`) | same set with `farmField×4` + `farmhouse1` on 10×10 |
| L3 castle (AI-seat start) | 5,000 | pop + the seat's starting "Warlord" | **12** | same set with `farmField×12` + `farmhouse1` on 15×15 |
| L3 castle (neutral, 2 per game) | 5,000 | 50/turn | **11** (`= starterFarmsNeeded(50)`) | same set with `farmField×11` + `farmhouse1` on 15×15 |

The owner-pool rule that sat between the two per-settlement sizings (2026-10-01 → 2026-10-02) put a seat's whole bill in its largest city (`starterPoolKey` grouping + `foodRequiredForPopulations`, both deleted); it died with the teleport it fed.

**Coverage, re-measured over 4000 seeded 1-player games** against each settlement's own bill, with the real per-cell multipliers (never the peak; per-farm multiplier over 24,000 real farm cells runs **min 0.02, mean 1.067, max 3.86**, and a negative draw is possible in principle — `addStockClamped` drops a non-positive addition, so a farm's real floor is 0 food/turn): the keep's 3 fields cover its bill on turn 1 in **98.05%** of games and the town's 4 in **98.25%** (the neutral figure, 90.54%, is notional — neutrals never consume). The misses are buffered by accumulation: simulating **22 `applyEndOfTurn` turns** on the same games produced **zero 22-turn morale collapses** across seeds — the keep runs on its accumulated surplus where the clamp bites, which is exactly the regime the teleport's removal created.

`starterFarmsNeeded(foodRequiredPerTurn)` sizes a farm's **plain-cell** output — `foodPerTurn (5) × CELL_MULTIPLIER_PEAK (1.0)` = 5 food/turn, the median cell rather than the 3.0× spot peak (§10) — against the bill, then pads by `STARTER_FARM_VARIANCE_HEADROOM = 1`. The headroom is not re-tuned per bill: a farmField's upkeep is 0 wood / 0 stone, so an extra field costs only four grid cells. (For reference, against a *single* 15/turn town the sweep gives 3 fields 51.1%, 4 → 98.0%, 5 → 100%.)

**Wood and stone arithmetic** (per settlement, with the map's resource-tile rates zeroed): **two** `woodcutterHut` (2026-10-02 — a single hut's 3 wood/turn only cancelled the producers' own upkeep, leaving every starter city net wood-negative) at +3 wood / 1 wood upkeep each, and `stoneMine` +3 stone / 0 stone upkeep, against the set's fixed 3 wood (town hall) + 2 wood (two houses) + 2 wood (huts) + 2 wood (mine) + 1 wood (farmhouse, 2026-10-04; 0 stone) = **10 wood + 2 stone** upkeep. Per turn: `wood = floor(3×m1) + floor(3×m2) − 10` = **−8..−2, median −4**, and `stone = floor(3×m_stone) − 2` = 0..+3, median 0 — measured over 400 seeded 1-player games on the pre-farmhouse set (the farmhouse's flat 1 wood shifts every figure one lower): keep median −3.06 / town −2.90 / neutral −3.03, worst −6.84. The single-hut set ran the same measurement at −4..−7, **median −5**, worst −7.34, so the second hut (+1 upkeep, ~+3 production) roughly doubles the wood runway: from the 300/300 start that is **≈100 turns at the median cell (was ~60), ~43 at the worst (was ~41), and 33 turns of guaranteed worst-case runway**; stone runway is 150 turns. The set is still not wood-positive by itself — the map's resource tiles are what keeps a settlement solvent in practice (over those same 400 seeds about a fifth of keeps sat on a wood-yielding tile and ran +9..+55 wood/turn). Gold gets no producer on purpose — `applyEffectiveIncome` already pays `population × goldTax × morale / 100` every turn regardless of the map (500/turn at the keep, 3,000/turn at the town at morale 100 — [economy.md](./economy.md)'s worked example is authoritative; an earlier "5/turn, 30/turn" figure here was doc drift).

**Neutrals are not part of any player's bill.** `applyEndOfTurnDetailed` produces for every settlement but gates consumption, morale decay and income on `s.ownerId === playerId` — so a neutral never eats and its food simply piles up at the warehouse cap. Per-settlement sizing handles them by construction: with no hero ever spawning on one and no trade partner (their `ownerId` is null), each neutral's bill is exactly its own population, so each is sized independently — two neutrals of equal population get equal farms. The deleted `starterPoolKey` grouping existed only to keep a former owner-*class* pool from lumping them together; with no pool at all, there is nothing to group.

The city view's free commit is now guarded by `starterCityOnOpen({ existing })`: a settlement that already has buildings returns its own array with `free: false`, so no `PlaceBuildings` is sent and the town hall is never dropped. Since init seeds everything, that free commit only fires for a settlement created *later* — by a charter, or as a test fixture — which is exactly the case `placeBuildings.test.ts` pins.

## 5. The per-turn pipeline

Per player's **EndTurn** — [`applyEndOfTurnDetailed()`](../packages/engine/src/turn/endTurn.ts), mirrored server-side by `runEndTurn()` in [`server/app/turnService.ts`](../server/app/turnService.ts) (the same three engine reducers, run against the authoritative DB row):

1. Hero movement reset for the active player's heroes.
2. **Production** — `produceSettlementResources()` (`packages/engine/src/settlement/produceResources.ts`): for **every settlement regardless of owner**, `warehouse[r] += resourceRates[r]`, plus the producer-building loop (§9). Additions are clamped to the settlement's stockpile / treasury caps (§1).
3. **Auto-trade** for the active player's settlements — **legacy only** now (see §6.6): the game-level `lobby.legacyAutoTrade` gate is `false` on every new game, so this step moves nothing there; resources travel by caravan instead (§6.6).
4. **Consumption → morale decay → effective income**, in that order, for the **active player's settlements only** (`packages/engine/src/economy/consumption.ts`).

On the **round wrap** (last player ends) — [`advanceRound()`](../packages/engine/src/turn/round.ts):

5. Day +1, turn order resets to player 0, all heroes' movement reset.
6. `matureBankWithdrawals()` — **daily**, every matured bank withdrawal pays into the treasury (clamped by headroom; the unpaid remainder is pushed back to `pendingOut`, never destroyed).
7. `advanceCharters()` — constructing charters tick down; completed ones found their settlement.
8. `advanceSettlementUpgrades()` — town hall / settlement / building upgrade timers tick down; completed ones apply.
9. **Weekly upkeep** when `day % 7 === 0` (`applyWeeklyUpkeep`): **caravan maintenance FIRST** (§6.6 — `economy/caravanUpkeep.ts`, billed before hero upkeep so caravans are "paid first and desert last") + hero upkeep (§6.7) + population growth (§6.1) + `accrueBankInterest()` on every bank pot (§6.8).

## 6. Resource sinks

### 6.1 Consumption, morale, and population growth

`packages/engine/src/economy/consumption.ts`:

- **Food:** `foodRequired = ceil(population / 100)` per turn (`FOOD_PER_POPULATION = 100`). **Population is divided by 100**, and there is **no garrison term** — the garrison's weekly food bill is a separate charge (see [army.md](./army.md)) that this per-turn figure does not include.
- **Building upkeep:** `Σ buildingUpkeep(kind, level)` where `upkeep = upkeepPerLevel × level`, paid in **wood and stone** from the warehouse.
- Both deductions clamp at 0 — a deficit never goes negative, it just stays empty.
- **Morale decay** per turn: `(foodDeficitRatio + suppliesDeficitRatio) × 10`, plus `+1` extra while morale < 50. Ratios are `(needed − have) / max(1, needed)`. `suppliesDeficitRatio` is **per-resource** — `max(woodRatio, stoneRatio)`, never pooled — so a wood surplus can no longer mask a total stone shortfall.
- **Morale recovery** (`MORALE_RECOVERY_PER_SUPPLIED_TURN = 4`, 2026-10-01): a settlement with **no food and no supplies shortfall** gains **+4 morale per turn**. Morale used to be subtract-only and unrecoverable. The gate is deliberately `foodDeficitRatio === 0 && suppliesDeficitRatio === 0`, **not** `moraleDecay(s) === 0` — `LOW_MORALE_EXTRA_DECAY` keeps `decay` positive below morale 50 even with zero shortfall, so a literal `decay === 0` gate would ratchet a fully fed settlement down forever.
- Morale is evaluated on **pre-consumption** state (`packages/engine/src/turn/endTurn.ts`), so a settlement holding exactly `foodRequired(population)` is not charged decay.
- **Effective gold income** per turn: `round(population × goldTax × morale / 100)` added to the treasury, clamped to treasury headroom. This is the **only** thing that adds treasury gold during the turn loop (plus bank interest and matured withdrawals, §6.8).
- **Population growth** (weekly): only if `warehouse.food >= foodRequired`; growth `= max(1, ceil(pop × growthRate))` (setting, default 10%, range 1–50%), capped at the level's population max. No food → no growth; the morale system handles the penalty.

### 6.2 Gold income vs. the HUD number

There are three "income" surfaces and they **disagree** (see [finding F2](#F2)):

- `settlementIncome()` / `playerIncome()` (`packages/engine/src/economy/income.ts`) = `pop × tax` **+ Σ building `goldPerTurn`** — this feeds the HUD's next-turn-gold display (`src/managers/UIManager.ts:473`).
- `effectiveIncome()` (`consumption.ts:48`) = `pop × tax × morale/100` — this is what actually accrues.
- `resourceRates.gold` (computed by `computeSettlementRates`, persisted, and previously rendered as a "40/turn" line) is a **phantom** — `produceSettlementResources` never consumed it, because gold is not a `WAREHOUSE_RESOURCE`. The per-turn rates display now renders **combined production** via `settlementProductionRates()` from `produceResources.ts` — `warehouseRates()`'s tile rates plus the per-building producers (§9) — (today in the logistics panel, `src/screens/logistics/logisticsModal.ts`, after the old settlement panel was deleted as an unwired second implementation): the *same loop body production uses*, so display and production cannot drift, and the panel's empty line reads **"no production"**. The persisted map is untouched.

Building `goldPerTurn` therefore *appears* in the HUD but never lands in the treasury — the only gold that actually accrues from buildings is a `goldMine` producer's output (§9).

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

  Requires population ≥ the engine-owned gate (`UPGRADE_POPULATION_GATE`, 85% of level cap — not player-configurable) and Town Hall level ≥ target. On completion, the precomputed `newResourceRates` (computed at the **target** level) replace the old rates.

- **In-progress visuals (shipped):** while an upgrade is in flight, the city view renders targeted buildings with shared construction-stage sprites instead of the finished building: stage 1 (staked plot + wood pile) below 5% progress, stage 2 (foundation + low scaffolding) from 5%, stage 3 (scaffolded near-complete shell) at ≥ 75%, then the real building sprite on completion. Progress = `1 − daysRemaining / totalDays`, where `totalDays` is derived from the cost tables (`upgradeTotalDays`, `packages/engine/src/settlement/construction.ts`) — TH 7/12d, buildings 4/7d (max across batch requests), settlement tier 15/25d. The `settlement`-tier upgrade stages nothing (it has no grid building). Wiring: `CitySceneInput.upgrades` → `CityBuildingNode.constructionStage` → `paintCityBuilding` resolves `building.pixel.underConstruction.{stage}`.

### 6.5 Charter provisioning

Founding a settlement costs, immediately and non-refundably (`packages/engine/src/charter/start.ts:10-12`): **2,500g from the hero's purse** + **20 wood + 15 stone from the provisioning settlement's warehouse**. Construction takes 10 days after travel; defeat at any point forfeits everything.

### 6.6 Trade & caravans

**Resources move physically (2026-10-02).** The instant transfers are gone for new games; everything ships by trade-route caravan (`packages/engine/src/logistics.ts`):

- **Trade routes** (`TradeRouteState` on `GameState.tradeRoutes`, `packages/contracts/src/gameState.ts`): `{ id, from, to, payload, wagons, caravan, unpaidSinceDay?, ownerId? }` with `TradeRouteEndpoint = { kind: "settlement" | "hero"; id }` and `TradeRoutePayload = { kind: "resource"; resource } | { kind: "gold" }`. Same-owner endpoints, any pair — city↔city and city↔hero. Legacy JSONB rows normalize in hydrate (`normalizeTradeRoute`, `packages/engine/src/hydrate.ts`), and `nextTradeRouteId` is derived at hydration (one past the highest persisted id — fixes a latent id-collision bug).
- **Route ownership & dormant routes (2026-10-04).** Every route carries a persisted `ownerId` — stamped at create, backfilled at hydrate from the persisted value, else the FROM/TO endpoint owners (explicit `null` only when both ends are dead heroes); `routeOwnerId` (`logistics.ts`) resolves the stamp, falling back to the FROM endpoint's live owner for legacy rows. A route whose **origin is captured/lost or whose origin hero is dead goes dormant**: it bills nothing, never deserts, never auto-removes, loads/delivers nothing while the ownership mismatch lasts, and persists until the persisted route owner removes it (`updateTradeRoute({ remove: true })` gates on the stamp, so a dead origin no longer makes a route unremovable and a capturer cannot remove a route that is not theirs). A captured **destination** receives nothing — the arriving caravan turns around with its cargo intact; if the origin is lost on the return leg, the cargo reroutes to the owner's nearest owned settlement, or rides aboard when the owner holds none (never destroyed).
- **Two caravan types**: a **cargo** caravan hauls one non-gold warehouse resource (`wagons × WAGON_RESOURCE_CAPACITY(50)`); a **treasure** caravan hauls gold (`wagons × WAGON_GOLD_CAPACITY(500)`). Deliveries clamp to the destination's headroom (settlement warehouse/treasury caps; hero `heroResourceCap`/`heroGoldCap`) — on the **delivery path** cargo is never lost: leftovers wait on the caravan and deliver as headroom appears. The removal paths are the two documented exceptions: a **manual remove** loses whatever is aboard (the player's explicit choice; the wagons return to the pool), and a **desertion auto-remove** returns what fits at the origin (owner-checked, headroom-clamped) with the leftover lost alongside the route. Hero endpoints re-path to the hero's live position (`CARAVAN_CATCHUP_REPATHS_PER_DAY = 3` per day); a hero destination dying sends the caravan home.
- **Caravan maintenance is paid FIRST** (`packages/engine/src/economy/caravanUpkeep.ts`, weekly inside `applyWeeklyUpkeep` before hero upkeep — "paid first so they desert last"). Each route with wagons bills `wagons × (1 gold + 1 food)`, drawn from the **origin** store (settlement treasury + warehouse; hero purse + larder), clamped to what is there — never into debt; a **dormant route** (origin captured/lost or its hero dead, §6.6 above) is skipped entirely — no bill, no streak, no desertion, no auto-remove. Fully paid clears the streak; short stamps `unpaidSinceDay`; after `DESERT_GRACE_WEEKS` (2) of unpaid charges the route loses `max(1, ceil(wagons × DESERT_COST_SHARE))` wagons per unpaid week — deserted wagons are **gone**, not returned to the pool. Wagons at 0 auto-remove the route (the disband first returns what fits of the aboard cargo at the origin); `TradeRouteRemoved` is emitted on that auto-disband **and** on manual remove (it was declared-never-emitted before 2026-10-02).
- **Recommendations** (`packages/engine/src/economy/tradeNeeds.ts`, `evaluateTradeNeeds(state, seat)`): food/gold only, to low settlements and heroes (food below `TRADE_LOW_FOOD_RATIO = 0.25` of the weekly requirement; gold when the garrison's weekly burn beats both income and one-week reserve; a hero when purse + larder can't cover its next bill; a same-tile source — the settlement the hero stands on — is never proposed). The logistics panel (`src/screens/logistics/logisticsModal.ts`) offers one-click accept per row and accept-all, and shows the per-turn **combined production** via `settlementProductionRates()`; the AI seats auto-accept through the same evaluator (`server/app/aiDriver.ts`, once per round+seat, up to `AI_MAX_ROUTES_PER_SEAT = 3`, buying wagons at the origin when short). An End Turn reminder toast (`src/screens/shared/tradeNeedsReminder.ts`) fires only when the seat has zero configured routes, deduped per session by recommendation key. Inter-settlement **gold** routes are structurally rare: treasuries sit at cap while income accrues (the cap fills within days at the 500–3,000/turn income scale), so the settlement-gold lane mostly matters for drained or captured treasuries — hero treasure routes are the everyday gold mover.
- **Legacy auto-trade** (`runAutoTrade`, `packages/engine/src/economy/trade.ts`) survives **behind the game-level `lobby.legacyAutoTrade` gate** (`ApplyEndOfTurnOptions.legacyAutoTrade`; absent → `true`, so every pre-2026-10-02 save keeps byte-identical behavior). New games write `false` at `POST /games` (optional `legacyAutoTrade` request body opts back in), so the pipeline's auto-trade step moves nothing and resources accumulate at their producing settlement. The per-settlement `autoTrade` toggle remains as a second gate. It covers **deficits only**, for **food, wood, stone** — never iron/arcane (they have no upkeep, commented at `trade.ts:17`) — and each leg records an `AutoTradeTransfer`.
- **Food surplus is reserved (2026-10-01).** A legacy source settlement's offer is `exportableStock(s, r)` — for food, `stock − foodRequired(s)`, for wood/stone the raw stock. Previously auto-trade liquidated a settlement's whole surplus and then evaluated it for morale at **0 food**, so a 100% food-deficit penalty applied forever to a settlement producing more than it ate. Anything *above* `foodRequired` is a genuine surplus and still trades. The garrison's weekly food bill is deliberately **not** reserved against — it needs the unit catalog, which `runAutoTrade` is not given, and it runs on a different cadence than this per-turn reservation.
- **The manual `tradeResources` command was deleted (2026-10-02)** — the settlement↔settlement instant transfer (same-owner, 1 gold per unit shipped) had no UI caller left (`settlementPanel.ts`/`tradeModal.ts` were already deleted as an unwired second implementation): reducer, command, event (`ResourcesTraded`), handler, parse branch, client optimistic path, and debug command are all gone. Deficit fill and surplus moving are the caravan chain's jobs now.

### 6.7 Hero gold flows

- **Weekly upkeep** (`packages/engine/src/hero/upkeep.ts`, narrowed 2026-10-02): gold from the purse, food from the **larder** (wagon cargo) — and food only, then, from the settlement **physically under the hero** (same hex, own-owned). The old owner-wide warehouse pool is gone with the teleport it fed; standing in the field or on someone else's town funds nothing. With auto-trade off, settlements accumulate surplus instead of draining to exactly `foodRequired`, which is what keeps the narrow gate survivable — and the caravan chain (recommender → route → caravan → larder) is the designed replacement. Honest cost: the default starting hero is funded 8/10 weeks by its keep's stores (was 10/10 under the pooled teleport); worst observed morale at day 21 is 63, no desertion, no collapse. The shortfall ladder itself (per-unit catalog bill, morale bleed, cost-weighted desertion after a 2-week grace) is [army.md](./army.md)'s Upkeep section.
- **Hero recruitment**: `recruitHero` costs **50g** (deducted from the recruiting settlement's treasury; max 5 heroes/player) and the new hero arrives with a **2–3 platoon starter army of 2–3 troops each**, drawn without replacement from the first three unit tiers — **peasant / pikeman / archer** — deterministically seeded from the game castle seed + seat + hero id (`packages/engine/src/hero/recruit.ts`), so the client's optimistic apply, the server's authoritative apply and any reload compute the identical army. It also allocates its **5 cargo wagons + 5 treasury carts from the player's unassigned pools** — the wagons and carts are drawn from what the player owns, never granted free.
- **Purse cap — treasury carts**: `heroGoldCap(hero) = (hero.treasuryWagons ?? 5) × 500` (`packages/engine/src/settlement/capacity.ts`), governed **separately** from the army `wagons` slot that caps cargo at `× 50` per resource. `BuyWagons`/`AssignWagons` take a `slot: "cargo" | "treasury"`; both pools live on `Player` (`wagonsOwned`/`treasuryWagonsOwned` + unassigned, JSONB; migration `023_treasury_wagons.sql` adds `heroes.treasury_wagons`). The cap is enforced at all three gold landing sites: battle loot (always was), the capture reward and treasury withdrawal (both clamp now, 2026-10-02).
- **Deposit/withdraw** (`transferGold`, `packages/engine/src/economy/transfer.ts`): hero ↔ settlement treasury, same-hex only. The command still moves the whole amount, but the **cap clamps the landing side** (withdraw clamps to `heroGoldCap` headroom — nothing is destroyed, the excess stays put; see [finding F9](#F9)).
- **Combat** (2026-09-29 hero outcomes): the purse is looted — wagon-capped, cargo included — only when a hero is **defeated** (wiped to zero troops; the hero is then removed from the map, and a chartering loser's charter is cancelled, costs forfeited). A **retreating** hero keeps the purse (its stacks are zeroed instead) and a **surrendering** hero pays the surrender cost and keeps the rest; both relocate to the nearest owned settlement.
- **Treasure caravans** (2026-10-02): a trade route with payload `{ kind: "gold" }` delivers into the destination purse/treasury at `wagons × 500` per load, clamped to headroom like every other caravan arrival — the third way gold reaches a hero in the field.

The designer's three gold sources for a hero, in one line: **pick up at a city** (deposit/withdraw, same hex), **battle or find on the map** (defeat loot, capture reward), **treasure caravans** (trade routes).

### 6.8 Bank pots

A `bank` holds a gold pot **of its own**, separate from the settlement treasury (`packages/engine/src/economy/bank.ts`):

- **Capacity:** `bankGoldCap(b) = 5000 × level` — level scales the *vault*, not the rate.
- **Deposit** moves gold from the treasury into the pot; **withdrawal** removes gold from the pot immediately into `pendingOut` and matures `BANK_WITHDRAWAL_DAYS = 7` in-game days later into `settlement.gold`.
- **Maturity ticks DAILY** (it is a countdown); **interest accrues WEEKLY** on the existing `day % 7` boundary at a flat `BANK_WEEKLY_INTEREST_RATE = 0.05` — deliberately **not** level-scaled, so a level-3 bank is a bigger vault rather than a gold printer.
- **Nothing is destroyed by a cap.** A matured withdrawal pays only up to treasury headroom; the unpaid remainder is pushed back into `pendingOut` (same maturity day) and lands on a later tick. Interest **stays in the pot**: clamping interest at the treasury cap would make the cap a game-breaking gate, and a pot-capped bank silently ceasing to earn would trap the player.

State lives on `BuildingDef.bank?: BankPot` (`{ gold, pendingOut: { gold, maturesOnDay }[] }`), persisted in a new nullable JSONB column `settlement_buildings.bank` (migration `022_bank_pot.sql`), following the `construction` precedent exactly (migration 013). **Absent means no pot**, and the key must be *absent* rather than `undefined` (the repo has a documented `deepStrictEqual` rule). See [architecture.md](./architecture.md)'s bank-pot section for the `BankGold` command, the `BankGoldMoved` event, and the reducer-first client path.

## 7. Buildings ↔ resources

The registry is [`packages/engine/src/buildingRegistry.ts`](../packages/engine/src/buildingRegistry.ts) (24 kinds). Placement gold → treasury; materials → warehouse.

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
| farmhouse | 80g 4w | 2 | 1 / 0 | food +2/turn, population +20 | — | peasant 25g |
| archeryRange | 350g 8w 5s | 4 | 1 / 1 | defense +1 | hero attack +1 | archer 250g + 2w |
| granary | 150g 8w 4s | 3 | 1 / 0 | food +3/turn, food storage +600 | — | — |
| warehouse **(2×2)** | 500g 16w 12s | 3 | 1 / 1 | storage +600 ×5 resources, treasury +500 | — | — |
| bank | 400g 6w 8s | 5 | 1 / 1 | treasury +2000 **+ own gold pot** (§6.8) | — | — |
| treasury | 400g 6w 8s | 5 | 1 / 1 | treasury +2000 | — | — |
| goldMine | 300g 6w 4s | 4 | 2 / 0 | gold +40/turn | — | — |
| woodcutterHut | 150g 5w | 3 | 1 / 0 | wood yield +3 | — | — |
| arcaneFont | 350g 5w 6s | 4 | 1 / 1 | arcane yield +3 | — | — |
| stables | 350g 10w 5s | 4 | 1 / 1 | — | — | — |
| huntingLodge | 250g 8w | 3 | 2 / 1 | defense +1 | — | warhound 180g |
| eyrie | 500g 12w 8s | 6 | 2 / 1 | — | — | giant_eagle 1400g + 2a (L1); eagle_prince 2400g + 4a (L2) |

**Footprints.** `warehouse` is **2×2** (four tiles ≈ 19% of a level-1 town's usable space — the placement cost doubled from 250g/8w/4s for exactly that reason). The registry's legacy **1.5×1.5** L2/L3 visual override deliberately **excludes** it (along with the other 2×2 kinds `apartment`/`farmField`/`townHall`): `coversCell` uses `gx < b.gx + w`, so a 1.5 footprint blocks only 2 cells — including `warehouse` would *release* two cells on upgrade and break cell exclusivity. `archeryRange` is 1×2. `footprintCells` / `footprintLine` / `footprintSuffix` (`src/screens/settlements/cityView/footprint.ts`) report **blocked** cells (`ceil`), matching `coversCell`, so those fractional overrides correctly read as 2×2 in the palette tooltip, palette label, and building popup.

**Wired vs. dormant — which of these actually do anything:**

| Effect | Status |
|--------|--------|
| `controlRangeBonus` (townHall) | ✅ **Wired** — feeds territory/control range (`packages/engine/src/control.ts:5-11`) |
| `storageBonus`, `treasuryBonus` | ✅ **Wired** — derived caps in `settlement/capacity.ts`; they gate additions only |
| `foodPerTurn` (farmField/farmhouse/granary) | ✅ **Wired as producers** — all three are `ProducerKind`s (2026-10-01), output × cell multiplier (§9). The flat per-turn value is *not* also applied on top |
| `resourceYieldBonus` | ⚠️ **Producer-only** — dormant as a generic bonus, but its magnitude is the base output for producer mines, which *are* applied (§9) |
| `goldPerTurn` (market/goldMine) | ⚠️ **Split** — HUD-only for `market`; `goldMine`'s 40/turn is real, as a producer (§9). `bank`'s dead `goldPerTurn: 60` was **removed** 2026-10-01 — it was never applied by the economy — and its description now states what it actually does ([F2](#F2)) |
| `populationBonus` | ❌ **Dormant** — displayed in building menus, never applied ([F3](#F3)) |
| `defenseBonus`, `unitCostReductionPct`, vision/speed/attack bonuses | ❌ **Display-only** — no combat or fog wiring reads them |

Level-scaling nuances (`buildingSettlementEffects`, `buildingRegistry.ts:377-402`): `goldPerTurn`, `foodPerTurn`, `populationBonus`, `defenseBonus`, `storageBonus`, and `treasuryBonus` scale ×level; `unitCostReductionPct` is returned **flat**. **`resourceYieldBonus` now scales ×level too** (2026-10-01) — it used to be a flat copy, so a `woodcutterHut`/`stoneMine`/`ironMine`/`mine`/`arcaneFont` produced the *same* output at L3 as at L1 while its `upkeepPerLevel` rose, making every upgrade strictly negative ROI. Producer bases are now 3/6/9 at L1/L2/L3, so net output rises monotonically (woodcutter 2 → 4 → 6; the others 1 → 2 → 3 after upkeep). A ×3 coincidence worth knowing: an **L1** producer on a **3.0×** spot ties an **L3** producer on a plain cell (3 × 3 = 9 × 1) — this already held for `goldMine` and `farmField`, and ×level preserves the existing convention rather than inventing one. An L3 *on* a spot (27) still dominates both.

Recruit costs (`RecruitEntry`) are charged by the wired `RecruitUnits` command — gold from the settlement treasury, materials from its warehouse, units into the garrison (see [army.md](./army.md)).

## 8. City spots & mines (status)

`generateCitySpots(size, rng, opts?)` (`packages/engine/src/settlement/citySpots.ts`) places **3 / 6 / 9** resource spots on the 5×5 / 10×10 / 15×15 city grids and **always returns `mines: []`**. `SettlementState.cityMines` is therefore empty in all live state, and neither spots nor mines contribute anything to `resourceRates`. Spots themselves matter through the producer system (§9–10): a spot cell's own resource rolls its multiplier on the 3.0 peak.

**Food joined the pool on 2026-10-01.** `RESOURCE_POOL` is now `gold, wood, stone, iron, arcane, food`, with a per-terrain `foodBias` (`DEFAULT_FOOD_BIAS = 0.35`, `foodBiasForTerrain(terrain)`): grass 0.55, forest 0.32, dirt 0.22, desert 0.05, mountain/water/unknown 0. One rng draw decides both halves of the pick — below `foodBias` the spot is food, otherwise the same value is rescaled across the non-food pool, so `foodBias: 0` reproduces the pre-food uniform pick exactly. Green plains get rich farmland; barrens barely any.

**Map tiles still never carry food** (`RESOURCE_DENSITY.food === 0` on every terrain, §2) — food is a *building* resource, and a city spot is the only place it can be. Food spots are now **visible** in the city view: the `isMineable` food filter in `src/managers/GameEngine.ts`'s `handleDblClick` was vestigial (added 2026-07-23 when `RESOURCE_POOL` had no food — it filtered nothing for its entire life) and has been removed, so `cityView.open()` receives `castle.citySpots` verbatim.

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
| food *(2026-10-01)* | `farmField` (5/turn) · `farmhouse` (2) · `granary` (3) | 5 / 2 / 3 food × level | Warehouse |

Legacy `mine` (pre-split saves) still produces — iron on an iron spot, stone otherwise — but is no longer offered in the build palette. Every resource now has at least one dedicated gathering building in the palette, grouped together in the palette's **Production** section — the build list is classified into Troop Buildings / Production / Civilian by registry data (`buildListSections.ts`, 2026-09-28). Food joined that section on 2026-10-01 because `farmField` and `granary` are producers; `granary` is genuinely both a storage and a food building. **`farmhouse` stays in Troop Buildings** because the `recruits` check runs first — it recruits nothing here, but `isProducerKind` is only consulted once `recruits.length > 0` is false.

- **Placement:** producers are placeable on **any empty buildable cell** — not only on matching spots. A spot's value is that its own resource peaks at **3.0×** there (§10); off-spot placement is legal but usually mediocre. A farm on a cell holding a **food** spot therefore earns the existing `SPOT_MULTIPLIER_PEAK = 3.0`. Existing overlap rules apply (footprint per cell, center reserved).
- **Output numbers** reuse existing registry constants (`goldMine.goldPerTurn = 40`; the shared `+3` magnitude; `foodPerTurn` for the three farm kinds). Level scaling follows the registry's ×level convention; producers upgrade via the existing L2/L3 path (cost ×1.5 / ×3).
- **Arcane Font stats** (as shipped in `buildingRegistry.ts`): placement `{gold 350, wood 5, stone 6}` — deliberately no arcane input, since it *is* the arcane source; upkeep `{wood 1, stone 1}`; `buildDays 4`.
- **Tick integration (shipped):** `produceSettlementResources(settlements, seed)` (`packages/engine/src/settlement/produceResources.ts`) sums `base × cellMultiplier(cell, producer resource)` over all producer buildings per settlement — gold to the treasury (rounded to 2 decimals), the rest to the warehouse. `applyEndOfTurnDetailed` passes `state.castleSeed`. Base amounts are read from the registry (`goldMine.goldPerTurn` = 40; `resourceYieldBonus` magnitudes = the shared `+3`; `foodPerTurn` for farms), so there is one source of truth. `ProducerResource` in `packages/engine/src/settlement/producers.ts` now includes `food`. This supersedes the dormant `resourceYieldBonus` semantics for producers ([F3](#F3) covers the remaining unwired effects).
- **Server authority:** placement is now a server command — `PlaceBuildings` re-derives the net cost and re-derives these outputs server-side (see §6.3; [F4](#F4) is resolved).
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
**F1 — ~~Food is a dead-end resource~~ RESOLVED (2026-10-01).** Food now has three production sources: `farmField` / `farmhouse` / `granary` are `ProducerKind`s feeding the normal production tick (§9), every new settlement is seeded with farmland sized against **its own** food bill (§4), and morale can **recover** (§6.1) instead of being subtract-only. Before this, food had **zero** sources — tile density is 0 by design (§2) and `foodPerTurn` was never applied — so every settlement ran a permanent 100% food-deficit penalty and the economy was unwinnable. The zero tile density itself remains deliberate: food comes from farm buildings, not from tiles.

<a id="F2"></a>
**F2 — HUD income ≠ actual income (partly closed).** `playerIncome()` includes building `goldPerTurn` and feeds the HUD's next-turn gold (`src/managers/UIManager.ts:473`), but `applyEffectiveIncome()` accrues only `pop × tax × morale/100` (§6.2). *Suggest:* either include `goldPerTurn` in `effectiveIncome` or exclude it from the HUD number. *(2026-10-01: two of the three surfaces were cleaned up — `bank`'s dead `goldPerTurn: 60` was deleted from the registry, and the phantom `resourceRates.gold` line was replaced by real per-turn production — `warehouseRates()` then, combined with the building producers into `settlementProductionRates()` on 2026-10-04 — today rendered in the logistics panel, `src/screens/logistics/logisticsModal.ts`, after the old settlement panel was deleted. `market`'s HUD-only 40/turn and the HUD-vs-accrual difference itself are still open.)*

<a id="F3"></a>
**F3 — ~~Defined-but-unwired building effects~~ PARTLY RESOLVED (2026-10-01).** `foodPerTurn` (farmField/farmhouse/granary) is now a **producer** input (§9), and `resourceYieldBonus` (mine/woodcutterHut/stoneMine/ironMine/arcaneFont) feeds producer bases at ×level (§7). Still unwired: `populationBonus` (house/apartment/farmhouse), `defenseBonus`, `unitCostReductionPct`, and the vision/speed/attack player effects — the only wired player effect is `controlRangeBonus`. *Suggest:* a population-formula hook and combat/fog wiring for the player effects — or delete the dead fields (the repo's own lesson: an unwired parallel implementation is not a safe intermediate state).

<a id="F4"></a>
**F4 — ~~Placement is client-trusted~~ RESOLVED (2026-09-27).** The `PlaceBuildings` command now commits the city view's working cart server-side (net cost re-derived and affordability revalidated against the server's own row; construction timers recomputed for new placements). *(Was: costs deducted client-side on city-view close via `UIManager.ts:189-215` with no server round-trip.)*

<a id="F5"></a>
**F5 — ~~`buildDays` is cosmetic~~ RESOLVED (2026-09-27).** Registry build days now gate new placements: `BuildingDef.construction` counts down per round wrap and the palette's displayed days are the real construction time. *(Was: placement was instant; only upgrades had timers.)*

<a id="F6"></a>
**F6 — ~~No warehouse capacity~~ RESOLVED (stockpile milestone).** Caps are derived in `settlement/capacity.ts`: `BASE_STORAGE` per level plus every `storageBonus` (granary +600 food, warehouse +600 ×5, both ×level), with the parallel `BASE_TREASURY` + `treasuryBonus` for gold and a per-bank `bankGoldCap` (§6.8). They are **soft** — an addition is clamped to headroom, existing stock above cap is never destroyed.

<a id="F7"></a>
**F7 — ~~Recruitment is display-only~~ RESOLVED (2026-09-29 unit-recruitment/garrison milestone).** Recruitment runs through the `RecruitUnits` command: registry gates (unit offered at that building, level ≥ `minLevel`), gold/warehouse charges, garrison deposit; documented in [army.md](./army.md). *(Was: `RecruitEntry` costs rendered in the building menu with no handler attached.)*

<a id="F8"></a>
**F8 — ~~Trade asymmetries~~ SUPERSEDED (2026-10-02).** The manual trade command and its modal are gone (§6.6), and the caravan recommender proposes exactly the resources that matter — **food and gold** — so "the engine permits trading food; the UI excludes it" no longer describes any live surface (caravan payloads accept any warehouse resource or gold). The flat 1:1 gold rate critique died with the instant-transfer mechanic it priced.

<a id="F9"></a>
**F9 — `transferGold` is all-or-nothing**, same-hex only. *Amended 2026-10-02:* the request shape still moves the whole amount, but the **cap clamps the landing side** — a withdrawal past `heroGoldCap` headroom lands only what fits and the excess stays in the treasury (nothing destroyed, nothing lost), so the operation is clamped-partial-capable now even though the command itself has no amount parameter. *Suggest:* amount entry if it ever matters gameplay-wise.

<a id="F10"></a>
**F10 — `cityMines` dormant.** Always empty (`citySpots.ts:35,60`); spots/mines are decoupled from `resourceRates`. Resolved by §9–10 (shipped) — spots now matter through producer multipliers; the `cityMines` array itself remains unused scaffolding.

## 12. Doc drift appendix

Stale claims in older docs, with corrections. The older docs were intentionally left unedited (link-only edits); this doc is the as-built authority.

| Doc | Stale claim | As-built |
|-----|-------------|----------|
| [resources.md](./resources.md) | Aggregation over "radius of 3 hexes" | `level` → 1/2/3 hexes for L1/L2/L3 (`control.ts:13`; it was `level − 1` until 2026-10-01) |
| [resources.md](./resources.md) | "5 resource types" | Code has 6 — food is in the type union and warehouse, and is **produced** by farm buildings (it has no tile source by design) |
| [resources.md](./resources.md) | Source paths `src/map/resourceTiles.ts`, `src/economy/settlementRates.ts` | Engine lives in `packages/engine/src/map/` and `packages/engine/src/economy/` (client keeps `src/map/` mirrors) |
| [economy.md](./economy.md) | Warehouse lists wood/stone/iron/arcane only | `food` is a warehouse resource too, produced by farm producers (see F1) |
| [economy.md](./economy.md), [settlements.md](./settlements.md) | Implementation pointers into `src/state/gameState.ts`, `src/views/…`, `src/economy/…` | Reducers are in `packages/engine/…` + `packages/contracts/…`; menus/screens under `src/screens/…`; the EndTurn pipeline is server-authoritative via `server/app/turnService.ts` |
| [README.md](./README.md) | "No food in v1" | Food exists end-to-end in the data model **and** is produced by farm buildings; only its *tile* source is zero, by design |

## 13. Cross-references

- What the resources are and their intended roles: [resources.md](./resources.md)
- The per-turn loop from the design side: [economy.md](./economy.md)
- Settlements, charters, upgrades, capture: [settlements.md](./settlements.md)
- The city view the specs build on: [city-view-impl-plan.md](./city-view-impl-plan.md)
- Where army upkeep/recruitment picks up: [army.md](./army.md)
- Module dependency map: [module-documentation-and-relationships.md](./module-documentation-and-relationships.md)

[← Back to index](./README.md)
