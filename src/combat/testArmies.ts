// Sandbox army generators for the "Test Battle" dev feature (see
// src/screens/combat/testBattleSetup.ts). Not used by the real game — the player side
// is a fixed preset and the AI side is randomized/rerollable, purely to
// exercise the manual battle arena end to end.

import { ARMY_STACK_SLOTS, normalizePlatoons, type Platoon, type UnitType } from "../state/units";

const PLAYER_PRESET: { unitTypeId: string; count: number }[] = [
  { unitTypeId: "swordsman", count: 10 },
  { unitTypeId: "archer", count: 8 },
  { unitTypeId: "cavalry", count: 5 },
  { unitTypeId: "pikeman", count: 8 },
  { unitTypeId: "crossbowman", count: 8 },
  { unitTypeId: "griffin", count: 4 },
];

export function fixedTestPlayerPlatoons(): Platoon[] {
  const platoons: Platoon[] = PLAYER_PRESET.map((e) => ({ entries: [{ unitTypeId: e.unitTypeId, count: e.count }] }));
  return normalizePlatoons(platoons);
}

const MIN_COUNT = 4;
const MAX_COUNT = 15;
const PLATOON_COUNT = 6;

export function randomAiPlatoons(unitTypes: Record<string, UnitType>): Platoon[] {
  const ids = Object.keys(unitTypes);
  if (ids.length === 0) return normalizePlatoons([]);
  const platoons: Platoon[] = [];
  for (let i = 0; i < Math.min(PLATOON_COUNT, ARMY_STACK_SLOTS); i++) {
    const unitTypeId = ids[Math.floor(Math.random() * ids.length)];
    const count = MIN_COUNT + Math.floor(Math.random() * (MAX_COUNT - MIN_COUNT + 1));
    platoons.push({ entries: [{ unitTypeId, count }] });
  }
  return normalizePlatoons(platoons);
}
