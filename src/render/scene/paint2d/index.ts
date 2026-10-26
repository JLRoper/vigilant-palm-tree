// Public Canvas2D painter for the SceneNode[] union produced by
// src/render/scene/sceneBuilder/{adventureScene,cityScene,battleScene}.ts.
//
// This is the dispatcher shell: it switches on node.kind and dispatches to a
// per-kind painter function. Every per-kind painter below is a real Canvas2D
// transcription of its legacy draw()/cityRenderer.ts/renderer.ts equivalent
// (adventure/city kinds landed in PR #135, the eight battle kinds in #136) --
// none of them are stubs any more.
//
// The seam is the whole point. paint2d/ never imports assetDescriptors.ts,
// assets.ts, sprites.ts, cityRenderer.ts, cityBuildingDraw.ts (barrel), or
// the state/settings.ts singleton value -- all of those are Vite-?url-coupled
// or have a cleanup lifecycle the painter shouldn't drive. The default-deps
// builder at src/render/paint2dDefaults.ts (and the skybox module at
// src/render/skybox.ts) are the only files in the painter project that touch
// those modules; they live outside paint2d/.
//
// See src/render/scene/paint2d/README.md for the full boundary rationale.

import type { Paint2DDep, ResolvedSprite, ResolvedSpriteDescriptor } from "./deps";
import {
  hexPath,
} from "./geometry";
import { paintCityDiorama } from "./cityDiorama";
import { HEX_SIZE } from "../../../core/hex";
import { decorationSeed } from "../../decorationSeed";
import { prefersReducedMotion } from "../../reducedMotion";
import { TERRAIN_COLORS } from "../../../map/terrain";
import { RESOURCE_PAL } from "../../palettes";
import type {
  BattleAiActingRingNode,
  BattleAiTelegraphHexNode,
  BattleAttackTargetRingNode,
  BattleCombatantNode,
  BattleFloatingTextNode,
  BattleHexNode,
  BattleImpactRingNode,
  BattleMovePathNode,
  BattleSpellTargetRingNode,
  CastleNode,
  CharterOverlayNode,
  CityBuildingNode,
  CityCellNode,
  CityGhostBuildingNode,
  CityLabelNode,
  CityMineNode,
  CityPersonNode,
  CityResourceSpotNode,
  CitySkyboxNode,
  DistrictNode,
  FogHexNode,
  HeroNode,
  HeroTrailNode,
  HoverHighlightNode,
  PathSegmentNode,
  ResourceIconNode,
  RiverHexNode,
  SceneNode,
  SelectedTileHighlightNode,
  TerrainDecorationNode,
  TerrainHexNode,
  TerritoryOutlineEdgeNode,
  UnchartedHexNode,
  ValidCharterHexNode,
  CaravanMarkerNode,
  CaravanRouteNode,
  WorldPoint,
  BattleBiomeBackgroundNode,
} from "../types";

// Live colour constants, transcribed byte-for-byte from the per-kind painter
// classes that used to live under `src/render/painter/` (PR #122). Those
// classes were deleted in issue #148 once MapRenderer switched to paintScene,
// so these literals are now the only copy.
const FOG_FILL = "rgba(8, 10, 16, 0.78)";
const FOG_EDGE = "rgba(8, 10, 16, 0.55)";
const HOVER_STROKE = "#ffcc00";
const SELECTED_TILE_STROKE = "#ffffff";

const PARALLAX_SPEEDS: Record<number, number[]> = {
  2: [0.1, 1.0],
  3: [0.1, 0.4, 1.0],
  4: [0.1, 0.3, 0.6, 1.0],
};

const OWNER_DOT_OFFSET_Y = 22;
const OWNER_DOT_RADIUS = 3.5;
const SELECTED_HERO_RING_RADIUS = 14;

const CITY_BG = "#1a1620";
const CITY_CELL_STROKE = "#3a3450";
const CITY_HOVER_UNDER = "rgba(18,16,22,0.65)";
const CITY_HOVER_STROKE = "#ffcc00";
const CITY_BUILDABLE_FILL = "rgba(18,16,22,0.18)";
const CITY_BUILDABLE_STROKE = "rgba(255,230,160,0.85)";
const CITY_TEXT = "#ffffff";
const CITY_SELECTION_STROKE = "#66ccff";
const CITY_GHOST_VALID_STROKE = "#44ff44";
const CITY_GHOST_INVALID_STROKE = "#ff4444";
// Worker-person fallback circle (sprite not yet loaded); battle-fallback style
// (filled circle + white stroke) with a neutral peasant tan.
const PERSON_PLACEHOLDER_FILL = "#c8b290";
const PERSON_BREATH_PERIOD_MS = 750;
const PERSON_STAGGER_BUCKETS = 7;
const PERSON_STAGGER_GX = 31;
const PERSON_STAGGER_GY = 17;
const PERSON_STAGGER_INDEX = 13;

const BATTLE_HEX_IMPASSABLE = "#3a2a2a";
const BATTLE_HEX_IN_RANGE = "rgba(210,210,215,0.35)";
const BATTLE_HEX_STROKE = "rgba(255,255,255,0.08)";
const BATTLE_HEX_AVAILABLE_STROKE = "rgba(255,214,102,0.9)";
const BATTLE_ATTACK_TARGET_STROKE = "#e05050";
const BATTLE_SPELL_TARGET_STROKE = "#b27ae8";
const BATTLE_SPELL_TARGET_FILL = "rgba(178, 122, 232, 0.16)";
const BATTLE_AI_TELEGRAPH_FILL = "rgba(224,80,80,0.22)";
const BATTLE_AI_TELEGRAPH_STROKE = "rgba(255,120,120,0.95)";
const BATTLE_MOVE_PATH = "rgba(255,255,255,0.28)";
const BATTLE_AI_ACTING_RING = "#ffffff";
const BATTLE_COMBATANT_ATTACKER = "#3070c0";
const BATTLE_COMBATANT_ATTACKER_SELECTED = "#5fb0ff";
const BATTLE_COMBATANT_DEFENDER = "#c04040";
const BATTLE_COMBATANT_DEFENDER_SELECTED = "#ff7a7a";
const BATTLE_COMBATANT_STROKE = "#fff";
// Legibility shadow for the unit-count text when it overlays unit art (same
// pattern as paintBattleFloatingText's strokeText outline).
const BATTLE_COMBATANT_TEXT_SHADOW = "rgba(0,0,0,0.85)";
const BATTLE_COMBATANT_TEXT_SHADOW_WIDTH = 3;
// Adventure-map-style owner dot at a sprite-mode combatant's base (plan
// decision #6) — the side accent, so teams read even with both figures upright.
const BATTLE_COMBATANT_OWNER_DOT_RADIUS = 3;


// Biome background color palettes (Concept 1: Living Terrain)
// Each biome has a base fill, stroke, and 3 accent colors for variation.
const BIOME_PALETTES: Record<string, { fill: string; stroke: string; accents: string[] }> = {
  grass: { fill: "#3a6b3a", stroke: "#2a4a2a", accents: ["#4a7b4a", "#2a5a2a", "#5a8b5a"] },
  dirt: { fill: "#8a6b3a", stroke: "#5a4a2a", accents: ["#9a7b4a", "#7a5a3a", "#aa8b5a"] },
  water: { fill: "#2a5a8a", stroke: "#1a3a5a", accents: ["#3a6a9a", "#1a4a6a", "#4a7aaa"] },
  forest: { fill: "#1f4a2a", stroke: "#0f2a1a", accents: ["#2f5a3a", "#0f3a1a", "#3f6a4a"] },
  denseForest: { fill: "#10301a", stroke: "#06140b", accents: ["#20402a", "#06240b", "#30503a"] },
  desert: { fill: "#d4b56e", stroke: "#a08850", accents: ["#e4c57e", "#c4a55e", "#f4d58e"] },
  mountain: { fill: "#6e6e7a", stroke: "#3a3a44", accents: ["#7e7e8a", "#5e5e64", "#8e8e9a"] },
  swamp: { fill: "#4a5540", stroke: "#2a3320", accents: ["#5a6550", "#3a4330", "#6a7560"] },
  snow: { fill: "#c9d6e4", stroke: "#8fa6bd", accents: ["#d9e6f4", "#9fb6cd", "#e9f6ff"] },
};

// Seeded random for per-hex variation
function biomeRandom(seed: number, variant: number): () => number {
  let s = (seed * 1664525 + variant * 1013904223 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Drawable = HTMLImageElement | HTMLCanvasElement;

function drawWithDescriptor(
  ctx: CanvasRenderingContext2D,
  drawable: Drawable,
  desc: ResolvedSpriteDescriptor,
  cx: number,
  cy: number,
  hexSize: number,
): void {
  const img = drawable as HTMLImageElement;
  const naturalW = img.naturalWidth ?? (drawable as HTMLCanvasElement).width;
  const naturalH = img.naturalHeight ?? (drawable as HTMLCanvasElement).height;
  if (!naturalW || !naturalH) return;
  const aspect = naturalW / naturalH;

  let w: number;
  let h: number;
  switch (desc.sizing.kind) {
    case "abs":
      w = desc.sizing.size * aspect;
      h = desc.sizing.size;
      break;
    case "fitHeight":
      h = hexSize * desc.sizing.hexSizeMul;
      w = h * aspect;
      break;
    case "fitWidth":
      w = hexSize * desc.sizing.hexSizeMul;
      h = w / aspect;
      break;
  }

  ctx.imageSmoothingEnabled = false;
  let x: number;
  let y: number;
  if (desc.anchor === "center") {
    x = cx - w / 2;
    y = cy - h / 2;
  } else {
    x = cx - w / 2;
    y = cy + hexSize * 0.5 - h + (desc.anchorOffsetY ?? 0);
  }
  ctx.drawImage(drawable, x, y, w, h);
}

export interface Paint2DFrame {
  /** CSS pixels the painter should treat as the viewport. City view paints into this rect as a single origin-space; adventure/battle use it for the background fill. */
  readonly viewportW: number;
  readonly viewportH: number;
}

/**
 * Paint a SceneNode[] list to context.
 *
 * @param ctx     The Canvas2D context to draw into.
 * @param nodes   The scene to paint. Order is significant (later nodes draw
 *                on top of earlier ones); the scene builders already emit in
 *                the correct paint order.
 * @param deps    External dependencies (sprite resolver, skybox, settings
 *                getters, colorForOwner, charterStyle). See `deps.ts`.
 * @param frame   Optional viewport in CSS pixels. Required for the
 *                background-fill decisions and for the citySkybox viewport.
 *                If `nodes` contains only battle-kind nodes, `frame` is
 *                not required.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SceneNode[],
  deps: Paint2DDep,
  frame?: Paint2DFrame,
): void {
  // Fail-fast: a citySkybox node carries its own viewport dimensions, but the
  // real skybox painter (Commit 7 of the design doc) needs the surrounding
  // frame for the parallax draw position math. Catch missing frames now so
  // the wiring stays tidy once the stub turns into a real Canvas call.
  if (frame === undefined && nodes.some((n) => n.kind === "citySkybox")) {
    throw new Error("paintScene: citySkybox node requires a Paint2DFrame (viewport dimensions) but none was provided");
  }
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx];
    switch (node.kind) {
      case "terrainHex":
        paintTerrainHex(ctx, node, deps);
        break;
      case "riverHex":
        paintRiverHex(ctx, node, deps);
        break;
      case "terrainDecoration":
        paintTerrainDecoration(ctx, node, deps);
        break;
      case "fogHex":
        paintFogHex(ctx, node, deps);
        break;
      case "unchartedHex":
        paintUnchartedHex(ctx, node, deps);
        break;
      case "resourceIcon":
        paintResourceIcon(ctx, node, deps);
        break;
      case "charterOverlay":
        paintCharterOverlay(ctx, node, deps);
        break;
      case "validCharterHex":
        paintValidCharterHex(ctx, node, deps);
        break;
      case "castle":
        paintCastle(ctx, node, deps);
        break;
      case "district":
        paintDistrict(ctx, node, deps);
        break;
      case "territoryOutlineEdge": {
        // drawTerritoryOutlines() stroked one owner's whole boundary as a
        // single sub-path under globalAlpha 0.45. Stroking edge-by-edge would
        // double-blend every shared endpoint into a visible bead, so gather
        // the consecutive same-owner run the scene builder emits and stroke
        // it once.
        let end = idx + 1;
        while (end < nodes.length) {
          const next = nodes[end];
          if (next.kind !== "territoryOutlineEdge" || next.ownerId !== node.ownerId) break;
          end++;
        }
        paintTerritoryOutlineEdges(ctx, nodes.slice(idx, end) as TerritoryOutlineEdgeNode[], deps);
        idx = end - 1;
        break;
      }
      case "pathSegment":
        paintPathSegment(ctx, node, deps);
        break;
      case "heroTrail":
        paintHeroTrail(ctx, node, deps);
        break;
      case "hoverHighlight":
        paintHoverHighlight(ctx, node, deps);
        break;
      case "selectedTileHighlight":
        paintSelectedTileHighlight(ctx, node, deps);
        break;
      case "caravanMarker":
        paintCaravanMarker(ctx, node, deps);
        break;
      case "caravanRoute":
        paintCaravanRoute(ctx, node);
        break;
      case "hero":
        paintHero(ctx, node, deps);
        break;
      case "citySkybox":
        paintCitySkybox(ctx, node, deps, frame);
        break;
      case "cityCell":
        paintCityCell(ctx, node, deps);
        break;
      case "cityResourceSpot":
        paintCityResourceSpot(ctx, node, deps);
        break;
      case "cityMine":
        paintCityMine(ctx, node, deps);
        break;
      case "cityBuilding": {
        // Same run-batching shape as territoryOutlineEdge above, for the same
        // reason: drawCityView() drew every building first and only then made
        // a second pass over the selected ones, so the dashed selection rings
        // sit above neighbouring buildings that overlap them.
        let end = idx + 1;
        while (end < nodes.length && nodes[end].kind === "cityBuilding") end++;
        const run = nodes.slice(idx, end) as CityBuildingNode[];
        for (const building of run) paintCityBuilding(ctx, building, deps);
        paintCityBuildingSelections(ctx, run, deps);
        idx = end - 1;
        break;
      }
      case "cityGhostBuilding":
        paintCityGhostBuilding(ctx, node, deps);
        break;
      case "cityPerson":
        paintCityPerson(ctx, node, deps);
        break;
      case "cityLabel":
        paintCityLabel(ctx, node, deps);
        break;
      case "battleBiomeBackground":
        paintBattleBiomeBackground(ctx, node, deps);
        break;
      case "battleHex":
        paintBattleHex(ctx, node, deps);
        break;
      case "battleAttackTargetRing":
        paintBattleAttackTargetRing(ctx, node, deps);
        break;
      case "battleSpellTargetRing":
        paintBattleSpellTargetRing(ctx, node, deps);
        break;
      case "battleAiTelegraphHex":
        paintBattleAiTelegraphHex(ctx, node, deps);
        break;
      case "battleMovePath":
        paintBattleMovePath(ctx, node, deps);
        break;
      case "battleImpactRing":
        paintBattleImpactRing(ctx, node, deps);
        break;
      case "battleAiActingRing":
        paintBattleAiActingRing(ctx, node, deps);
        break;
      case "battleCombatant":
        paintBattleCombatant(ctx, node, deps);
        break;
      case "battleFloatingText":
        paintBattleFloatingText(ctx, node, deps);
        break;
      default: {
        // Exhaustiveness check: adding a new SceneNode.kind that isn't handled
        // above becomes a compile error here (since the `never` assignability
        // fails). If a runtime-SceneNode slips through somehow (downcasted or
        // from a future plugin), throw instead of silently no-op.
        const _exhaustive: never = node;
        void _exhaustive;
        throw new Error(`paintScene: unknown SceneNode.kind: ${(node as { kind: string }).kind}`);
      }
    }
  }
}

// ---- Per-kind painters -----------------------------------------------------
// 1:1 Canvas transcriptions of the legacy draw paths, matching their output
// byte-for-byte per the per-kind function signatures the dispatcher above
// satisfies.

export function paintTerrainHex(ctx: CanvasRenderingContext2D, node: TerrainHexNode, deps: Paint2DDep): void {
  const colors = TERRAIN_COLORS[node.terrain];
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 1;
  hexPath(ctx, node.world.x, node.world.y);
  ctx.fill();
  ctx.stroke();
  void deps;
}

// River overlay geometry: the engine's NEIGHBOR_DIRS order is E, NE, NW, W,
// SW, SE; on screen (y down) those edges sit at the angles below, and the
// baked tiles are authored with their exit edge at 0 degrees. Rotating a
// tile by `rotationDeg` aligns it to the real neighbour direction.
const RIVER_DIR_ANGLE_DEG = [0, 300, 240, 180, 120, 60];
const RIVER_EDGE_DIST = HEX_SIZE * (Math.sqrt(3) / 2);
const RIVER_ART_SIZE = 88;

export interface RiverMaskInfo {
  template: "end" | "straight" | "curveC" | "curveCC" | "curve120C" | "curve120CC";
  rotationDeg: number;
}

/** Map a six-bit neighbour mask to the baked tile shape + its rotation.
 * Two-exit masks resolve by their directed separation: opposite = straight,
 * 60 degrees = curveC (down-wind) / curveCC (up-wind), and 120 degrees =
 * curve120C / curve120CC. Every pair is covered. */
export function riverMaskInfo(mask: number): RiverMaskInfo {
  const dirs: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) dirs.push(d);
  if (dirs.length === 0) return { template: "end", rotationDeg: 0 };
  const a = dirs[0];
  if (dirs.length === 1) return { template: "end", rotationDeg: RIVER_DIR_ANGLE_DEG[a] };
  const b = dirs[1];
  const diff = (RIVER_DIR_ANGLE_DEG[b] - RIVER_DIR_ANGLE_DEG[a] + 360) % 360;
  const template =
    diff === 180 ? ("straight" as const)
      : diff === 60 ? ("curveC" as const)
        : diff === 300 ? ("curveCC" as const)
          : diff === 120 ? ("curve120C" as const)
            : ("curve120CC" as const);
  return { template, rotationDeg: RIVER_DIR_ANGLE_DEG[a] };
}

function paintRiverBandFallback(
  ctx: CanvasRenderingContext2D,
  node: RiverHexNode,
  info: RiverMaskInfo,
): void {
  const { x, y } = node.world;
  const wide = node.size === "wide";
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((info.rotationDeg * Math.PI) / 180);
  ctx.lineCap = "round";
  const stroke = (w: number, color: string, extra: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    if (info.template === "straight") {
      ctx.moveTo(-RIVER_EDGE_DIST, 0);
      ctx.lineTo(RIVER_EDGE_DIST, 0);
    } else if (info.template === "curveC") {
      ctx.moveTo(RIVER_EDGE_DIST, 0);
      ctx.quadraticCurveTo(RIVER_EDGE_DIST + 4, RIVER_EDGE_DIST * 0.45, RIVER_EDGE_DIST * 0.5, RIVER_EDGE_DIST * Math.sin(Math.PI / 3));
    } else if (info.template === "curveCC") {
      ctx.moveTo(RIVER_EDGE_DIST, 0);
      ctx.quadraticCurveTo(RIVER_EDGE_DIST + 4, -RIVER_EDGE_DIST * 0.45, RIVER_EDGE_DIST * 0.5, -RIVER_EDGE_DIST * Math.sin(Math.PI / 3));
    } else {
      ctx.moveTo(RIVER_EDGE_DIST, 0);
      ctx.lineTo(8, 0);
      void extra;
      ctx.stroke();
      // source pool
      ctx.beginPath();
      ctx.arc(6, 0, (wide ? 11 : 8) + extra, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    void extra;
    ctx.stroke();
  };
  stroke((wide ? 20 : 12) + 2, "#1d3f66", 0);
  stroke(wide ? 20 : 12, "#2a5a8a", 0);
  ctx.restore();
}

/**
 * Endpoint pass-throughs: a short wedge on the water-facing exit, painted in
 * the exact body colour (TERRAIN_COLORS.water.fill). Opaque at the shared
 * edge, fading inward, it flares the band to the full hex edge: the band's
 * abrupt bank-line cut, the angular gap and the shade patch between band
 * blues all disappear under it, and the river visibly pours into the water.
 */
function paintMouthWedge(ctx: CanvasRenderingContext2D, node: RiverHexNode): void {
  if (node.mouthDir === undefined) return;
  const theta = (RIVER_DIR_ANGLE_DEG[node.mouthDir] * Math.PI) / 180;
  const nx = Math.cos(theta);
  const ny = Math.sin(theta);
  const ex = Math.sin(theta);
  const ey = -Math.cos(theta);
  const midX = node.world.x + RIVER_EDGE_DIST * nx;
  const midY = node.world.y + RIVER_EDGE_DIST * ny;
  const depth = 22;
  const half = (node.size === "wide" ? 11 : 9) * (HEX_SIZE / RIVER_ART_SIZE) + 1;
  const edgeHalf = HEX_SIZE * 0.5;
  const quad = (d1: number, s1: number, d2: number, s2: number, alpha: number): void => {
    ctx.beginPath();
    ctx.moveTo(midX - nx * d1 + ex * s1, midY - ny * d1 + ey * s1);
    ctx.lineTo(midX - nx * d1 - ex * s1, midY - ny * d1 - ey * s1);
    ctx.lineTo(midX - nx * d2 - ex * s2, midY - ny * d2 - ey * s2);
    ctx.lineTo(midX - nx * d2 + ex * s2, midY - ny * d2 + ey * s2);
    ctx.closePath();
    ctx.fillStyle = `rgba(42, 90, 138, ${alpha})`;
    ctx.fill();
  };
  quad(depth, half, depth * 0.55, (half + edgeHalf) / 2, 0.85);
  // Stops at the rim (a hair inside it, to bury the shared-edge hex stroke
  // without crossing into the neighbour): painting past the rim made the
  // wedge cover the neighbour tile's fog veil, so the river showed through
  // the fog on the very tile it pours into.
  quad(depth * 0.55, (half + edgeHalf) / 2, 1, edgeHalf, 1);
}

export function paintRiverHex(ctx: CanvasRenderingContext2D, node: RiverHexNode, deps: Paint2DDep): void {
  const info = riverMaskInfo(node.mask);
  const mask = node.bridge && node.size === "wide" ? "bridge" : info.template;
  const r = deps.sprite.resolveRiverSprite?.(node.size, mask as "end" | "straight" | "curveC" | "curveCC" | "curve120C" | "curve120CC" | "bridge");
  if (r && r.ready) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(node.world.x, node.world.y);
    ctx.rotate((info.rotationDeg * Math.PI) / 180);
    // The art maps 1:1 to logical px (hex radius 32 on an 88px canvas).
    ctx.drawImage(
      r.drawable,
      -RIVER_ART_SIZE / 2,
      -RIVER_ART_SIZE / 2,
      RIVER_ART_SIZE,
      RIVER_ART_SIZE,
    );
    ctx.restore();
    paintMouthWedge(ctx, node);
    return;
  }
  paintRiverBandFallback(ctx, node, info);
  paintMouthWedge(ctx, node);
}

export function paintTerrainDecoration(ctx: CanvasRenderingContext2D, node: TerrainDecorationNode, deps: Paint2DDep): void {
  if (node.terrain === "grass" || node.terrain === "dirt") {
    void deps;
    return;
  }
  const { x: cx, y: cy } = node.world;
  const seed = decorationSeed(node.q, node.r) - Math.floor(decorationSeed(node.q, node.r));
  const ox = (seed - 0.5) * 14;
  const oy = (((decorationSeed(node.q + 7, node.r - 3)) % 1) - 0.5) * 10;

  const t = node.terrain;
  if (t === "forest") {
    ctx.fillStyle = "#0d2a14";
    ctx.beginPath();
    ctx.moveTo(cx + ox, cy + oy - 10);
    ctx.lineTo(cx + ox - 8, cy + oy + 6);
    ctx.lineTo(cx + ox + 8, cy + oy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(cx + ox - 1.5, cy + oy + 5, 3, 4);
  } else if (t === "denseForest") {
    // Thicket: three close-set crowns over a near-black floor, so the
    // impassable biome reads visibly denser than a plain forest tile.
    ctx.fillStyle = "#06170c";
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy + 1, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0e2413";
    for (const [dx, dy, h] of [[-6, 1, 6], [5, -2, 7], [0, 6, 5]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + ox + dx, cy + oy + dy - h - 4);
      ctx.lineTo(cx + ox + dx - h, cy + oy + dy + h);
      ctx.lineTo(cx + ox + dx + h, cy + oy + dy + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#03100a";
    ctx.fillRect(cx + ox - 2, cy + oy + 8, 4, 5);
  } else if (t === "water") {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, 4, 0.2 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  } else if (t === "desert") {
    ctx.strokeStyle = "rgba(80,60,30,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + ox - 7, cy + oy - 2);
    ctx.lineTo(cx + ox - 3, cy + oy - 5);
    ctx.moveTo(cx + ox + 2, cy + oy + 3);
    ctx.lineTo(cx + ox + 6, cy + oy + 1);
    ctx.moveTo(cx + ox - 5, cy + oy + 5);
    ctx.lineTo(cx + ox - 1, cy + oy + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(120,90,50,0.6)";
    ctx.beginPath();
    ctx.arc(cx + ox + 9, cy + oy + 4, 1, 0, Math.PI * 2);
    ctx.arc(cx + ox - 10, cy + oy - 6, 1, 0, Math.PI * 2);
    ctx.arc(cx + ox + 3, cy + oy - 9, 1, 0, Math.PI * 2);
    ctx.fill();
  } else if (t === "mountain") {
    ctx.fillStyle = "#5a5a64";
    ctx.beginPath();
    ctx.moveTo(cx + ox, cy + oy - 14);
    ctx.lineTo(cx + ox - 14, cy + oy + 8);
    ctx.lineTo(cx + ox + 14, cy + oy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f4f4f8";
    ctx.beginPath();
    ctx.moveTo(cx + ox, cy + oy - 14);
    ctx.lineTo(cx + ox - 4, cy + oy - 6);
    ctx.lineTo(cx + ox + 4, cy + oy - 6);
    ctx.closePath();
    ctx.fill();
  } else if (t === "swamp") {
    ctx.fillStyle = "rgba(22, 34, 20, 0.7)";
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy + 3, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(108, 134, 66, 0.85)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx + ox - 5, cy + oy + 2);
    ctx.lineTo(cx + ox - 6, cy + oy - 6);
    ctx.moveTo(cx + ox, cy + oy + 2);
    ctx.lineTo(cx + ox + 1, cy + oy - 8);
    ctx.moveTo(cx + ox + 5, cy + oy + 1);
    ctx.lineTo(cx + ox + 6, cy + oy - 5);
    ctx.stroke();
  } else if (t === "snow") {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, 5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(cx + ox + 5, cy + oy + 3, 1.2, 0, Math.PI * 2);
    ctx.arc(cx + ox - 6, cy + oy - 2, 1.2, 0, Math.PI * 2);
    ctx.arc(cx + ox + 1, cy + oy + 6, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  void deps;
}

export function paintFogHex(ctx: CanvasRenderingContext2D, node: FogHexNode, deps: Paint2DDep): void {
  hexPath(ctx, node.world.x, node.world.y);
  ctx.fillStyle = FOG_FILL;
  ctx.fill();
  ctx.strokeStyle = FOG_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  void deps;
}

export function paintUnchartedHex(ctx: CanvasRenderingContext2D, node: UnchartedHexNode, deps: Paint2DDep): void {
  hexPath(ctx, node.world.x, node.world.y);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.strokeStyle = "rgba(28, 32, 40, 0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  void deps;
}

export function paintResourceIcon(ctx: CanvasRenderingContext2D, node: ResourceIconNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForResource(node.resource);
  if (!r || !r.ready) return;
  ctx.imageSmoothingEnabled = false;
  drawWithDescriptor(ctx, r.drawable, r.descriptor, node.world.x, node.world.y, HEX_SIZE);
}

export function paintCastle(ctx: CanvasRenderingContext2D, node: CastleNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForCastle(node.level, node.variant, node.fullness);
  if (r && r.ready) {
    drawWithDescriptor(ctx, r.drawable, r.descriptor, node.world.x, node.world.y, HEX_SIZE);
  }
  const { x: cx, y: cy } = node.world;
  const ringY = cy + HEX_SIZE * 0.55;
  if (node.selected) {
    // Double ring = selected. Full alpha so it clearly out-weights the
    // always-on ownership ring; white for neutrals, owner colour otherwise.
    const ringColor = node.dashedBorder ? "rgba(255,255,255,0.9)" : node.color;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, ringY, HEX_SIZE * 1.05, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, ringY, HEX_SIZE * 1.18, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, ringY, HEX_SIZE * 0.95, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  if (node.dashedBorder) {
    // Neutral settlements keep the faint dashed-white ring.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Always-on ownership ring: dimmed so it stops reading as a selection.
    ctx.strokeStyle = node.color;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.restore();
  }
  void deps;
}

export function paintDistrict(ctx: CanvasRenderingContext2D, node: DistrictNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForDistrict?.(node.variant, node.tier);
  if (r && r.ready !== false) {
    drawWithDescriptor(ctx, r.drawable, r.descriptor, node.world.x, node.world.y, HEX_SIZE);
  }
  const { x: cx, y: cy } = node.world;
  const ringY = cy + HEX_SIZE * 0.45;
  ctx.beginPath();
  ctx.arc(cx, ringY, HEX_SIZE * 0.72, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  if (node.ownerId === null) {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = node.color;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.stroke();
    ctx.restore();
  }
  if (node.blocked) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, ringY, HEX_SIZE * 0.85, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 92, 64, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  void deps;
}

export function paintCharterOverlay(ctx: CanvasRenderingContext2D, node: CharterOverlayNode, deps: Paint2DDep): void {
  const style = deps.charterStyle(node.phase);
  ctx.strokeStyle = style.stroke;
  ctx.setLineDash(style.lineDash);
  ctx.lineWidth = style.lineWidth;
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = style.fill;
  ctx.fill();

  if (node.phase === "constructing") {
    const innerSize = HEX_SIZE * 0.5;
    ctx.strokeStyle = "rgba(160, 120, 60, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(node.world.x - innerSize * 0.5, node.world.y - innerSize * 0.3);
    ctx.lineTo(node.world.x + innerSize * 0.5, node.world.y - innerSize * 0.3);
    ctx.lineTo(node.world.x, node.world.y - innerSize);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(node.world.x - innerSize * 0.5, node.world.y - innerSize * 0.3);
    ctx.lineTo(node.world.x + innerSize * 0.5, node.world.y - innerSize * 0.3);
    ctx.lineTo(node.world.x, node.world.y + innerSize * 0.2);
    ctx.closePath();
    ctx.stroke();
  }
}

export function paintValidCharterHex(ctx: CanvasRenderingContext2D, node: ValidCharterHexNode, deps: Paint2DDep): void {
  const style = deps.validCharterStyle;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.lineDash);
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = style.fill;
  ctx.fill();
}

export function paintTerritoryOutlineEdge(ctx: CanvasRenderingContext2D, node: TerritoryOutlineEdgeNode, deps: Paint2DDep): void {
  paintTerritoryOutlineEdges(ctx, [node], deps);
}

/**
 * Stroke a run of same-owner boundary edges as one path, matching
 * `drawTerritoryOutlines()`'s per-owner batch. Batching is load-bearing, not
 * an optimisation: at `globalAlpha = 0.45` with round caps, per-edge strokes
 * blend twice at every shared endpoint.
 */
export function paintTerritoryOutlineEdges(
  ctx: CanvasRenderingContext2D,
  edges: readonly TerritoryOutlineEdgeNode[],
  deps: Paint2DDep,
): void {
  if (edges.length === 0) return;
  ctx.save();
  ctx.strokeStyle = edges[0].color;
  ctx.lineWidth = deps.getTerritoryBorderWidth();
  ctx.globalAlpha = 0.45;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const e of edges) {
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
  }
  ctx.stroke();
  ctx.restore();
}

export function paintPathSegment(ctx: CanvasRenderingContext2D, node: PathSegmentNode, deps: Paint2DDep): void {
  if (node.points.length < 2) return;
  const color = node.reachable
    ? "rgba(255, 204, 0, 0.85)"
    : node.fogged
    ? "rgba(255, 204, 0, 0.50)"
    : "rgba(255, 204, 0, 0.30)";
  const width = node.reachable ? 4 : 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (node.fogged) {
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = width + 2;
    tracePoints(ctx, node.points);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  tracePoints(ctx, node.points);
  ctx.stroke();
  const dotRadius = node.reachable ? 6 : 4;
  const alpha = color.replace(/[\d.]+\)$/, "0.5)");
  ctx.fillStyle = alpha;
  // Every point except the segment's first one gets a dot -- including the
  // last. drawPathSegment()'s loop ran `fromIdx + 1 ..< toIdx`, i.e. inclusive
  // of the final point it had just stroked to.
  for (let i = 1; i < node.points.length; i++) {
    const p = node.points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  void deps;
}

function tracePoints(ctx: CanvasRenderingContext2D, points: readonly WorldPoint[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

export function paintHeroTrail(ctx: CanvasRenderingContext2D, node: HeroTrailNode, deps: Paint2DDep): void {
  if (node.points.length < 2) return;
  const color = node.color;
  const n = node.points.length;
  const intensity = node.intensity ?? 1;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Index-based fade: oldest point faintest, newest at full base alpha. The
  // polyline is stroked per segment so the ramp applies to it too.
  for (let i = 1; i < n; i++) {
    const prev = node.points[i - 1];
    const p = node.points[i];
    const ramp = 0.35 + 0.65 * (i / (n - 1 || 1));
    ctx.globalAlpha = 0.55 * ramp * intensity;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 * ramp * intensity;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
  void deps;
}

export function paintHoverHighlight(ctx: CanvasRenderingContext2D, node: HoverHighlightNode, deps: Paint2DDep): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = HOVER_STROKE;
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  void deps;
}

export function paintCaravanMarker(ctx: CanvasRenderingContext2D, node: CaravanMarkerNode, deps?: Paint2DDep): void {
  const { x, y } = node.world;
  const marker = node.markerWorld ?? node.world;
  const s = Math.min(1 + (node.wagons - 1) * 0.08, 1.4);
  const sprite =
    deps?.sprite.resolveSpriteForCaravan?.(node.payloadKind, node.facingDirection) ??
    deps?.sprite.resolveSprite(node.payloadKind === "gold" ? "caravan.gold" : "caravan.resource");

  if (node.hovered) {
    // Footprint ring under the cart: a bright inner ellipse plus a soft
    // owner-tinted halo, so a hovered wagon reads at any zoom without
    // obscuring the sprite itself.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 236, 160, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(marker.x, marker.y, HEX_SIZE * 0.72, HEX_SIZE * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(marker.x, marker.y, HEX_SIZE * 0.82, HEX_SIZE * 0.46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (sprite && sprite.ready) {
    // Directional art is authored per compass heading, so the painter draws it
    // as-is: the old horizontal-flip trick only ever had two poses.
    drawWithDescriptor(ctx, sprite.drawable, sprite.descriptor, x, y, HEX_SIZE * s);

    ctx.save();
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y + OWNER_DOT_OFFSET_Y, OWNER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const badgeY = marker.y - HEX_SIZE * 0.72 * s;
    const label = String(node.wagons);
    ctx.font = `bold ${Math.round(10 * Math.min(s, 1.2))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(label, marker.x, badgeY);
    ctx.fillStyle = node.payloadKind === "gold" ? "#ffd866" : "#ffffff";
    ctx.fillText(label, marker.x, badgeY);
    ctx.restore();
    return;
  }

  const fallbackScale = Math.min(1 + (node.wagons - 1) * 0.12, 2);
  const bodyW = 26 * fallbackScale;
  const bodyH = 10 * fallbackScale;
  const wheelR = 3.5 * fallbackScale;
  const bodyTop = y - bodyH - wheelR;
  ctx.save();
  ctx.fillStyle = node.payloadKind === "gold" ? "#b8860b" : "#8a5a2b";
  ctx.strokeStyle = "#3a2a14";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
  ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
  ctx.beginPath();
  ctx.arc(x, bodyTop, bodyW / 2, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = node.color;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3a2a14";
  for (const dx of [-bodyW * 0.3, bodyW * 0.3]) {
    ctx.beginPath();
    ctx.arc(x + dx, y - wheelR, wheelR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = node.payloadKind === "gold" ? "#ffd866" : "#ffffff";
  ctx.font = `bold ${Math.round(9 * fallbackScale)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(String(node.wagons), marker.x, bodyTop - bodyW / 2 - 3 * fallbackScale);
  ctx.restore();
}

export function paintCaravanRoute(ctx: CanvasRenderingContext2D, node: CaravanRouteNode): void {
  if (node.points.length < 2) return;
  const gold = node.payloadKind === "gold";
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Dark under-stroke keeps the dashed route legible over bright terrain.
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 5;
  tracePoints(ctx, node.points);
  ctx.stroke();
  ctx.strokeStyle = gold ? "rgba(255, 214, 102, 0.95)" : "rgba(255, 240, 200, 0.95)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 5]);
  tracePoints(ctx, node.points);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = gold ? "rgba(255, 214, 102, 0.9)" : "rgba(255, 240, 200, 0.9)";
  for (let i = 1; i < node.points.length; i++) {
    const p = node.points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const last = node.points[node.points.length - 1];
  ctx.strokeStyle = node.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function paintSelectedTileHighlight(ctx: CanvasRenderingContext2D, node: SelectedTileHighlightNode, deps: Paint2DDep): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = SELECTED_TILE_STROKE;
  ctx.setLineDash([4, 3]);
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  ctx.setLineDash([]);
  void deps;
}

export function paintHero(ctx: CanvasRenderingContext2D, node: HeroNode, deps: Paint2DDep): void {
  const alpha = node.alpha ?? 1;
  const faded = alpha < 1;
  if (faded) {
    ctx.save();
    ctx.globalAlpha *= alpha;
  }
  const variant = node.horseVariant;
  // The walk-cycle vertical squash applies to the on-foot hero sprite only --
  // drawHorseSprite() never took a scaleY. Mounted heroes bob but don't squash,
  // and neither does a wagon: it is not a person on foot.
  const needsScale = !node.wagon && variant === "hero" && Math.abs(node.scaleY - 1.0) > 1e-6;
  if (needsScale) {
    const anchorY = node.world.y + HEX_SIZE * 0.5;
    ctx.save();
    ctx.translate(node.world.x, anchorY);
    ctx.scale(1, node.scaleY);
    ctx.translate(-node.world.x, -anchorY);
  }
  // A covered wagon (settlers mode) is a hero-shaped entity that is NOT a
  // horse, so it draws the map's existing wagon art -- the trade-route caravan
  // family a player already reads as "a wagon" on this map -- resolved per
  // heading exactly as a caravan marker is (SETTLERS-PLAN.md §4 W4: the wagon
  // renders as a wagon rather than the generic hero variant). Reusing that
  // family is deliberate: a second wagon asset would be a parallel source of
  // the same object.
  const r = node.wagon
    ? deps.sprite.resolveSpriteForCaravan?.("resource", node.facingDirection)
    : deps.sprite.resolveSpriteForHero(node.faction, node.facingDirection, variant, node.runFrame);
  if (r && r.ready) {
    drawWithDescriptor(ctx, r.drawable, r.descriptor, node.world.x, node.world.y, HEX_SIZE);
  }
  if (needsScale) ctx.restore();

  // Markers anchor to markerWorld, not world: they stay put while the sprite bobs.
  ctx.fillStyle = node.color;
  ctx.beginPath();
  ctx.arc(node.markerWorld.x, node.markerWorld.y + OWNER_DOT_OFFSET_Y, OWNER_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (node.selected) {
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(node.markerWorld.x, node.markerWorld.y, SELECTED_HERO_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (faded) ctx.restore();
}

export function paintCitySkybox(ctx: CanvasRenderingContext2D, node: CitySkyboxNode, deps: Paint2DDep, frame?: Paint2DFrame): void {
  if (!frame) return;
  const { viewportW, viewportH, spriteVariant, parallaxEnabled, parallaxLayerCount, offsetX, offsetY } = node;
  if (node.backdropMode === "diorama" && node.backdrop) {
    paintCityDiorama(ctx, viewportW, viewportH, node.backdrop, node.citySize, node.gridFootprint);
    return;
  }
  const skybox = deps.skybox;
  if (skybox) {
    skybox.ensureLoaded(spriteVariant);
    if (parallaxEnabled) {
      const layers = skybox.getLayers(spriteVariant, parallaxLayerCount);
      if (layers) {
        const img = skybox.getImage(spriteVariant);
        if (img) {
          const imgW = img.naturalWidth;
          const imgH = img.naturalHeight;
          const imgRatio = imgW / imgH;
          const viewRatio = viewportW / viewportH;
          let drawW: number;
          let drawH: number;
          if (viewRatio > imgRatio) {
            drawW = viewportW;
            drawH = viewportW / imgRatio;
          } else {
            drawH = viewportH;
            drawW = viewportH * imgRatio;
          }
          const ox = (drawW - viewportW) / 2 + offsetX;
          const oy = (drawH - viewportH) / 2 + offsetY;
          const speeds = PARALLAX_SPEEDS[parallaxLayerCount] ?? PARALLAX_SPEEDS[4];
          for (let i = 0; i < layers.length; i++) {
            const speed = speeds[i];
            ctx.drawImage(layers[i], -ox * speed, -oy * speed, drawW, drawH);
          }
          return;
        }
      }
    }
    const img = skybox.getImage(spriteVariant);
    if (img) {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const imgRatio = imgW / imgH;
      const viewRatio = viewportW / viewportH;
      let drawW: number;
      let drawH: number;
      if (viewRatio > imgRatio) {
        drawW = viewportW;
        drawH = viewportW / imgRatio;
      } else {
        drawH = viewportH;
        drawW = viewportH * imgRatio;
      }
      const ox = (drawW - viewportW) / 2 + offsetX;
      const oy = (drawH - viewportH) / 2 + offsetY;
      ctx.drawImage(img, -ox, -oy, drawW, drawH);
      return;
    }
  }
  ctx.fillStyle = CITY_BG;
  ctx.fillRect(0, 0, viewportW, viewportH);
}

export function paintCityCell(ctx: CanvasRenderingContext2D, node: CityCellNode, deps: Paint2DDep): void {
  if (!node.hovered && !node.buildable && !node.gridLines) {
    void deps;
    return;
  }
  const { x, y } = node.screen;
  const hw = node.halfWidth;
  const hh = node.halfHeight;
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
  if (node.buildable) {
    ctx.fillStyle = CITY_BUILDABLE_FILL;
    ctx.fill();
  }
  if (node.hovered) {
    ctx.strokeStyle = CITY_HOVER_UNDER;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = CITY_HOVER_STROKE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (node.buildable) {
    ctx.strokeStyle = CITY_BUILDABLE_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.strokeStyle = CITY_CELL_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  void deps;
}

export function paintCityResourceSpot(ctx: CanvasRenderingContext2D, node: CityResourceSpotNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForResource(node.resource);
  if (r && r.ready) {
    const img = r.drawable as Drawable;
    const naturalW = (img as HTMLImageElement).naturalWidth ?? (img as HTMLCanvasElement).width;
    const naturalH = (img as HTMLImageElement).naturalHeight ?? (img as HTMLCanvasElement).height;
    const w = Math.min(node.tileWidth * 0.5, node.tileHeight * 2.0);
    const h = naturalW && naturalH ? (w / naturalW) * naturalH : w;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(r.drawable as Drawable, node.screen.x - w / 2, node.screen.y - h / 2, w, h);
    ctx.restore();
    return;
  }
  const pal = RESOURCE_PAL[node.resource];
  if (!pal) return;
  const hw = node.tileWidth * 0.22;
  const hh = node.tileHeight * 0.22;
  ctx.beginPath();
  ctx.moveTo(node.screen.x, node.screen.y - hh);
  ctx.lineTo(node.screen.x + hw, node.screen.y);
  ctx.lineTo(node.screen.x, node.screen.y + hh);
  ctx.lineTo(node.screen.x - hw, node.screen.y);
  ctx.closePath();
  ctx.fillStyle = pal.stone;
  ctx.fill();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function paintCityMine(ctx: CanvasRenderingContext2D, node: CityMineNode, deps: Paint2DDep): void {
  const pal = RESOURCE_PAL[node.resource];
  if (!pal) return;
  paintCityResourceSpot(ctx, { kind: "cityResourceSpot", gx: node.gx, gy: node.gy, screen: node.screen, tileWidth: node.tileWidth, tileHeight: node.tileHeight, resource: node.resource }, deps);
  const hw = node.tileWidth * 0.28;
  const hh = node.tileHeight * 0.28;
  const wallH = node.tileWidth * 0.12;
  const topY = node.screen.y - hh;
  const botY = node.screen.y + hh;
  const botWallY = botY + wallH;

  ctx.save();
  ctx.fillStyle = pal.stoneDk;
  ctx.beginPath();
  ctx.moveTo(node.screen.x - hw, node.screen.y);
  ctx.lineTo(node.screen.x, botY);
  ctx.lineTo(node.screen.x + hw, node.screen.y);
  ctx.lineTo(node.screen.x, topY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneDk;
  ctx.fillRect(node.screen.x - hw, node.screen.y, hw * 2, wallH);

  ctx.fillStyle = pal.stone;
  ctx.beginPath();
  ctx.moveTo(node.screen.x - hw, node.screen.y);
  ctx.lineTo(node.screen.x - hw, botWallY);
  ctx.lineTo(node.screen.x, botWallY + wallH * 0.6);
  ctx.lineTo(node.screen.x, botY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneDk;
  ctx.beginPath();
  ctx.moveTo(node.screen.x, botY);
  ctx.lineTo(node.screen.x + hw, node.screen.y);
  ctx.lineTo(node.screen.x + hw, botWallY);
  ctx.lineTo(node.screen.x, botWallY + wallH * 0.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneHi;
  ctx.beginPath();
  ctx.moveTo(node.screen.x, topY - wallH * 0.3);
  ctx.lineTo(node.screen.x + hw, topY);
  ctx.lineTo(node.screen.x, topY + hh * 0.3);
  ctx.lineTo(node.screen.x - hw, topY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.glow;
  ctx.font = `${Math.max(8, node.tileHeight * 0.2)}px ${deps.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(node.level), node.screen.x, node.screen.y - node.tileWidth * 0.06);
  ctx.restore();
}

// Sprite-only city-building draw, the survivor of paint2d/buildings.ts's
// drawBuildingInto(): buildings render exclusively from `building.pixel.*`
// sprites (the five procedural style leaves were deleted with the style
// system), so a resolver miss draws nothing. The sizing quirk is carried over
// verbatim: the `fitHeight` branch scales off `tw`, not `td`.
function drawCitySpriteInto(
  ctx: CanvasRenderingContext2D,
  sprite: ResolvedSprite | undefined,
  x: number,
  y: number,
  tw: number,
  td: number,
): void {
  if (!sprite || !sprite.ready) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const drawable = sprite.drawable;
  const dw = (drawable as HTMLImageElement).naturalWidth ?? (drawable as HTMLCanvasElement).width;
  const dh = (drawable as HTMLImageElement).naturalHeight ?? (drawable as HTMLCanvasElement).height;
  const desc = sprite.descriptor;
  const aspect = dw / dh;
  let sw: number;
  let sh: number;
  if (desc.sizing.kind === "fitWidth") {
    sw = tw * desc.sizing.hexSizeMul;
    sh = sw / aspect;
  } else if (desc.sizing.kind === "fitHeight") {
    sh = tw * desc.sizing.hexSizeMul;
    sw = sh * aspect;
  } else {
    sw = tw * 0.85;
    sh = (tw * 0.85) / aspect;
  }
  const dx = x - sw / 2;
  const dy = desc.anchor === "center"
    ? y - sh / 2 + (desc.anchorOffsetY ?? 0)
    : y + td * 0.5 - sh + (desc.anchorOffsetY ?? 0);
  ctx.drawImage(drawable, dx, dy, sw, sh);
  ctx.restore();
}

export function paintCityBuilding(ctx: CanvasRenderingContext2D, node: CityBuildingNode, deps: Paint2DDep): void {
  const sprite = node.constructionStage
      ? deps.sprite.resolveSprite(`building.pixel.underConstruction.${node.constructionStage}`)
      : node.farmSpriteKey !== undefined
        ? deps.sprite.resolveSprite(node.farmSpriteKey)
        : node.farmStyle !== undefined
          ? deps.sprite.resolveSprite(`building.${node.farmStyle}.${node.buildingKind}.${node.level}`)
          : deps.sprite.resolveSpriteForBuilding(node.buildingKind, node.level);
  drawCitySpriteInto(
    ctx,
    sprite,
    node.center.x,
    node.center.y,
    node.halfWidth * 2,
    node.halfHeight * 2,
  );
}

/**
 * Second pass over a run of building nodes, stroking the dashed ring around
 * the selected ones. Separate from `paintCityBuilding` because drawCityView()
 * drew all buildings before any selection ring -- inlining the ring would let
 * a later building paint over an earlier building's ring.
 */
export function paintCityBuildingSelections(
  ctx: CanvasRenderingContext2D,
  nodes: readonly CityBuildingNode[],
  deps: Paint2DDep,
): void {
  const selected = nodes.filter((n) => n.selected);
  if (selected.length === 0) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = CITY_SELECTION_STROKE;
  ctx.setLineDash([6, 4]);
  for (const node of selected) {
    ctx.strokeRect(node.center.x - node.halfWidth, node.center.y - node.halfHeight, node.halfWidth * 2, node.halfHeight * 2);
  }
  ctx.restore();
  void deps;
}

export function paintCityGhostBuilding(ctx: CanvasRenderingContext2D, node: CityGhostBuildingNode, deps: Paint2DDep): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = node.valid ? CITY_GHOST_VALID_STROKE : CITY_GHOST_INVALID_STROKE;
  ctx.lineWidth = 3;
  ctx.strokeRect(node.center.x - node.halfWidth, node.center.y - node.halfHeight, node.halfWidth * 2, node.halfHeight * 2);
  drawCitySpriteInto(
    ctx,
    deps.sprite.resolveSpriteForBuilding(node.buildingKind, 1),
    node.center.x,
    node.center.y,
    node.halfWidth * 2,
    node.halfHeight * 2,
  );
  ctx.restore();

  // The red outline says "no"; this says WHY, under the footprint so it never
  // covers the sprite the player is aiming with. Same ink and shadow as the
  // city's own labels so it reads on any backdrop.
  if (!node.valid && node.reason) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 3;
    ctx.fillStyle = CITY_GHOST_INVALID_STROKE;
    ctx.font = `11px ${deps.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.reason, node.center.x, node.center.y + node.halfHeight + 4);
    ctx.restore();
  }
}

export function paintCityPerson(ctx: CanvasRenderingContext2D, node: CityPersonNode, deps: Paint2DDep): void {
  const sprite =
    deps.sprite.resolveSpriteForCityPerson?.() ??
    deps.sprite.resolveSpriteForUnit("peasant", "idle");
  const personH = 16;
  const spacing = 14;
  const reduced = prefersReducedMotion();
  const now = reduced ? 0 : performance.now();
  for (let i = 0; i < node.count; i++) {
    // Centered row: count=1 sits dead on the node center, larger clusters fan
    // out symmetrically so the group never spills past the footprint edges.
    const x = node.center.x + (i - (node.count - 1) / 2) * spacing;
    const y = node.center.y;
    const staggerMs =
      (((node.gx * PERSON_STAGGER_GX + node.gy * PERSON_STAGGER_GY + i * PERSON_STAGGER_INDEX) % PERSON_STAGGER_BUCKETS) *
        PERSON_BREATH_PERIOD_MS) /
      PERSON_STAGGER_BUCKETS;
    const bob = reduced ? 0 : Math.floor((now + staggerMs) / PERSON_BREATH_PERIOD_MS) % 2;
    if (sprite && sprite.ready && sprite.drawable) {
      const drawable = sprite.drawable;
      const naturalW = (drawable as HTMLImageElement).naturalWidth ?? (drawable as HTMLCanvasElement).width;
      const naturalH = (drawable as HTMLImageElement).naturalHeight ?? (drawable as HTMLCanvasElement).height;
      const w = naturalW && naturalH ? (personH / naturalH) * naturalW : personH;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(drawable, x - w / 2, y - personH - bob, w, personH);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, y - 5 - bob, 5, 0, Math.PI * 2);
      ctx.fillStyle = PERSON_PLACEHOLDER_FILL;
      ctx.fill();
      ctx.strokeStyle = BATTLE_COMBATANT_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

export function paintCityLabel(ctx: CanvasRenderingContext2D, node: CityLabelNode, deps: Paint2DDep): void {
  ctx.save();
  ctx.globalAlpha = node.alpha;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.fillStyle = CITY_TEXT;
  ctx.font = `${node.fontPx}px ${deps.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.fillText(node.text, node.x, node.y);
  ctx.restore();
}

export function paintBattleHex(ctx: CanvasRenderingContext2D, node: BattleHexNode, deps: Paint2DDep): void {
  hexPath(ctx, node.world.x, node.world.y, node.hexRadius);
  // Base fill is now provided by biome background; only draw overlay highlights
  if (node.inMoveRange) {
    ctx.fillStyle = BATTLE_HEX_IN_RANGE;
    ctx.fill();
  } else if (node.impassable) {
    // Impassable hexes get a subtle overlay so they read on top of biome background
    ctx.fillStyle = BATTLE_HEX_IMPASSABLE + "80";
    ctx.fill();
  }
  ctx.strokeStyle = node.available ? BATTLE_HEX_AVAILABLE_STROKE : BATTLE_HEX_STROKE;
  ctx.lineWidth = node.available ? 2 : 1;
  ctx.stroke();
  void deps;
}

export function paintBattleBiomeBackground(ctx: CanvasRenderingContext2D, node: BattleBiomeBackgroundNode, deps: Paint2DDep): void {
  const palette = BIOME_PALETTES[node.biome] ?? BIOME_PALETTES.grass;
  const rng = biomeRandom(node.seed, node.variant);

  // Base fill with slight variation
  const variation = rng();
  const fillIdx = Math.floor(variation * palette.accents.length);
  ctx.fillStyle = variation < 0.7 ? palette.fill : palette.accents[fillIdx];

  hexPath(ctx, node.world.x, node.world.y, node.hexRadius);
  ctx.fill();

  // Optional: add subtle texture detail based on biome (for non-impassable hexes)
  const isImpassable = node.impassable === true;
  if (!isImpassable) {
    if (node.biome === "forest" || node.biome === "denseForest") {
      // Tiny pine needle clusters
      const detailRng = biomeRandom(node.seed + 1000, node.variant);
      for (let i = 0; i < 2; i++) {
        const angle = detailRng() * Math.PI * 2;
        const dist = node.hexRadius * 0.3 * detailRng();
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        ctx.fillStyle = palette.accents[Math.floor(detailRng() * palette.accents.length)];
        ctx.beginPath();
        ctx.arc(node.world.x + dx, node.world.y + dy, Math.max(1, node.hexRadius * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (node.biome === "desert") {
      // Sand ripple lines
      const detailRng = biomeRandom(node.seed + 1000, node.variant);
      ctx.strokeStyle = palette.accents[0] + "40";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 2; i++) {
        const y = node.world.y - node.hexRadius * 0.4 + detailRng() * node.hexRadius * 0.8;
        ctx.beginPath();
        ctx.moveTo(node.world.x - node.hexRadius * 0.5, y);
        ctx.lineTo(node.world.x + node.hexRadius * 0.5, y);
        ctx.stroke();
      }
    } else if (node.biome === "swamp") {
      // Bubbles
      const detailRng = biomeRandom(node.seed + 1000, node.variant);
      for (let i = 0; i < 3; i++) {
        const angle = detailRng() * Math.PI * 2;
        const dist = node.hexRadius * 0.4 * detailRng();
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        ctx.fillStyle = "#4aa5a5" + Math.floor(detailRng() * 128 + 64).toString(16).padStart(2, "0");
        ctx.beginPath();
        ctx.arc(node.world.x + dx, node.world.y + dy, Math.max(1, node.hexRadius * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (node.biome === "snow") {
      // Snow drift highlights
      const detailRng = biomeRandom(node.seed + 1000, node.variant);
      ctx.fillStyle = "#ffffff60";
      for (let i = 0; i < 2; i++) {
        const angle = detailRng() * Math.PI * 2;
        const dist = node.hexRadius * 0.35 * detailRng();
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        ctx.beginPath();
        ctx.arc(node.world.x + dx, node.world.y + dy, Math.max(1, node.hexRadius * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Subtle stroke
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // IMPASSABLE OBSTACLE IMAGERY - biome-specific visuals explaining WHY it's blocked
  if (isImpassable) {
    const cx = node.world.x;
    const cy = node.world.y;
    const r = node.hexRadius;
    const obsRng = biomeRandom(node.seed + 5000, node.variant);

    switch (node.biome) {
      case "grass":
      case "dirt": {
        // Large boulders / standing stones
        const numRocks = 1 + Math.floor(obsRng() * 2);
        for (let i = 0; i < numRocks; i++) {
          const angle = obsRng() * Math.PI * 2;
          const dist = r * 0.25 * obsRng();
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const rockR = r * (0.18 + obsRng() * 0.12);
          // Rock base
          ctx.fillStyle = "#4a4a3a";
          ctx.beginPath();
          ctx.ellipse(cx + dx, cy + dy + rockR * 0.3, rockR, rockR * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          // Rock top highlight
          ctx.fillStyle = "#6a6a5a";
          ctx.beginPath();
          ctx.ellipse(cx + dx - rockR * 0.2, cy + dy - rockR * 0.2, rockR * 0.6, rockR * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          // Shadow
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.beginPath();
          ctx.ellipse(cx + dx, cy + dy + rockR * 0.5, rockR * 0.8, rockR * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "forest": {
        // Fallen logs
        const numLogs = 1 + Math.floor(obsRng() * 2);
        for (let i = 0; i < numLogs; i++) {
          const angle = obsRng() * Math.PI;
          const length = r * (0.5 + obsRng() * 0.4);
          const cx_log = cx + Math.cos(angle) * r * 0.15;
          const cy_log = cy + Math.sin(angle) * r * 0.15;
          const logAngle = angle + (obsRng() - 0.5) * 0.5;
          ctx.fillStyle = "#3a2a1a";
          ctx.save();
          ctx.translate(cx_log, cy_log);
          ctx.rotate(logAngle);
          ctx.beginPath();
          ctx.roundRect(-length / 2, -r * 0.08, length, r * 0.16, r * 0.05);
          ctx.fill();
          // Bark lines
          ctx.strokeStyle = "#2a1a0a";
          ctx.lineWidth = 1;
          for (let b = 0; b < 3; b++) {
            const bx = -length / 2 + length * (b + 1) / 4;
            ctx.beginPath();
            ctx.moveTo(bx, -r * 0.08);
            ctx.lineTo(bx, r * 0.08);
            ctx.stroke();
          }
          ctx.restore();
        }
        break;
      }
      case "denseForest": {
        // Massive tree trunks (wider, darker)
        const numTrunks = 1 + Math.floor(obsRng() * 2);
        for (let i = 0; i < numTrunks; i++) {
          const angle = obsRng() * Math.PI * 2;
          const dist = r * 0.2 * obsRng();
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const trunkR = r * (0.25 + obsRng() * 0.15);
          // Trunk base
          ctx.fillStyle = "#1a1008";
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, trunkR, 0, Math.PI * 2);
          ctx.fill();
          // Bark texture
          ctx.strokeStyle = "#0a0603";
          ctx.lineWidth = 2;
          for (let b = 0; b < 4; b++) {
            const ba = (b / 4) * Math.PI * 2;
            const br = trunkR * (0.3 + obsRng() * 0.4);
            ctx.beginPath();
            ctx.moveTo(cx + dx + Math.cos(ba) * br, cy + dy + Math.sin(ba) * br);
            ctx.lineTo(cx + dx + Math.cos(ba) * trunkR, cy + dy + Math.sin(ba) * trunkR);
            ctx.stroke();
          }
          // Root flare
          ctx.fillStyle = "#0a0603";
          ctx.beginPath();
          ctx.ellipse(cx + dx, cy + dy + trunkR * 0.6, trunkR * 1.2, trunkR * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "desert": {
        // Rock outcrops / cacti
        if (obsRng() < 0.6) {
          // Rock outcrop
          const angle = obsRng() * Math.PI * 2;
          const dist = r * 0.2 * obsRng();
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const w = r * (0.6 + obsRng() * 0.4);
          const h = r * (0.5 + obsRng() * 0.3);
          ctx.fillStyle = "#b8965a";
          ctx.beginPath();
          ctx.moveTo(cx + dx - w / 2, cy + dy + h / 2);
          ctx.lineTo(cx + dx - w * 0.3, cy + dy - h / 2);
          ctx.lineTo(cx + dx + w * 0.3, cy + dy - h / 2);
          ctx.lineTo(cx + dx + w / 2, cy + dy + h / 2);
          ctx.closePath();
          ctx.fill();
          // Highlight
          ctx.fillStyle = "#d4b56e";
          ctx.beginPath();
          ctx.moveTo(cx + dx - w * 0.2, cy + dy + h / 2);
          ctx.lineTo(cx + dx, cy + dy - h * 0.3);
          ctx.lineTo(cx + dx + w * 0.2, cy + dy + h / 2);
          ctx.fill();
        } else {
          // Cactus cluster
          const numCacti = 2 + Math.floor(obsRng() * 2);
          for (let i = 0; i < numCacti; i++) {
            const angle = obsRng() * Math.PI * 2;
            const dist = r * 0.3 * obsRng();
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            const ch = r * (0.4 + obsRng() * 0.3);
            const cw = r * 0.12;
            // Main stem
            ctx.fillStyle = "#2a5a2a";
            ctx.beginPath();
            ctx.roundRect(cx + dx - cw / 2, cy + dy - ch, cw, ch, cw / 2);
            ctx.fill();
            // Arms
            if (obsRng() > 0.5) {
              const armY = cy + dy - ch * (0.3 + obsRng() * 0.4);
              const armDir = obsRng() > 0.5 ? 1 : -1;
              ctx.beginPath();
              ctx.moveTo(cx + dx, armY);
              ctx.lineTo(cx + dx + armDir * cw * 3, armY - cw * 2);
              ctx.lineTo(cx + dx + armDir * cw * 4, armY);
              ctx.lineTo(cx + dx, armY + cw);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
        break;
      }
      case "mountain": {
        // Cliff face / scree
        const cliffX = cx - r * 0.4 + obsRng() * r * 0.8;
        const cliffTop = cy - r * 0.5;
        const cliffBottom = cy + r * 0.5;
        // Cliff wall
        ctx.fillStyle = "#5a5a64";
        ctx.beginPath();
        ctx.moveTo(cliffX - r * 0.3, cliffBottom);
        ctx.lineTo(cliffX - r * 0.1, cliffTop);
        ctx.lineTo(cliffX + r * 0.1, cliffTop);
        ctx.lineTo(cliffX + r * 0.3, cliffBottom);
        ctx.closePath();
        ctx.fill();
        // Strata lines
        ctx.strokeStyle = "#4a4a54";
        ctx.lineWidth = 1;
        for (let s = 0; s < 4; s++) {
          const sy = cliffBottom - (cliffBottom - cliffTop) * (s + 1) / 5;
          ctx.beginPath();
          ctx.moveTo(cliffX - r * 0.25, sy);
          ctx.lineTo(cliffX + r * 0.25, sy);
          ctx.stroke();
        }
        // Scree at base
        ctx.fillStyle = "#6a6a74";
        for (let i = 0; i < 6; i++) {
          const sx = cliffX - r * 0.4 + obsRng() * r * 0.8;
          const sy = cliffBottom - obsRng() * r * 0.3;
          const sr = r * (0.04 + obsRng() * 0.04);
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "swamp": {
        // Deep water pool with mangrove roots
        const poolR = r * 0.5;
        // Water
        const waterGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, poolR);
        waterGrad.addColorStop(0, "#2a4a6a");
        waterGrad.addColorStop(0.5, "#1a3a5a");
        waterGrad.addColorStop(1, "#0a2a4a");
        ctx.fillStyle = waterGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, poolR, 0, Math.PI * 2);
        ctx.fill();
        // Water reflection highlight
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.arc(cx - poolR * 0.3, cy - poolR * 0.3, poolR * 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Mangrove roots
        ctx.strokeStyle = "#1a2a1a";
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 + obsRng() * 0.3;
          const rootLen = poolR * (0.8 + obsRng() * 0.4);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * poolR * 0.9, cy + Math.sin(angle) * poolR * 0.9);
          ctx.quadraticCurveTo(
            cx + Math.cos(angle) * poolR * 0.5,
            cy + Math.sin(angle) * poolR * 0.5,
            cx + Math.cos(angle) * rootLen,
            cy + Math.sin(angle) * rootLen
          );
          ctx.stroke();
        }
        break;
      }
      case "snow": {
        // Ice floe / crevasse
        if (obsRng() < 0.5) {
          // Ice floe
          const angle = obsRng() * Math.PI * 2;
          const dist = r * 0.15 * obsRng();
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const floeR = r * (0.25 + obsRng() * 0.2);
          // Ice base
          ctx.fillStyle = "#d0e0f0";
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, floeR, 0, Math.PI * 2);
          ctx.fill();
          // Ice texture
          ctx.strokeStyle = "#a0c0e0";
          ctx.lineWidth = 1;
          for (let c = 0; c < 3; c++) {
            const ca = obsRng() * Math.PI * 2;
            const cr = floeR * (0.2 + obsRng() * 0.5);
            ctx.beginPath();
            ctx.arc(cx + dx + Math.cos(ca) * cr, cy + dy + Math.sin(ca) * cr, floeR * 0.15, 0, Math.PI * 2);
            ctx.stroke();
          }
          // Edge highlight
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, floeR, -Math.PI / 2, Math.PI / 4);
          ctx.stroke();
        } else {
          // Crevasse
          const crevX = cx - r * 0.2 + obsRng() * r * 0.4;
          const crevTop = cy - r * 0.5;
          const crevBottom = cy + r * 0.5;
          // Dark crack
          ctx.fillStyle = "#1a2a4a";
          ctx.beginPath();
          ctx.moveTo(crevX - r * 0.05, crevTop);
          ctx.lineTo(crevX + r * 0.05, crevTop);
          ctx.lineTo(crevX + r * 0.1, crevBottom);
          ctx.lineTo(crevX - r * 0.1, crevBottom);
          ctx.closePath();
          ctx.fill();
          // Ice edges
          ctx.strokeStyle = "#80a0d0";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(crevX - r * 0.05, crevTop);
          ctx.lineTo(crevX - r * 0.05, crevBottom);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(crevX + r * 0.05, crevTop);
          ctx.lineTo(crevX + r * 0.05, crevBottom);
          ctx.stroke();
        }
        break;
      }
      case "water": {
        // Deep water
        const waterGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        waterGrad.addColorStop(0, "#3a6a9a");
        waterGrad.addColorStop(0.5, "#2a5a8a");
        waterGrad.addColorStop(1, "#1a3a5a");
        ctx.fillStyle = waterGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
        // Wave lines
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        for (let w = 0; w < 4; w++) {
          const wy = cy - r * 0.7 + w * r * 0.45 + obsRng() * r * 0.1;
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.7, wy);
          ctx.quadraticCurveTo(cx, wy - r * 0.1, cx + r * 0.7, wy);
          ctx.stroke();
        }
        break;
      }
    }
  }

  void deps;
}


export function paintBattleAttackTargetRing(ctx: CanvasRenderingContext2D, node: BattleAttackTargetRingNode, deps: Paint2DDep): void {
  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
  ctx.strokeStyle = BATTLE_ATTACK_TARGET_STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();
  void deps;
}

export function paintBattleSpellTargetRing(ctx: CanvasRenderingContext2D, node: BattleSpellTargetRingNode, deps: Paint2DDep): void {
  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
  ctx.fillStyle = BATTLE_SPELL_TARGET_FILL;
  ctx.fill();
  ctx.strokeStyle = BATTLE_SPELL_TARGET_STROKE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  void deps;
}

export function paintBattleAiTelegraphHex(ctx: CanvasRenderingContext2D, node: BattleAiTelegraphHexNode, deps: Paint2DDep): void {
  hexPath(ctx, node.world.x, node.world.y, node.hexRadius);
  ctx.fillStyle = BATTLE_AI_TELEGRAPH_FILL;
  ctx.fill();
  ctx.strokeStyle = BATTLE_AI_TELEGRAPH_STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();
  void deps;
}

export function paintBattleMovePath(ctx: CanvasRenderingContext2D, node: BattleMovePathNode, deps: Paint2DDep): void {
  if (node.points.length < 2) return;
  ctx.strokeStyle = BATTLE_MOVE_PATH;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < node.points.length; i++) {
    const p = node.points[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  void deps;
}

export function paintBattleImpactRing(ctx: CanvasRenderingContext2D, node: BattleImpactRingNode, deps: Paint2DDep): void {
  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,190,90,${node.alpha})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  void deps;
}

export function paintBattleAiActingRing(ctx: CanvasRenderingContext2D, node: BattleAiActingRingNode, deps: Paint2DDep): void {
  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
  ctx.strokeStyle = BATTLE_AI_ACTING_RING;
  ctx.lineWidth = 3;
  ctx.stroke();
  void deps;
}

export function paintBattleCombatant(ctx: CanvasRenderingContext2D, node: BattleCombatantNode, deps: Paint2DDep): void {
  // Sprite-first (plan/2026-09-29-arena-unit-sprites.md): resolve the
  // combatant's dominant unit art; on a ready hit, draw it bottom-anchored at
  // the combatant's world point (descriptor anchor "bottom" = feet at the
  // hex's south vertex, the same convention as every other world sprite),
  // mirrored for defenders. On a miss/unready sprite, fall through to the
  // original circle rendering below — byte-identical to pre-sprite output.
  const unitSprite = node.unitTypeId
    ? deps.sprite.resolveSpriteForUnit(node.unitTypeId, node.pose ?? "idle")
    : undefined;
  if (unitSprite && unitSprite.ready) {
    const hexSize = node.hexSize ?? node.radius / 0.55;

    if (node.selected) {
      ctx.beginPath();
      ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
      ctx.strokeStyle = node.side === "attacker" ? BATTLE_COMBATANT_ATTACKER_SELECTED : BATTLE_COMBATANT_DEFENDER_SELECTED;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (node.mirror) {
      ctx.save();
      ctx.translate(node.world.x, node.world.y);
      ctx.scale(-1, 1);
      ctx.translate(-node.world.x, -node.world.y);
      drawWithDescriptor(ctx, unitSprite.drawable, unitSprite.descriptor, node.world.x, node.world.y, hexSize);
      ctx.restore();
    } else {
      drawWithDescriptor(ctx, unitSprite.drawable, unitSprite.descriptor, node.world.x, node.world.y, hexSize);
    }

    ctx.beginPath();
    ctx.arc(node.world.x, node.world.y + hexSize * 0.5, BATTLE_COMBATANT_OWNER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = deps.battleAccent(node.side, "ring");
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(node.radius * 0.7)}px ${deps.fontFamily}`;
    ctx.textAlign = "center";
    ctx.lineWidth = BATTLE_COMBATANT_TEXT_SHADOW_WIDTH;
    ctx.strokeStyle = BATTLE_COMBATANT_TEXT_SHADOW;
    ctx.strokeText(String(node.unitCount), node.world.x, node.world.y + node.radius * 0.14);
    ctx.fillText(String(node.unitCount), node.world.x, node.world.y + node.radius * 0.14);

    const barW = node.radius * 2;
    const barX = node.world.x - barW / 2;
    const barY = node.world.y + node.radius + 3;
    ctx.fillStyle = "#000";
    ctx.fillRect(barX, barY, barW, 4);
    ctx.fillStyle = node.hpRatio > 0.5 ? "#4caf50" : node.hpRatio > 0.25 ? "#ffb300" : "#e53935";
    ctx.fillRect(barX, barY, barW * node.hpRatio, 4);
    return;
  }

  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y, node.radius, 0, Math.PI * 2);
  ctx.fillStyle = node.side === "attacker"
    ? (node.selected ? BATTLE_COMBATANT_ATTACKER_SELECTED : BATTLE_COMBATANT_ATTACKER)
    : (node.selected ? BATTLE_COMBATANT_DEFENDER_SELECTED : BATTLE_COMBATANT_DEFENDER);
  ctx.fill();
  ctx.strokeStyle = BATTLE_COMBATANT_STROKE;
  ctx.lineWidth = node.selected ? 2 : 1;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(node.radius * 0.7)}px ${deps.fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(String(node.unitCount), node.world.x, node.world.y + node.radius * 0.14);

  const barW = node.radius * 2;
  const barX = node.world.x - barW / 2;
  const barY = node.world.y + node.radius + 3;
  ctx.fillStyle = "#000";
  ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = node.hpRatio > 0.5 ? "#4caf50" : node.hpRatio > 0.25 ? "#ffb300" : "#e53935";
  ctx.fillRect(barX, barY, barW * node.hpRatio, 4);
}

export function paintBattleFloatingText(ctx: CanvasRenderingContext2D, node: BattleFloatingTextNode, deps: Paint2DDep): void {
  ctx.font = `700 16px ${deps.fontFamily}`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(0,0,0,${node.alpha * 0.85})`;
  ctx.strokeText(node.text, node.world.x, node.world.y);
  ctx.fillStyle = `rgba(255,214,102,${node.alpha})`;
  ctx.fillText(node.text, node.world.x, node.world.y);
}
