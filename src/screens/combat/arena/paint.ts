import type { BattleSide, Combatant, ManualBattleState } from "@heroes/engine";
import type { Axial } from "./layout";
import { buildBattleScene, type BattleSceneInput } from "../../../render/scene/sceneBuilder/battleScene";
import { paintScene, type Paint2DFrame } from "../../../render/scene/paint2d";
import type {
  Paint2DDep,
  Paint2DSpriteResolver,
  ResolvedSprite,
  SkyboxProvider,
  SpriteKey,
} from "../../../render/scene/paint2d/deps";

// URL query-param key that opts the arena into the paint2d/ SceneNode[]
// rendering path. Default false in production; flip on via
// `?paint=scenebuilder` (URL-search readable, easy to script in Playwright,
// easy to disable). Per plan/2026-08-17-combat-decomposition-finishing-breakout.md
// §9.4.
export const PAINT_MODE_QUERY_KEY = "paint";
export const PAINT_MODE_SCENEBUILDER = "scenebuilder";

export function readUseSceneBuilder(search: string): boolean {
  return new URLSearchParams(search).get(PAINT_MODE_QUERY_KEY) === PAINT_MODE_SCENEBUILDER;
}

export interface PaintSceneForArenaArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly state: ManualBattleState;
  readonly humanSide: BattleSide;
  readonly aiSide: BattleSide;
  readonly selectedSlot: number | null;
  readonly moveRange: Axial[];
  readonly attackTargets: Combatant[];
  readonly aiActing: boolean;
  readonly aiActingSlot: number | null;
  readonly aiTargetHex: Axial | null;
  readonly moveAnim: {
    readonly side: BattleSide;
    readonly slotIndex: number;
    readonly path: Axial[];
    readonly startedAt: number;
    readonly durationMs: number;
  } | null;
  readonly impact: { readonly hex: Axial; readonly startedAt: number } | null;
  readonly floats: { readonly hex: Axial; readonly text: string; readonly startedAt: number }[];
  readonly hexSize: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly canvasCssW: number;
  readonly canvasCssH: number;
  readonly paint2d: Paint2DDep;
}

export function paintSceneForArena(args: PaintSceneForArenaArgs): void {
  const nowMs = performance.now();
  const sceneInput: BattleSceneInput = {
    state: args.state,
    humanSide: args.humanSide,
    aiSide: args.aiSide,
    selectedSlot: args.selectedSlot,
    // buildBattleScene() treats moveRange/attackTargets/path/floats as
    // read-only (it only filters/maps them, never mutates), so we can
    // pass the caller's arrays through without per-frame copies.
    moveRange: args.moveRange,
    attackTargets: args.attackTargets,
    aiActing: args.aiActing,
    aiActingSlot: args.aiActingSlot,
    aiTargetHex: args.aiTargetHex,
    moveAnim: args.moveAnim,
    impact: args.impact,
    floats: args.floats,
    hexSize: args.hexSize,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    nowMs,
  };

  const nodes = buildBattleScene(sceneInput);
  const frame: Paint2DFrame = { viewportW: args.canvasCssW, viewportH: args.canvasCssH };

  paintScene(args.ctx, nodes, args.paint2d, frame);
}

export interface ArenaPaint2dDepsOptions {
  readonly fontFamily: string;
  readonly attackerAccent: string;
  readonly defenderAccent: string;
}

// Battle-specific Paint2DDep. Most Paint2DDep fields are unused for the
// arena's eight battle-kind nodes (no sprites, no skybox, no parallax, no
// charter) -- this builder returns inert defaults for those, and a real
// `battleAccent` derived from the arena's own ATTACKER_ACCENT/DEFENDER_ACCENT
// so any future per-kind painter that asks for the side accent gets the same
// color draw() uses today.
export function buildArenaPaint2dDeps(opts: ArenaPaint2dDepsOptions): Paint2DDep {
  const sprite: Paint2DSpriteResolver = {
    resolveSpriteForResource: () => undefined,
    resolveSpriteForHero: () => undefined,
    resolveSpriteForBuilding: () => undefined,
    resolveSpriteForCastle: () => undefined,
    resolveSprite: (_key: SpriteKey): ResolvedSprite | undefined => undefined,
  };

  const skybox: SkyboxProvider | null = null;

  return {
    sprite,
    skybox,
    getResourceStyle: () => "rune-stone",
    getSpriteVariant: () => 0,
    getParallaxEnabled: () => false,
    getParallaxLayerCount: () => 0,
    getBgOffsetX: () => 0,
    getBgOffsetY: () => 0,
    getTerritoryBorderWidth: () => 1,
    colorForOwner: () => "#ffffff",
    battleAccent: (side: BattleSide, _role: "ring" | "select") =>
      side === "attacker" ? opts.attackerAccent : opts.defenderAccent,
    fontFamily: opts.fontFamily,
    charterStyle: () => ({ stroke: "transparent", fill: "transparent", lineDash: [], lineWidth: 1 }),
    validCharterStyle: { stroke: "transparent", fill: "transparent", lineDash: [], lineWidth: 1 },
  };
}