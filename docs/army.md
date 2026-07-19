# Army & Tactical Battlefield

⏸️ **Deferred.** This entire system is postponed to a later milestone. Documented here so the design intent isn't lost and the schema anticipates it.

## Why deferred

The player chose to skip the full army model for v1 to keep the resource/settlement system focused. Food is also deferred — it returns here, not in the [resources](./resources.md) doc.

## Scope (when we build this)

A second screen/mode that opens when two heroes meet on the adventure map. Combat becomes **tactical** — units on a grid, turn-based actions, manual positioning.

## Unit roster (proposed for v1 of the army system)

5 unit types. Every **human** army type costs **1 food/day** for upkeep.

| Unit | Cost | Upkeep | Role |
|------|------|--------|------|
| Peasant | 10g | 1 food | Cheap filler, scout |
| Militia | 20g, 10w | 1 food | Basic infantry |
| Archer | 35g, 15w | 1 food | Ranged |
| Knight | 80g, 20w, 10i | 2 food | Heavy melee |
| Mage | 100g, 10i, 5a | 2 food | Spell support, fragile |

(`g`=gold, `w`=wood, `i`=iron, `a`=arcane dust)

## Recruitment

- Instant, at any friendly [settlement](./settlements.md).
- Click hero at settlement → recruit menu → unit appears immediately in hero's stack.
- No build queue, no town screen.

## Hero unit cap

**Base 10 + 1 per owned [settlement](./settlements.md).** With 3 settlements, a hero can field 13 units.

## Combat resolution

✅ **Locked (from earlier decision):** **auto-resolve formula** when this system lands.

- `attack` and `defense` derived from unit types + counts.
- Random ±20% swing per engagement.
- Instant outcome, no per-unit positioning in v1.
- Tactical grid screen can come **after** auto-resolve ships, if desired.

## Hero death

✅ **Locked:** **captured for ransom.**

- Ransom: fixed amount (TBD), paid from inventory.
- Hero released immediately with 1 peasant.
- Settlements stay with the player.

## Food (deferred)

- Every **human** army type costs **1 food/day** for upkeep.
- When this system ships, [Food](./resources.md#open-questions) returns to the resource list.
- Net food production vs upkeep determines whether units starve (lose units) or the player can grow.

## DB schema preview

```sql
-- on heroes table (new)
army JSONB NOT NULL DEFAULT '[]'::jsonb
-- each entry: { unit_type, count }

captured_until_turn INTEGER  -- NULL if free, else turn number when ransom auto-expires (future)
```

## Cross-references

- Hero state and movement: [heroes.md](./heroes.md)
- Where recruitment happens: [settlements.md](./settlements.md)
- What units cost: [resources.md](./resources.md)

[← Back to index](./README.md)
