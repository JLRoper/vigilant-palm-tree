import type { AdvantageType } from "./combatConfig";
import type { Platoon, PlatoonEntry } from "@heroes/contracts";

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
  tier?: 1 | 2 | 3;
  upkeepGold?: number;
  upkeepFood?: number;
  range?: number;
}

export function unitTier(t: UnitType | undefined): 1 | 2 | 3 {
  return t?.tier ?? 1;
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

// Demo armies assigned to heroes on fresh game creation so the Hero Info menu
// has real data to display. Keys are hero index -> player index (0 = human).
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
    default:
      return [];
  }
}
