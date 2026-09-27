import {
  attackFromHex,
  attackWithPlatoon,
  endPlatoonTurn,
  getCombatant,
  getMovementRange,
  movePlatoon,
  retreatHero,
  timeOfDayForRound,
  type BattleSide,
  type ManualBattleState,
} from "@heroes/engine";
import { hexDistance, type Axial } from "./layout";

// Live action-stream hook (plan/2026-09-27-manual-battle-wiring.md, work
// item 4b): the arena hands each wrapper an optional `emit` callback; when
// present, every *applied* action posts one row to the server's
// battle_actions table as it happens. Only applied actions are streamed --
// a click the engine rejected never mutated the battle, so there is nothing
// for the future legality-check consumer to re-simulate. The arena's own
// start ("start": obstacleSeed + initial stacks + sides, the mandatory
// re-simulation seed row) and end ("end": outcome + survivors) rows are
// emitted by openManualBattleArena, not here.
export type BattleActionPhase = "start" | "move" | "attack" | "retreat" | "surrender" | "end";

export interface BattleAction {
  phase: BattleActionPhase;
  payload: Record<string, unknown>;
}

export type BattleActionEmit = (action: BattleAction) => void;

// State context every streamed row carries alongside the action itself:
// the round and its time-of-day phase (the same value the arena's top-bar
// chip renders), so a future re-simulation can reproduce time-of-day
// progression via timeOfDayForRound without guessing.
function actionContext(state: ManualBattleState): { round: number; timeOfDay: string } {
  return { round: state.round, timeOfDay: timeOfDayForRound(state.round) };
}

// Telemetry must never fail the arena: the emit callback runs AFTER the
// engine mutation it describes, and a throw here would otherwise bubble into
// the arena's click handler with the action already applied. Swallow +
// warn, same posture as the api layer's own catch (a normal production emit
// can't throw -- GameActions's callback is `void api.postBattleAction(...)`
// and that catches its own network errors -- this guard covers any other
// caller, including tests).
function safeEmit(emit: BattleActionEmit | undefined, action: BattleAction): void {
  if (!emit) return;
  try {
    emit(action);
  } catch (err) {
    console.warn("[arena] battle-action telemetry failed:", err);
  }
}

export function attackFromSelectedHex(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  targetSlot: number,
  fromHex: Axial,
  emit?: BattleActionEmit,
): boolean {
  const ok = attackFromHex(state, humanSide, selectedSlot, targetSlot, fromHex);
  if (ok && emit) {
    safeEmit(emit, {
      phase: "attack",
      payload: { ...actionContext(state), side: humanSide, slotIndex: selectedSlot, targetSlotIndex: targetSlot, from: fromHex },
    });
  }
  return ok;
}

export function attackFromTarget(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  targetSlot: number,
  emit?: BattleActionEmit,
): boolean {
  const ok = attackWithPlatoon(state, humanSide, selectedSlot, targetSlot);
  if (ok && emit) {
    safeEmit(emit, {
      phase: "attack",
      payload: { ...actionContext(state), side: humanSide, slotIndex: selectedSlot, targetSlotIndex: targetSlot },
    });
  }
  return ok;
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
export function retreatAction(state: ManualBattleState, side: BattleSide, emit?: BattleActionEmit): void {
  retreatHero(state, side, { applyLoss: true });
  if (emit) {
    safeEmit(emit, { phase: "retreat", payload: { ...actionContext(state), side } });
  }
}

// Surrender skips the loss and yields immediately. Same engine call as retreat
// with applyLoss:false — the differentiation lives entirely in the call site.
// The gold actually paid (or the Leave-Behind units stripped instead) is
// carried by the arena's "end" row, not here — this wrapper doesn't know it.
export function surrenderAction(state: ManualBattleState, side: BattleSide, emit?: BattleActionEmit): void {
  retreatHero(state, side, { applyLoss: false });
  if (emit) {
    safeEmit(emit, { phase: "surrender", payload: { ...actionContext(state), side } });
  }
}

export interface MoveResult {
  moved: boolean;
  distance: number;
  remainingSteps: number;
  from: Axial | null;
}

// Atomic move of the selected human platoon to `hex`. Returns enough info for
// the caller to log the move (distance, from hex, remaining range) without
// having to read state again. `moved=false` means the engine rejected the
// move (impassable/occupied/out of range) -- nothing mutated, nothing streamed.
export function moveSelectedTo(
  state: ManualBattleState,
  humanSide: BattleSide,
  selectedSlot: number,
  hex: Axial,
  emit?: BattleActionEmit,
): MoveResult {
  const actorBefore = getCombatant(state, humanSide, selectedSlot);
  const from = actorBefore ? { ...actorBefore.position } : null;
  const distance = from ? hexDistance(from, hex) : 0;
  const moved = movePlatoon(state, humanSide, selectedSlot, hex);
  const stillActor = moved ? getCombatant(state, humanSide, selectedSlot) : null;
  const remainingSteps = stillActor ? getMovementRange(state, stillActor).length : 0;
  if (moved && emit) {
    safeEmit(emit, {
      phase: "move",
      payload: { ...actionContext(state), side: humanSide, slotIndex: selectedSlot, from, to: hex, distance },
    });
  }
  return { moved, distance, remainingSteps, from };
}
