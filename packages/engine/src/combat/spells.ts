// Spellcasting v1 (docs/spellcasting-plan.md, decisions locked 2026-09-27 in
// the battle-updates roadmap §"Spellcasting v1"). One spell per hero, two
// spells in the catalog, mana as the only cast limiter, Intelligence = mana
// pool / Arcane = spell power. All numbers are named constants in
// combatConfig.ts; this module holds the catalog, the stat→number formulas,
// and the overworld mana-regen helper. The battle-side resolver
// (castSpell/getValidSpellTargets) lives in manualBattle.ts, which imports
// from here — kept one-directional so the dependency graph stays acyclic.

import type { HeroId, HeroState, SpellId } from "@heroes/contracts";
import {
  DEFAULT_HERO_ARCANE,
  DEFAULT_HERO_INTELLIGENCE,
  MANA_PER_INTELLIGENCE,
  SPELL_BUFF_DURATION_ROUNDS,
  SPELL_BUFF_MULTIPLIER,
  SPELL_MANA_COST,
  SPELL_POWER_PER_ARCANE,
} from "../combatConfig";
import type { ActiveSpellEffect, Combatant } from "./types";

export type { SpellId };

export interface SpellDef {
  id: SpellId;
  name: string;
  description: string;
  // Which platoons are legal targets: enemy platoons for damage spells,
  // the caster's own living platoons for buffs.
  targets: "enemy" | "friendly";
  manaCost: number;
}

export const SPELL_CATALOG: Record<SpellId, SpellDef> = {
  magic_arrow: {
    id: "magic_arrow",
    name: "Magic Arrow",
    description: `Deals flat arcane damage (${SPELL_POWER_PER_ARCANE}/Arcane) to one enemy platoon — ignores attack/defense ratios and the type triangle.`,
    targets: "enemy",
    manaCost: SPELL_MANA_COST,
  },
  bless: {
    id: "bless",
    name: "Bless",
    description: `Multiplies one friendly platoon's damage by ${SPELL_BUFF_MULTIPLIER} for ${SPELL_BUFF_DURATION_ROUNDS} rounds.`,
    targets: "friendly",
    manaCost: SPELL_MANA_COST,
  },
};

// v1 ships every hero with Magic Arrow (no spell-selection UI).
export const DEFAULT_HERO_SPELL: SpellId = "magic_arrow";

// heroMaxMana = intelligence × MANA_PER_INTELLIGENCE.
export function maxManaFor(intelligence: number): number {
  return Math.max(0, Math.round(intelligence * MANA_PER_INTELLIGENCE));
}

// Damage-spell magnitude = arcane × SPELL_POWER_PER_ARCANE (flat, untyped).
export function spellDamageFor(arcane: number): number {
  return Math.max(0, Math.round(arcane * SPELL_POWER_PER_ARCANE));
}

export function spellDef(id: SpellId): SpellDef {
  return SPELL_CATALOG[id];
}

// A hero's spell loadout as threaded into a manual battle: which spell they
// know, the mana they walk in with, and their arcane-scaled spell power.
export interface HeroSpellLoadout {
  spell: SpellId;
  mana: number;
  maxMana: number;
  power: number;
}

// Maps a persisted HeroState onto a battle loadout; null when the hero
// knows no spell (then the arena hides casting for that side entirely).
export function spellLoadoutForHero(hero: Pick<HeroState, "heroSpell" | "heroMana" | "heroMaxMana" | "arcane">): HeroSpellLoadout | null {
  if (!hero.heroSpell) return null;
  return {
    spell: hero.heroSpell,
    mana: hero.heroMana,
    maxMana: hero.heroMaxMana,
    power: spellDamageFor(hero.arcane),
  };
}

// The v1 default loadout (default Int/Arcane stats, full mana bar, Magic
// Arrow) — what the Test Battle sandbox and stat-less heroes fall back to.
export function defaultSpellLoadout(): HeroSpellLoadout {
  return {
    spell: DEFAULT_HERO_SPELL,
    mana: maxManaFor(DEFAULT_HERO_INTELLIGENCE),
    maxMana: maxManaFor(DEFAULT_HERO_INTELLIGENCE),
    power: spellDamageFor(DEFAULT_HERO_ARCANE),
  };
}

// Backfills the spellcasting stat block onto a hero that lacks it (old
// saves, test fixtures): fixed v1 starting stats, full pool, Magic Arrow.
export function withDefaultSpellStats<T extends object>(hero: T): T & Pick<HeroState, "arcane" | "intelligence" | "heroMana" | "heroMaxMana" | "heroSpell"> {
  const present = hero as Partial<Pick<HeroState, "arcane" | "intelligence" | "heroMana" | "heroMaxMana" | "heroSpell">>;
  const intelligence = present.intelligence ?? DEFAULT_HERO_INTELLIGENCE;
  const maxMana = present.heroMaxMana ?? maxManaFor(intelligence);
  return {
    ...hero,
    arcane: present.arcane ?? DEFAULT_HERO_ARCANE,
    intelligence,
    heroMana: present.heroMana ?? maxMana,
    heroMaxMana: maxMana,
    heroSpell: present.heroSpell ?? DEFAULT_HERO_SPELL,
  };
}

// Overworld regen (locked decision: full refill on the day tick). Pure —
// returns a new heroes record for turn/round.ts's advanceRound to spread
// into the new state.
export function regenerateHeroMana(heroes: Record<HeroId, HeroState>): Record<HeroId, HeroState> {
  const next: Record<HeroId, HeroState> = {};
  for (const [id, hero] of Object.entries(heroes)) {
    next[id] = hero.heroMana >= hero.heroMaxMana ? hero : { ...hero, heroMana: hero.heroMaxMana };
  }
  return next;
}

// Combined multiplier of every buff on the platoon that is still live in
// `round` (active through expiresRound, inclusive). resolveAttack folds this
// into its damage modifier so a blessed platoon hits harder in BOTH engines.
export function activeEffectMultiplier(combatant: Combatant, round: number): number {
  let multiplier = 1;
  for (const effect of combatant.activeEffects) {
    if (effect.expiresRound >= round) multiplier *= effect.multiplier;
  }
  return multiplier;
}

// Drops buffs whose window has closed — called at the manual battle's round
// boundary, after state.round has advanced.
export function pruneExpiredEffects(combatant: Combatant, round: number): void {
  combatant.activeEffects = combatant.activeEffects.filter((e: ActiveSpellEffect) => e.expiresRound >= round);
}
