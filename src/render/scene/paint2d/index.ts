// Public Canvas2D painter for the SceneNode[] union produced by
// src/render/scene/sceneBuilder/{adventureScene,cityScene,battleScene}.ts.
//
// This is the dispatcher shell: it switches on node.kind and dispatches to a
// per-kind painter function. Each per-kind painter is currently a stub
// (no-op). The actual per-kind Canvas transcription is a follow-up -- this
// commit only establishes the module tree, the Paint2DDep seam, and the
// dispatcher.
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
  TerrainDecorationNode,
  TerrainHexNode,
  TerritoryOutlineEdgeNode,
  ValidCharterHexNode,
} from "../types";

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
    }
  }
}

// ---- Per-kind stubs ------------------------------------------------------------
// Each function is a no-op. The actual 1:1 Canvas transcription lives in
// follow-up commits; this module only establishes the seam, the dispatcher,
// and the per-kind function signatures that the painters will satisfy.

export function paintTerrainHex(ctx: CanvasRenderingContext2D, node: TerrainHexNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:192-205 (drawHex). Fill from
  // TERRAIN_COLORS[node.terrain] (sourced from @heroes/engine), stroke with
  // a faint edge.
  void ctx;
  void node;
  void deps;
}

export function paintTerrainDecoration(ctx: CanvasRenderingContext2D, node: TerrainDecorationNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:207-262 (drawDecoration). The
  // decoration seed formula at renderer.ts:354 (decorationSeed) classifies
  // each hex by a deterministic Math.sin() hash and draws 0..3 procedural
  // decorations (small triangles/arcs for trees/rocks/etc.).
  void ctx;
  void node;
  void deps;
}

export function paintFogHex(ctx: CanvasRenderingContext2D, node: FogHexNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:154-166 (drawFogHex). Fills with
  // FOG_FILL, no edge stroke.
  void ctx;
  void node;
  void deps;
}

export function paintResourceIcon(ctx: CanvasRenderingContext2D, node: ResourceIconNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/overlays/resourceIcon.ts (which calls
  // sprites.ts:35-46 drawResourceIcon). Needs deps.sprite.resolveSpriteForResource
  // -- the painter never names a key string.
  void ctx;
  void node;
  void deps;
}

export function paintCharterOverlay(ctx: CanvasRenderingContext2D, node: CharterOverlayNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:264-316 (drawCharterOverlays).
  // Phase-conditional stroke/fill + the two small "house" triangles during
  // constructing (renderer.ts:298-313). Style comes from
  // deps.charterStyle(node.phase).
  void ctx;
  void node;
  void deps;
}

export function paintValidCharterHex(ctx: CanvasRenderingContext2D, node: ValidCharterHexNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:318-343 (drawValidCharterHexes).
  // Dashed hex outline + faint fill using deps.validCharterStyle.
  void ctx;
  void node;
  void deps;
}

export function paintCastle(ctx: CanvasRenderingContext2D, node: CastleNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:71-78 (sprite) +
  // src/render/renderer.ts:168-190 (drawCastleBorder). The sprite is
  // resolved via deps.sprite.resolveSpriteForCastle(level, variant); the
  // border uses `node.color` (already baked by the scene builder) and the
  // selected/dashedBorder flags.
  void ctx;
  void node;
  void deps;
}

export function paintTerritoryOutlineEdge(ctx: CanvasRenderingContext2D, node: TerritoryOutlineEdgeNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/overlays/territoryOutline.ts (the edge loop).
  // Line stroke from `(x1,y1)` to `(x2,y2)` using `node.color`, with
  // globalAlpha 0.45 + lineWidth from deps.getTerritoryBorderWidth().
  void ctx;
  void node;
  void deps;
}

export function paintPathSegment(ctx: CanvasRenderingContext2D, node: PathSegmentNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/overlays/pathOverlay.ts:28-56.
  void ctx;
  void node;
  void deps;
}

export function paintHeroTrail(ctx: CanvasRenderingContext2D, node: HeroTrailNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/overlays/pathOverlay.ts:58-87.
  void ctx;
  void node;
  void deps;
}

export function paintHoverHighlight(ctx: CanvasRenderingContext2D, node: HoverHighlightNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:84-94.
  void ctx;
  void node;
  void deps;
}

export function paintHero(ctx: CanvasRenderingContext2D, node: HeroNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/renderer.ts:96-147. Branches on
  // horseVariant === "hero" (procedural knight from src/render/heroSprites.ts,
  // which is leaf-clean) vs. image-horse variant (via
  // deps.sprite.resolveSpriteForHero). After the sprite: a faction color dot
  // at y+22 + a selection ring when node.selected.
  void ctx;
  void node;
  void deps;
}

export function paintCitySkybox(ctx: CanvasRenderingContext2D, node: CitySkyboxNode, deps: Paint2DDep, frame?: Paint2DFrame): void {
  // TODO: Transcribe src/render/cityRenderer.ts:177-242 (drawSkybox). Uses
  // deps.skybox for the loaded image + parallax layers; falls back to the
  // BATTLE_BG fill when deps.skybox is null or the requested variant isn't
  // loaded. Requires `frame` (the painter copies the parallax speed maths
  // from the live code verbatim).
  void ctx;
  void node;
  void deps;
  void frame;
}

export function paintCityCell(ctx: CanvasRenderingContext2D, node: CityCellNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityRenderer.ts:375-409 (drawCell).
  void ctx;
  void node;
  void deps;
}

export function paintCityResourceSpot(ctx: CanvasRenderingContext2D, node: CityResourceSpotNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityBuildingDraw/spots.ts:7-40 (drawSpot).
  // Pulled in inline here because that leaf file imports resourceStyleKey
  // from assetDescriptors.ts -- the Vite seam forbids it.
  void ctx;
  void node;
  void deps;
}

export function paintCityMine(ctx: CanvasRenderingContext2D, node: CityMineNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityBuildingDraw/spots.ts:42-91 (drawMine).
  void ctx;
  void node;
  void deps;
}

export function paintCityBuilding(ctx: CanvasRenderingContext2D, node: CityBuildingNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityBuildingDraw.ts (1392 lines). The
  // painter's local BuildingCache lives at src/render/scene/paint2d/city/
  // buildingCache.ts (forthcoming). Style leaves are imported directly
  // (cityBuildingDraw/{classic,blocky,crystalline,organic,industrial}.ts --
  // leaf-clean, verified).
  void ctx;
  void node;
  void deps;
}

export function paintCityGhostBuilding(ctx: CanvasRenderingContext2D, node: CityGhostBuildingNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityRenderer.ts:350-360 (ghost building).
  void ctx;
  void node;
  void deps;
}

export function paintCityLabel(ctx: CanvasRenderingContext2D, node: CityLabelNode, deps: Paint2DDep): void {
  // TODO: Transcribe src/render/cityRenderer.ts:362-370 (text).
  void ctx;
  void node;
  void deps;
}

export function paintBattleHex(ctx: CanvasRenderingContext2D, node: BattleHexNode, deps: Paint2DDep): void {
  // TODO: Transcribe the hex loop at manualBattleArena.ts:1512-1526.
  void ctx;
  void node;
  void deps;
}

export function paintBattleAttackTargetRing(ctx: CanvasRenderingContext2D, node: BattleAttackTargetRingNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1528-1535.
  void ctx;
  void node;
  void deps;
}

export function paintBattleAiTelegraphHex(ctx: CanvasRenderingContext2D, node: BattleAiTelegraphHexNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1541-1552.
  void ctx;
  void node;
  void deps;
}

export function paintBattleMovePath(ctx: CanvasRenderingContext2D, node: BattleMovePathNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1556-1566.
  void ctx;
  void node;
  void deps;
}

export function paintBattleImpactRing(ctx: CanvasRenderingContext2D, node: BattleImpactRingNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1569-1577.
  void ctx;
  void node;
  void deps;
}

export function paintBattleAiActingRing(ctx: CanvasRenderingContext2D, node: BattleAiActingRingNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1582-1592.
  void ctx;
  void node;
  void deps;
}

export function paintBattleCombatant(ctx: CanvasRenderingContext2D, node: BattleCombatantNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1594-1622.
  void ctx;
  void node;
  void deps;
}

export function paintBattleFloatingText(ctx: CanvasRenderingContext2D, node: BattleFloatingTextNode, deps: Paint2DDep): void {
  // TODO: Transcribe manualBattleArena.ts:1627-1638.
  void ctx;
  void node;
  void deps;
}
