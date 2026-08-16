# Plan: flanking, facing, and rear guards (part 2 of the attacking overhaul)

Status: **not started — design questions open.** Deliberately deferred out of the
directional melee targeting change so that shipped as positioning-only.

## Context

Directional melee targeting shipped: the player now picks which of the six hexes around
an enemy their platoon closes in from (`getApproachHexes` / `attackFromHex` in
`shared/combat/manualBattle.ts`, hover-sector UI in `src/views/manualBattleArena.ts`).

Right now that choice is **purely positional**. Where you end up decides who can reach you
next round, whether you screen a ranged stack, and whether you hold a chokepoint — but it
does not change a single point of damage. `computeDamage` (`shared/combat/damage.ts`) is
type-triangle plus stats, entirely independent of relative position.

The question this doc exists to answer: **should the side you attack from matter
mechanically, and if so, what does the player do about it?** A flank bonus with no counterplay
is just a damage tax on whoever moves second. The defensive half has to be designed at the
same time as the offensive half, or the feature is unfair by construction.

## What the engine would need

No facing exists anywhere in the codebase today — `Combatant` (`shared/combat/types.ts:20`)
has `position: Axial` and nothing else spatial. Adding it touches:

- **`Combatant.facing: number`** — an index into `HEX_DIRECTIONS` (`src/core/hex.ts`), the
  same 0-5 edge convention the approach-hex code already uses.
- **When facing updates** — on deployment (face the enemy line), after `movePlatoon` (face
  the direction of travel? face the nearest enemy?), and after `attackFromHex` (face the
  target you just hit). Each choice plays very differently and needs testing, not a coin flip.
- **Damage** — a multiplier in `computeDamage` keyed off the angular gap between the
  attacker's approach direction and the defender's facing. Front / flank / rear as three
  bands (gap 0-1 / 2 / 3) is the obvious first cut.
- **`runAiTurn`** — the AI currently picks targets with `pickTarget` and closes by simple
  heuristic. It would need to value approach hexes by the bonus they'd earn, or it becomes
  free damage for the human every round. This is likely the largest single piece of work.
- **Rendering** — facing has to be legible on the board at a glance, or the player is doing
  hex geometry in their head. A notch, a shield arc, or a chevron on the unit disc in
  `draw()`.

## Open question 1: how does a player set up flank and rear guards?

The defensive counterplay. Options worth prototyping, not mutually exclusive:

- **Pre-battle formation step.** A deployment screen before round 1 where you place platoons
  and set initial facings. Fits the existing `deploymentPosition` (`shared/combat/grid.ts:88`)
  seam cleanly — it already computes starting hexes, and this would let the player override
  them. Costs a whole new screen.
- **A "guard" stance action.** Spend a platoon's turn to hold position and widen its front
  arc (say, no flank penalty from any of three sides instead of one). Trades tempo for
  safety, which is a good trade to offer. Cheap: it's a third verb alongside move and attack.
- **Mutual cover between adjacent friendlies.** Two of your platoons standing side by side
  each cover the other's exposed flank automatically. Emergent and requires no new UI — the
  player discovers it — but it's also invisible unless the board shows it, and it quietly
  makes clumping strictly correct. Needs a counter-pressure (area damage? morale?) or it
  flattens into "always blob".
- **Bodyguard / screening platoons.** A unit type trait where a platoon absorbs flank attacks
  aimed at a neighbour. Ties into `UnitType` rather than positioning alone.

The real question underneath: is protecting your flanks something you **do** (spend an
action), something you **arrange** (spend positioning), or something you **bring** (spend
roster slots)? Probably some of each, but the first cut should pick one and be legible.

## Open question 2: how can maps offer that protection in different ways?

If terrain can guard a flank, positioning gains a whole second dimension and the map stops
being a neutral field. Ways to spend the same idea differently:

- **Impassable hexes as cover.** The grid already has `BattleHex.impassable`
  (`shared/combat/types.ts`), and obstacles already scatter through the middle
  (`makeBattleGrid`). A back against an obstacle is a side that cannot be attacked at all —
  this needs *zero* new data, just a rule. Strongest candidate for the first version.
- **Board edges.** Same idea, free: `getApproachHexes` already returns fewer hexes for a
  target on the rim, so edges already confer real protection today. Worth making explicit
  and visible rather than accidental.
- **Terrain types with different protection.** Cliffs (no approach at all), water (approach
  allowed but attacker penalised), woods (breaks line of sight for the ranged half). This
  wants the terrain system in `docs/terrain-plan.md` to land first — check that plan for
  overlap before designing anything here.
- **Elevation.** A separate axis from facing that would stack with it. Almost certainly too
  much for this pass; noting it so it isn't reinvented.
- **Deployment zones anchored on a feature.** Maps that start you with your back to a wall,
  making the *map* the thing that decides whether flanking is the dominant strategy this fight.

## Suggested sequencing

1. **Ship obstacle-and-edge cover first, with no facing at all.** "A side you can't be
   attacked from is a side you don't have to guard" is already true — the engine just
   doesn't say so out loud. Making it explicit and visible teaches the player to think about
   approach direction before any damage math is at stake, and it's nearly free.
2. Prototype facing with a rear bonus only (skip flank), so the effect is dramatic and easy
   to read while the numbers get tuned.
3. Add exactly one form of counterplay — the guard stance is the cheapest — and playtest
   before adding a second.
4. Teach `runAiTurn` to value approach direction. Do not ship 2 or 3 to a player-facing build
   without this.

## Related

- [move-into-contact-rules.md](move-into-contact-rules.md) — zone of control and disengagement,
  which overlap heavily with facing (turning your back to leave a fight is the same idea).
- `docs/terrain-plan.md` — terrain types, which open question 2 depends on.
- `feature-plans/CombatResolutionEngine.md` — the damage/type-advantage rules a facing
  multiplier would slot into.
