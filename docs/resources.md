# Resources

<!-- docs:verified 2026-10-18 -->

Six resource types are defined by [`packages/contracts/src/resources.ts`](../packages/contracts/src/resources.ts): gold, wood, stone, iron, arcane, and food. Five have world-map resource-tile density data; food is a settlement/city resource and never spawns on the world map.

## Resource Types

| Resource | Map tile yield | Main use |
|---|---:|---|
| Gold | 20 (tile-rate value; the treasury credit is the separate building `goldPerTurn`, paid by End Turn since 2026-10-18 — see F2) | Recruitment, construction, trade, charter purse |
| Wood | 15 | Building costs and upkeep |
| Stone | 12 | Building costs and upkeep |
| Iron | 8 | Faction building/recruit costs and settlement upgrades |
| Arcane | 5 | Faction building/recruit costs and upgrades |
| Food | 10 (no map tiles) | Settlement food stock, population, weekly troop upkeep, and caravans |

Resource-tile placement and yields are in [`packages/engine/src/map/resourceTiles.ts`](../packages/engine/src/map/resourceTiles.ts). Settlement rates are computed by [`packages/engine/src/economy/settlementRates.ts`](../packages/engine/src/economy/settlementRates.ts); radius is the settlement level (1, 2, or 3). Food instead comes from city food spots and buildings. See [`resource-gathering.md`](./resource-gathering.md) for the full as-built economy pipeline.

## Map-Tile Density

Each passable tile rolls once against the density table below. Mountain and water tiles have zero resource density and do not hold resource tiles.

| Resource ↓ / Terrain → | Grass | Dirt | Forest | Desert | Swamp | Snow | Mountain | Water |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gold | 6% | 5% | 1% | 1% | 2% | 1% | 0% | 0% |
| Wood | 2% | 1% | 18% | 0.5% | 10% | 0.5% | 0% | 0% |
| Stone | 2% | 6% | 1% | 1% | 0.5% | 3% | 0% | 0% |
| Iron | 0.5% | 3% | 0% | 0% | 0% | 1% | 0% | 0% |
| Arcane | 0% | 2% | 0% | 8% | 3% | 0% | 0% | 0% |
| Food | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |

### Mountain Edges

For each passable tile adjacent to a mountain, the placer multiplies that tile's stone and iron densities by 1.5, capped at 0.20 and 0.15 respectively. The bonus is applied to nearby passable terrain, not to the impassable mountain itself and not only to grass/dirt.

## Food

Food is live, but it is not a map resource. City food spots supply the local multiplier used by farm producers; farms, farmhouses, and granaries produce food. Settlement consumption and population growth run per turn/round, while hero and garrison food upkeep is charged weekly. Food can also move in physical trade-route caravans. See [`army.md`](./army.md), [`settlements.md`](./settlements.md), and [`resource-gathering.md`](./resource-gathering.md).

## Economy caveat — RESOLVED 2026-10-18

`effectiveSettlementIncome()` is a projection helper, and End Turn now pays everything it projects: morale-scaled tax, `producerTurnOutput` (including a `goldMine`), **and** every completed non-producer building's `goldPerTurn` (a `market` pays 40/level). Under-construction buildings are excluded from both sides. The former divergence — `market.goldPerTurn` shown in the HUD but never credited — was finding F2 in [`resource-gathering.md`](./resource-gathering.md), now **closed**.

`resourceRates.gold` remains a phantom (a persisted tile-rate value `produceSettlementResources` never consumes, because gold is not a warehouse resource); the per-turn display reads combined production instead.

## Cross-References

- [Map and terrain](./map.md)
- [Settlement rules](./settlements.md)
- [Economy design intent](./economy.md)
- [As-built resource production and sinks](./resource-gathering.md)
- [Player guide](./player-guide.md)
- [Documentation index](./README.md)
