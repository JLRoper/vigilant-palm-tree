// Shared types for the army/unit system. The catalog of unit types lives in the
// database (table `unit_types`, served via GET /api/units). Each hero carries an
// ordered list of army stacks; the list always has exactly ARMY_STACK_SLOTS
// entries (empty stacks use { unitTypeId: null, count: 0 }).

export interface UnitType {
  id: string;
  name: string;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  description: string;
}

export interface UnitStack {
  unitTypeId: string | null;
  count: number;
}

export const ARMY_STACK_SLOTS = 8;

export function emptyStack(): UnitStack {
  return { unitTypeId: null, count: 0 };
}

// Returns a fresh array of exactly ARMY_STACK_SLOTS stacks, normalized so that
// stacks with count <= 0 collapse to empty (and trailing slots are filled).
export function normalizeStacks(stacks: readonly UnitStack[] | undefined | null): UnitStack[] {
  const out: UnitStack[] = [];
  if (stacks) {
    for (let i = 0; i < Math.min(stacks.length, ARMY_STACK_SLOTS); i++) {
      const s = stacks[i];
      out.push(s && s.count > 0 && s.unitTypeId ? { ...s } : emptyStack());
    }
  }
  while (out.length < ARMY_STACK_SLOTS) out.push(emptyStack());
  return out;
}

// Demo armies assigned to heroes on fresh game creation so the Hero Info menu
// has real data to display. Keys are hero index -> player index (0 = human).
export function demoStacksForPlayer(playerIdx: number): UnitStack[] {
  switch (playerIdx) {
    case 0:
      return [
        { unitTypeId: "swordsman", count: 12 },
        { unitTypeId: "archer", count: 8 },
        { unitTypeId: "cavalry", count: 4 },
      ];
    case 1:
      return [
        { unitTypeId: "crossbowman", count: 10 },
        { unitTypeId: "griffin", count: 3 },
      ];
    default:
      return [];
  }
}