// Shared types for the army/unit system. The catalog of unit types lives in the
// database (table `unit_types`, served via GET /api/units). Each hero carries an
// ordered list of ARMY_STACK_SLOTS platoons; the list always has exactly that
// many entries (empty platoons use { entries: [] }).
//
// A platoon is a single battle-grid slot that can carry up to
// MAX_PLATOON_ENTRIES distinct unit types at once (see feature-plans/
// CombatResolutionEngine.md "Army model: platoons"). This replaces the older
// single-type-per-slot UnitStack shape.

import type { AdvantageType } from "@heroes/engine";
import type { Platoon, PlatoonEntry } from "@heroes/contracts";

export type { AdvantageType };
export type { Platoon, PlatoonEntry };

export interface UnitType {
  id: string;
  name: string;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  description: string;
  // Type-advantage tag used by the combat resolver's damage formula — see
  // shared/combatConfig.ts TYPE_TRIANGLE and shared/combat/damage.ts.
  advantageType: AdvantageType;
  // Categorical "specialty" tag used by the manual battle arena to derive a
  // per-platoon specialty icon (top-left of the status tile). Platoons
  // pick their dominant specialty from their entries — see
  // shared/combat/manualBattle.ts computeSpecialty().
  specialty: string;
  // Tiebreaker weight when a platoon mixes units of more than one
  // specialty. Specialty weighted-total = sum(count * specialtyPriority).
  // Bumps above 1.0 let a smaller-but-heavier specialty take precedence
  // (e.g. shields out-vote pikes at smaller counts).
  specialtyPriority: number;
}

export { ARMY_STACK_SLOTS, MAX_PLATOON_ENTRIES, emptyPlatoon, normalizePlatoons, platoonsHaveTroops } from "@heroes/engine";

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
