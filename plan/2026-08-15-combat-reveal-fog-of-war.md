# Plan: Combat-only reveal (fog of war) for the manual battle arena — parked idea

**Status:** Not implemented. Written to preserve the idea after the underlying
system was removed on 2026-08-15, so it can be picked up deliberately later
instead of being reconstructed from scratch or half-remembered.

**Branch context:** written on `claude/spy-feature-removal-d0a33d`, right after
removing the "Spy" action (see git history around that date) and then removing
the fog-of-war system it partially depended on.

---

## What existed before this

The manual battle arena (`src/views/manualBattleArena.ts`,
`shared/combat/manualBattle.ts`) had a fog-of-war layer: each `Combatant` had a
`scoutedBy: Set<BattleSide>` field. A side's full stats (composition, exact
troop counts, specialty icon, real HP bar) were hidden — rendered as `?`, `×?`,
and a hatched placeholder bar — until that side was in `scoutedBy`. The set was
populated by `markContacted()`, called automatically whenever
`attackWithPlatoon()` resolved an attack: engaging a platoon in combat
permanently revealed it (mutually) for the rest of the fight.

There was also a "Spy" player action (`spyOnPlatoon`/`getValidSpyTargets`,
plus arena UI: a Spy button, a targeting mode, a gold dashed ring, a
troop-cost dialog) that let a platoon spend 1 troop to proactively reveal an
enemy within reach, without spending its turn. That was removed first (see
the "remove the Spy feature" work) for being half-baked — the cost/benefit
math, the "why 1 troop specifically," and the interaction with ranged vs.
melee reach were never really designed, just implemented.

## Why fog-of-war itself was removed next

Once Spy was gone, the *only* way to lift the fog was to attack first — there
was no proactive option left at all. That made fog-of-war strictly
information-asymmetric against the human player for no gameplay payoff:

- The AI opponent (`runAiTurn` in `shared/combat/manualBattle.ts`) never
  consulted `scoutedBy`/fog-of-war in the first place — it always had full
  information about the human's army. Fog-of-war was purely a UI concealment
  layer on the human side, not a real hidden-information mechanic both sides
  played under.
- Auto-resolve battles (`shared/combat/resolveBattle.ts`, used by the server's
  `/resolve-battle` route) initialized and cloned `scoutedBy` on every
  `Combatant` but never read it — vestigial plumbing riding along on the
  shared type, not an active mechanic there.
- With no proactive reveal option, "attack blind or don't act" isn't a
  meaningful choice — it's just a tax on the first attack against any given
  platoon.

So the field, `markContacted()`, `isKnownTo()`, and all the UI gating
(`?`/`×?`/hatched HP bar, the scouted-only click-to-inspect fallback) were
removed. The AI opponent's army panel now always shows real stats.

## The idea worth revisiting

Fog of war isn't inherently a bad idea for this arena — HoMM-style tactical
battles often benefit from not knowing the exact composition of a stack until
you've either scouted it or engaged it. The reason it's parked rather than
kept is that neither half of a coherent implementation existed at once:

- A **hidden-information mechanic** needs a real way to *earn* information
  before committing to an attack — proactive scouting, hero abilities,
  terrain/vision rules, or partial information (e.g. "roughly 5-10 troops,
  type unknown" rather than a flat `?`) — not just "attack it and now you
  know."
- It also arguably needs the **AI to play under the same rule**, or a
  deliberate, stated reason why the human is uniquely disadvantaged (e.g. "the
  AI already committed its army pre-battle and doesn't need to scout its own
  side" — plausible, but was never actually the stated design intent; it was
  just how the code happened to be written).

If this comes back, a real design pass should answer, before writing code:

1. **What does "unknown" actually communicate?** A flat `?` gives zero
   tactical information. A range, a silhouette, or a partial reveal (e.g.
   troop count visible, composition not) may be more interesting and less
   frustrating than binary known/unknown.
2. **How is fog lifted, proactively?** If a scouting action returns, it needs
   an actual designed cost/benefit — not "spend 1 troop" picked without
   justification. Consider whether this should tie into the hero-item
   "scout a location" concept mentioned in `docs/terrain-plan.md` /
   `docs/CombatResolutionEngine-TechnicalDesign.md` (a distinct, unrelated,
   unbuilt concept — scouting a *map tile* pre-battle, not a *platoon*
   mid-battle) rather than reinventing a second, incompatible scouting idea.
3. **Does the AI play under the same fog, or is asymmetry intentional?**
   Pick one and state it, rather than leaving it as an accident of which code
   path happened to check `scoutedBy`.
4. **Is contact-reveal (attack-to-know) part of the final design, or just a
   fallback?** It's a reasonable piece to keep (you inherently learn about
   what you're fighting), but shouldn't be the *only* piece if the point is a
   real hidden-information mechanic.

## Where the removed code lived (for reference, not to resurrect as-is)

- `shared/combat/types.ts` — `Combatant.scoutedBy: Set<BattleSide>`
- `shared/combat/resolveBattle.ts` — `buildCombatants()` initialization,
  `cloneCombatant()` spread
- `shared/combat/manualBattle.ts` — `markContacted()`, called from
  `attackWithPlatoon()`
- `src/views/manualBattleArena.ts` — `isKnownTo()`, the `known` gating in
  `buildPlatoonStrip()` (specialty icon, troop count, HP bar), the
  scouted-only click-to-inspect fallback in `handleClick()`, the `isKnownTo`
  check in the rail hover handler

None of this crossed the network boundary (confirmed during removal): the
server's `/resolve-battle` route only ever serializes `Platoon`/
`CombatantResult` data, never a raw `Combatant`, so `scoutedBy` never reached
JSON. That's a non-issue either way, but worth knowing if a future version
considers syncing fog state for a multiplayer manual-battle mode — `Set`
doesn't survive `JSON.stringify` and would need to become an array or similar
at that boundary.
