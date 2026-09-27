import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceRound,
  DEFAULT_HERO_ARCANE,
  DEFAULT_HERO_INTELLIGENCE,
  MANA_PER_INTELLIGENCE,
  maxManaFor,
  regenerateHeroMana,
  spellDamageFor,
  spellLoadoutForHero,
  SPELL_POWER_PER_ARCANE,
  withDefaultSpellStats,
} from "@heroes/engine";
import type { HeroState } from "@heroes/contracts";
import { makeHero, makeState } from "../charter/_helpers";

// Spellcasting v1 overworld seam (docs/spellcasting-plan.md, roadmap
// §"Spellcasting v1"): Intelligence = mana pool, Arcane = spell power, full
// mana refill on the day tick (advanceRound), loadout mapping for the arena.

test("maxManaFor/spellDamageFor: the locked v1 formulas", () => {
  assert.equal(maxManaFor(0), 0);
  assert.equal(maxManaFor(DEFAULT_HERO_INTELLIGENCE), DEFAULT_HERO_INTELLIGENCE * MANA_PER_INTELLIGENCE);
  assert.equal(spellDamageFor(0), 0);
  assert.equal(spellDamageFor(DEFAULT_HERO_ARCANE), DEFAULT_HERO_ARCANE * SPELL_POWER_PER_ARCANE);
});

test("withDefaultSpellStats: stat-less heroes get the fixed v1 block", () => {
  const bare = makeHero("h0", 0, 2, 2);
  assert.equal(bare.arcane, DEFAULT_HERO_ARCANE);
  assert.equal(bare.intelligence, DEFAULT_HERO_INTELLIGENCE);
  assert.equal(bare.heroMaxMana, maxManaFor(DEFAULT_HERO_INTELLIGENCE));
  assert.equal(bare.heroMana, bare.heroMaxMana, "a fresh hero starts with a full bar");
  assert.equal(bare.heroSpell, "magic_arrow", "v1 ships every hero with Magic Arrow");

  const custom = withDefaultSpellStats({ arcane: 9 });
  assert.equal(custom.arcane, 9, "provided values are kept");
  assert.equal(custom.intelligence, DEFAULT_HERO_INTELLIGENCE, "missing values are defaulted");
});

test("regenerateHeroMana: full refill, partial bars included, already-full heroes untouched", () => {
  const drained = makeHero("h0", 0, 2, 2, { heroMana: 3 });
  const full = makeHero("h1", 1, 5, 5);
  const next = regenerateHeroMana({ h0: drained, h1: full });
  assert.equal(next.h0.heroMana, next.h0.heroMaxMana, "the day tick fully refills mana");
  assert.equal(next.h1, full, "an already-full hero is returned as-is (no churn)");
});

test("advanceRound (the day tick) refills hero mana", () => {
  const drained = makeHero("h0", 0, 2, 2, { heroMana: 3 });
  const state = makeState({ heroes: [drained] });
  const next = advanceRound(state, 0.1);
  const hero = next.heroes.h0;
  assert.equal(hero.heroMana, hero.heroMaxMana, "a new day means a full mana bar");
  assert.equal(hero.heroMaxMana, maxManaFor(drained.intelligence));
});

test("spellLoadoutForHero: HeroState maps onto the battle loadout; no spell means none", () => {
  const hero: HeroState = makeHero("h0", 0, 2, 2, { arcane: 4, heroMana: 12 });
  const loadout = spellLoadoutForHero(hero);
  assert.deepEqual(loadout, {
    spell: "magic_arrow",
    mana: 12,
    maxMana: maxManaFor(DEFAULT_HERO_INTELLIGENCE),
    power: spellDamageFor(4),
  });

  const mute = spellLoadoutForHero({ ...hero, heroSpell: null });
  assert.equal(mute, null, "a spellcaster-less hero produces no loadout");
});
