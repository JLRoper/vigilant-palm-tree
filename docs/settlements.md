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
4. **Complete**: settlement appears as Level 1 with population 50, empty warehouse, 0 gold, morale 50, `autoTrade: false`, generated city spots.

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

The growth rate and upgrade population gate are configurable in Settings:

| Setting | Default | Range | Step |
|---------|---------|-------|------|
| Population Growth Rate | 10% | 1%–50% | 1% |
| Upgrade Population Gate | 85% | 25%–100% | 5% |

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

1. **Pre-requisite check:** Population must meet the gate threshold (default 85% of level cap), and Town Hall must be at or above the target level.
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

If an enemy hero walks onto a settlement tile, ownership **flips** to that hero's faction. The settlement stays at its current level and continues producing.

- Captured settlements produce for the new owner starting the next turn.
- Capturing is the only way settlements change hands in v1.
- A player can recapture their own settlements by walking their hero back onto them.
- **Active upgrades survive capture.** If a settlement is mid-upgrade, construction continues under the new owner.

✅ **Locked:** no other form of destruction. Settlements are permanent until captured — no spells, no demolition, no decay.

## Building persistence (✅ implemented)

Buildings placed in the city view are persisted to `SettlementState.buildings` (a `BuildingDef[]` array). Previously ephemeral (only existed while city view was open), buildings now survive close/reopen cycles.

- **First open:** If `buildings` is empty (migration of old saves), buildings are auto-generated and persisted.
- **Close:** The full buildings array is written back to settlement state.
- **Generate button:** A small "Generate" button in the top-right of the city view replaces the entire buildings array with fresh generation. Useful for testing.
- **Town Hall at center:** The center cell is always reserved for a Town Hall building.

Source: [`src/views/cityView.ts`](../src/views/cityView.ts), [`src/views/buildingPlacer.ts`](../src/views/buildingPlacer.ts).

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
- `SettlementState.buildings` — `BuildingDef[]` (persisted building array)
- `SettlementState.upgrade` — `UpgradeState?` (active upgrade, if any)

New event kinds:
- `charter_started`
- `charter_arrived`
- `charter_travel_blocked`
- `town_hall_upgrade_started`
- `settlement_upgrade_started`
- (battle resolution handles `charter_lost` implicitly via `cleanupDefeatedHeroCharters`)

## Cross-references

- What a settlement produces: [resources.md](./resources.md)
- How it produces per turn: [economy.md](./economy.md)
- Who builds and captures them: [heroes.md](./heroes.md)
- Inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)

[← Back to index](./README.md)
