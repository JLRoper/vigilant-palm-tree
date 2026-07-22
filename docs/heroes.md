# Heroes

The actors on the map. Heroes move tile-to-tile, claim [settlements](./settlements.md), and (in future) lead armies into combat.

## What a hero is (v1)

- A single hero sprite on the hex map.
- A position (axial coordinate `q, r`).
- A faction (`player` or `enemy`).
- An ID and movement animation state.

Heroes lead **army stacks** of unit types (see [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts)). Battle resolves by auto-resolve formula — defender is removed from the map on loss and their gold transfers to the attacker. Hero death / capture-for-ransom is still deferred. See the [army system](./army.md) for what remains.

## Movement

- Click a tile to plan a path. [A* pathfinding](../src/map/pathfinding.ts) computes the route.
- Path renders as a yellow line with dots on each step.
- Hero tweens between tiles at **220 ms per tile**.
- During movement, new click commands are ignored.
- Tile costs (see [map.md](./map.md)):
  - Grass = 1
  - Dirt = 1.2
  - Forest = 1.6
  - Water = impassable

## Player turn

Every time the player hero arrives at a destination:
- Turn counter increments by 1.
- Gold is earned: `max(1, path_length)`.
- Combat check: if any enemy hero is within hex distance 1, combat triggers (auto-resolve — see [army.md](./army.md)).
- [Resources](./resources.md) are collected from owned [settlements](./settlements.md) — see [economy.md](./economy.md).
- Game state (hero position, turn, gold, enemy positions) is persisted via the API.

## Enemy heroes

In v1, two enemy heroes spawn on the map. They **wander** independently:
- Every ~1.8 seconds, each idle enemy picks a random reachable tile 3–6 hexes away and moves one step toward it.
- No tactical AI, no coordination.

## Future: hero death & capture-for-ransom

⏸️ **Deferred** — applies once the [army system](./army.md) ships.

When a hero's army is destroyed in combat:
- Hero is **captured for ransom**.
- Removed from the map until ransom is paid.
- **Ransom:** fixed amount (**TBD when army ships**), paid from inventory. Hero released immediately with 1 peasant unit.
- Settlements the hero founded stay with the player — settlements belong to the player, not the hero.

## Future: hero stats

⏸️ **Deferred.** Will likely include:
- Attack / Defense (derived from army)
- Movement points per turn
- Hero level / XP
- Special abilities

## DB persistence (current)

```sql
hero_q INTEGER NOT NULL
hero_r INTEGER NOT NULL
turn   INTEGER NOT NULL DEFAULT 1
gold   INTEGER NOT NULL DEFAULT 0
enemy_positions JSONB NOT NULL DEFAULT '[]'::jsonb
```

## Cross-references

- Where heroes move: [map.md](./map.md)
- What they claim: [settlements.md](./settlements.md)
- What they see inside a settlement: [city-view.md](./city-view.md)
- What they fight with (future): [army.md](./army.md)

[← Back to index](./README.md)
