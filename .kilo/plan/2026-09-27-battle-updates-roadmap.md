# Battle Updates Roadmap — wiring → morale/fatigue → spellcasting

**Status:** ✅ Current planning doc (2026-09-27). Decisions locked with JLR; sequencing below.

## Sequence

| # | Feature | State | Why this order |
|---|---|---|---|
| 0 | **Manual battle wiring** (collision → arena, Quick Resolve, `battle_actions` streaming, SubmitBattleResult, #143 fix) | 🔨 **In implementation** — `.kilo/plan/2026-09-27-manual-battle-wiring.md` | Everything else plays through the arena's real-game entry point |
| A | **Morale & fatigue** (`docs/morale-fatigue-plan.md`) | 📋 Planned — implementation-ready, needs stale-path refresh | Smallest closed loop; its `Combatant` extension (morale/fatigue fields) lands FIRST so spellcasting's `activeEffects` extends an already-updated shape; UI bars already exist waiting for real data |
| B | **Spellcasting v1** (`docs/spellcasting-plan.md`) | 📋 Planned — all 5 open design questions answered 2026-09-27 (see below) | Depends on A's `Combatant` shape + on wiring's `battle_actions` log (spell casts must be streamed like every other action for the future legality checker) |
| C | Deferred follow-ups | — | PvP manual battles; AI casting (v1.1); hero stat progression/leveling; spellbook (multiple spells per hero) |

## Cross-cutting coordination rules

1. **`Combatant` shape evolves once per feature, in sequence:** A adds `morale`/`fatigue`; B adds `activeEffects: { multiplier: number; expiresRound: number }[]` (resolves spellcasting open question #5 — `SideModifiers.damageMultiplier` is a per-battle static and does NOT fit a per-platoon timed debuff).
2. **`battle_actions` streaming covers new verbs:** when A lands, morale/fatigue changes become log entries (`morale_change`); when B lands, `spell_cast` actions stream like moves/attacks. The future legality consumer needs them all.
3. **All tunables live in `packages/engine/src/combatConfig.ts`** as named constants — never inlined (both plans already mandate this).
4. **Stale paths to refresh during each feature's implementation:** both docs predate the `shared/` → `packages/engine` move and the `src/views/` → `src/screens/` move. Canonical: `shared/combat/*` → `packages/engine/src/combat/*`, `src/views/manualBattleArena.ts` → `src/screens/combat/arena/openManualBattleArena.ts` (+ siblings), `src/views/heroInfoMenu.ts` → `src/screens/heroes/heroInfoMenu.ts`, `shared/combatConfig.ts` → `packages/engine/src/combatConfig.ts`.

## Morale & fatigue (feature A) — no open design questions

The existing plan is complete and approved as written (8 phases, acceptance criteria). Implementation notes:
- Phase order per the doc's own suggestion: data model + constants → fatigue accrual/decay + damage hookup → morale triggers + retreat threshold → UI bars → tests landing with each phase.
- All values as `combatConfig.ts` constants: fatigue per move/attack, decay per own-turn start, morale delta per casualty/kill/adjacent-death, the attack/defense multiplier curve, and the lowered auto-retreat HP threshold at low morale.

## Spellcasting v1 (feature B) — decisions locked 2026-09-27

These resolve the plan's open questions #1–#4 (+#5 via sequencing):

1. **Mana home: persistent on `HeroState`** (`packages/contracts/src/gameState.ts`) — `heroMana`, `heroMaxMana`, `heroSpell` (one spell for v1). Persists across battles via the normal games-row state; threads into the arena through `openManualBattleArena`'s `options` exactly like `heroGold`.
2. **Overworld regen:** mana refills on the day tick (the same cadence that drives the per-round economy) — full refill per new day, v1 proposal; the exact hook is the `day:changed` point in the server turn pipeline.
3. **Stat semantics: Intelligence = mana pool, Arcane = spell power.** `heroMaxMana = f(Intelligence)`, spell magnitude `= g(Arcane)` — v1 uses fixed starting Int/Arcane on `HeroState` (formulas as `combatConfig.ts` constants, e.g. `MANA_PER_INTELLIGENCE`, `SPELL_POWER_PER_ARCANE`); leveling/progression of the stats is explicitly later. Side effect: the hero info panel's four blank stat rows (Attack, Defence, Arcane, Intelligence) get wired to real `HeroState` values — Attack/Defence from the hero's existing combat stats or flat v1 values, flagged as its own small task.
4. **AI never casts in v1** (v1.1 fast-follow): AI-side cast button hidden; `runAiTurn()` unchanged.
5. **Cast limiter: mana only.** No per-battle/round hard cap; the tuning knob is mana cost vs. pool size.
6. **Spell set for v1 (unchanged from the plan):** one damage spell (flat, via `applyCasualties()`, skipping the atk/def ratio + type multiplier) and one buff/debuff spell (per-`Combatant` timed multiplier via `activeEffects`); `CombatEffect` gains `"spell_damage"`/`"spell_buff"` kinds; `BattleLogEntry` gains `spell_cast`; casting never consumes a platoon's turn (Spy precedent).
7. **Wiring requirement:** every cast streams a `battle_actions` row (feature 0's pipeline) — the action log must be complete for the future legality consumer.

## Open items not in this roadmap

Real email delivery; city-view mine upgrades L2/L3 UI (may reuse `pixel.goldMine.1-3` art); `building-pixel-bar-1/2.png` wiring (needs a "Bar" kind + effects); stale granary anchor values.
