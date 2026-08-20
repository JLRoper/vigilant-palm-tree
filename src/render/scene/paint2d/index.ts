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

import type { Paint2DDep } from "./deps";
import {
  hexPath,
} from "./geometry";
import { decorationSeed } from "../../decorationSeed";
import { TERRAIN_COLORS } from "../../../map/terrain";
import { drawKnightSprite, drawDemonSprite } from "../../heroSprites";
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
  CastleNode,
  CharterOverlayNode,
  CityBuildingNode,
  CityCellNode,
  CityGhostBuildingNode,
  CityLabelNode,
  CityMineNode,
  CityResourceSpotNode,
  CitySkyboxNode,
  FogHexNode,
  HeroNode,
  HeroTrailNode,
  HoverHighlightNode,
  PathSegmentNode,
  ResourceIconNode,
  SceneNode,
  SelectedTileHighlightNode,
  TerrainDecorationNode,
  TerrainHexNode,
  TerritoryOutlineEdgeNode,
  ValidCharterHexNode,
} from "../types";

// Live-copied colour constants. The painter classes under `src/render/painter/`
// (PR #122) already use these -- the paint2d transcription emit must match
// their output byte-for-byte. The painter project lives here, not in the
// forbidden Vite-?url-coupled set, so these literals are the source of truth.
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
const CITY_CELL_FILL = "#2a2438";
const CITY_CELL_STROKE = "#3a3450";
const CITY_HOVER_STROKE = "#ffcc00";
const CITY_TEXT = "#ffffff";

const BATTLE_HEX_FILL = "#20242c";
const BATTLE_HEX_IMPASSABLE = "#3a2a2a";
const BATTLE_HEX_IN_RANGE = "rgba(210,210,215,0.35)";
const BATTLE_HEX_STROKE = "rgba(255,255,255,0.08)";
const BATTLE_HEX_AVAILABLE_STROKE = "rgba(255,214,102,0.9)";
const BATTLE_ATTACK_TARGET_STROKE = "#e05050";
const BATTLE_AI_TELEGRAPH_FILL = "rgba(224,80,80,0.22)";
const BATTLE_AI_TELEGRAPH_STROKE = "rgba(255,120,120,0.95)";
const BATTLE_MOVE_PATH = "rgba(255,255,255,0.28)";
const BATTLE_AI_ACTING_RING = "#ffffff";
const BATTLE_COMBATANT_ATTACKER = "#3070c0";
const BATTLE_COMBATANT_ATTACKER_SELECTED = "#5fb0ff";
const BATTLE_COMBATANT_DEFENDER = "#c04040";
const BATTLE_COMBATANT_DEFENDER_SELECTED = "#ff7a7a";
const BATTLE_COMBATANT_STROKE = "#fff";

type Drawable = HTMLImageElement | HTMLCanvasElement;

interface SpriteDescriptor {
  anchor: "bottom" | "center";
  anchorOffsetY?: number;
  sizing:
    | { kind: "abs"; size: number }
    | { kind: "fitHeight"; hexSizeMul: number }
    | { kind: "fitWidth"; hexSizeMul: number };
}

function drawWithDescriptor(
  ctx: CanvasRenderingContext2D,
  drawable: Drawable,
  desc: SpriteDescriptor,
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
  for (const node of nodes) {
    switch (node.kind) {
      case "terrainHex":
        paintTerrainHex(ctx, node, deps);
        break;
      case "terrainDecoration":
        paintTerrainDecoration(ctx, node, deps);
        break;
      case "fogHex":
        paintFogHex(ctx, node, deps);
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
      case "territoryOutlineEdge":
        paintTerritoryOutlineEdge(ctx, node, deps);
        break;
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
      case "cityBuilding":
        paintCityBuilding(ctx, node, deps);
        break;
      case "cityGhostBuilding":
        paintCityGhostBuilding(ctx, node, deps);
        break;
      case "cityLabel":
        paintCityLabel(ctx, node, deps);
        break;
      case "battleHex":
        paintBattleHex(ctx, node, deps);
        break;
      case "battleAttackTargetRing":
        paintBattleAttackTargetRing(ctx, node, deps);
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

export function paintTerrainDecoration(ctx: CanvasRenderingContext2D, node: TerrainDecorationNode, deps: Paint2DDep): void {
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

export function paintResourceIcon(ctx: CanvasRenderingContext2D, node: ResourceIconNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForResource(node.resource);
  if (!r || !r.ready) return;
  ctx.imageSmoothingEnabled = false;
  drawWithDescriptor(ctx, r.drawable as Drawable, r.descriptor as unknown as SpriteDescriptor, node.world.x, node.world.y, 32);
}

export function paintCastle(ctx: CanvasRenderingContext2D, node: CastleNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForCastle(node.level, node.variant);
  if (r && r.ready) {
    drawWithDescriptor(ctx, r.drawable as Drawable, r.descriptor as unknown as SpriteDescriptor, node.world.x, node.world.y, 32);
  }
  const { x: cx, y: cy } = node.world;
  const radius = node.selected ? 32 * 1.05 : 32 * 0.95;
  ctx.beginPath();
  ctx.arc(cx, cy + 32 * 0.55, radius, 0, Math.PI * 2);
  if (node.dashedBorder) {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.setLineDash([4, 4]);
  } else {
    ctx.strokeStyle = node.color;
    ctx.setLineDash([]);
  }
  ctx.lineWidth = node.selected ? 3 : 2;
  ctx.stroke();
  ctx.setLineDash([]);
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
    const innerSize = 32 * 0.5;
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
  ctx.save();
  ctx.strokeStyle = node.color;
  ctx.lineWidth = deps.getTerritoryBorderWidth();
  ctx.globalAlpha = 0.45;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(node.x1, node.y1);
  ctx.lineTo(node.x2, node.y2);
  ctx.stroke();
  ctx.restore();
}

export function paintPathSegment(ctx: CanvasRenderingContext2D, node: PathSegmentNode, deps: Paint2DDep): void {
  if (node.points.length < 2) return;
  const color = node.reachable ? "rgba(255, 204, 0, 0.85)" : "rgba(255, 204, 0, 0.30)";
  ctx.lineWidth = node.reachable ? 4 : 3;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < node.points.length; i++) {
    const p = node.points[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  const dotRadius = node.reachable ? 6 : 4;
  const alpha = color.replace(/[\d.]+\)$/, "0.5)");
  ctx.fillStyle = alpha;
  for (let i = 1; i < node.points.length - 1; i++) {
    const p = node.points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  void deps;
}

export function paintHeroTrail(ctx: CanvasRenderingContext2D, node: HeroTrailNode, deps: Paint2DDep): void {
  if (node.points.length < 2) return;
  const color = node.color;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let i = 1; i < node.points.length; i++) {
    const p = node.points[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < node.points.length; i++) {
    const p = node.points[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
  void deps;
}

export function paintHoverHighlight(ctx: CanvasRenderingContext2D, node: HoverHighlightNode, deps: Paint2DDep): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = HOVER_STROKE;
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  void deps;
}

export function paintSelectedTileHighlight(ctx: CanvasRenderingContext2D, node: SelectedTileHighlightNode, deps: Paint2DDep): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = SELECTED_TILE_STROKE;
  ctx.setLineDash([4, 3]);
  hexPath(ctx, node.world.x, node.world.y);
  ctx.stroke();
  ctx.setLineDash([]);
  void deps;
}

export function paintHero(ctx: CanvasRenderingContext2D, node: HeroNode, deps: Paint2DDep): void {
  const variant = node.horseVariant;
  const needsScale = Math.abs(node.scaleY - 1.0) > 1e-6;
  if (needsScale) {
    const anchorY = node.world.y + 32 * 0.5;
    ctx.save();
    ctx.translate(node.world.x, anchorY);
    ctx.scale(1, node.scaleY);
    ctx.translate(-node.world.x, -anchorY);
  }
  if (variant === "hero") {
    const r = deps.sprite.resolveSpriteForHero(node.faction, node.facingDirection, variant);
    if (r && r.ready) {
      drawWithDescriptor(ctx, r.drawable as Drawable, r.descriptor as unknown as SpriteDescriptor, node.world.x, node.world.y, 32);
    } else {
      const drawer = node.faction === "player" ? drawKnightSprite : drawDemonSprite;
      drawer(ctx, 32);
    }
  } else {
    const r = deps.sprite.resolveSpriteForHero(node.faction, node.facingDirection, variant);
    if (r && r.ready) {
      drawWithDescriptor(ctx, r.drawable as Drawable, r.descriptor as unknown as SpriteDescriptor, node.world.x, node.world.y, 32);
    }
  }
  if (needsScale) ctx.restore();

  ctx.fillStyle = node.color;
  ctx.beginPath();
  ctx.arc(node.world.x, node.world.y + OWNER_DOT_OFFSET_Y, OWNER_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (node.selected) {
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(node.world.x, node.world.y, SELECTED_HERO_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function paintCitySkybox(ctx: CanvasRenderingContext2D, node: CitySkyboxNode, deps: Paint2DDep, frame?: Paint2DFrame): void {
  if (!frame) return;
  const { viewportW, viewportH, spriteVariant, parallaxEnabled, parallaxLayerCount, offsetX, offsetY } = node;
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
  const { x, y } = node.screen;
  const hw = node.halfWidth;
  const hh = node.halfHeight;
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
  ctx.fillStyle = CITY_CELL_FILL;
  ctx.fill();
  if (node.hovered) {
    ctx.strokeStyle = CITY_HOVER_STROKE;
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = CITY_CELL_STROKE;
    ctx.lineWidth = 1;
  }
  ctx.stroke();
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

export function paintCityBuilding(ctx: CanvasRenderingContext2D, node: CityBuildingNode, deps: Paint2DDep): void {
  const r = deps.sprite.resolveSpriteForBuilding(node.style, node.buildingKind, node.level);
  if (r && r.ready) {
    drawWithDescriptor(ctx, r.drawable as Drawable, r.descriptor as unknown as SpriteDescriptor, node.center.x, node.center.y, 32);
  }
  if (node.selected) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#66ccff";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(node.center.x - node.halfWidth, node.center.y - node.halfHeight, node.halfWidth * 2, node.halfHeight * 2);
    ctx.restore();
  }
}

export function paintCityGhostBuilding(ctx: CanvasRenderingContext2D, node: CityGhostBuildingNode, deps: Paint2DDep): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = node.valid ? "#44ff44" : "#ff4444";
  ctx.lineWidth = 3;
  ctx.strokeRect(node.center.x - node.halfWidth, node.center.y - node.halfHeight, node.halfWidth * 2, node.halfHeight * 2);
  ctx.restore();
  void deps;
}

export function paintCityLabel(ctx: CanvasRenderingContext2D, node: CityLabelNode, deps: Paint2DDep): void {
  ctx.save();
  ctx.globalAlpha = node.alpha;
  ctx.fillStyle = CITY_TEXT;
  ctx.font = `${node.fontPx}px ${deps.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.fillText(node.text, node.x, node.y);
  ctx.restore();
}

export function paintBattleHex(ctx: CanvasRenderingContext2D, node: BattleHexNode, deps: Paint2DDep): void {
  hexPath(ctx, node.world.x, node.world.y, node.hexRadius);
  ctx.fillStyle = node.impassable
    ? BATTLE_HEX_IMPASSABLE
    : node.inMoveRange
      ? BATTLE_HEX_IN_RANGE
      : BATTLE_HEX_FILL;
  ctx.fill();
  ctx.strokeStyle = node.available ? BATTLE_HEX_AVAILABLE_STROKE : BATTLE_HEX_STROKE;
  ctx.lineWidth = node.available ? 2 : 1;
  ctx.stroke();
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
