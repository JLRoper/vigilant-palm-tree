import type { AdvantageType } from "./combatConfig";
import type { FactionId, Platoon, PlatoonEntry } from "@heroes/contracts";

export type { AdvantageType };
// Platoon/PlatoonEntry now live in @heroes/contracts (Track A / Phase 1,
// stage 2) — re-exported here so existing consumers of state/units don't
// need to change their import path.
export type { Platoon, PlatoonEntry };

export interface UnitType {
  id: string;
  name: string;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  description: string;
  advantageType: AdvantageType;
  specialty: string;
  specialtyPriority: number;
  // Optional so pre-migration catalogs (and the ~dozens of UnitType literals
  // in tests) stay valid; the helpers below apply the defaults.
  tier?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  upkeepGold?: number;
  upkeepFood?: number;
  range?: number;
  // Roster faction (unit_types.faction_id, migration 023). Optional for the
  // same reason as tier: absent reads as "human" via unitFactionId below.
  factionId?: FactionId;
}

export function unitTier(t: UnitType | undefined): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return t?.tier ?? 1;
}

export function unitFactionId(t: UnitType | undefined): FactionId {
  return t?.factionId ?? "human";
}

export function unitUpkeepGold(t: UnitType | undefined): number {
  return t?.upkeepGold ?? 1;
}

export function unitUpkeepFood(t: UnitType | undefined): number {
  return t?.upkeepFood ?? 1;
}

export function unitRange(t: UnitType | undefined): number {
  return t?.range ?? 1;
}

export const ARMY_STACK_SLOTS = 8;
export const MAX_PLATOON_ENTRIES = 3;

export function emptyPlatoon(): Platoon {
  return { entries: [] };
}

function normalizeEntries(entries: readonly PlatoonEntry[] | undefined | null): PlatoonEntry[] {
  if (!entries) return [];
  const out: PlatoonEntry[] = [];
  for (const e of entries.slice(0, MAX_PLATOON_ENTRIES)) {
    if (e && e.unitTypeId && e.count > 0) out.push({ unitTypeId: e.unitTypeId, count: e.count });
  }
  return out;
}

export function normalizePlatoons(platoons: readonly Platoon[] | undefined | null): Platoon[] {
  const out: Platoon[] = [];
  if (platoons) {
    for (let i = 0; i < Math.min(platoons.length, ARMY_STACK_SLOTS); i++) {
      out.push({ entries: normalizeEntries(platoons[i]?.entries) });
    }
  }
  while (out.length < ARMY_STACK_SLOTS) out.push(emptyPlatoon());
  return out;
}

export function settlementStacks(s: { stacks?: Platoon[] } | undefined): Platoon[] {
  return normalizePlatoons(s?.stacks);
}

export function platoonsHaveTroops(platoons: readonly Platoon[]): boolean {
  return platoons.some((p) => p.entries.some((e) => e.count > 0));
}

export function platoonTroopTotal(platoons: readonly Platoon[]): number {
  let total = 0;
  for (const p of platoons) {
    for (const e of p.entries) {
      total += e.count;
    }
  }
  return total;
}

// Per-unit strength weight: attack + defence, the two stats the battle
// auto-resolver scores armies with (effective attack and count-average
// defence in combat/damage.ts). Unknown unit ids follow the units.ts
// helper convention of tier-1 defaults (1 + 1): a catalog-less comparison
// scales both sides uniformly, so a ratio gate on power degrades exactly
// to a troop-count comparison instead of marking every garrison free.
export function unitPower(t: UnitType | undefined): number {
  return (t?.attack ?? 1) + (t?.defence ?? 1);
}

export function platoonPower(platoons: readonly Platoon[], unitTypes: Record<string, UnitType>): number {
  let power = 0;
  for (const p of platoons) {
    for (const e of p.entries) {
      power += e.count * unitPower(unitTypes[e.unitTypeId]);
    }
  }
  return power;
}

export function trimPlatoonsFromEnd(
  platoons: readonly Platoon[],
  remove: number,
): Platoon[] {
  const out = platoons.map((p) => ({ entries: p.entries.map((e) => ({ ...e })) }));
  for (let i = out.length - 1; i >= 0 && remove > 0; i--) {
    const entries = out[i].entries;
    while (remove > 0 && entries.length > 0) {
      const last = entries[entries.length - 1];
      const take = Math.min(last.count, remove);
      last.count -= take;
      remove -= take;
      if (last.count === 0) entries.pop();
    }
  }
  return out;
}

export interface DesertionResult {
  stacks: Platoon[];
  removed: number;
  removedCost: number;
}

// Weighted removal by weekly upkeep cost: keep removing individual units
// until the accumulated REMOVED weekly cost reaches targetCost (or the army
// runs out). Which unit leaves each round is a weighted draw whose weight is
// that unit's unitUpkeepGold, so an Eagle Prince (10g) walks ten times as
// often as a peasant (1g) -- "20% of what upkeep couldn't cover" costs an
// Eagle Prince as much as ten peasants.
//
// Conventions mirror trimPlatoonsFromEnd above: the input array length and
// platoon order are preserved, entries are cloned, and an entry that reaches
// count 0 is dropped. Unlike trimPlatoonsFromEnd this NEVER writes a
// fractional count -- the target is an integer ceiling and every weight is an
// integer, so each step removes exactly one unit. Callers recompute
// platoonTroopTotal() on the returned stacks rather than trusting a scalar.
export function desertTroopsByCost(
  stacks: readonly Platoon[],
  targetCost: number,
  unitTypes: Record<string, UnitType>,
  rng: () => number,
): DesertionResult {
  const out = stacks.map((p) => ({ entries: p.entries.map((e) => ({ ...e })) }));
  let remaining = Math.ceil(targetCost);
  let removed = 0;
  let removedCost = 0;
  while (remaining > 0) {
    let totalWeight = 0;
    for (const p of out) {
      for (const e of p.entries) totalWeight += e.count * unitUpkeepGold(unitTypes[e.unitTypeId]);
    }
    if (totalWeight <= 0) break;
    // Roll in weight-space, then walk the entries consuming the roll until
    // the winning unit is found. Clamped so a degenerate rng() >= 1 (or a
    // NaN) still resolves to the last live unit instead of running off the end.
    let roll = rng() * totalWeight;
    if (!Number.isFinite(roll) || roll < 0) roll = 0;
    if (roll >= totalWeight) roll = totalWeight - Number.MIN_VALUE;
    let picked: PlatoonEntry | null = null;
    for (const p of out) {
      let found = false;
      for (const e of p.entries) {
        const w = e.count * unitUpkeepGold(unitTypes[e.unitTypeId]);
        if (roll < w) {
          picked = e;
          found = true;
          break;
        }
        roll -= w;
      }
      if (found) break;
    }
    if (!picked) break;
    const cost = unitUpkeepGold(unitTypes[picked.unitTypeId]);
    picked.count -= 1;
    removed += 1;
    removedCost += cost;
    remaining -= cost;
  }
  for (const p of out) p.entries = p.entries.filter((e) => e.count > 0);
  return { stacks: out, removed, removedCost };
}

// Demo armies assigned to heroes on fresh game creation so the Hero Info menu
// has real data to display. Keys are hero index -> player index (0 = human).
// Seats beyond the two hand-written rows cycle the table deterministically
// (seat i gets row i % 2) so every seat up to MAX_PLAYERS spawns a non-empty
// starter army.
export function demoPlatoonsForPlayer(playerIdx: number): Platoon[] {
  switch (playerIdx) {
    case 0:
      return [
        { entries: [{ unitTypeId: "swordsman", count: 12 }] },
        { entries: [{ unitTypeId: "archer", count: 8 }] },
        { entries: [{ unitTypeId: "cavalry", count: 4 }] },
      ];
    case 1:
      return [
        { entries: [{ unitTypeId: "crossbowman", count: 10 }] },
        { entries: [{ unitTypeId: "griffin", count: 3 }] },
      ];
    default: {
      const row = demoPlatoonsForPlayer(Math.abs(playerIdx) % 2);
      return row.map((p) => ({ entries: p.entries.map((e) => ({ ...e })) }));
    }
  }
}
