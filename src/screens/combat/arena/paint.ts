import type { BattleSide, Combatant, ManualBattleState } from "@heroes/engine";
import type { Terrain } from "@heroes/engine";
import type { Axial } from "./layout";
import { buildBattleScene, type BattleSceneInput } from "../../../render/scene/sceneBuilder/battleScene";
import { paintScene, type Paint2DFrame } from "../../../render/scene/paint2d";
import type {
  Paint2DDep,
  Paint2DSpriteResolver,
  ResolvedSprite,
  BiomeBackgroundProvider,
  SkyboxProvider,
  SpriteKey,
} from "../../../render/scene/paint2d/deps";

// URL query-param keys controlling which render path the arena uses. The
// paint2d/ SceneNode[] path is the DEFAULT (plan decision #4 in
// plan/2026-09-29-arena-unit-sprites.md — the sprite look only exists there,
// so keeping legacy default would make the flag flip the arena's look, the
// exact divergence issue #148 warns about). `?paint=legacy` is the escape
// hatch back to the circle rendering; `?paint=scenebuilder` is still accepted
// as a no-op for old links. Per
// plan/2026-08-17-combat-decomposition-finishing-breakout.md §9.4.
export const PAINT_MODE_QUERY_KEY = "paint";
export const PAINT_MODE_SCENEBUILDER = "scenebuilder";
export const PAINT_MODE_LEGACY = "legacy";

export function readUseSceneBuilder(search: string): boolean {
  return new URLSearchParams(search).get(PAINT_MODE_QUERY_KEY) !== PAINT_MODE_LEGACY;
}

export interface PaintSceneForArenaArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly state: ManualBattleState;
  readonly humanSide: BattleSide;
  readonly aiSide: BattleSide;
  readonly selectedSlot: number | null;
  readonly moveRange: Axial[];
  readonly attackTargets: Combatant[];
  readonly spellTargets: Combatant[];
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
  readonly attacker: { readonly side: BattleSide; readonly slotIndex: number; readonly startedAt: number } | null;
  readonly floats: { readonly hex: Axial; readonly text: string; readonly startedAt: number }[];
  readonly hexSize: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly canvasCssW: number;
  readonly canvasCssH: number;
  readonly biome: Terrain;
  readonly biomeSeed: number;
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
    spellTargets: args.spellTargets,
    aiActing: args.aiActing,
    aiActingSlot: args.aiActingSlot,
    aiTargetHex: args.aiTargetHex,
    moveAnim: args.moveAnim,
    impact: args.impact,
    attacker: args.attacker,
    floats: args.floats,
    hexSize: args.hexSize,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    biome: args.biome,
    biomeSeed: args.biomeSeed,
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
  // Real unit-sprite resolution for the battleCombatant painter, built by the
  // caller (openManualBattleArena) via paint2dDefaults' createUnitSpriteResolver().
  // Injected rather than imported here because paint2dDefaults transitively
  // pulls assetDescriptors.ts's Vite ?url PNG imports — static import would
  // make this module unimportable under bare node:test. Optional so test
  // callers get the same inert stub as every other resolver here.
  readonly biome?: Terrain;
  readonly biomeSeed?: number;
  readonly resolveSpriteForUnit?: Paint2DSpriteResolver["resolveSpriteForUnit"];
}

// Battle-specific Paint2DDep. Most Paint2DDep fields are unused for the
// arena's eight battle-kind nodes (no sprites except unit art, no skybox, no
// parallax, no charter) -- this builder returns inert defaults for those, and a
// real `battleAccent` derived from the arena's own ATTACKER_ACCENT/DEFENDER_ACCENT
// so any future per-kind painter that asks for the side accent gets the same
// color draw() uses today.
export function buildArenaPaint2dDeps(opts: ArenaPaint2dDepsOptions): Paint2DDep {
  const sprite: Paint2DSpriteResolver = {
    resolveSpriteForResource: () => undefined,
    resolveSpriteForHero: () => undefined,
    resolveSpriteForBuilding: () => undefined,
    resolveSpriteForCastle: () => undefined,
    resolveSpriteForUnit: opts.resolveSpriteForUnit ?? (() => undefined),
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
    getBiomeBackground: (biome: Terrain): BiomeBackgroundProvider | null => {
      if (opts.biome && biome !== opts.biome) return null;
      return (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, seed: number, variant: number) => {
        const palette = {
          grass: { fill: "#3a6b3a", stroke: "#2a4a2a", accents: ["#4a7b4a", "#2a5a2a", "#5a8b5a"] },
          dirt: { fill: "#8a6b3a", stroke: "#5a4a2a", accents: ["#9a7b4a", "#7a5a3a", "#aa8b5a"] },
          water: { fill: "#2a5a8a", stroke: "#1a3a5a", accents: ["#3a6a9a", "#1a4a6a", "#4a7aaa"] },
          forest: { fill: "#1f4a2a", stroke: "#0f2a1a", accents: ["#2f5a3a", "#0f3a1a", "#3f6a4a"] },
          denseForest: { fill: "#10301a", stroke: "#06140b", accents: ["#20402a", "#06240b", "#30503a"] },
          desert: { fill: "#d4b56e", stroke: "#a08850", accents: ["#e4c57e", "#c4a55e", "#f4d58e"] },
          mountain: { fill: "#6e6e7a", stroke: "#3a3a44", accents: ["#7e7e8a", "#5e5e64", "#8e8e9a"] },
          swamp: { fill: "#4a5540", stroke: "#2a3320", accents: ["#5a6550", "#3a4330", "#6a7560"] },
          snow: { fill: "#c9d6e4", stroke: "#8fa6bd", accents: ["#d9e6f4", "#9fb6cd", "#e9f6ff"] },
        }[biome] ?? { fill: "#3a6b3a", stroke: "#2a4a2a", accents: ["#4a7b4a", "#2a5a2a", "#5a8b5a"] };
        
        const rng = (() => {
          let s = (seed * 1664525 + variant * 1013904223 + 12345) >>> 0;
          return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 0x100000000;
          };
        })();

        const variation = rng();
        const fillIdx = Math.floor(variation * palette.accents.length);
        ctx.fillStyle = variation < 0.7 ? palette.fill : palette.accents[fillIdx];

        // Draw hex
        ctx.beginPath();
        const size = radius + 1;
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const x = cx + size * Math.cos(angle);
          const y = cy + size * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = palette.stroke;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Optional biome details
        if (biome === "forest" || biome === "denseForest") {
          const detailRng = (() => {
            let s = (seed * 1664525 + variant * 1013904223 + 1012345) >>> 0;
            return () => {
              s = (s * 1664525 + 1013904223) >>> 0;
              return s / 0x100000000;
            };
          })();
          for (let i = 0; i < 2; i++) {
            const angle = detailRng() * Math.PI * 2;
            const dist = radius * 0.3 * detailRng();
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            ctx.fillStyle = palette.accents[Math.floor(detailRng() * palette.accents.length)];
            ctx.beginPath();
            ctx.arc(cx + dx, cy + dy, Math.max(1, radius * 0.08), 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (biome === "desert") {
          const detailRng = (() => {
            let s = (seed * 1664525 + variant * 1013904223 + 1012345) >>> 0;
            return () => {
              s = (s * 1664525 + 1013904223) >>> 0;
              return s / 0x100000000;
            };
          })();
          ctx.strokeStyle = palette.accents[0] + "40";
          ctx.lineWidth = 0.5;
          for (let i = 0; i < 2; i++) {
            const y = cy - radius * 0.4 + detailRng() * radius * 0.8;
            ctx.beginPath();
            ctx.moveTo(cx - radius * 0.5, y);
            ctx.lineTo(cx + radius * 0.5, y);
            ctx.stroke();
          }
        } else if (biome === "swamp") {
          const detailRng = (() => {
            let s = (seed * 1664525 + variant * 1013904223 + 1012345) >>> 0;
            return () => {
              s = (s * 1664525 + 1013904223) >>> 0;
              return s / 0x100000000;
            };
          })();
          for (let i = 0; i < 3; i++) {
            const angle = detailRng() * Math.PI * 2;
            const dist = radius * 0.4 * detailRng();
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            ctx.fillStyle = "#4aa5a5" + Math.floor(detailRng() * 128 + 64).toString(16).padStart(2, "0");
            ctx.beginPath();
            ctx.arc(cx + dx, cy + dy, Math.max(1, radius * 0.06), 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (biome === "snow") {
          const detailRng = (() => {
            let s = (seed * 1664525 + variant * 1013904223 + 1012345) >>> 0;
            return () => {
              s = (s * 1664525 + 1013904223) >>> 0;
              return s / 0x100000000;
            };
          })();
          ctx.fillStyle = "#ffffff60";
          for (let i = 0; i < 2; i++) {
            const angle = detailRng() * Math.PI * 2;
            const dist = radius * 0.35 * detailRng();
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            ctx.beginPath();
            ctx.arc(cx + dx, cy + dy, Math.max(1, radius * 0.1), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      };
    },
  };
}