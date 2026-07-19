# Economy

The per-turn loop that ties [resources](./resources.md), [settlements](./settlements.md), and [heroes](./heroes.md) together.

## Status

📋 **Planned, not implemented.** Implementation lands with the settlement system.

## The loop

End of every player turn:

1. **Collect resources** from every settlement the player owns.
   - Each settlement produces its underlying tile's resource yield (see [resources.md](./resources.md)).
   - Add to player's inventory.
2. **Award move gold** based on path length of the player's last move: `gold += max(1, path_length)`.
3. **Increment turn counter.**
4. **Check combat** — if any enemy hero is within hex distance 1, trigger combat (see [army.md](./army.md)).
5. **Persist** updated game state to the DB.
6. **Emit event** to the game_events log: `move_completed` or `combat_won`.

## Player inventory

Tracked fields:
- `gold` — universal currency
- `wood`, `stone`, `iron_ore`, `arcane_dust` — raw materials
- (future) `food` — for army upkeep, deferred

All start at 0. Earned from settlements. Spent on buildings, recruitment, ransom.

## Settlement build cost

✅ **Locked:** flat **100g / 30w / 20s** regardless of resource rarity. See [settlements.md](./settlements.md).

For deeper resource production (mines inside a settlement), see [city-view.md](./city-view.md).

## Example turn

Player has 2 settlements: one on Gold (+20), one on Wood (+15).

| Step | Result |
|------|--------|
| Move from (2,2) to (5,4), 4 steps | `gold += 4` |
| Settlement on Gold produces | `gold += 20` |
| Settlement on Wood produces | `wood += 15` |
| End of turn totals | `gold +=24, wood +=15` |
| Persisted state | `{ hero: (5,4), turn: N+1, gold: G+24, wood: W+15, ... }` |

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
