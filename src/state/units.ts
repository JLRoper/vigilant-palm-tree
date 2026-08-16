// Shared types for the army/unit system. The catalog of unit types lives in the
// database (table `unit_types`, served via GET /api/units). Each hero carries an
// ordered list of ARMY_STACK_SLOTS platoons; the list always has exactly that
// many entries (empty platoons use { entries: [] }).
//
// A platoon is a single battle-grid slot that can carry up to
// MAX_PLATOON_ENTRIES distinct unit types at once (see feature-plans/
// CombatResolutionEngine.md "Army model: platoons"). This replaces the older
// single-type-per-slot UnitStack shape.

export type { AdvantageType, Platoon, PlatoonEntry, UnitType } from "@heroes/engine";
export { ARMY_STACK_SLOTS, emptyPlatoon, MAX_PLATOON_ENTRIES, normalizePlatoons, platoonsHaveTroops } from "@heroes/engine";

import type { Platoon } from "@heroes/contracts";

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
