# Income rebalancing plan: castle-level income growth vs. building/unit costs

> **Status (2026-10-23):** 🚧 Proposed — not yet implemented. Written up
> after playtesting found L1 castles earning ~400g/turn while L2/L3 castles
> earn 3,000–14,000g/turn, against flat building costs of ~80–500g. No
> option below has been chosen yet; this doc records the analysis and the
> candidate fixes for a design decision.

## Problem

A settlement's gold income scales on **two multiplicative knobs at once**
as it levels up, while building and unit costs don't scale with settlement
level at all:

| Level | Population | Gold tax | Income/turn (`pop × tax`) | Treasury cap |
|---|---|---|---|---|
| 1 | 500 | 1 | **500** | 1,500 |
| 2 | 1,500 | 2 | **3,000** | 4,000 |
| 3 | 5,000 | 3 | **15,000** | 10,000 |

(`POP_BY_LEVEL` / `SETTLEMENT_GOLD_TAX`,
[`packages/engine/src/economy/settlementRates.ts:6-16`](../packages/engine/src/economy/settlementRates.ts).)
That's a **30× jump** L1→L3 from population and tax compounding together.
Playtesting numbers (400 vs. 3,000–14,000) land almost exactly on this
curve once morale (which scales income linearly, see `effectiveIncome()` in
[`packages/engine/src/economy/consumption.ts`](../packages/engine/src/economy/consumption.ts))
is below 100%.

Meanwhile:

- **Building placement costs are flat regardless of settlement level.**
  Every entry in `buildingRegistry.ts`'s `REGISTRY` sits at 80–500g (most
  250–400g); `buildingPlacementCost()` applies no level multiplier.
- **Unit recruit costs are similarly flat** (25g peasants up to ~2,000g for
  top-tier units), unrelated to the owning settlement's level.
- **No concurrent-construction limit exists.** `PlaceBuildings` accepts a
  batch, and nothing gates how many buildings can be started in one command
  beyond available footprint space — so a turn's income directly caps how
  many buildings/units can be bought *that turn*, with no other throttle.
- **The treasury cap doesn't keep pace with income.** Base treasury cap
  only grows ~6.7× (1,500→10,000, `BASE_TREASURY` in
  [`packages/engine/src/settlement/capacity.ts:11`](../packages/engine/src/settlement/capacity.ts))
  while income grows 30×. A L3 castle's single-turn income (15,000) already
  exceeds its base cap before any Bank/Treasury building is built, so the
  cap doesn't throttle a single turn's spending — it only wastes overflow
  across turns.

Net effect: once a settlement reaches L2/L3, a single turn's income can
outright buy its entire remaining building roster or a stack of top-tier
units, which defeats the treasury-management/pacing side of the economy
loop described in [`economy.md`](./economy.md).

## Where the compounding comes from

Population alone already scales 10× L1→L3 (500→5,000) — that's the normal
"bigger city, bigger economy" curve, and isn't the problem by itself. The
**gold tax rate** scaling 1→2→3 on top of that population growth is the
second multiplier that turns a reasonable 10× into an unreasonable 30×.
That second multiplier is the most suspect lever.

## Options considered

1. **Flatten the tax-rate curve.** E.g. hold `goldTax` at 1 for all levels,
   or soften it to something like 1 / 1.3 / 1.6. Population growth alone
   still rewards leveling up; removes the second multiplier. Cuts L1→L3
   from 30× to ~10×. Smallest, most surgical change — one constant table.
2. **Scale building/unit costs with settlement level.** Mirrors what
   `buildingUpgradeCost()` already does for settlement/town-hall upgrades
   (1.5× at L2, 3× at L3 — see `KIND_UPGRADE_MULTIPLIER` and the `factor`
   logic in `buildingRegistry.ts:717-742`). Keeps the "bigger castle, bigger
   everything" fantasy but keeps per-building spend proportionate to
   income. Doesn't by itself fix single-turn unit buying unless recruit
   costs get the same treatment.
3. **Cap concurrent construction per settlement.** E.g. only N buildings
   under construction at once, independent of gold on hand. Attacks the
   "buy the whole build queue in one turn" symptom directly, and still
   matters even if gold is stockpiled over several turns rather than
   earned all at once this turn.
4. **Raise treasury cap scaling to match income scaling.** Least effective
   alone — the cap only throttles *accumulation* across turns; it doesn't
   stop a single turn's spend, since L3 income already exceeds the current
   cap in one turn.

## Recommended direction (not yet decided)

Option 1 + Option 3 together: flattening the tax curve fixes the
economy-wide imbalance at the source, and a construction cap closes the
"steamroll the build queue" exploit even for a player who stockpiles gold
over several turns rather than spending it the instant it's earned. Option
2 is a reasonable addition on top but doesn't by itself fix per-turn unit
buying unless recruit costs scale too.

## Open questions for the design decision

- What should the flattened/softened tax curve actually be? (Hold at 1?
  Soften to a gentler ratio? Does it differ for charter-founded
  settlements, which already start at a lower morale/tax baseline?)
- Should unit recruit costs scale with the *recruiting building's* level,
  the *settlement's* level, or stay flat and rely on construction-cap /
  draft-pool throttling instead?
- Does a concurrent-construction cap apply per settlement, per district, or
  per player? Does it interact with the existing `maxWorkers` /
  workforce-staffing model ([`settlements.md`](./settlements.md) →
  Workforce staffing)?
- Multiplayer implication: does flattening the tax curve change the
  relative value of rushing a L3 castle vs. founding more L1 settlements
  (charter spam), and is that shift desirable?

## Cross-references

- Current income/cost mechanics: [`economy.md`](./economy.md)
- Settlement level table and population caps: [`settlements.md`](./settlements.md)
- Rates/population/tax source: [`packages/engine/src/economy/settlementRates.ts`](../packages/engine/src/economy/settlementRates.ts)
- Building costs and upgrade-cost scaling: [`packages/engine/src/buildingRegistry.ts`](../packages/engine/src/buildingRegistry.ts)
- Treasury/storage caps: [`packages/engine/src/settlement/capacity.ts`](../packages/engine/src/settlement/capacity.ts)
- Morale scaling of effective income: [`packages/engine/src/economy/consumption.ts`](../packages/engine/src/economy/consumption.ts)

[← Back to index](./README.md)
