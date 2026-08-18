import {
  getApproachHexes,
  getCombatant,
  isRangedPlatoon,
  type BattleSide,
  type Combatant,
  type ManualBattleState,
} from "@heroes/engine";
import { axialToPixel, HEX_DIRECTIONS, nearestHexEdge, pixelToAxial, type Axial } from "./layout";
import { isAlive } from "./layout";

export interface ArenaInputDeps {
  getState: () => ManualBattleState;
  getHumanSide: () => BattleSide;
  getAiSide: () => BattleSide;
  getHexSize: () => number;
  getSelectedSlot: () => number | null;
  isAiActing: () => boolean;
  isBattleOver: () => boolean;
  getCursorTarget: () => HTMLElement;
  draw: () => void;
  refresh: () => void;
}

export interface ArenaInput {
  getPendingTarget(): Combatant | null;
  getApproachHexes(): readonly { hex: Axial; cost: number }[];
  getApproachChoice(): Axial | null;
  clearPendingAttack(): boolean;
  updateHover(localX: number, localY: number): void;
}

export function pickApproachForEdge(
  target: Combatant,
  approaches: readonly { hex: Axial; cost: number }[],
  edge: number,
): Axial {
  const wanted = {
    q: target.position.q + HEX_DIRECTIONS[edge].q,
    r: target.position.r + HEX_DIRECTIONS[edge].r,
  };
  const exact = approaches.find((a) => a.hex.q === wanted.q && a.hex.r === wanted.r);
  if (exact) return exact.hex;

  let best = approaches[0];
  let bestGap = Infinity;
  for (const a of approaches) {
    const dir = HEX_DIRECTIONS.findIndex(
      (d) => target.position.q + d.q === a.hex.q && target.position.r + d.r === a.hex.r,
    );
    const raw = Math.abs(dir - edge);
    const gap = Math.min(raw, 6 - raw);
    if (gap < bestGap) {
      bestGap = gap;
      best = a;
    }
  }
  return best.hex;
}

function livingEnemyAt(deps: ArenaInputDeps, hex: Axial): Combatant | undefined {
  const { getState, getAiSide } = deps;
  const enemies = getAiSide() === "attacker" ? getState().attacker : getState().defender;
  return enemies.find((e) => isAlive(e) && e.position.q === hex.q && e.position.r === hex.r);
}

function resolveHover(
  deps: ArenaInputDeps,
  hex: Axial,
  localX: number,
  localY: number,
  pendingTarget: Combatant | null,
  approachHexes: readonly { hex: Axial; cost: number }[],
): { target: Combatant; approaches: { hex: Axial; cost: number }[]; choice: Axial } | null {
  if (deps.isAiActing() || deps.isBattleOver() || deps.getSelectedSlot() === null) return null;
  const state = deps.getState();
  const humanSide = deps.getHumanSide();
  const actor = getCombatant(state, humanSide, deps.getSelectedSlot()!);
  if (!actor || isRangedPlatoon(actor, state.unitTypes)) return null;

  const enemy = livingEnemyAt(deps, hex);
  if (enemy) {
    const approaches = getApproachHexes(state, actor, enemy);
    if (approaches.length === 0) return null;
    const center = axialToPixel(enemy.position.q, enemy.position.r, deps.getHexSize());
    const edge = nearestHexEdge(center.x, center.y, localX, localY);
    return { target: enemy, approaches, choice: pickApproachForEdge(enemy, approaches, edge) };
  }

  if (pendingTarget) {
    const onApproach = approachHexes.find((a) => a.hex.q === hex.q && a.hex.r === hex.r);
    if (onApproach) return { target: pendingTarget, approaches: [...approachHexes], choice: onApproach.hex };
  }
  return null;
}

export function createArenaInput(deps: ArenaInputDeps): ArenaInput {
  let pendingTarget: Combatant | null = null;
  let approachHexes: { hex: Axial; cost: number }[] = [];
  let approachChoice: Axial | null = null;

  function clearPendingAttack(): boolean {
    if (pendingTarget === null && approachChoice === null) return false;
    pendingTarget = null;
    approachHexes = [];
    approachChoice = null;
    return true;
  }

  function updateHover(localX: number, localY: number): void {
    const prevTarget = pendingTarget;
    const prevChoice = approachChoice;

    const resolved = resolveHover(
      deps,
      pixelToAxial(localX, localY, deps.getHexSize()),
      localX,
      localY,
      pendingTarget,
      approachHexes,
    );
    if (resolved) {
      pendingTarget = resolved.target;
      approachHexes = resolved.approaches;
      approachChoice = resolved.choice;
    } else {
      clearPendingAttack();
    }

    deps.getCursorTarget().style.cursor = pendingTarget ? "crosshair" : "";
    if (prevTarget !== pendingTarget) {
      deps.refresh();
      return;
    }
    const sameChoice =
      prevChoice === approachChoice ||
      (prevChoice !== null && approachChoice !== null && prevChoice.q === approachChoice.q && prevChoice.r === approachChoice.r);
    if (!sameChoice) deps.draw();
  }

  return {
    getPendingTarget: () => pendingTarget,
    getApproachHexes: () => approachHexes,
    getApproachChoice: () => approachChoice,
    clearPendingAttack,
    updateHover,
  };
}