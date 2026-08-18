import {
  attackFromHex,
  attackWithPlatoon,
  endPlatoonTurn,
  getCombatant,
  getMovementRange,
  movePlatoon,
  retreatHero,
  type BattleSide,
  type ManualBattleState,
} from "@heroes/engine";
import { hexDistance, type Axial } from "./layout";

export function attackFromSelectedHex(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  targetSlot: number,
  fromHex: Axial,
): boolean {
  return attackFromHex(state, humanSide, selectedSlot, targetSlot, fromHex);
}

export function attackFromTarget(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  targetSlot: number,
): boolean {
  return attackWithPlatoon(state, humanSide, selectedSlot, targetSlot);
}

export function endPlatoonTurnAction(
  state: ManualBattleState,
  side: BattleSide,
  slotIndex: number,
): void {
  endPlatoonTurn(state, side, slotIndex);
}

// Retreat applies the standard 15% self-retreat loss to every still-living
// platoon and pulls the whole side off the field.
export function retreatAction(state: ManualBattleState, side: BattleSide): void {
  retreatHero(state, side, { applyLoss: true });
}

// Surrender skips the loss and yields immediately. Same engine call as retreat
// with applyLoss:false — the differentiation lives entirely in the call site.
export function surrenderAction(state: ManualBattleState, side: BattleSide): void {
  retreatHero(state, side, { applyLoss: false });
}

export interface MoveResult {
  moved: boolean;
  distance: number;
  remainingSteps: number;
  from: Axial | null;
}

// Atomic move of the selected human platoon to `hex`. Returns enough info for
// the caller to log the move (distance, from hex, remaining range) without
// having to read state again. `moved=false` means the engine rejected the move
// (e.g. the hex was impassable or already taken by an intervening
//).
export function moveSelectedTo(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  hex: Axial,
): MoveResult {
  const actorBefore = getCombatant(state, humanSide, selectedSlot);
  const from = actorBefore ? { ...actorBefore.position } : null;
  const distance = from ? hexDistance(from, hex) : 0;
  const moved = movePlatoon(state, humanSide, selectedSlot, hex);
  const stillActor = moved ? getCombatant(state, humanSide, selectedSlot) : null;
  const remainingSteps = stillActor ? getMovementRange(state, stillActor).length : 0;
  return { moved, distance, remainingSteps, from };
}