# Economy

The per-turn loop that ties [resources](./resources.md), [settlements](./settlements.md), and [heroes](./heroes.md) together.

## Status

✅ **Implemented.** Per-turn loop, resource accumulation, decay, and trade all ship and are covered by the smoke test.

## The loop

End of every player turn:

1. **Collect resources** from every settlement the player owns. Each settlement produces its underlying tile's resource yield plus any other resource-bearing tiles within radius 3, scaled by castle level (see [resources.md](./resources.md#per-settlement-aggregation)).
2. **Award move gold** based on path length of the player's last move: `gold += max(1, path_length)`.
3. **Increment turn counter.**
4. **Check combat** — if any enemy hero is within hex distance 1, trigger battle (auto-resolve).
5. **Persist** updated game state to the DB.
6. **Emit event** to the game_events log.

Implementation: [`src/economy/`](../../src/economy/), [`src/state/turnController.ts`](../../src/state/turnController.ts).

## Player inventory

Tracked fields (gold held in two pools: hero purse and per-settlement treasuries):

- `gold` (hero purse) — moves with the hero, captured on hero loss
- Per-settlement `gold` (treasury) — funds recruitment, building, trade; grows from `population × gold_tax` per round
- `wood`, `stone`, `iron`, `arcane` in each settlement's warehouse — produced per turn, spent on building or traded between owned settlements
- (future) `food` — for army upkeep, deferred

See [`src/state/gameState.ts`](../../src/state/gameState.ts) for the canonical shape.

## Settlement build cost

✅ **Locked:** flat **100g / 30w / 20s** regardless of resource rarity. See [settlements.md](./settlements.md).

For deeper resource production (mines inside a settlement), see [city-view.md](./city-view.md).

## Example turn (v1)

Player owns one L1 settlement founded on wood, with two forest tiles in radius (so 3 wood tiles total → `3 × 15 × 1 = 45 wood/turn`), population 500, gold tax 1 → `500g/turn`.

| Step | Result |
|------|--------|
| Move from (2,7) to (3,7), 1 step | `hero_purse += 1g` (move gold) |
| Settlement produces | `warehouse.wood += 45`, `treasury += 500g` |
| End of turn totals | `+45 wood, +501g (1 move + 500 tax)` |
| Persisted state | `{ hero: (3,7), turn: N+1, purse: P+1, settlement: { gold: T+500, wood: W+45 } }` |

Morale decays when food/warehouse can't keep up with upkeep (when food ships); for v1 without food, morale is held at 100.

## Combat's economic impact

When combat resolves (future, see [army.md](./army.md)):
- Winner: +50 gold bonus.
- Loser: hero captured for ransom (see [heroes.md](./heroes.md)).
- Settlement capture: ownership flips, settlement continues producing for new owner.

## DB schema (current)

```sql
gold INTEGER NOT NULL DEFAULT 0
-- wood, stone, iron_ore, arcane_dust can be added when settlements land:
wood         INTEGER NOT NULL DEFAULT 0
stone        INTEGER NOT NULL DEFAULT 0
iron_ore     INTEGER NOT NULL DEFAULT 0
arcane_dust  INTEGER NOT NULL DEFAULT 0
```

## Cross-references

- What's produced: [resources.md](./resources.md)
- What produces it: [settlements.md](./settlements.md)
- What happens inside a settlement: [city-view.md](./city-view.md)
- Who triggers the loop: [heroes.md](./heroes.md)
- Future combat impact: [army.md](./army.md)

[← Back to index](./README.md)
