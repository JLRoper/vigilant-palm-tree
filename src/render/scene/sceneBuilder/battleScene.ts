import { axialToPixel, type Axial } from "../../../core/hex";
import {
  getCombatant,
  totalHealth,
  unactedLivingSlots,
  type BattleSide,
  type Combatant,
  type ManualBattleState,
} from "@heroes/engine";
import type { SceneNode, WorldPoint } from "../types";

// Faithful decomposition of manualBattleArena.ts's draw()/renderPixelFor()
// into pure data. Unlike the adventure/city scenes, there's no wrapper
// object here that resolves animation timing ahead of the builder running
// (contrast Hero.update(dtMs), already applied before buildAdventureScene()
// ever reads a Hero's position/scale) -- moveAnim/impact/floats are plain
// closure locals in manualBattleArena.ts, and their on-screen position/
// opacity is derived from wall-clock time only at draw()'s call time. To
// keep this builder pure (same input -> same output, no internal clock
// reads), it takes `nowMs` as an explicit field and performs that
// interpolation itself instead of calling performance.now() -- the same
// "the builder doesn't own a clock" principle entityMirror.ts follows,
// just applied inline rather than inside a ticked class, since
// manualBattleArena.ts has no equivalent of Hero to tick beforehand.
//
// Two pieces of draw()'s surrounding closure state are deliberately left
// out below despite looking like obvious candidates: pendingTarget/
// approachHexes/approachChoice (the directional-melee hover latch) and the
// ATTACKER_ACCENT/DEFENDER_ACCENT/humanAccent consts. Tracing every ctx.*
// call in manualBattleArena.ts confirms none of the three hover-latch
// fields or the accent consts are ever read inside draw() -- the latch
// only changes the help text and the CSS cursor (DOM/text, out of scope
// for a canvas scene graph), and the accents only style the DOM side
// panels. Faithfully decomposing draw() means leaving them out rather than
// inventing a node they would never populate.

// Mirror manualBattleArena.ts's own (unexported) IMPACT_MS/FLOAT_MS consts.
// Duplicated rather than imported -- that file exports neither, and this
// session leaves it untouched (see the plan doc's "explicitly out of
// scope" list).
const IMPACT_MS = 300;
const FLOAT_MS = 800;

export interface BattleSceneInput {
  state: ManualBattleState;
  humanSide: BattleSide;
  aiSide: BattleSide;
  selectedSlot: number | null;
  moveRange: Axial[];
  attackTargets: Combatant[];
  aiActing: boolean;
  aiActingSlot: number | null;
  aiTargetHex: Axial | null;
  moveAnim: { side: BattleSide; slotIndex: number; path: Axial[]; startedAt: number; durationMs: number } | null;
  impact: { hex: Axial; startedAt: number } | null;
  floats: { hex: Axial; text: string; startedAt: number }[];
  // Solved per-layout by manualBattleArena.ts's fitHexSize()/
  // relayoutCanvas() -- this screen's bespoke stand-in for a Camera (see
  // WorldPoint's doc comment in types.ts and plan/2026-08-17-consolidated-
  // phase-1-5-track-map.md §7.2).
  hexSize: number;
  offsetX: number;
  offsetY: number;
  nowMs: number;
}

function hexKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

function isAlive(c: Combatant): boolean {
  return !c.retreated && c.entries.some((e) => e.count > 0);
}

function hpRatioFor(state: ManualBattleState, c: Combatant): number {
  return c.maxHealth > 0 ? totalHealth(c.entries, state.unitTypes) / c.maxHealth : 0;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function toWorld(input: BattleSceneInput, q: number, r: number): WorldPoint {
  const { x, y } = axialToPixel(q, r, input.hexSize);
  return { x: x + input.offsetX, y: y + input.offsetY };
}

type ActiveMoveAnim = NonNullable<BattleSceneInput["moveAnim"]>;

// Mirrors renderPixelFor(): a combatant mid-move draws at its interpolated
// position along moveAnim.path rather than its (already updated) engine
// position, for whichever side/slotIndex moveAnim currently names.
function resolvePosition(input: BattleSceneInput, activeMoveAnim: ActiveMoveAnim | null, c: Combatant): WorldPoint {
  if (!activeMoveAnim || activeMoveAnim.side !== c.side || activeMoveAnim.slotIndex !== c.slotIndex) {
    return toWorld(input, c.position.q, c.position.r);
  }
  const path = activeMoveAnim.path;
  if (path.length === 0) return toWorld(input, c.position.q, c.position.r);
  if (path.length === 1) return toWorld(input, path[0].q, path[0].r);
  const t = clamp01((input.nowMs - activeMoveAnim.startedAt) / activeMoveAnim.durationMs);
  const scaled = t * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(scaled));
  const localT = scaled - i;
  const a = toWorld(input, path[i].q, path[i].r);
  const b = toWorld(input, path[i + 1].q, path[i + 1].r);
  return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
}

export function buildBattleScene(input: BattleSceneInput): SceneNode[] {
  const nodes: SceneNode[] = [];

  // pruneExpiredEffects() mutates these away in manualBattleArena.ts before
  // draw() reads them; this builder is pure, so an expired entry is simply
  // treated as absent rather than mutating the caller's state.
  const activeMoveAnim: ActiveMoveAnim | null =
    input.moveAnim && input.nowMs - input.moveAnim.startedAt < input.moveAnim.durationMs ? input.moveAnim : null;
  const activeImpact = input.impact && input.nowMs - input.impact.startedAt < IMPACT_MS ? input.impact : null;
  const activeFloats = input.floats.filter((f) => input.nowMs - f.startedAt < FLOAT_MS);

  const moveRangeSet = new Set(input.moveRange.map(hexKey));
  const availableSet = input.aiActing
    ? new Set<string>()
    : new Set(
        unactedLivingSlots(input.state, input.humanSide)
          .map((slot) => getCombatant(input.state, input.humanSide, slot))
          .filter((c): c is Combatant => c !== undefined)
          .map((c) => hexKey(c.position)),
      );

  for (const hex of input.state.grid.hexes) {
    nodes.push({
      kind: "battleHex",
      q: hex.q,
      r: hex.r,
      world: toWorld(input, hex.q, hex.r),
      hexRadius: input.hexSize - 1,
      impassable: hex.impassable,
      inMoveRange: moveRangeSet.has(hexKey(hex)),
      available: availableSet.has(hexKey(hex)),
    });
  }

  for (const t of input.attackTargets) {
    nodes.push({
      kind: "battleAttackTargetRing",
      side: t.side,
      slotIndex: t.slotIndex,
      // The target's raw engine position, not resolvePosition() -- draw()
      // rings attackTargets via toCanvas(t.position...), never
      // renderPixelFor(t), so a target that's itself mid-animation (not
      // reachable in practice, since aiActing blocks human input while any
      // moveAnim is playing, but faithfully preserved anyway) rings where
      // it *is*, not where it's currently drawn sliding to.
      world: toWorld(input, t.position.q, t.position.r),
      radius: input.hexSize * 0.8,
    });
  }

  if (input.aiTargetHex) {
    const { q, r } = input.aiTargetHex;
    nodes.push({
      kind: "battleAiTelegraphHex",
      q,
      r,
      world: toWorld(input, q, r),
      hexRadius: input.hexSize - 1,
    });
  }

  if (activeMoveAnim) {
    nodes.push({
      kind: "battleMovePath",
      side: activeMoveAnim.side,
      slotIndex: activeMoveAnim.slotIndex,
      points: activeMoveAnim.path.map((hex) => toWorld(input, hex.q, hex.r)),
    });
  }

  if (activeImpact) {
    const t = clamp01((input.nowMs - activeImpact.startedAt) / IMPACT_MS);
    nodes.push({
      kind: "battleImpactRing",
      world: toWorld(input, activeImpact.hex.q, activeImpact.hex.r),
      radius: input.hexSize * (0.5 + t * 0.55),
      alpha: (1 - t) * 0.9,
    });
  }

  if (input.aiActingSlot !== null) {
    const acting = getCombatant(input.state, input.aiSide, input.aiActingSlot);
    if (acting && isAlive(acting)) {
      nodes.push({
        kind: "battleAiActingRing",
        side: input.aiSide,
        slotIndex: input.aiActingSlot,
        world: resolvePosition(input, activeMoveAnim, acting),
        radius: input.hexSize * 0.78,
      });
    }
  }

  for (const side of ["attacker", "defender"] as const) {
    for (const c of side === "attacker" ? input.state.attacker : input.state.defender) {
      if (!isAlive(c)) continue;
      nodes.push({
        kind: "battleCombatant",
        side,
        slotIndex: c.slotIndex,
        world: resolvePosition(input, activeMoveAnim, c),
        radius: input.hexSize * 0.55,
        selected: side === input.humanSide && c.slotIndex === input.selectedSlot,
        unitCount: c.entries.reduce((sum, e) => sum + e.count, 0),
        hpRatio: hpRatioFor(input.state, c),
      });
    }
  }

  for (const f of activeFloats) {
    const t = clamp01((input.nowMs - f.startedAt) / FLOAT_MS);
    const { x, y } = toWorld(input, f.hex.q, f.hex.r);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    nodes.push({
      kind: "battleFloatingText",
      text: f.text,
      world: { x, y: y - input.hexSize * (0.7 + t * 0.9) },
      alpha,
    });
  }

  return nodes;
}
