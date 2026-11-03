import type { BuildingDef, DistrictState, SettlementState } from "@heroes/contracts";
import { buildingUpkeep } from "@heroes/engine";

// E3 (playthrough round 2b): a town-hall upgrade levels the WHOLE city -- it is
// the settlement-wide "bring every building to the hall's level" action
// (`packages/engine/src/settlement/advance.ts`, which maps the level-up over the
// main city AND every district) -- and the menu stated only the one-off cost
// (`L2: 1500g 15w 10s / 7d`). Measured on the card's Gold hold: before the
// upgrade the city paid 10 wood + 2 stone a day; after it, 22 wood + 4 stone,
// with nothing on the offer saying the per-day bill more than doubles. A player
// can spend a young city's whole wood line on a button that reads like a cheap
// upgrade.
//
// This module is the pre-purchase statement of that scope: how many buildings
// the click raises and what the city's own upkeep bill becomes. Both numbers are
// computed with the ENGINE's own functions and the engine's own rule
// (`Math.max(building.level, targetLevel)` per building), so the sentence cannot
// describe an effect the reducer does not apply.

export interface TownHallUpgradeScope {
  /** Buildings the upgrade raises: the main city plus every district. */
  buildings: number;
  /** The city's per-day upkeep now. */
  upkeepNow: { wood: number; stone: number };
  /** The city's per-day upkeep once every building is at the target level. */
  upkeepAfter: { wood: number; stone: number };
}

function allBuildings(settlement: Pick<SettlementState, "buildings" | "districts">): BuildingDef[] {
  const out: BuildingDef[] = [...settlement.buildings];
  for (const d of Object.values((settlement.districts ?? {}) as Record<string, DistrictState>)) {
    out.push(...d.buildings);
  }
  return out;
}

export function townHallUpgradeScope(
  settlement: Pick<SettlementState, "buildings" | "districts">,
  targetLevel: number,
): TownHallUpgradeScope {
  const buildings = allBuildings(settlement);
  const billAt = (levelOf: (b: BuildingDef) => number): { wood: number; stone: number } => {
    let wood = 0;
    let stone = 0;
    for (const b of buildings) {
      const upkeep = buildingUpkeep(b.kind, levelOf(b));
      wood += upkeep.wood;
      stone += upkeep.stone;
    }
    return { wood, stone };
  };
  return {
    buildings: buildings.length,
    // The upgrade never LOWERS a building (advance.ts's `Math.max`), so a
    // building already past the target level keeps its own bill.
    upkeepNow: billAt((b) => b.level),
    upkeepAfter: billAt((b) => Math.max(b.level, targetLevel)),
  };
}

/** "10 wood + 2 stone", "4 stone", or "nothing". */
export function upkeepAmountText(upkeep: { wood: number; stone: number }): string {
  const parts: string[] = [];
  if (upkeep.wood > 0) parts.push(`${upkeep.wood} wood`);
  if (upkeep.stone > 0) parts.push(`${upkeep.stone} stone`);
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

/**
 * The sentence the town-hall offer carries, before the click. `targetLevel` is
 * named because the whole point is that this is a CITY-level change, not a
 * building-level one.
 */
export function townHallUpgradeScopeLine(scope: TownHallUpgradeScope, targetLevel: number): string {
  const now = upkeepAmountText(scope.upkeepNow);
  const sameBill =
    scope.upkeepNow.wood === scope.upkeepAfter.wood && scope.upkeepNow.stone === scope.upkeepAfter.stone;
  const consequence = sameBill
    ? `and the city's daily upkeep stays at ${now}`
    : `and the city's daily upkeep rises from ${now} to ${upkeepAmountText(scope.upkeepAfter)}`;
  return (
    `Levels the WHOLE city to L${targetLevel} \u2014 all ${scope.buildings} buildings, districts included \u2014 ` +
    `${consequence}.`
  );
}
