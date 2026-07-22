# Settlements

The player's claim on the world. A settlement is built on a [resource tile](./resources.md) and passively produces that tile's resource each turn.

## Model

- Built directly on a resource tile. The settlement's yield is determined by the underlying tile's resource type and by other resource tiles within radius 3 (see [resources.md](./resources.md#per-settlement-aggregation)).
- Each player can own **up to 3 settlements** at any time. Shared across all the player's heroes.
- Settlements persist independently of which hero founded them — they belong to the **player**, not the hero. If the founding hero is lost, the settlement stays.
- Settlements accumulate [resources](./resources.md) each turn (see [economy.md](./economy.md)).

## Building cost (locked)

Constructing a settlement costs:
- **100 Gold**
- **30 Wood**
- **20 Stone**

✅ **Locked:** flat cost regardless of underlying resource type. Rarity of the tile is the constraint, not the cost. A settlement on an arcane dust tile costs the same as one on a gold tile.

## Levels

✅ **Locked.** Three levels ship in v1 UI. Level scales both resource yield and gold tax (population × tax = base gold income), and unlocks a larger city-view grid.

| Level | Tier label | Population | Gold tax/turn | City grid |
|-------|------------|------------|---------------|-----------|
| 1     | Settlement | 500        | 1g/head       | 5×5       |
| 2     | Town       | 1,500      | 2g/head       | 10×10     |
| 3     | Castle     | 5,000      | 3g/head       | 15×15     |

Resource yield scales linearly with level: `level × base_yield`. Source: [`src/economy/settlementRates.ts`](../src/economy/settlementRates.ts), [`src/entities/settlement.ts`](../src/entities/settlement.ts).

## Capture

If an enemy hero walks onto a settlement tile, ownership **flips** to that hero's faction. The settlement stays at its current level and continues producing.

- Captured settlements produce for the new owner starting the next turn.
- Capturing is the only way settlements change hands in v1.
- A player can recapture their own settlements by walking their hero back onto them.

✅ **Locked:** no other form of destruction. Settlements are permanent until captured — no spells, no demolition, no decay.

## Map visualisation

- **Unclaimed resource tile:** small icon overlay (coin, log, brick, ore, vial) on top of the terrain.
- **Claimed settlement:** small town sprite (procedural: walls + flag in the owner's colour) drawn **on top of** the resource icon.
- **Minimap:** resource tiles shown as an amber dot in the corner of the tile cell.

## Persistence (DB schema preview)

Extend the `games` table:
```sql
settlements JSONB NOT NULL DEFAULT '[]'::jsonb
-- each entry: { id, q, r, resource, level, owner_faction, founded_turn }
```

New event kinds:
- `settlement_built`
- `settlement_captured`
- `settlement_upgraded` (future)

## Cross-references

- What a settlement produces: [resources.md](./resources.md)
- How it produces per turn: [economy.md](./economy.md)
- Who builds and captures them: [heroes.md](./heroes.md)
- Inside a settlement: [city-view.md](./city-view.md)

[← Back to index](./README.md)
