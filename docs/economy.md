# Economy

The per-turn loop that ties [resources](./resources.md), [settlements](./settlements.md), and [heroes](./heroes.md) together.

## Status

✅ **Implemented.** Per-round loop, resource accumulation, decay **and recovery**, auto-trade, storage/treasury caps, bank pots, and charter costs all ship and are covered by tests. This page is the design-side view; [resource-gathering.md](./resource-gathering.md) is the as-built reference for exact numbers.

## The loop

Per **round** (all players act, then `advanceRound`):

1. **Hero movement** — each player's turn: heroes move (manual for human, AI for enemies). Chartering heroes auto-travel at turn start.
2. **Resource production** — all settlements produce resources based on `resourceRates` (computed from nearby resource tiles × level) **plus their producer buildings** (mines, woodcutters, arcane fonts, and farms — a farm's output is its rate × a per-cell multiplier that peaks at 3× on a matching city spot).
3. **Auto-trade** — active player's settlements auto-transfer resources to cover deficits (a food source keeps its own `foodRequired` reserve).
4. **Consumption** — active player's settlements consume food and building upkeep from warehouses.
5. **Morale** — decays on a food/supplies shortfall, and **recovers +4 per turn** when fully supplied.
6. **Effective income** — `population × goldTax × (morale / 100)` is added to each settlement's treasury.
7. **Advance round** — day increments, all heroes get movement reset, matured bank withdrawals pay out, hero weekly upkeep (`applyWeeklyUpkeep`), **garrison weekly upkeep** (catalog-scaled gold/food from each settlement's treasury + warehouse, with morale bleed, a 2-week grace, then weighted desertion — `applyGarrisonUpkeep`), bank interest on every pot, settlement population growth (weekly), upgrade timer advancement.
8. **Charter advancement** — constructing charters decrement `daysRemaining`; completed charters spawn new settlements.
9. **Upgrade advancement** — active settlement and town hall upgrades decrement `daysRemaining`; completed upgrades apply level-up (rates, spots, TH level).

Implementation: the canonical reducers live in [`packages/engine/src/`](../packages/engine/src), re-exported to the client by [`src/state/gameState.ts`](../src/state/gameState.ts) and orchestrated by [`src/state/turnController.ts`](../src/state/turnController.ts). The per-turn pipeline itself is **server-authoritative**: `server/app/turnService.ts` re-runs the same engine functions against the DB row. Full as-built reference: [resource-gathering.md](./resource-gathering.md).

## Resource pools

Gold is held in two separate pools:
- **Hero purse** (`hero.gold`) — moves with the hero; spent on chartering (2500g); looted by the winner **on defeat** (wiped in battle — the hero is then removed from the map, 2026-09-29 outcomes). A retreat keeps the purse (loses its troops instead); a surrender pays its gold cost and keeps the rest
- **Settlement treasury** (`settlement.gold`) — funds recruitment, building, trade; grows from `population × gold_tax × morale` per round

Warehouse resources held per-settlement:
- `wood`, `stone`, `iron`, `arcane` — produced per turn from nearby tiles
- Spent on charter provisioning (20 wood + 15 stone from settlement warehouse)
- Traded between owned settlements (manual or auto-trade)
- Consumed by building upkeep
- `food` — **produced by farm buildings** (`farmField` 5/turn, `farmhouse` 2, `granary` 3, each × building level × its city-cell multiplier), consumed by the population growth check, the per-turn `ceil(pop/100)` settlement consumption, and the weekly **garrison upkeep**. Food has **no map-tile source** by design — a city's *food spot* is the only tile a farm can exploit for the 3× peak. A free initial city ships with one farm field and two houses; the auto-granted L2 town and L3 castle are seeded with 4 and 11 farm fields respectively, sized by population.

Stockpiles and the treasury are **soft-capped** (derived per level + building `storageBonus`/`treasuryBonus`; a cap gates additions and never destroys stock above it). A `bank` holds a gold pot of its own — capacity `5000 × level`, a 7-day withdrawal delay, and a flat 5% weekly interest that stays in the pot.

## Charter expedition costs

✅ **Locked.** Founding a new settlement via charter costs:
- **2500 Gold** — deducted from hero purse
- **20 Wood** — deducted from provisioning settlement warehouse
- **15 Stone** — deducted from provisioning settlement warehouse

Hero must stand on a friendly settlement to initiate. All costs are non-refundable if the hero is defeated during travel or construction.

## Settlement upgrade costs (✅ implemented)

Upgrading a settlement to the next tier costs resources from the settlement's treasury and warehouse:

| | L1→L2 (Town) | L2→L3 (Castle) |
|---|---|---|
| Gold | 5,000g | 15,000g |
| Wood | 40 | 80 |
| Stone | 30 | 60 |
| Iron | 20 | 50 |
| Arcane | — | 20 |
| Days | 15 | 25 |

## Town Hall upgrade costs (✅ implemented)

| | L1→L2 | L2→L3 |
|---|---|---|
| Gold | 1,500g | 5,000g |
| Wood | 15 | 40 |
| Stone | 10 | 25 |
| Days | 7 | 12 |

All costs are deducted immediately at initiation. If the settlement is captured during construction, the upgrade continues under the new owner with no additional cost.

## Settlement income

Each settlement produces:
- **Gold:** `population × goldTax × (morale / 100)` per round (effective income) — plus a `goldMine` producer's output, and a bank's weekly interest and matured withdrawals
- **Resources:** `resourceRates[r]` per round per resource type, where `resourceRates` is computed at settlement creation time from nearby resource tiles within `settlementRateRadius(level) = level` × level, **plus** every producer building's `base × cell multiplier` (a farm on a matching city spot peaks at 3×)

Initial castles start with population 500, gold tax 1, morale 100, and a seeded starter city (town hall + farm field + 2 houses). Charter-founded settlements start with population 50, gold tax 1, morale 50, `autoTrade: false`, and a free starter set committed when the city view first opens.

## Population growth (✅ implemented)

Settlements gain population weekly during `applyWeeklyUpkeep` (day % 7 === 0), provided they have enough food.

- **Food check:** `warehouse.food >= foodRequired(s)` — growth stalls if food is insufficient
- **Growth:** `max(1, ceil(population × growthRate))` using `settings().populationGrowthRate` (default 10%)
- **Cap:** Population cannot exceed the level's maximum (see [settlements.md](./settlements.md) level table)
- **No food penalty:** Population simply doesn't grow; existing morale decay still applies

Growth rate and the upgrade population gate percentage are player-configurable in Settings.

## Morale

Morale ranges 0–100 and is evaluated on **pre-consumption** state, so a settlement holding exactly its food requirement is not charged decay. It decays when food or building upkeep can't be met from warehouse stocks — `(foodDeficitRatio + suppliesDeficitRatio) × 10`, with `+1` extra while morale < 50, where each ratio is `(needed − have) / max(1, needed)`. `suppliesDeficitRatio` is per-resource (`max(wood, stone)`), so a surplus in one material cannot mask a total shortfall in the other.

**Morale recovers** (+4 per turn, `MORALE_RECOVERY_PER_SUPPLIED_TURN`) whenever there is no food and no supplies shortfall — falling behind is meant to be recoverable, not permanent. Charter settlements start at 50 (lower initial morale). Morale affects effective gold income linearly.

## Storage buildings

Four buildings raise a capacity, and they are not interchangeable:

| Building | Raises | Notes |
|---|---|---|
| `granary` | food storage +600 × level | Also a food producer (+3/turn) — both a storage and a production building |
| `warehouse` | +600 × level on **all five** materials (2×2 footprint) | Also +500 treasury; a real space commitment, so its cost doubled |
| `treasury` | treasury +2000 × level | Gold capacity only; does nothing else |
| `bank` | treasury +2000 × level **plus its own gold pot** | Pot capacity 5000 × level, 7-day withdrawal delay, 5% weekly interest |

## Combat's economic impact

When combat resolves:
- **Winner gains defender's hero gold** (from loser's purse).
- **Loser's hero is deleted** — if chartering, charter is cancelled and costs forfeited.
- **Settlement capture:** ownership flips; settlement continues producing for new owner.

## Example turn (v1)

Player owns one L1 settlement on wood, with two forest tiles in radius (3 wood tiles → `3 × 15 × 1 = 45 wood/round`), population 500, gold tax 1, morale 100 → `500g/round`, one farm field producing food.

| Step | Result |
|------|--------|
| Advance round | Day increments, all heroes get 7 MP, matured bank withdrawals pay out |
| Settlement produces | `warehouse.wood += 45` (tiles) + the farm field's `5 × cellMultiplier` food; `treasury += 500g` |
| Auto-trade (if active) | Transfers resources to cover deficits, leaving each source's own food reserve intact |
| Consumption | Food (`ceil(500/100) = 5`) + building upkeep deducted |
| Morale | −decay on a shortfall, or **+4** when fully supplied |
| Population growth | Weekly: if food met, `pop += max(1, ceil(500 × 0.10)) = +50` |
| Charter construction | `daysRemaining--` for constructing charters |
| Upgrade advancement | `daysRemaining--` for active settlement/TH upgrades |
| End of round totals | `+45 wood, +5 food, +500g` (for player 0) |

## DB persistence

All economy state is stored in the `games` table JSONB columns:
- `heroes` — per-hero `gold`
- `settlements` — per-settlement `gold`, `warehouse`, `morale`, `resourceRates`, `autoTrade`, `population`, `buildings` (including a bank's own `bank` pot), `upgrade`

`activeCharters` round-trips server-side via its own `charters` table, not JSONB (see [settlements.md](./settlements.md#persistence)) — `StartCharter` writes it, `EndTurn`'s round-wrap pipeline advances/founds it via `advanceCharters()`. Settlement upgrades persist via `UpgradeState` in the settlement JSONB, and (as of Phase 3 Track A Week 2) actually advance/complete server-side via `server/app/turnService.ts`'s `advanceSettlementUpgrades()` call on round wrap, not just client-side.

**Floats into INTEGER columns.** The engine deliberately models these quantities as 2-decimal floats (a farm yields e.g. 6.4 food; morale lands on values like 90.4), but every numeric game column is declared `INTEGER`. Writes therefore go through `toIntColumn()` (`server/persistence/integerColumns.ts` = `Math.round`, non-finite → 0) at all 8 sites (`gameRepo` ×3, `settlementRepo` ×3, `heroRepo` ×2) — without it, one food-producing settlement made **every** `EndTurn` return HTTP 500 (`invalid input syntax for type integer: "4171.6"`). `Math.round` matches the engine's own gold idiom and is the identity on integers; `Math.floor` would silently destroy 0.6 of real farm gold per persist. `games.gold` is a derived cross-player sum that is never read authoritatively.

**Known limitation (not fixed).** The granular `INTEGER` tables are now a permanently-rounded shadow of the full-precision `games.settlements` JSONB, and `hydrateFromRepos` (`server/persistence/hydrate.ts`) **prefers** the granular tables when both are non-empty — so a granular-migrated game reloads from rounded integers and sheds ≤0.5 per quantity per command. Newly created games never hit this path, because `POST /api/games` writes no granular rows. The proper fix is `NUMERIC` columns plus a node-postgres type parser (node-postgres returns `numeric` as a string without one), deliberately out of scope for this pass.

## Cross-references

- What's produced: [resources.md](./resources.md)
- What produces it: [settlements.md](./settlements.md)
- What happens inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)
- Who triggers the loop: [heroes.md](./heroes.md)
- Future combat impact: [army.md](./army.md)
- As-built pipeline & sinks reference: [resource-gathering.md](./resource-gathering.md)

[← Back to index](./README.md)
