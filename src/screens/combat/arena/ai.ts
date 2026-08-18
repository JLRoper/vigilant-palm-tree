import {
  attackWithPlatoon,
  endPlatoonTurn,
  getCombatant,
  getMovementPath,
  isBattleOver as isBattleOverFn,
  movePlatoon,
  planAiTurn,
  unactedLivingSlots,
  type BattleSide,
  type Combatant,
  type ManualBattleState,
} from "@heroes/engine";
import { fmtHex, hexDistance, platoonLabel, type Axial } from "./layout";

export const AI_TELEGRAPH_MS = 320;
export const AI_STEP_MS = 260;
// Per hex of the walk, capped so a full-speed dash across the field still
// resolves promptly rather than making the player wait out every step.
export const AI_MOVE_MS_PER_HEX = 90;
export const AI_MOVE_MS_MAX = 620;
export const AI_ARRIVE_PAUSE_MS = 140;
export const AI_IMPACT_HOLD_MS = 420;

export interface MoveAnim {
  side: BattleSide;
  slotIndex: number;
  path: Axial[];
  startedAt: number;
  durationMs: number;
}

export interface ImpactFx {
  hex: Axial;
  startedAt: number;
}

export interface FloatFx {
  hex: Axial;
  text: string;
  startedAt: number;
}

export interface ArenaAiDeps {
  getState: () => ManualBattleState;
  getAiSide: () => BattleSide;
  getHumanSide: () => BattleSide;
  debugLog: (...args: unknown[]) => void;
  recordMove: (side: BattleSide, slotIndex: number, hexes: number) => void;
  logNewBattleEvents: (sinceLength: number) => void;
  spawnDamageFloats: (sinceLength: number) => void;
  refresh: () => void;
  pumpAnimation: () => void;
  finishBattle: () => void;
  endAiPhase: () => void;
  setMoveAnim: (anim: MoveAnim | null) => void;
  setImpact: (impact: ImpactFx | null) => void;
}

export interface ArenaAi {
  isActing(): boolean;
  getActingSlot(): number | null;
  getTargetHex(): Axial | null;
  bumpRunToken(): void;
  clearTimer(): void;
  advance(): void;
  endPhase(): void;
}

export function createArenaAi(deps: ArenaAiDeps): ArenaAi {
  let aiActing = false;
  let aiActingSlot: number | null = null;
  let aiTargetHex: Axial | null = null;
  let aiRunToken = 0;
  let aiTimer: number | null = null;

  function clearAiTimer(): void {
    if (aiTimer !== null) {
      window.clearTimeout(aiTimer);
      aiTimer = null;
    }
  }

  function aiWait(ms: number): Promise<boolean> {
    const token = aiRunToken;
    return new Promise((resolve) => {
      aiTimer = window.setTimeout(() => {
        aiTimer = null;
        resolve(token === aiRunToken);
      }, ms);
    });
  }

  function isBattleOver(): boolean {
    return isBattleOverFn(deps.getState());
  }

  async function stepAi(): Promise<void> {
    const token = aiRunToken;
    if (isBattleOver()) {
      deps.finishBattle();
      return;
    }
    const state = deps.getState();
    const aiSide = deps.getAiSide();
    const plan = planAiTurn(state, aiSide);
    if (!plan) {
      endPhase();
      return;
    }

    const actor = getCombatant(state, aiSide, plan.slotIndex);
    aiActingSlot = plan.slotIndex;
    const plannedTarget =
      plan.attackTargetSlot !== null
        ? getCombatant(state, aiSide === "attacker" ? "defender" : "attacker", plan.attackTargetSlot)
        : undefined;
    aiTargetHex = plannedTarget ? { ...plannedTarget.position } : null;
    deps.refresh();
    if (!(await aiWait(AI_TELEGRAPH_MS)) || token !== aiRunToken) return;

    if (plan.moveTo && actor) {
      const from = { ...actor.position };
      const path = getMovementPath(state, actor, plan.moveTo);
      const distance = hexDistance(from, plan.moveTo);
      movePlatoon(state, aiSide, plan.slotIndex, plan.moveTo);
      if (path.length > 0) {
        deps.recordMove(aiSide, plan.slotIndex, distance);
        deps.debugLog(
          `ai move: ${platoonLabel(aiSide, plan.slotIndex)}: ${fmtHex(from)} -> ${fmtHex(plan.moveTo)} (${distance} hex${distance === 1 ? "" : "es"})`,
        );
        const durationMs = Math.min(path.length * AI_MOVE_MS_PER_HEX, AI_MOVE_MS_MAX);
        deps.setMoveAnim({
          side: aiSide,
          slotIndex: plan.slotIndex,
          path: [from, ...path],
          startedAt: performance.now(),
          durationMs,
        });
        deps.pumpAnimation();
        if (!(await aiWait(durationMs + AI_ARRIVE_PAUSE_MS)) || token !== aiRunToken) return;
      }
      deps.setMoveAnim(null);
    }

    aiTargetHex = null;
    const beforeLog = state.log.length;
    const struck =
      plan.attackTargetSlot !== null
        ? getCombatant(state, aiSide === "attacker" ? "defender" : "attacker", plan.attackTargetSlot)
        : undefined;
    if (plan.attackTargetSlot === null || !attackWithPlatoon(state, aiSide, plan.slotIndex, plan.attackTargetSlot)) {
      endPlatoonTurn(state, aiSide, plan.slotIndex);
    }
    deps.logNewBattleEvents(beforeLog);
    const landedHits = state.log.length > beforeLog;
    if (landedHits) {
      if (struck) deps.setImpact({ hex: { ...struck.position }, startedAt: performance.now() });
      deps.spawnDamageFloats(beforeLog);
      deps.pumpAnimation();
    }
    aiActingSlot = null;
    deps.refresh();
    if (landedHits && (!(await aiWait(AI_IMPACT_HOLD_MS)) || token !== aiRunToken)) return;

    if (isBattleOver()) {
      deps.finishBattle();
      return;
    }
    const stateAfter = deps.getState();
    if (
      unactedLivingSlots(stateAfter, deps.getHumanSide()).length === 0 &&
      unactedLivingSlots(stateAfter, deps.getAiSide()).length > 0
    ) {
      if (!(await aiWait(AI_STEP_MS)) || token !== aiRunToken) return;
      void stepAi();
      return;
    }
    endPhase();
  }

  function advance(): void {
    if (isBattleOver()) {
      deps.finishBattle();
      return;
    }
    if (unactedLivingSlots(deps.getState(), deps.getAiSide()).length === 0) {
      deps.refresh();
      return;
    }
    aiActing = true;
    deps.refresh();
    aiTimer = window.setTimeout(() => {
      aiTimer = null;
      void stepAi();
    }, AI_STEP_MS);
  }

  function endPhase(): void {
    aiActing = false;
    aiActingSlot = null;
    aiTargetHex = null;
    deps.endAiPhase();
  }

  return {
    isActing: () => aiActing,
    getActingSlot: () => aiActingSlot,
    getTargetHex: () => aiTargetHex,
    bumpRunToken: () => {
      aiRunToken++;
    },
    clearTimer: clearAiTimer,
    advance,
    endPhase,
  };
}

// The helper below is exposed for unit tests that want to construct a
// combatant without going through startManualBattle.
export function makeCombatantForTest(opts: Partial<Combatant> & Pick<Combatant, "side" | "slotIndex" | "position">): Combatant {
  return {
    entries: [],
    retreated: false,
    maxHealth: 0,
    hasCounterCharge: true,
    ...opts,
  };
}