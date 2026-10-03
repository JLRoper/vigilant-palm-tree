# Economy

The per-turn loop that ties [resources](./resources.md), [settlements](./settlements.md), and [heroes](./heroes.md) together.

## Status

✅ **Implemented.** Per-round loop, resource accumulation, decay **and recovery**, storage/treasury caps, bank pots, charter costs, and — since 2026-10-02 — **trade-route caravans with weekly maintenance** (the instant auto-trade survives only behind the legacy `lobby.legacyAutoTrade` gate) all ship and are covered by tests. This page is the design-side view; [resource-gathering.md](./resource-gathering.md) is the as-built reference for exact numbers.

## The loop

Per **round** (all players act, then `advanceRound`):

1. **Hero movement** — each player's turn: heroes move (manual for human, AI for enemies). Chartering heroes auto-travel at turn start.
2. **Resource production** — all settlements produce resources based on `resourceRates` (computed from nearby resource tiles × level) **plus their producer buildings** (mines, woodcutters, arcane fonts, and farms — a farm's output is its rate × a per-cell multiplier that peaks at 3× on a matching city spot).
3. **Auto-trade** — legacy only (`lobby.legacyAutoTrade`; `false` on every new game, so this step moves nothing there — resources travel by caravan, see [Trade routes & caravans](#trade-routes--caravans-2026-10-02)).
4. **Consumption** — active player's settlements consume food and building upkeep from warehouses.
5. **Morale** — decays on a food/supplies shortfall, and **recovers +4 per turn** when fully supplied.
6. **Effective income** — `population × goldTax × (morale / 100)` is added to each settlement's treasury.
7. **Advance round** — day increments, all heroes get movement reset, matured bank withdrawals pay out, and the weekly upkeep runs on every 7th day in a fixed order: **caravan maintenance first** (`wagons × (1 gold + 1 food)` per route, `economy/caravanUpkeep.ts` — paid first so caravans desert last), then hero weekly upkeep (`applyWeeklyUpkeep`), **garrison weekly upkeep** (catalog-scaled gold/food from each settlement's treasury + warehouse, with morale bleed, a 2-week grace, then weighted desertion — `applyGarrisonUpkeep`), bank interest on every pot, settlement population growth (weekly), upgrade timer advancement.
8. **Charter advancement** — constructing charters decrement `daysRemaining`; completed charters spawn new settlements.
9. **Upgrade advancement** — active settlement and town hall upgrades decrement `daysRemaining`; completed upgrades apply level-up (rates, spots, TH level).

Implementation: the canonical reducers live in [`packages/engine/src/`](../packages/engine/src), re-exported to the client by [`src/state/gameState.ts`](../src/state/gameState.ts) and orchestrated by [`src/state/turnController.ts`](../src/state/turnController.ts). The per-turn pipeline itself is **server-authoritative**: `server/app/turnService.ts` re-runs the same engine functions against the DB row. Full as-built reference: [resource-gathering.md](./resource-gathering.md).

## Resource pools

Gold is held in two separate pools:
- **Hero purse** (`hero.gold`) — moves with the hero; **capped by treasury carts** (`heroGoldCap = treasuryWagons × 500`, a slot separate from the army wagons — migration 023); spent on chartering (2500g); looted by the winner **on defeat** (wiped in battle — the hero is then removed from the map, 2026-09-29 outcomes). A retreat keeps the purse (loses its troops instead); a surrender pays its gold cost and keeps the rest
- **Settlement treasury** (`settlement.gold`) — funds recruitment, building, caravan loading; grows from `population × gold_tax × morale` per round

> **Vocabulary (canonical, per the designer).** The **treasury** is the *gold store* — a settlement's `gold`, or a hero's purse — raised by `treasury`/`bank` buildings (and treasury carts on a hero). The **larder** is the *food store* — a settlement's `warehouse.food`, or the food in a hero's wagon cargo — raised by the `granary`. Hero upkeep and caravan bills are quoted in exactly these terms: gold from the treasury/purse, food from the larder/warehouse.

Warehouse resources held per-settlement:
- `wood`, `stone`, `iron`, `arcane` — produced per turn from nearby tiles
- Spent on charter provisioning (20 wood + 15 stone from settlement warehouse)
- Shipped between owned endpoints by **trade-route caravans** (see below)
- Consumed by building upkeep
- `food` — **produced by farm buildings** (`farmField` 5/turn, `farmhouse` 2, `granary` 3, each × building level × its city-cell multiplier), consumed by the population growth check, the per-turn `ceil(pop/100)` settlement consumption, and the weekly **garrison upkeep**. Food has **no map-tile source** by design — a city's *food spot* is the only tile a farm can exploit for the 3× peak. Every settlement is seeded with a starter city whose farmland is sized against **its own** bill (population plus any starting hero standing on it): the L1 keep places 3 fields (asks 4; a 5×5 grid holds 3), the L2 town 4, an AI seat's L3 castle 12, a neutral L3 castle 11.

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

Growth rate is player-configurable in Settings. The upgrade population gate is not — it is the engine-owned constant `UPGRADE_POPULATION_GATE` (85% of level cap, `packages/engine/src/settlement/upgradeSettlement.ts`, issue #153).

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

## Trade routes & caravans (2026-10-02)

The anti-teleport economy: resources move **physically**, by caravan, or not at all. The game-level `lobby.legacyAutoTrade` flag (absent → `true`, so every pre-2026-10-02 save is untouched; `POST /games` writes `false` on every new game) turns the old instant auto-trade off — the per-settlement `autoTrade` toggle remains as a second gate — and trade routes become the only resource transport:

- **Routes connect cities AND heroes.** `TradeRouteState { id, from, to, payload, wagons, caravan, unpaidSinceDay? }` with endpoints `{ kind: "settlement" | "hero"; id }` and payloads `{ kind: "resource"; resource } | { kind: "gold" }` — same-owner pairs, any direction. Wagons are drawn from the player's unassigned pool; removing a route returns them.
- **Two caravan types:** **cargo** (one non-gold warehouse resource, `wagons × 50` per load) and **treasure** (gold, `wagons × 500`). Deliveries clamp to destination headroom (warehouse/treasury caps; hero `heroResourceCap`/`heroGoldCap`) and **never lose cargo** — leftovers wait on the caravan for headroom. Hero endpoints re-path to the moving hero (3 re-paths/day); a dead hero endpoint sends the caravan home.
- **Maintenance is paid FIRST** — `wagons × (1 gold + 1 food)` weekly out of the route's **origin** store (treasury + warehouse, or purse + larder), before hero upkeep, so caravans are "paid first and desert last". Two unpaid weeks open the desertion gate: the route loses a cost-shared share of wagons per unpaid week (gone for good), and at 0 wagons the route disbands itself (`TradeRouteRemoved`).
- **Recommendations** (`economy/tradeNeeds.ts`): food/gold routes to low settlements and heroes, one-click accept in the logistics panel (`src/screens/logistics/logisticsModal.ts`), an End Turn reminder toast when a seat has no routes at all, and the AI seats auto-accept through the same evaluator (up to 3 routes per seat, buying wagons when short) — the AI plays by the same route rules.

As-built numbers and module paths: [resource-gathering.md](./resource-gathering.md) §6.6.

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
| Auto-trade (legacy games only) | Transfers resources to cover deficits, leaving each source's own food reserve intact — on a new game (`lobby.legacyAutoTrade: false`) this row is a no-op and surplus accumulates at the producing settlement |
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

**Floats into NUMERIC columns (migration 027, 2026-10-02).** The engine deliberately models these quantities as 2-decimal floats (a farm yields e.g. 6.4 food; morale lands on values like 90.4). While every numeric game column was `INTEGER`, an unrounded float write aborted the whole statement (`invalid input syntax for type integer: "4171.6"`) — one food-producing settlement made **every** `EndTurn` return HTTP 500 — so writes went through an interim `Math.round` boundary fix (`toIntColumn()`), which unblocked `EndTurn` but left the granular tables a permanently-rounded shadow of the full-precision `games.settlements` JSONB. Migration `027_numeric_columns.sql` widened every affected column to `NUMERIC` and the shadow is gone: `server/persistence/integerColumns.ts` now exports `toNumericColumn()` — the identity on finite values (6.4 persisted reads back 6.4), keeping only the non-finite → 0 defense — at all 8 write sites (`gameRepo` ×3, `settlementRepo` ×3, `heroRepo` ×2), and `server/persistence/pgTypes.ts` registers the node-postgres OID-1700 type parser (`parseFloat`, null-guarded) so every pool reads `NUMERIC` back as numbers. `games.gold` is a derived cross-player sum that is never read authoritatively.

## Cross-references

- What's produced: [resources.md](./resources.md)
- What produces it: [settlements.md](./settlements.md)
- What happens inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)
- Who triggers the loop: [heroes.md](./heroes.md)
- Future combat impact: [army.md](./army.md)
- As-built pipeline & sinks reference: [resource-gathering.md](./resource-gathering.md)

[← Back to index](./README.md)
