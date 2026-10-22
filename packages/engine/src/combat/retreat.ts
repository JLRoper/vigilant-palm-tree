import type { PlatoonEntry, UnitType } from "../units";
import { unitRange } from "../units";
import { totalHealth } from "./damage";
import type { BattleLogEntry, BattleSide, Combatant } from "./types";

// Hero retreat, starting-edge rule (plan/2026-10-21-battle-retreat-rules.md):
// platoons for which `escapes` holds leave the field intact; every other
// living platoon is abandoned and all of its units are lost. The manual arena
// passes "standing on the starting edge column"; the auto-resolver, whose
// platoons never move, passes "never made melee contact".
export function retreatSideByEdge(
  combatants: Combatant[],
  side: BattleSide,
  escapes: (c: Combatant) => boolean,
  round: number,
  log: BattleLogEntry[],
): void {
  for (const c of combatants) {
    if (c.retreated || c.entries.every((e) => e.count <= 0)) continue;
    if (escapes(c)) {
      c.retreated = true;
      continue;
    }
    const casualties: PlatoonEntry[] = c.entries.filter((e) => e.count > 0).map((e) => ({ ...e }));
    c.entries = [];
    log.push({ round, kind: "left_behind", side, slotIndex: c.slotIndex, casualties });
  }
  log.push({ round, kind: "hero_retreat", side });
}

// Whether a hero retreat is open in `round` (the round about to be played,
// or the one in progress) for a battle whose gate is `minRetreatRound`.
export function retreatOpen(round: number, minRetreatRound: number): boolean {
  return round >= minRetreatRound;
}

export function isMeleePlatoon(entries: readonly PlatoonEntry[], unitTypes: Record<string, UnitType>): boolean {
  return entries.some((e) => unitRange(unitTypes[e.unitTypeId]) <= 1);
}

// The "outmatched" policy's trigger: this side's remaining health is below
// `ratio` of the enemy's.
export function isOutmatched(
  own: readonly Combatant[],
  enemy: readonly Combatant[],
  unitTypes: Record<string, UnitType>,
  ratio: number,
): boolean {
  const sum = (list: readonly Combatant[]): number =>
    list.reduce((acc, c) => (c.retreated ? acc : acc + totalHealth(c.entries, unitTypes)), 0);
  const enemyHealth = sum(enemy);
  if (enemyHealth <= 0) return false;
  return sum(own) < ratio * enemyHealth;
}
