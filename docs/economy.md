# Economy

The per-turn loop that ties [resources](./resources.md), [settlements](./settlements.md), and [heroes](./heroes.md) together.

## Status

✅ **Implemented.** Per-round loop, resource accumulation, decay, auto-trade, and charter costs all ship and are covered by tests.

## The loop

Per **round** (all players act, then `advanceRound`):

1. **Hero movement** — each player's turn: heroes move (manual for human, AI for enemies). Chartering heroes auto-travel at turn start.
2. **Resource production** — all settlements produce resources based on `resourceRates` (computed from nearby resource tiles × level).
3. **Auto-trade** — active player's settlements auto-transfer resources to cover deficits.
4. **Consumption** — active player's settlements consume food and building upkeep from warehouses.
5. **Morale decay** — active player's settlements lose morale based on deficits.
6. **Effective income** — `population × goldTax × (morale / 100)` is added to each settlement's treasury.
7. **Advance round** — day increments, all heroes get movement reset, hero weekly upkeep (1g/troop every 7 days), settlement population growth (weekly), upgrade timer advancement.
8. **Charter advancement** — constructing charters decrement `daysRemaining`; completed charters spawn new settlements.
9. **Upgrade advancement** — active settlement and town hall upgrades decrement `daysRemaining`; completed upgrades apply level-up (rates, spots, TH level).

Implementation: [`src/state/gameState.ts`](../src/state/gameState.ts) (reducers), [`src/state/turnController.ts`](../src/state/turnController.ts) (orchestration), [`src/economy/`](../src/economy/).

## Resource pools

Gold is held in two separate pools:
- **Hero purse** (`hero.gold`) — moves with the hero; spent on chartering (2500g); captured on defeat
- **Settlement treasury** (`settlement.gold`) — funds recruitment, building, trade; grows from `population × gold_tax × morale` per round

Warehouse resources held per-settlement:
- `wood`, `stone`, `iron`, `arcane` — produced per turn from nearby tiles
- Spent on charter provisioning (20 wood + 15 stone from settlement warehouse)
- Traded between owned settlements (manual or auto-trade)
- Consumed by building upkeep
- (future) `food` — for army upkeep, deferred

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
- **Gold:** `population × goldTax × (morale / 100)` per round (effective income)
- **Resources:** `resourceRates[r]` per round per resource type, where `resourceRates` is computed at settlement creation time from nearby resource tiles × level

Initial castles start with population 500, gold tax 1, morale 100. Charter-founded settlements start with population 50, gold tax 1, morale 50, `autoTrade: false`.

## Population growth (✅ implemented)

Settlements gain population weekly during `applyWeeklyUpkeep` (day % 7 === 0), provided they have enough food.

- **Food check:** `warehouse.food >= foodRequired(s)` — growth stalls if food is insufficient
- **Growth:** `max(1, ceil(population × growthRate))` using `settings().populationGrowthRate` (default 10%)
- **Cap:** Population cannot exceed the level's maximum (see [settlements.md](./settlements.md) level table)
- **No food penalty:** Population simply doesn't grow; existing morale decay still applies

Growth rate and the upgrade population gate percentage are player-configurable in Settings.

## Morale

Morale ranges 0–100. It decays when food or building upkeep can't be met from warehouse stocks. Charter settlements start at 50 (lower initial morale). Morale affects effective gold income linearly.

## Combat's economic impact

When combat resolves:
- **Winner gains defender's hero gold** (from loser's purse).
- **Loser's hero is deleted** — if chartering, charter is cancelled and costs forfeited.
- **Settlement capture:** ownership flips; settlement continues producing for new owner.

## Example turn (v1)

Player owns one L1 settlement on wood, with two forest tiles in radius (3 wood tiles → `3 × 15 × 1 = 45 wood/round`), population 500, gold tax 1, morale 100 → `500g/round`.

| Step | Result |
|------|--------|
| Advance round | Day increments, all heroes get 7 MP |
| Settlement produces | `warehouse.wood += 45`, `treasury += 500g` |
| Auto-trade (if active) | Transfers resources to cover deficits |
| Consumption | Food + building upkeep deducted |
| Morale decay | Decays if upkeep unmet |
| Population growth | Weekly: if food met, `pop += max(1, ceil(500 × 0.10)) = +50` |
| Charter construction | `daysRemaining--` for constructing charters |
| Upgrade advancement | `daysRemaining--` for active settlement/TH upgrades |
| End of round totals | `+45 wood, +500g` (for player 0) |

## DB persistence

All economy state is stored in the `games` table JSONB columns:
- `heroes` — per-hero `gold`
- `settlements` — per-settlement `gold`, `warehouse`, `morale`, `resourceRates`, `autoTrade`, `population`, `buildings`, `upgrade`

`activeCharters` round-trips server-side via its own `charters` table, not JSONB (see [settlements.md](./settlements.md#persistence)) — `StartCharter` writes it, `EndTurn`'s round-wrap pipeline advances/founds it via `advanceCharters()`. Settlement upgrades persist via `UpgradeState` in the settlement JSONB, and (as of Phase 3 Track A Week 2) actually advance/complete server-side via `server/app/turnService.ts`'s `advanceSettlementUpgrades()` call on round wrap, not just client-side.

## Cross-references

- What's produced: [resources.md](./resources.md)
- What produces it: [settlements.md](./settlements.md)
- What happens inside a settlement: [city-view-impl-plan.md](./city-view-impl-plan.md)
- Who triggers the loop: [heroes.md](./heroes.md)
- Future combat impact: [army.md](./army.md)

[← Back to index](./README.md)
