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
7. **Advance round** — day increments, all heroes get movement reset, hero weekly upkeep (1g/troop every 7 days).
8. **Charter advancement** — constructing charters decrement `daysRemaining`; completed charters spawn new settlements.

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

## Settlement income

Each settlement produces:
- **Gold:** `population × goldTax × (morale / 100)` per round (effective income)
- **Resources:** `resourceRates[r]` per round per resource type, where `resourceRates` is computed at settlement creation time from nearby resource tiles × level

Initial castles start with population 500, gold tax 1, morale 100. Charter-founded settlements start with population 50, gold tax 1, morale 50, `autoTrade: false`.

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
| Charter construction | `daysRemaining--` for constructing charters |
| End of round totals | `+45 wood, +500g` (for player 0) |

## DB persistence

All economy state is stored in the `games` table JSONB columns:
- `heroes` — per-hero `gold`
- `settlements` — per-settlement `gold`, `warehouse`, `morale`, `resourceRates`, `autoTrade`

`activeCharters` round-trips through JSONB alongside the rest of `GameState`.

## Cross-references

- What's produced: [resources.md](./resources.md)
- What produces it: [settlements.md](./settlements.md)
- What happens inside a settlement: [city-view.md](./city-view.md)
- Who triggers the loop: [heroes.md](./heroes.md)
- Future combat impact: [army.md](./army.md)

[← Back to index](./README.md)
