# Settlements

The player's claim on the world. Settlements come in two forms: **initial castles** (pre-placed at game start via `castlePlacement`) and **charter-founded settlements** (created by heroes via expedition).

## Initial castles

At game start, 2–5 castles are placed on the map (configurable via `castleSeed`/`castleCount`). Each faction gets one. These are Level 1–3 settlements with pre-computed resource rates, city spots, and mines.

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
- AI does not charter in this phase

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

Resource yield scales linearly with level: `level × base_yield`. Source: [`src/economy/settlementRates.ts`](../src/economy/settlementRates.ts), [`src/entities/settlement.ts`](../src/entities/settlement.ts).

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

Source: [`src/state/settings.ts`](../src/state/settings.ts), growth logic in [`src/state/gameState.ts`](../src/state/gameState.ts) `applyWeeklyUpkeep`.

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
3. **Construction:** `daysRemaining` counts down each `advanceRound`. Settlement operates normally during construction (production, income, growth continue).
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

Source: [`src/state/gameState.ts`](../src/state/gameState.ts) (`startTownHallUpgrade`, `startBuildingUpgrade`, `startSettlementUpgrade`, `advanceSettlementUpgrades`), [`server/app/commandHandler.ts`](../server/app/commandHandler.ts) (`UpgradeTownHall`/`UpgradeBuilding`/`UpgradeSettlement` cases), [`src/views/settlementInfoMenu.ts`](../src/views/settlementInfoMenu.ts), [`src/views/buildingMenu.ts`](../src/views/buildingMenu.ts).

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

## Building persistence (✅ implemented)

Buildings placed in the city view are persisted to `SettlementState.buildings` (a `BuildingDef[]` array). Previously ephemeral (only existed while city view was open), buildings now survive close/reopen cycles.

- **First open:** a settlement with no buildings is handed the **free starter set** and it is committed for the player — `townHall L1 + farmField L1 + 2× house L1 + 2× woodcutterHut L1 + stoneMine L1` (`buildStarterLayout`, `packages/engine/src/settlement/starterLayout.ts`), costing **9 wood + 2 stone** per turn (the second hut is the 2026-10-02 balance fix: one hut left the set net wood-negative, median −5 wood/turn; two land it at median −3). This replaced a hand-off of `cityBuildingGen`'s denseUrban layout (~14 buildings, level-2 town hall, **no producer at all**, ~24 wood + 14 stone per turn) which bankrupted a player by roughly turn 12. Farm count is sized against the settlement's **own** food bill (its population plus the weekly bill of any starting hero standing on it — `starterFarmsNeeded(foodBill)`): the L1 keep asks 4 and places 3 (a 5×5 grid physically holds 3 beside the town hall; the accumulated surplus covers the rest), the L2 town (pop 1,500) gets 4 on 10×10, an AI seat's L3 castle 12, and a neutral L3 castle (pop 5,000) 11 on 15×15 (a 1-player game creates 4 settlements, not 2 — `castleCount` is floored at `CASTLE_COUNT_MIN = 4`, so two neutral L3s are seeded the same way).
- **Never twice:** `starterCityOnOpen({ existing })` returns an already-populated settlement's own array with `free: false`, so no `PlaceBuildings` is sent and the town hall is never dropped.
- **Close:** The full buildings array is written back to settlement state.
- **Generate button:** A small "Generate" button in the top-right of the city view replaces the entire buildings array with fresh generation. Useful for testing.
- **Town Hall at center:** The center cell is always reserved for a Town Hall building.

Source: [`src/views/cityView.ts`](../src/views/cityView.ts), [`src/views/buildingPlacer.ts`](../src/views/buildingPlacer.ts), and the layout/guard pair in `packages/engine/src/settlement/starterLayout.ts`. The city view's re-sync of its working cart against live state now goes through the pure `syncCartBuildings` (`src/screens/settlements/cityView/syncedBuildings.ts`) — it refreshes `level`/`style`/`construction` **and** `bank`, so a pot that changed while the city view was open is not written back stale (unit-tested, because `cityView.ts` cannot be imported under bare `node:test`).

## Map visualisation

- **Unclaimed resource tile:** small icon overlay (coin, log, brick, ore, vial) on top of the terrain.
- **Claimed settlement:** small town sprite (procedural: walls + flag in the owner's colour) drawn **on top of** the resource icon.
- **Charter target:** hex with scaffolding overlay — dashed outline in `"traveling"` phase, solid outline with construction icon in `"constructing"` phase.
- **Charter placement mode:** valid hexes highlighted with green dashed outline.
- **Minimap:** resource tiles shown as an amber dot in the corner of the tile cell.

## Persistence

`activeCharters`/`nextCharterId`/`nextSettlementId` are all persisted server-side. `server/migrations/009_granular_entities.sql` added a `charters` table plus `games.next_charter_id`/`next_settlement_id` counter columns; `server/persistence/hydrate.ts` reads all three into `GameState` on its granular path, and the `StartCharter` command (`server/app/commandHandler.ts`) writes them via `charterRepo.upsertMany` and `gameRepo.saveHeroesAndSettlements`'s extra param. Charter *founding* is also server-authoritative: `advanceCharters()` runs as part of `EndTurn`'s round-wrap pipeline (`server/app/turnService.ts`), and that command's case syncs the result into `charterRepo`. The hex-by-hex *travel* a "traveling"-phase charter's hero takes toward its target is the one piece still client-only — `TurnController.advanceAutoTravel()`'s loop, not yet ported to its own command.

State types defined in [`src/state/gameState.ts`](../src/state/gameState.ts):
- `CharterState` — `{ id, heroId, ownerId, targetQ, targetR, settlementName, phase, daysRemaining, settlementId, resourceRates, foundedOnResource, citySpots }`
- `HeroState.isChartering` / `HeroState.charterId`
- `GameState.activeCharters`, `nextCharterId`, `nextSettlementId`
- `UpgradeState` — `{ kind: "townHall"|"settlement", targetLevel: 2|3, daysRemaining, newResourceRates?, newCitySpots? }`
- `SettlementState.buildings` — `BuildingDef[]` (persisted building array; a bank's pot rides on its own `BuildingDef.bank?: BankPot`, stored in the nullable JSONB column `settlement_buildings.bank` — migration `022_bank_pot.sql`)
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
