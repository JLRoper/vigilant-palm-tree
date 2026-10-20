# Settlements

<!-- docs:verified 2026-10-18 -->

The player's claim on the world. Settlements come in two forms: **initial castles** (pre-placed at game start via `castlePlacement`) and **charter-founded settlements** (created by heroes via expedition).

## Initial castles

At game start, castles are placed on the map (configurable via `castleSeed`/`castleCount`; `defaultCastleCountForMap` and `maxCastleCountForMap` in `packages/engine/src/map/castlePlacement.ts` scale the default and maximum castle counts by $\sqrt{N/432}$ on maps larger than `24×18` — up to 18 default / 45 max on `huge` 72×54 and 30 default / 75 max on `epic` 120×90 — and `generateCastles` verifies passable BFS connectivity via `buildReachableMask` so castles never spawn in isolated pockets). Each faction gets one. These are Level 1–3 settlements with pre-computed resource rates, city spots, and mines.

## Charter settlements (✅ implemented)

A hero standing on a friendly settlement can initiate a **charter expedition** to found a new settlement at a distant hex.

### Cost

Paid at initiation time, deducted immediately:
- **2500 Gold** (from hero's purse)
- **20 Wood** (from provisioning settlement's warehouse)
- **15 Stone** (from provisioning settlement's warehouse)

If the hero is defeated during travel or construction, all costs are forfeited.

### Process

1. **Provision** (instant): costs deducted. Hero enters `"traveling"` phase.
2. **Travel** (1+ turns): hero auto-paths one hex-step per owner-turn toward target. Vulnerable to attack.
3. **Construction** (10 days): hero is stationary at target. `daysRemaining` decrements each `advanceRound`. Vulnerable to attack.
4. **Complete**: settlement appears as Level 1 with population 50, empty warehouse, 0 gold, morale 50, `autoTrade: false` (now the default for *every* settlement — initial castles included, since the 2026-10-02 rework; see [economy.md](./economy.md) → Trade routes & caravans), generated city spots (which may now include **food** spots, terrain-biased — see [resource-gathering.md](./resource-gathering.md) §8).

### Placement rules

- Target hex must be passable terrain
- Minimum 4 hexes from any existing settlement
- Not occupied by another hero or active charter target
- No movement-range limit — hero walks there over multiple turns

### Limits

- **No cap** on number of settlements per player
- Voluntary cancellation not allowed
- **AI chartering is live:** the server-side AI driver can start and advance charter expeditions using the same cost, distance, travel, and construction rules as human players (B3; see [multiplayer.md](./multiplayer.md)).

### Hero state during charter

- `isChartering: true` / `charterId` set — hero cannot be manually controlled
- Traveling: auto-paths each turn via `advanceAutoTravel()` in `TurnController`
- Constructing: stationary, `daysRemaining` decrements per round
- Defeat in any phase → charter lost, costs forfeited

## Levels

✅ **Locked.** Three levels ship in v1 UI. Level scales both resource yield and gold tax (population × tax = base gold income), and unlocks a larger city-view grid.

| Level | Tier label | Population cap | Gold tax/turn | City grid |
|-------|------------|----------------|---------------|-----------|
| 1     | Settlement | 500            | 1g/head       | 5×5       |
| 2     | Town       | 1,500          | 2g/head       | 10×10     |
| 3     | Castle     | 5,000          | 3g/head       | 15×15     |

Charter-founded settlements always start at Level 1 with population 50 (not 500).

Resource rates scale with settlement level and nearby map resource tiles. Source: [`packages/engine/src/economy/settlementRates.ts`](../packages/engine/src/economy/settlementRates.ts) and the engine settlement reducers; client visual settlement entities remain under `src/entities/`.

## Population growth (✅ implemented)

Settlements grow naturally each week, provided they have enough food to sustain their current population.

- **Schedule:** Weekly during `applyWeeklyUpkeep` (day % 7 === 0)
- **Condition:** `warehouse.food >= foodRequired(s)` — growth only occurs when food is met
- **Formula:** `growth = max(1, ceil(population × growthRate))`
- **Cap:** Level's maximum population (500 / 1,500 / 5,000)
- **No growth penalty:** When food is short, population simply doesn't grow (morale decay handles the penalty separately)

The growth rate is configurable in Settings; the upgrade population gate is **not** player-configurable — it is the engine-owned constant `UPGRADE_POPULATION_GATE` (85%, `packages/engine/src/settlement/upgradeSettlement.ts`, issue #153):

| Setting | Default | Range | Step |
|---------|---------|-------|------|
| Population Growth Rate | 10% | 1%–50% | 1% |

Source: [`src/state/settings.ts`](../src/state/settings.ts) for the client setting and `packages/engine` turn/upkeep reducers for authoritative weekly growth.

## Settlement upgrades (✅ implemented)

Settlements can be upgraded to the next tier through an active construction process. Upgrades are player-initiated and require both population and Town Hall prerequisites.

### Settlement upgrade costs

| | L1→L2 (Town) | L2→L3 (Castle) |
|---|---|---|
| Gold (treasury) | 5,000g | 15,000g |
| Wood | 40 | 80 |
| Stone | 30 | 60 |
| Iron | 20 | 50 |
| Arcane | — | 20 |
| Construction | 15 days | 25 days |
| Req: population | ≥ 85% of level cap | ≥ 85% of level cap |
| Req: Town Hall level | ≥ 2 | ≥ 3 |

### Town Hall upgrade costs

| | L1→L2 | L2→L3 |
|---|---|---|
| Gold (treasury) | 1,500g | 5,000g |
| Wood | 15 | 40 |
| Stone | 10 | 25 |
| Construction | 7 days | 12 days |

### Process

1. **Pre-requisite check:** Population must meet the gate threshold (85% of level cap — the engine constant `UPGRADE_POPULATION_GATE`, not player-configurable), and Town Hall must be at or above the target level.
2. **Initiation:** Player clicks the upgrade button in the settlement info panel. Costs are deducted immediately from the settlement treasury and warehouse.
3. **Construction:** `daysRemaining` counts down each `advanceRound` — by **`1 + upgradeAccelEffort` days** (2026-10-17) when the settlement's `townHall` or `mageGuild` is **explicitly staffed** (max effort across the two kinds, so up to 2× with a full crew; unassigned/legacy buildings earn no acceleration). Settlement operates normally during construction (production, income, growth continue).
4. **Completion:** When `daysRemaining` reaches 0:
   - Level increments to target
   - Gold tax updates (2 for L2, 3 for L3)
   - Resource rates recalculated (pre-computed at initiation)
   - New city spots merged in (pre-computed at initiation)
   - Population and buildings preserved as-is
5. **Town Hall completion:** The Town Hall building level increments in the `buildings` array.

### Constraints

- **No concurrent upgrades:** Only one upgrade (town hall or settlement) at a time per settlement.
- **Upgrade persists through capture:** If a settlement is captured mid-upgrade, construction continues under new ownership.
- **Only player-owned settlements can upgrade:** The upgrade button only appears for the active player's settlements.

### UI

- **Settlement info panel:** Upgrade button below the warehouse grid. Shows pre-req status when requirements aren't met, clickable button when ready, progress bar during construction.
- **Building menu (Town Hall):** Upgrade button appears when clicking the Town Hall building (L1 or L2 only). Shows cost and disables when resources are insufficient.

Starting a town-hall upgrade (`UpgradeTownHall`), a building upgrade (`UpgradeBuilding`), or a settlement upgrade (`UpgradeSettlement`) is now a server-authoritative command (`server/app/commandHandler.ts`) — the client's local `@heroes/engine` reducer call applies immediately for responsiveness, then a matching command round-trip (`src/io/commands.ts`, fired from `src/state/turnController.ts` via `src/game/turnHooks.ts`) persists it server-side, the same pattern `StartCharter` uses (see Persistence below). `advanceSettlementUpgrades` (completion, on round wrap) has been server-authoritative since `EndTurn`'s pipeline was ported (`server/app/turnService.ts`).

Source: `packages/engine/src/settlement/` upgrade reducers, [`server/app/commandHandler.ts`](../server/app/commandHandler.ts), and the current panels under `src/screens/settlements/`.

## Capture

A hero walking onto an enemy settlement tile captures it — **only if the garrison is empty**. The settlement stays at its current level and continues producing. A **neutral** (ownerless) settlement behaves like an enemy-owned one for both the garrison gate and the capture reward.

- **Garrison gate:** if the settlement's garrison has troops — enemy-owned **or neutral** (the `unowned_settlement` gate was removed in the 2026-09-29 capture/garrison wave) — the tile walk enters the `SETTLEMENT_BATTLE` phase instead. A local-human attacker first confirms in the **assault modal** (2026-09-29 follow-ups, B5): "Assault on \<name\>" with You/Garrison army summaries and Assault / Auto-resolve / Cancel — Assault enters the manual arena (attacker vs *"<name> Garrison"*, title bar "Assault on \<name\>"), Auto-resolve resolves silently, and Cancel ends the client-local phase with the hero still standing on the settlement tile (garrison holds, capture deferred, no command submitted; re-selecting the hero re-opens the flow). A non-local attacker auto-resolves silently (result card/toast). Either way the result rides `SubmitSettlementBattleResult` (`startSettlementBattle` / `applySettlementBattleResult` in `@heroes/engine`). The direct `CaptureSettlement` command rejects a non-empty garrison (`garrison_not_defeated`).
- **Serialized capture (2026-09-29):** the optimistic local capture applies immediately, but its `CaptureSettlement` POST waits for the triggering move's persist (`TurnController.lastMovePersist`) — the server's hero-standing-on-the-settlement precondition only holds once the move has landed (this killed a live-verified ~50% `hero_not_at_settlement` 409 race, human and AI). A server rejection rolls the capture back (`rollbackCaptureSettlement` in `@heroes/engine`: owner/roster restore, clamped gold subtraction); `already_owned` — the server captured inline with a post-battle persist — is treated as benign, since the local capture already matches.
- **Settlement-battle loser outcomes (2026-09-29):** the attacking hero follows the hero-battle verdict rules — defeat removes them from the map (hero row + `heroIds` + charter folded), retreat empties the stacks and relocates to the nearest owned settlement (stay-put when none is owned), surrender relocates keeping troops. See [army.md](./army.md) → Combat resolution.
- **Post-battle capture:** when the victorious attacker stands on an enemy settlement whose garrison is now empty, capture fires automatically (`TurnController.captureAfterBattleIfNeeded`, wired on both the hero-battle and settlement-battle paths).
- Captured settlements produce for the new owner starting the next turn.
- Capturing is the only way settlements change hands in v1.
- A player can recapture their own settlements by walking their hero back onto them (same garrison gate).
- **Active upgrades survive capture.** If a settlement is mid-upgrade, construction continues under the new owner.

✅ **Locked:** no other form of destruction. Settlements are permanent until captured — no spells, no demolition, no decay.

## Garrison (✅ implemented)

Every settlement can hold troops: `SettlementState.stacks?: Platoon[]` — the same `Platoon[]` shape as hero stacks (null-safe accessor: `settlementStacks` in `@heroes/engine`'s `units.ts`).

- **In:** `RecruitUnits` lands newly recruited units here (garrison-first — see [army.md](./army.md)); `TransferUnits` with `direction: "toGarrison"` pulls troops off a hero standing on the tile.
- **Out:** `TransferUnits` with `"toHero"` loads the hero's platoons — the hero **must stand on the settlement**.
- **Upkeep:** weekly (inside `applyWeeklyUpkeep`) via `applyGarrisonUpkeep` (`packages/engine/src/settlement/garrisonUpkeep.ts`) — the same `resolveTroopUpkeep` rule heroes run (per-unit catalog gold/food bill, gold from the treasury and food from the warehouse, shortfall taken as a morale bleed then weighted desertion after a 2-week grace). Full rule: [army.md](./army.md) → Upkeep.
- **Defense:** a non-empty garrison must be defeated before capture succeeds — in the manual arena for a local-human attacker (behind the assault-confirm modal), auto-resolved otherwise (see Capture above); since the 2026-09-29 capture/garrison wave the losing attacker suffers the hero-battle outcomes (defeat removes the hero, retreat/surrender relocate).
- **AI-held garrisons (2026-09-29 follow-ups, B1):** AI seats spend their own treasuries on garrison troops during their turns — threat-sized (`pickGarrisonRecruitment`: target power = 1.0 × nearby enemy-hero power within reach 8, floor 4, gold reserve 100), bought through the same `RecruitUnits` path and building gates as a player's recruits. An AI town left alone grows a garrison instead of falling to the first walk-in.

Buildings gate what a settlement can recruit; the newest are **huntingLodge** (placement 250g + 8 wood; recruits warhound for 180g; `defenseBonus: 1`) and **eyrie** (placement 500g + 12 wood + 8 stone; recruits giant_eagle 1400g + 2 arcane at L1, eagle_prince 2400g + 4 arcane at L2). The full building→unit table lives in [army.md](./army.md).

## Building roster — the newest and the storage roles

**`treasury` (new 2026-10-01).** 1×1, 400g + 6 wood + 8 stone, 5 days, upkeep 1 wood / 1 stone, `settlementEffects: { treasuryBonus: 2000 }`. It raises the treasury cap and does nothing else. No capacity code changed: `settlementTreasuryCap` already summed `treasuryBonus` over every building, so a new cap-building contributes on sight.

**`warehouse` is now 2×2** (four tiles) with `placementCost: { gold: 500, wood: 16, stone: 12 }` — the cost doubled because four tiles is ~19% of a level-1 town's usable space (5% at 1×1). `storageBonus` is unchanged at +600 × level on all five resources. The registry's legacy 1.5×1.5 L2/L3 visual override deliberately **excludes** it: `coversCell` uses `gx < b.gx + w`, so a 1.5 footprint covers only 2 cells — including `warehouse` would *release* two cells on upgrade and break cell exclusivity (the same reason `apartment`, `farmField`, and `townHall` stay out).

**`bank` reworked.** Its dead `goldPerTurn: 60` was removed — it was never applied, since only `goldMine`'s gold actually accrues — and its description now states what it does. It keeps `treasuryBonus: 2000` and gains **its own gold pot** (deposit / 7-day withdrawal delay / 5% flat weekly interest, capacity `5000 × level`). Persistence, the `BankGold` command, the `BankGoldMoved` event, and the client path are documented in [architecture.md](./architecture.md) → Bank pots.

**The three storage roles are not interchangeable:**

| Building | Raises | Also |
|---|---|---|
| `granary` | **food** storage +600 × level | A food **producer** too (+3/turn) — genuinely both |
| `warehouse` | **materials** storage +600 × level, all five (2×2 footprint) | +500 treasury |
| `treasury` | **gold** capacity only, +2000 × level | — |
| `bank` | **gold** capacity +2000 × level | Its own gold pot (interest + withdrawal delay) |

Caps are derived (`settlement/capacity.ts`) and **soft**: an addition is clamped to headroom, and stock above cap is never destroyed. `granary` and `farmField` moved from the palette's Civilian section to **Production** (both are producers); `farmhouse` stays in Troop Buildings because the palette's `recruits` check runs first.

### Workforce staffing (2026-10-17)

Each settlement derives a worker pool of **`floor(population / 100)`** (`workforcePool` in `packages/engine/src/settlement/workforce.ts`), shared across main-city and district buildings. Workers are assigned per building via the `AssignWorkers` command (`packages/contracts/src/commands/assignWorkers.ts` — reducer in `packages/engine/src/settlement/staffWorkers.ts`, rejection reasons `no_settlement` / `unowned_settlement` / `no_building` / `not_staffable` / `invalid_workers` / `invalid_source` / `pool_exhausted`), emitting a `WorkersAssigned` EngineEvent. An optional `source?: { gx, gy }` (2026-10-18) turns the command into an **atomic one-worker move**: the reducer validates and writes both buildings in a single operation (source loses one, destination gains it), so the press-and-hold drag below never commits a partial transfer; legacy normalization and the legacy source base (display − 1) still apply. `BuildingDef.workers` **undefined = legacy auto-staffed** (effort 1) — an untouched legacy settlement behaves exactly as before, but the **first assignment converts the whole settlement to explicit crews** (normalized 2026-10-18, auto-crew 2026-10-18 late): the touched building receives the chosen count and the remaining pool is auto-employed — job slots first, balanced round-robin across job kinds in priority order (food producers, the other producers, market, recruiters, town hall; within a kind the least-staffed building takes the next worker), then houses/apartments, and only the true surplus stays idle. Construction sites, inert kinds, and pre-existing explicit counts are skipped. New buildings placed into an already-normalized settlement start at `workers: 0`; new buildings in an untouched legacy settlement keep legacy auto-staffing. An explicit number scales the building's effort `min(workers / maxWorkers, 1)` and `0` shuts it down. Role tags per kind — not exclusive, the panel shows all of them (`farmhouse` = producer+recruiter, `mageGuild` = recruiter+upgrade-accel):

- **Producers** (goldMine, woodcutterHut, stoneMine, ironMine, arcaneFont, farmField, farmhouse, granary): output scales `round(base × cellMultiplier × effort)`.
- **`market`**: flat `goldPerTurn` × effort lands in the treasury (F2 resolved).
- **Recruit kinds (19):** each recruits from a per-unitTypeId **draft pool** (`draftMax` 3; `draftPerDay` 0.25 × `(1 + effort)` × tier multiplier reclaimed daily on the round wrap, `applyDraftRecharge` — tier-scaled since 2026-10-18, tiers 1–7 → ×1 / ×0.8 / ×0.65 / ×0.5 / ×0.4 / ×0.3 / ×0.2 per `TIER_DRAFT_RECHARGE_MULTIPLIER` in `packages/engine/src/units.ts`, so higher-tier units refill slower; catalog-less callers → ×1). Recruiting consumes the pool (rejection `draft_pool_empty` when the count exceeds `floor` of the pool) and still costs gold/resources; `draft` undefined = full pool (legacy). The client's **recruitment panel** (`src/screens/settlements/cityView/recruitmentPanel.ts`, model `src/screens/settlements/recruitmentPanelModel.ts`; ⚔ Recruit or `r`) collapses every recruit source in the settlement **and its districts** into one block per building kind, shows each unit's `+N/wk` refill rate recomputed from the live staffing of every building of that kind (7 × `buildingDraftPerDay` × `draftRechargeMultiplier` × `tierDraftRechargeMultiplier`), staffs recruiters from each building's own line (`−`/`+` committing `AssignWorkers` district-true), offers a per-kind **Buy all** that allocates most-stocked-building-first then round-robin (`allocateRecruitCounts`), and commits each allocation through this same `RecruitUnits` path with that source building's own coords + district — no new command or event. The panel also mounts the settlement panel's **Garrison** accordion content itself (`src/screens/settlements/garrisonView.ts`): one `GarrisonView` instance per surface, identical square tiles that drag-and-drop (within a grid swaps two slots, `ReorderGarrison`; between the garrison grid and the hero's army grid moves troops via `TransferUnits` into the dropped slot), both refreshed from the same UIManager pass so a drag on either shows on both. Its building list scrolls inside the panel and the panel is resizable (corner grip, size remembered).
- **`townHall` + `mageGuild`:** staffing accelerates the settlement's active upgrade timer — see the Upgrade process below.
- Every other kind holds workers **inert** (parked). Per-kind caps (`buildingMaxWorkers`): producers 3 (farmField/farmhouse/granary 2), recruit kinds 4, market/townHall/mageGuild 3, house 1, apartment 2, all others 2.

**Daily wages (2026-10-18).** Population also accrues a wage bill: every active player's settlement pays `floor(population / 100)` gold per day (1g per 100 population, `WAGE_POPULATION_PER_GOLD = 100`; `settlementDailyWage` / `applySettlementWages` in `packages/engine/src/economy/consumption.ts`) at end of turn, after food consumption and before income. The deduction floors at 0 (no debt) and carries no morale penalty; it is not yet shown in the settlement panel UI.

Client: per-building worker stepper and draft-pool readouts in the city-view building menu (the green gold/food effect lines show the **current** staffing-scaled value — e.g. `+13.33 gold/turn (33% staffed)` — and refresh on every stepper commit), a floating workforce panel (`w` or the **♟ Workforce** button in the City Design box opens it — the box itself is a draggable floating panel with a remembered position since 2026-10-19; drag its chips onto buildings to add from the pool; geometry key `workforcePanel`, resized by the shared corner grip with the size remembered; each row shows `n/max` with every role tag under the name so long labels no longer truncate, hovering a row highlights that building's footprint so duplicate rows are distinguishable, and while the settlement is still legacy the header reads `auto-staffed (pool N) — first assignment switches this city to manual crews`; chips are disabled when no idle workers remain), a Workforce row in the settlement info menu (legacy shows `auto · pool N`; an oversubscribed pool shows `over pool` instead of a negative idle count), and city-view peasant sprites (cap 4 per building) that alternate a 1px bob between two states staggered per worker (2026-10-18; the renderer honors `prefers-reduced-motion` with a static frame, and the visual-regression suite pins reduced motion). Press-and-hold on a staffed building's iso-grid footprint picks a worker up (dashed source highlight; grid-aligned hover highlight on the destination) and releasing over another building **moves** one worker via the atomic `source` form above; drop on empty ground, the same building, a full building, or off-canvas — or `Esc` — cancels with no changes, and the trailing click after any drag does not open the building menu (panel chips still add from the pool). Drops resolve only on the game canvas: releasing over any floating UI (workforce panel, building menu, HUD) cancels instead of assigning the building hidden underneath, a click on a panel chip without motion is a no-op, and a worker pickup is not armed while the Build/Destroy placer is active. `Esc` closes the workforce panel before the city view, the panel closes with the view (no orphan floating over the world map), the last drag is cancelled on window blur, and city shortcuts (`w` / `b`) are ignored while a menu input has focus. Any successful assignment from any surface refreshes the open building menu (`notifyWorkforceCommit`), and the legacy staffing predicates the menu and panel read are centralized in the engine workforce module (`hasLegacyStaffing` / `hasExplicitStaffing` / `staffingBase`). Staffing is server-owned across the city-view cart round-trip: `syncCartBuilding` re-syncs `workers` / `draft` from live state (like `construction` / `bank`), so closing the view or committing a placement/destroy no longer writes the open-time counts back over assignments made while the view was open (2026-10-18 regression fix).

## Building persistence (✅ implemented)

Buildings placed in the city view are persisted to `SettlementState.buildings` (a `BuildingDef[]` array). Previously ephemeral (only existed while city view was open), buildings now survive close/reopen cycles.

- **First open:** a settlement with no buildings is handed the **free starter set** and it is committed for the player — `townHall L1 + farmField L1 + 2× house L1 + 2× woodcutterHut L1 + stoneMine L1 + farmhouse L1` (`buildStarterLayout`, `packages/engine/src/settlement/starterLayout.ts`), costing **10 wood + 2 stone** per turn (the farmhouse's 1 wood + 0 stone included; the second hut is the 2026-10-02 balance fix: one hut left the set net wood-negative, median −5 wood/turn; two land it at median −4). The farmhouse is the tier-1 peasant's recruiting building (25g, `minLevel 1`), so every settlement — player and AI alike — can raise garrison troops from the moment it exists (the AI garrison planner shops the same `eligibleRecruitSources` gate). This replaced a hand-off of `cityBuildingGen`'s denseUrban layout (~14 buildings, level-2 town hall, **no producer at all**, ~24 wood + 14 stone per turn) which bankrupted a player by roughly turn 12. Farm count is sized against the settlement's **own** food bill (its population plus the weekly bill of any starting hero standing on it — `starterFarmsNeeded(foodBill)`): the L1 keep asks 4 and places 3 (a 5×5 grid physically holds 3 beside the town hall; the accumulated surplus covers the rest), the L2 town (pop 1,500) gets 4 on 10×10, an AI seat's L3 castle 12, and a neutral L3 castle (pop 5,000) 11 on 15×15 (a 1-player game creates 4 settlements, not 2 — `castleCount` is floored at `CASTLE_COUNT_MIN = 4`, so two neutral L3s are seeded the same way).
- **Never twice:** `starterCityOnOpen({ existing })` returns an already-populated settlement's own array with `free: false`, so no `PlaceBuildings` is sent and the town hall is never dropped.
- **Close:** The full buildings array is written back to settlement state.
- **Generate button:** A small "Generate" button in the top-right of the city view replaces the entire buildings array with fresh generation. Useful for testing.
- **Town Hall at center:** The center cell is always reserved for a Town Hall building.

Source: [`src/screens/settlements/cityView/cityView.ts`](../src/screens/settlements/cityView/cityView.ts), [`src/screens/settlements/cityView/buildingPlacer.ts`](../src/screens/settlements/cityView/buildingPlacer.ts), and the layout/guard pair in `packages/engine/src/settlement/starterLayout.ts`. The city view's re-sync of its working cart against live state goes through the pure `syncCartBuildings` (`src/screens/settlements/cityView/syncedBuildings.ts`) — it refreshes `level`/`style`/`construction` **and** `bank`, so a pot that changed while the city view was open is not written back stale (unit-tested, because city view imports cannot be loaded under bare `node:test`).

## City districts (✅ implemented)

Owned settlements can expand onto non-settlement hexes within their territory (`controlRange(level)` in `packages/engine/src/control.ts`, resolved via `resolveControllingSettlement` and keyed by `districtKey(q, r)` as `"q,r"`).

- **Grid & spots:** Each district opens in `CityView` (`district?: { q, r }`) as a 5×5 satellite grid where all 25 cells (including center `(2, 2)`) are buildable (`Town Hall` is forbidden: `town_hall_forbidden_in_district`). `generateDistrictSpots` (`packages/engine/src/settlement/citySpots.ts`) generates 3 deterministic `"rich"` spots in `0..4 × 0..4`; when the map hex carries a resource deposit, `spots[0]` is guaranteed to match that resource.
- **Dense-forest wood bonus:** A hex whose terrain is `forest` and which touches a `denseForest` hex gets **one extra spot** — `DENSE_FOREST_BONUS_SPOT` (`wood`, `vein: "dense"`) — on top of its own spots, so its grid carries 4. The rule is the forest's, not the settlement's: no other terrain gains anything. Callers pass `{ touchesDenseForest: touchesTerrain(map, q, r, "denseForest") }` to `generateDistrictSpots` (client `GameEngine`/`UIManager`, server `PlaceBuildings`, and `districtSeed`'s startup districts), so the client-side optimistic grid and the server-authoritative one agree. Existing spots are drawn first, so a hex with no dense-forest neighbour keeps byte-identical spots.
- **No floating districts (2026-10-18):** A district must be part of ONE connected cluster rooted at the settlement's own hex — it must be hex-adjacent to the settlement centre or to another district of the same settlement. Chains count (centre → A → B). Enforced in `packages/engine/src/settlement/districtConnectivity.ts` (`districtConnectionReason`, `connectedDistrictKeys`, `disconnectedDistrictKeys`) and checked twice: the reducer (`applyPlaceBuildings`) refuses any commit whose RESULT leaves a non-empty district outside the cluster (`district_not_connected`, which is what also stops a player clearing the last building out of a bridging district and stranding the far side), and `server/app/commandHandler.ts`'s `PlaceBuildings` pre-checks the target hex for the precise reason before any cost is charged.
- **Water districts & the shipyard (2026-10-18):** A water hex is a district ONLY when it holds a `shipyard` — the one building that may stand on water, and the exception the connectivity rule is built around: water that separates two districts is bridged when a shipyard water district sits in between, because that water district is itself a link in the chain. Rejections: `impassable_district_terrain` (mountain always; water without a shipyard) and `shipyard_requires_water` (a shipyard on a land hex). The city view mirrors both (`districtTerrainBlock` in `src/screens/settlements/cityView/buildEntryStatus.ts`), so the palette disables the same builds the server refuses.
- **Startup districts (2026-10-18):** A settlement is BORN with its districts (`packages/engine/src/settlement/districtSeed.ts`, called from `init.ts`'s `seedStartupDistrictPass`): tier 1 gets none, tier 2 gets 1, tier 3 gets 2. Each seeded district holds 2–3 level-1 buildings from `DISTRICT_BUILDING_POOL` (never a town hall), placed on legal non-overlapping cells, with its own `generateDistrictSpots` set; a resource deposit on the hex picks that resource's producer (or a farm field for food). They are free and already built — the town the game started with, like the main city's starter layout — and every one of them satisfies the connectivity rule by construction (the first is always a neighbour of the settlement hex, later ones must touch the settlement or a chosen district). Seeding draws from its own per-settlement RNG stream (`mulberry32(hashString("startup-districts:<castleSeed>:<settlementId>"))`), so the map's own seeded generation — names, horse variants, city spots — is unchanged.
- **Economy & pooling:** District placements always pay full net cost (never `freeInitialLayout`). Completed district buildings pool into the parent settlement's resource production (`settlementProductionRates`, `produceSettlementResources`), gold income (`settlementIncome`, `effectiveSettlementIncome`), storage and treasury caps (`settlementResourceCap`, `settlementTreasuryCap`), construction/upgrade ticks (`advanceBuildingConstructions`, `startBuildingUpgrade`, `advanceSettlementUpgrades`), banking (`depositIntoBank`, `requestBankWithdrawal`, `matureBankWithdrawals`, `accrueBankInterest`), and garrison recruitment (`eligibleRecruitSources`, `recruitUnits`).
- **Enemy occupation blocking:** When an enemy hero (`ownerId !== settlement.ownerId`) stands on `(district.q, district.r)` (`isDistrictBlockedByHero` in `packages/engine/src/settlement/producers.ts`), that district's resource production and building gold income are zeroed until the hex is cleared, while building upkeep (`buildingUpkeepRequired`) still applies.
- **Cleanup & persistence:** Removing all buildings from a district deletes `districts["q,r"]` and omits `SettlementState.districts` when empty. Persisted in `settlements.districts` JSONB (`server/migrations/029_settlement_districts.sql`) and round-tripped by `settlementRepo` and `hydrateGameState`.

## Map visualisation

- **Unclaimed resource tile:** small icon overlay (coin, log, brick, ore, vial) on top of the terrain.
- **Claimed settlement:** town/castle sprite drawn **on top of** the resource icon, with an ownership ring in the owner's colour. Tier 1 settlements with buildings resolve 20 variant-by-fullness sprites in `src/resources/settlements/` (`settlement-l1-v{0..3}-f{1..5}.png`, keys `castle.1.v${variant}.f${fullness}` via `castleKey(level, variant, fullness)` in `src/render/assetDescriptors.ts`): `castleVariant: 0 | 1 | 2 | 3` selects one of 4 architectural variants, and `settlementFullnessForCount(count)` (`src/render/scene/sceneBuilder/adventureScene.ts`) maps `buildings.length` to 5 fullness stages (Fullness 1: 0–3 buildings, Fullness 2: 4–6, Fullness 3: 7–9, Fullness 4: 10–12, Fullness 5: 13+).
- **Charter target:** hex with scaffolding overlay — dashed outline in `"traveling"` phase, solid outline with construction icon in `"constructing"` phase.
- **Charter placement mode:** valid hexes highlighted with green dashed outline.
- **Minimap:** resource tiles shown as an amber dot in the corner of the tile cell.

## Persistence

`activeCharters`/`nextCharterId`/`nextSettlementId` are all persisted server-side. `server/migrations/009_granular_entities.sql` added a `charters` table plus `games.next_charter_id`/`next_settlement_id` counter columns; `server/persistence/hydrate.ts` reads all three into `GameState` on its granular path, and the `StartCharter` command (`server/app/commandHandler.ts`) writes them via `charterRepo.upsertMany` and `gameRepo.saveHeroesAndSettlements`'s extra param. Charter *founding* is also server-authoritative: `advanceCharters()` runs as part of `EndTurn`'s round-wrap pipeline (`server/app/turnService.ts`), and that command's case syncs the result into `charterRepo`. The hex-by-hex *travel* a "traveling"-phase charter's hero takes toward its target is the one piece still client-only — `TurnController.advanceAutoTravel()`'s loop, not yet ported to its own command.

State types defined in [`src/state/gameState.ts`](../src/state/gameState.ts):
- `CharterState` — `{ id, heroId, ownerId, targetQ, targetR, settlementName, phase, daysRemaining, settlementId, resourceRates, foundedOnResource, citySpots }`
- `HeroState.isChartering` / `HeroState.charterId`
- `GameState.activeCharters`, `nextCharterId`, `nextSettlementId`
- `UpgradeState` — `{ kind: "townHall"|"settlement", targetLevel: 2|3, daysRemaining, newResourceRates?, newCitySpots? }` (the timer ticks `1 + upgradeAccelEffort` days per round wrap when a `townHall`/`mageGuild` is explicitly staffed — see the Upgrade process above)
- `SettlementState.buildings` — `BuildingDef[]` (persisted building array; a bank's pot rides on its own `BuildingDef.bank?: BankPot`, stored in the nullable JSONB column `settlement_buildings.bank` — migration `022_bank_pot.sql`. Building workforce rides the same row: `BuildingDef.workers?` / `BuildingDef.draft?`, persisted in the nullable `settlement_buildings.workers INTEGER` / `settlement_buildings.draft JSONB` columns — migration `030_workforce.sql`, following the 013 `construction` / 022 `bank` precedent exactly. `NULL` = legacy auto-staffed / full pool.)
- `SettlementState.districts` — `Record<string, DistrictState>?` (optional map of `"q,r"` → `{ q, r, citySpots, buildings }`, persisted in `settlements.districts` JSONB — migration `029_settlement_districts.sql`)
- `SettlementState.upgrade` — `UpgradeState?` (active upgrade, if any)
- `SettlementState.stacks` — `Platoon[]?` (settlement garrison; persisted via the `settlement_platoons` table, migration `016_settlement_platoons.sql`, dual-written by `settlementRepo` and reassembled by the granular hydrate path)

New event kinds:
- `charter_started`
- `charter_arrived`
- `charter_travel_blocked`
- `town_hall_upgrade_started`
- `settlement_upgrade_started`
- (battle resolution handles `charter_lost` implicitly via `cleanupDefeatedHeroCharters`)

Recruitment/garrison event kinds (`@heroes/contracts` `EngineEvent`s):
- `UnitsRecruited`
- `UnitsTransferred`
- `SettlementBattleResolved`
- `BankGoldMoved` (2026-10-01 — one pot deposit or withdrawal-request; classified `"apply"` with a replay reducer)

## Cross-references

- What a settlement produces: [resources.md](./resources.md)
- How it produces per turn: [economy.md](./economy.md)
- Who builds and captures them: [heroes.md](./heroes.md)
- Inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)
- As-built collection & building-economy reference: [resource-gathering.md](./resource-gathering.md)

[← Back to index](./README.md)
