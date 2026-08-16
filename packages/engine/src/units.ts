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

export function platoonsHaveTroops(platoons: readonly Platoon[]): boolean {
  return platoons.some((p) => p.entries.some((e) => e.count > 0));
}
