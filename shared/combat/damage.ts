import type { PlatoonEntry, UnitType } from "../units";
import { TYPE_ADVANTAGE_MULTIPLIER, TYPE_DISADVANTAGE_MULTIPLIER, TYPE_TRIANGLE } from "../combatConfig";

export function totalHealth(entries: readonly PlatoonEntry[], unitTypes: Record<string, UnitType>): number {
  let hp = 0;
  for (const e of entries) hp += (unitTypes[e.unitTypeId]?.health ?? 0) * e.count;
  return hp;
}

// Not a simulated win-rate — computeDamage is deterministic ("no random
// swing", see below), so fighting the same two platoons twice always gives
// the same outcome. Instead this compares how many rounds each side would
// take to grind the other down at their current damage/HP and turns that
// into a 0-100 estimate. Symmetric: estimateWinChance(a, b, ...) is always
// 100 - estimateWinChance(b, a, ...).
export function estimateWinChance(
  aEntries: readonly PlatoonEntry[],
  bEntries: readonly PlatoonEntry[],
  unitTypes: Record<string, UnitType>,
): number {
  const aHp = totalHealth(aEntries, unitTypes);
  const bHp = totalHealth(bEntries, unitTypes);
  if (aHp <= 0) return 0;
  if (bHp <= 0) return 100;
  const aDmg = computeDamage(aEntries, bEntries, unitTypes, 1).damage;
  const bDmg = computeDamage(bEntries, aEntries, unitTypes, 1).damage;
  const roundsToKillB = bHp / aDmg;
  const roundsToKillA = aHp / bDmg;
  return Math.round((roundsToKillA / (roundsToKillA + roundsToKillB)) * 100);
}

function uniqueAdvantageTypes(entries: readonly PlatoonEntry[], unitTypes: Record<string, UnitType>): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    const t = unitTypes[e.unitTypeId]?.advantageType;
    if (t) set.add(t);
  }
  return Array.from(set);
}

// Symmetric infantry/cavalry/ranged triangle, plus the "monster" one-way
// exception (always advantaged attacking, never disadvantaged) — see
// shared/combatConfig.ts.
export function typeMultiplier(
  attackerEntries: readonly PlatoonEntry[],
  defenderEntries: readonly PlatoonEntry[],
  unitTypes: Record<string, UnitType>,
): { multiplier: number; advantageBonus: boolean; disadvantagePenalty: boolean } {
  const attackerTypes = uniqueAdvantageTypes(attackerEntries, unitTypes);
  const defenderTypes = uniqueAdvantageTypes(defenderEntries, unitTypes);
  let advantaged = false;
  let disadvantaged = false;
  for (const at of attackerTypes) {
    if (at === "monster") {
      advantaged = true;
      continue;
    }
    const beats = TYPE_TRIANGLE[at as keyof typeof TYPE_TRIANGLE];
    if (beats && defenderTypes.includes(beats)) advantaged = true;
    if (defenderTypes.some((dt) => TYPE_TRIANGLE[dt as keyof typeof TYPE_TRIANGLE] === at)) disadvantaged = true;
  }
  if (advantaged) return { multiplier: TYPE_ADVANTAGE_MULTIPLIER, advantageBonus: true, disadvantagePenalty: false };
  if (disadvantaged) return { multiplier: TYPE_DISADVANTAGE_MULTIPLIER, advantageBonus: false, disadvantagePenalty: true };
  return { multiplier: 1, advantageBonus: false, disadvantagePenalty: false };
}

export interface DamageComputation {
  damage: number;
  advantageBonus: boolean;
  disadvantagePenalty: boolean;
}

// Ratio-based, deterministic damage formula (no random swing — see
// feature-plans/CombatResolutionEngine.md "Damage formula & type-advantage
// chart"): effAttack^2 / (effAttack + effDefense), scaled by the
// type-advantage multiplier and a caller modifier (e.g. a future Day/Night
// hook).
export function computeDamage(
  attackerEntries: readonly PlatoonEntry[],
  defenderEntries: readonly PlatoonEntry[],
  unitTypes: Record<string, UnitType>,
  modifier: number,
): DamageComputation {
  let effAttack = 0;
  for (const e of attackerEntries) effAttack += (unitTypes[e.unitTypeId]?.attack ?? 0) * e.count;

  let defWeighted = 0;
  let defenderCount = 0;
  for (const e of defenderEntries) {
    defWeighted += (unitTypes[e.unitTypeId]?.defence ?? 0) * e.count;
    defenderCount += e.count;
  }
  const effDefense = defenderCount > 0 ? defWeighted / defenderCount : 0;

  const rawDamage = effAttack + effDefense > 0 ? (effAttack * effAttack) / (effAttack + effDefense) : 0;
  const { multiplier, advantageBonus, disadvantagePenalty } = typeMultiplier(attackerEntries, defenderEntries, unitTypes);
  const damage = Math.max(1, Math.round(rawDamage * multiplier * modifier));
  return { damage, advantageBonus, disadvantagePenalty };
}

export interface CasualtyResult {
  entries: PlatoonEntry[];
  casualties: PlatoonEntry[];
}

// Applies damage entry-by-entry in listed order: the first entry absorbs
// damage from its health pool (count * health) until exhausted, then the
// next. unitsLost = floor(damageApplied / entry.health); any remainder
// within an entry's pool is discarded rather than carried to the next
// entry — a deliberate simplification, see feature-plans/
// CombatResolutionEngine.md "Damage formula & type-advantage chart".
export function applyCasualties(
  entries: readonly PlatoonEntry[],
  unitTypes: Record<string, UnitType>,
  damage: number,
): CasualtyResult {
  const working = entries.map((e) => ({ ...e }));
  const casualties: PlatoonEntry[] = [];
  let remaining = damage;
  for (const e of working) {
    if (remaining <= 0) break;
    const hp = unitTypes[e.unitTypeId]?.health ?? 1;
    const pool = hp * e.count;
    const applied = Math.min(remaining, pool);
    const lost = Math.min(e.count, Math.floor(applied / hp));
    if (lost > 0) {
      e.count -= lost;
      casualties.push({ unitTypeId: e.unitTypeId, count: lost });
    }
    remaining -= applied;
  }
  const survivors = working.filter((e) => e.count > 0);
  return { entries: survivors, casualties };
}

// Peels a flat percentage off every entry's count (rounding up so a retreat
// always costs at least 1 unit if any remain) — the self-retreat loss from
// feature-plans/CombatResolutionEngine.md.
export function applyRetreatLoss(
  entries: readonly PlatoonEntry[],
  lossPct: number,
): { entries: PlatoonEntry[]; casualties: PlatoonEntry[] } {
  const survivors: PlatoonEntry[] = [];
  const casualties: PlatoonEntry[] = [];
  for (const e of entries) {
    const lost = Math.min(e.count, Math.ceil(e.count * lossPct));
    const remaining = e.count - lost;
    if (lost > 0) casualties.push({ unitTypeId: e.unitTypeId, count: lost });
    if (remaining > 0) survivors.push({ unitTypeId: e.unitTypeId, count: remaining });
  }
  return { entries: survivors, casualties };
}
