# Settlements

The player's claim on the world. Settlements come in two forms: **initial castles** (pre-placed at game start via `castlePlacement`) and **charter-founded settlements** (created by heroes via expedition).

## Initial castles

At game start, 2–5 castles are placed on the map (configurable via `castleSeed`/`castleCount`). Each faction gets one. These are Level 1–3 settlements with pre-computed resource rates, city spots, and mines.

## Charter settlements (✅ implemented)

A hero standing on a friendly settlement can initiate a **charter expedition** to found a new settlement at a distant hex.

### Cost

Paid at initiation time, deducted immediately:
- **2500 Gold** (from hero's purse)
- **20 Wood** (from provisioning settlement's warehouse)
- **15 Stone** (from provisioning settlement's warehouse)

If the hero is defeated during travel or construction, all costs are forfeited.

### Process

1. **Provision** (instant): costs deducted. Hero enters `"traveling"` phase.
2. **Travel** (1+ turns): hero auto-paths one hex-step per owner-turn toward target. Vulnerable to attack.
3. **Construction** (10 days): hero is stationary at target. `daysRemaining` decrements each `advanceRound`. Vulnerable to attack.
4. **Complete**: settlement appears as Level 1 with population 50, empty warehouse, 0 gold, morale 50, `autoTrade: false`, generated city spots.

### Placement rules

- Target hex must be passable terrain
- Minimum 4 hexes from any existing settlement
- Not occupied by another hero or active charter target
- No movement-range limit — hero walks there over multiple turns

### Limits

- **No cap** on number of settlements per player
- Voluntary cancellation not allowed
- AI does not charter in this phase

### Hero state during charter

- `isChartering: true` / `charterId` set — hero cannot be manually controlled
- Traveling: auto-paths each turn via `advanceAutoTravel()` in `TurnController`
- Constructing: stationary, `daysRemaining` decrements per round
- Defeat in any phase → charter lost, costs forfeited

## Levels

✅ **Locked.** Three levels ship in v1 UI. Level scales both resource yield and gold tax (population × tax = base gold income), and unlocks a larger city-view grid.

| Level | Tier label | Population | Gold tax/turn | City grid |
|-------|------------|------------|---------------|-----------|
| 1     | Settlement | 500        | 1g/head       | 5×5       |
| 2     | Town       | 1,500      | 2g/head       | 10×10     |
| 3     | Castle     | 5,000      | 3g/head       | 15×15     |

Charter-founded settlements always start at Level 1 with population 50 (not 500).

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
- **Charter target:** hex with scaffolding overlay — dashed outline in `"traveling"` phase, solid outline with construction icon in `"constructing"` phase.
- **Charter placement mode:** valid hexes highlighted with green dashed outline.
- **Minimap:** resource tiles shown as an amber dot in the corner of the tile cell.

## Persistence

`activeCharters`, `nextCharterId`, and `nextSettlementId` are stored as part of the `games` JSONB row. No schema change needed — they round-trip through `heroes`/`settlements`/`players` JSONB columns on `POST /api/games/:name/end-turn`.

State types defined in [`src/state/gameState.ts`](../src/state/gameState.ts):
- `CharterState` — `{ id, heroId, ownerId, targetQ, targetR, settlementName, phase, daysRemaining, settlementId, resourceRates, foundedOnResource, citySpots }`
- `HeroState.isChartering` / `HeroState.charterId`
- `GameState.activeCharters`, `nextCharterId`, `nextSettlementId`

New event kinds:
- `charter_started`
- `charter_arrived`
- `charter_travel_blocked`
- (battle resolution handles `charter_lost` implicitly via `cleanupDefeatedHeroCharters`)

## Cross-references

- What a settlement produces: [resources.md](./resources.md)
- How it produces per turn: [economy.md](./economy.md)
- Who builds and captures them: [heroes.md](./heroes.md)
- Inside a settlement: [city-view.md](./city-view.md)

[← Back to index](./README.md)
