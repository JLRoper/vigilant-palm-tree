# City View

When the player double-clicks a friendly [settlement](./settlements.md), the camera zooms into a **square grid** — the settlement's interior. The grid size scales with castle level:

| Castle level | Tier label | Grid size |
|--------------|------------|-----------|
| 1            | Settlement | 5×5       |
| 2            | Town       | 10×10     |
| 3            | Castle     | 15×15     |

The grid is rendered as an isometric diamond (rotated 45°, tilted ~26.5°), and the player finds scattered resource spots and builds **mines** on top of them to actually collect those resources.

## Status

📋 **Planned, not implemented.** Stubbed here to lock the high-level design before we forget it.

## Why this exists

The adventure map tile under a settlement only tells the player **what kind** of resource the settlement yields (e.g. "Gold"). The settlement's interior determines **how much** — by how many mines the player has built and what they produce.

## Grid

- **Square grid** sized per castle tier (5×5 / 10×10 / 15×15), distinct from the adventure map's hex grid.
- Rendered isometrically (diamond orientation, ~26.5° tilt).
- Camera framing: fixed cell size for 5×5 and 10×10, fit-to-viewport for 15×15.
- Each cell can hold:
  - **Empty** (buildable)
  - **Resource spot** (one of the 5 [resource types](./resources.md))
  - **Mine** (built on a resource spot, produces the resource)
  - **Wall / fortification** (future)
  - **Building slot** (future — town hall, mage guild, etc.)

See [city-view-impl-plan.md](./city-view-impl-plan.md) for the full implementation plan.

## Resource spots inside

When a settlement is first founded, the city grid is populated with a small number of resource spots:

- **~4–6 spots total**, distributed randomly across the grid (count may scale with tier — see impl plan).
- Spot types drawn from the full resource pool (Gold, Wood, Stone, Iron Ore, Arcane Dust) — **not** constrained to match the adventure map tile's resource.
- Same spot can yield different amounts depending on its underlying "vein size" (small/medium/large).

This means a Gold-tile settlement on the adventure map might have a few Iron spots and one Arcane spot inside it. The adventure tile is the **headline** resource; the city interior is the **mix**.

## Mines

- Built on top of a resource spot to collect it.
- Each mine has:
  - **Resource type** (must match the spot beneath it)
  - **Level** (1–3, like settlements)
  - **Daily yield** (base × level × vein size)
- Construction cost scales with mine type:
  - Gold mine: 50g
  - Wood mine: 30g, 10w
  - Stone mine: 30g, 20s
  - Iron mine: 50g, 10i
  - Arcane mine: 80g, 10a
- Upgrade cost (Level 1 → 2 → 3): 2× construction cost per level.

## Player interaction

- Double-click friendly settlement on adventure map → camera pans/zooms to city view.
- Click empty cell → build menu (mine types + cancel).
- Click resource spot → show "Build X mine here" prompt.
- Click existing mine → show info + upgrade button.
- Esc or click "back" arrow → return to adventure map at the settlement tile.

## Capture impact on city view

When an enemy hero captures the settlement (see [settlements.md](./settlements.md)):
- City view now belongs to the new owner.
- Mines built by the previous owner stay — they produce for the new owner.
- The new owner can demolish (future) or upgrade mines.

## DB schema preview

```sql
-- on each settlement entry in games.settlements JSONB:
city_spots JSONB NOT NULL DEFAULT '[]'::jsonb
-- each entry: { cell: {x, y}, resource: 'gold'|'wood'|..., vein: 'small'|'medium'|'large' }

city_mines JSONB NOT NULL DEFAULT '[]'::jsonb
-- each entry: { cell: {x, y}, resource, level, built_turn }
```

## Keep it simple for now

The player noted: "We'll have to keep it simple for now." For v1 of city view, ship the minimum:

1. The tier-appropriate grid (5×5 / 10×10 / 15×15) renders when settlement is opened, isometrically.
2. Resource spots are visible (no fog).
3. Player can build one mine type per spot.
4. Mine production adds to per-turn yield.

Defer for later:
- Mine upgrades (schema supports levels, UI doesn't).
- Building slots beyond mines.
- Walls / fortification layout.
- Spells that affect city production.

## Cross-references

- The settlement that opens this view: [settlements.md](./settlements.md)
- What mines produce: [resources.md](./resources.md)
- How production flows into the per-turn loop: [economy.md](./economy.md)

[← Back to index](./README.md)
