# Heroes

The actors on the map. Heroes move tile-to-tile, claim [settlements](./settlements.md), lead armies, and can found new settlements via charter expeditions.

## What a hero is (v1)

- A single hero sprite on the hex map.
- A position (axial coordinate `q, r`).
- A faction (`player` or `enemy`).
- An ID, name, owner, and movement animation state.
- A personal **gold purse** (persists with the hero; captured on defeat).
- A set of **army stacks** (unit types + counts, see [`src/data/unitCatalog.ts`](../src/data/unitCatalog.ts)).
- Movement points per turn (7 base, refreshed each `advanceRound`).
- A **trail** of visited hexes.
- **Chartering** state (`isChartering`, `charterId`) — see below.

## Movement

- Click a tile to plan a path. [A* pathfinding](../src/map/pathfinding.ts) computes the route.
- Path renders as a yellow line with dots on each step.
- Hero tweens between tiles at a configurable duration.
- Movement points: **7 per round**, consumed by terrain costs.
- Tile costs (see [map.md](./map.md)):
  - Grass = 1
  - Dirt = 1.2
  - Forest = 1.6
  - Water = impassable

## Chartering (✅ implemented)

A hero can found a new settlement via a **charter expedition**. See [settlements.md](./settlements.md) for costs and rules.

When chartering:
- `isChartering: true` — hero cannot be manually controlled or selected
- `charterId` links to the active `CharterState`
- **Traveling phase**: hero auto-paths toward target, one step per owner-turn
- **Constructing phase**: hero is stationary for 10 days
- If defeated at any point: charter is lost, costs forfeited, hero deleted (standard combat resolution)

## Player turn

The game operates on a **round-based** cycle:
- Each player gets a `PLAYER_TURN` phase to move their heroes.
- Human player clicks to select hero, clicks map to move (A* pathfinding + terrain costs).
- Selected hero's gold/resources are shown in the hero info panel.
- Chartering heroes auto-move at turn start (no manual input).
- AI heroes move automatically via `pickAiMove` (wander + basic targeting).
- After all players act, `advanceRound` runs: day increments, all heroes reset movement, settlements produce resources, morale decays, charters advance.

## Hero gold & economy

Each hero carries their own gold purse (`hero.gold`):
- Earned from combat (defeating enemies loots their gold).
- Spent on chartering (2500g cost from hero purse).
- Deposited to / withdrawn from settlement treasuries (hero must stand on matching settlement).

Settlements track gold separately in their treasury (`settlement.gold`).

## Combat

When a hero moves adjacent to an enemy hero, battle triggers:
- Auto-resolve formula determines winner (see [army.md](./army.md)).
- Loser is removed from the map.
- Winner gains loser's hero gold.
- If loser was chartering, the charter is cancelled (costs forfeited).
- Battle resolution persists via `/api/games/:name/resolve-battle`.

## Enemy heroes

Enemy heroes spawn with initial castles. They **wander** independently:
- AI picks a move target via `pickAiMove` (wander logic + basic targeting).
- AI does not charter settlements in v1.
- AI heroes with `isChartering: true` are skipped in the tick loop (future-proofing).

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

Heroes are stored in the `heroes JSONB` column of the `games` table. Each hero includes all fields from `HeroState` in [`src/state/gameState.ts`](../src/state/gameState.ts).

## Cross-references

- Where heroes move: [map.md](./map.md)
- What they claim: [settlements.md](./settlements.md)
- What they see inside a settlement: [city-view.md](./city-view.md)
- What they fight with (future): [army.md](./army.md)

[← Back to index](./README.md)
