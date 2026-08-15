# Plan: move-into-contact rules (part 3 of the attacking overhaul)

Status: **not started — follow-up to a change already shipped.**

## Context

Moving a platoon next to an enemy in the manual arena can resolve a fight with no separate
attack click. That "bump attack" lives entirely in `refreshAfterMove`
(`src/views/manualBattleArena.ts`) — **it is view code, not an engine rule**. `movePlatoon`
and `attackWithPlatoon` in `shared/combat/manualBattle.ts` are independent; nothing in the
engine auto-attacks.

Two consequences worth keeping in mind before designing anything here:

1. **It is asymmetric.** `runAiTurn` does not play by this rule. The AI moves and attacks by
   its own heuristic and is never forced into a fight by proximity. The human is.
2. **It is cheap to change.** Because it is one branch in one view function, any of the
   options below is a small change — the cost is in deciding which is *right*, not in
   building it.

### What already changed

The bump used to fire whenever *any* enemy was adjacent after a move, with `pickTarget`
choosing which one to hit. That handed target selection to the engine — exactly what
directional targeting exists to give back to the player.

It now fires only when **exactly one** enemy is adjacent. With two or more, the move stands,
both light up as targets, and the player's click decides. Aiming a specific enemy from a
specific side goes through `attackFromHex` and never touches this path at all.

So the engine no longer guesses your *target*. What remains unresolved is whether it should
be deciding to *attack at all*.

## The open problem

You cannot deliberately move into contact without fighting. That forbids a real set of
tactical options:

- Screening a ranged stack by parking a melee platoon in front of it.
- Blocking a corridor or chokepoint to deny movement.
- Stepping into contact with a platoon you intend to hit *next* round with a better matchup.
- Positioning defensively when you'd rather absorb a hit than trade.

Against that: the bump is genuinely convenient, and removing it outright makes the common
case ("walk over and hit that guy") cost an extra click for no gain.

## Options

### A. Per-platoon "move only" toggle
An action-bar toggle that suppresses the bump for the selected platoon. Explicit, discoverable,
and preserves the fast path by default. Costs a button, its state, and a repaint hook — the
help text at `renderActions` would need to reflect the mode.

### B. Modifier key
Hold Shift to move without attacking. Zero UI surface, but undiscoverable without a tooltip,
and awkward on touch. Probably a companion to A rather than an alternative.

### C. Remove the bump entirely
Moving is always moving; attacking is always an explicit click or a directional attack. The
most coherent model — one action, one meaning — and the cheapest to reason about. Costs one
extra click in the common case. **Worth prototyping before assuming the click matters**;
now that hovering an enemy gives a one-click move-and-attack via `attackFromHex`, the bump
may already be redundant for the case it was invented to serve.

### D. Zone of control
The bigger systemic version. Hexes adjacent to an enemy cost extra to enter or leave, or end
movement outright. This replaces "did you touch an enemy" with a real positional rule and
makes screening and chokepoints meaningful without any auto-attack. Touches `movementCosts`
in `shared/combat/manualBattle.ts` and therefore also the AI's pathing and every existing
movement test.

### E. Disengagement penalty
Leaving a hex adjacent to an enemy grants that enemy a free attack, or costs movement. Pairs
naturally with D and with facing (see `flanking-and-facing.md` — turning your back to leave
a fight is the same idea wearing a different hat). Makes committing to melee a real decision
rather than a reversible one.

## Recommendation for the next pass

Try **C** first, and measure it by playing rather than by argument. The bump was a workaround
for a gap that directional targeting has now closed; it may simply not be needed. If the extra
click does grate, **A** is the smallest thing that fixes it.

**D** and **E** are a separate, larger feature — a real melee-engagement system. They should
be designed together with facing, not bolted onto the bump rule.

## Also worth settling

**Should the AI play by whatever rule the human gets?** Right now it does not, and if this
turns into zone-of-control or disengagement penalties, the asymmetry stops being a curiosity
and becomes a fairness problem. Any of D or E means teaching `runAiTurn` the same rule.

## Verification, whenever this is picked up

`test/combat/manualBattle.test.ts` covers the engine primitives (`movePlatoon`,
`attackWithPlatoon`, `attackFromHex`) but **not** the bump itself, which is view code with no
test harness. Options D and E move the rule into the engine and would become testable there —
a point in their favour. A and C stay untestable without a view-level harness, so they need
manual verification in a Test Battle.

## Related

- [flanking-and-facing.md](flanking-and-facing.md) — facing and flank bonuses; overlaps
  heavily with D and E.
- [directional-melee-attack-targeting.md](directional-melee-attack-targeting.md) — superseded
  design notes for the change that prompted this one.
