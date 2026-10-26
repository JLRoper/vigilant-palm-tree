import type { Terrain } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import type { Faction, HeroDirection } from "../../entities/hero";
import type { HorseVariant } from "../../state/settings";
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase } from "@heroes/contracts";
import type { BattleSide, CityBackdropSignature, CityViewSize } from "@heroes/engine";

/** World-space pixel coordinates (pre-Camera-transform), same space axialToPixel() returns. */
export interface WorldPoint {
  x: number;
  y: number;
}

export type SceneNode =
  | TerrainHexNode
  | TerrainDecorationNode
  | RiverHexNode
  | FogHexNode
  | UnchartedHexNode
  | ResourceIconNode
  | CharterOverlayNode
  | ValidCharterHexNode
  | CastleNode
  | DistrictNode
  | TerritoryOutlineEdgeNode
  | PathSegmentNode
  | HeroTrailNode
  | HoverHighlightNode
  | SelectedTileHighlightNode
  | CaravanMarkerNode
  | CaravanRouteNode
  | HeroNode
  | CitySkyboxNode
  | CityCellNode
  | CityResourceSpotNode
  | CityMineNode
  | CityBuildingNode
  | CityGhostBuildingNode
  | CityPersonNode
  | CityLabelNode
  | BattleHexNode
  | BattleAttackTargetRingNode
  | BattleSpellTargetRingNode
  | BattleAiTelegraphHexNode
  | BattleMovePathNode
  | BattleImpactRingNode
  | BattleAiActingRingNode
  | BattleCombatantNode
  | BattleFloatingTextNode
  | BattleBiomeBackgroundNode;

export interface TerrainHexNode {
  kind: "terrainHex";
  q: number;
  r: number;
  world: WorldPoint;
  terrain: Terrain;
}

export interface TerrainDecorationNode {
  kind: "terrainDecoration";
  q: number;
  r: number;
  world: WorldPoint;
  terrain: Terrain;
}

export interface RiverHexNode {
  kind: "riverHex";
  q: number;
  r: number;
  world: WorldPoint;
  size: "small" | "wide";
  /** Bitmask of the six neighbour directions that are also river cells. */
  mask: number;
  bridge?: boolean;
  /**
   * Endpoint pass-throughs only: the direction of the water-facing exit the
   * end cell pours into. The painter draws a short mouth wedge there so the
   * band melts into a body of water instead of stopping at the rim with a
   * hard bank line.
   */
  mouthDir?: number;
}

export interface FogHexNode {
  kind: "fogHex";
  q: number;
  r: number;
  world: WorldPoint;
}

export interface UnchartedHexNode {
  kind: "unchartedHex";
  q: number;
  r: number;
  world: WorldPoint;
}

export interface ResourceIconNode {
  kind: "resourceIcon";
  q: number;
  r: number;
  world: WorldPoint;
  resource: ResourceType;
}

/** Trade-route caravan marker (docs/wagons-stockpiles-trade-routes-plan.md §5.2). */
export interface CaravanMarkerNode {
  kind: "caravanMarker";
  q: number;
  r: number;
  world: WorldPoint;
  markerWorld?: WorldPoint;
  color: string;
  wagons: number;
  payloadKind?: "resource" | "gold";
  facingDirection?: HeroDirection;
  /** Set while the tile is under the pointer, so the painter can ring the cart. */
  hovered?: boolean;
}

/** The hovered own-seat caravan's remaining current-leg route, drawn under the marker layer. */
export interface CaravanRouteNode {
  kind: "caravanRoute";
  routeId: string;
  color: string;
  payloadKind?: "resource" | "gold";
  points: WorldPoint[];
}

export interface CharterOverlayNode {
  kind: "charterOverlay";
  q: number;
  r: number;
  world: WorldPoint;
  phase: CharterPhase;
}

export interface ValidCharterHexNode {
  kind: "validCharterHex";
  q: number;
  r: number;
  world: WorldPoint;
}

export interface CastleNode {
  kind: "castle";
  settlementId: string;
  world: WorldPoint;
  level: CastleLevel;
  variant: CastleVariant;
  fullness?: 1 | 2 | 3 | 4 | 5;
  ownerId: number | null;
  selected: boolean;
  color: string;
  dashedBorder: boolean;
}

export interface DistrictNode {
  kind: "district";
  settlementId: string;
  ownerId: number | null;
  q: number;
  r: number;
  world: WorldPoint;
  tier: 1 | 2 | 3;
  variant: "standard" | "farm";
  color: string;
  blocked?: boolean;
}

export interface TerritoryOutlineEdgeNode {
  kind: "territoryOutlineEdge";
  ownerId: number;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PathSegmentNode {
  kind: "pathSegment";
  reachable: boolean;
  points: WorldPoint[];
  /** Set when any tile this segment spans is under fog of war; the painter brightens the dim gold and adds a dark under-stroke so the path reads against the fog overlay. */
  fogged?: boolean;
}

export interface HeroTrailNode {
  kind: "heroTrail";
  heroId: string;
  color: string;
  points: WorldPoint[];
  /** Alpha multiplier for the whole trail; absent = 1. Enemy heroes' trails carry a dimmer value than the viewer's own. */
  intensity?: number;
}

export interface HoverHighlightNode {
  kind: "hoverHighlight";
  q: number;
  r: number;
  world: WorldPoint;
}

export interface SelectedTileHighlightNode {
  kind: "selectedTileHighlight";
  q: number;
  r: number;
  world: WorldPoint;
}

export interface HeroNode {
  kind: "hero";
  heroId: string;
  ownerId: number;
  /** Sprite anchor: tile centre + pixelOffset + the walk-cycle bob. */
  world: WorldPoint;
  /** Owner-dot / selection-ring anchor: tile centre + pixelOffset, no bob. The
   * pre-cutover HeroPainter deliberately left both markers still while the
   * sprite bobbed, so they need their own anchor rather than reusing `world`. */
  markerWorld: WorldPoint;
  facingDirection: HeroDirection;
  horseVariant: HorseVariant;
  faction: Faction;
  scaleY: number;
  /** Which run-cycle pose to draw while moving; absent/0 = base sprite. Derived from moveProgress by the scene builder. */
  runFrame?: 0 | 1;
  /**
   * Settlers mode's covered wagon (SETTLERS-PLAN.md §4 W4): a hero-shaped
   * entity that is not a hero. Derived by the scene builder from the entity id
   * (`p<seat>-wagon`, contracts' isCoveredWagonId), never stored on the entity
   * -- the mode may not add a column, and an id is what survives a reload.
   * Absent on every recruited hero and on every classic game.
   */
  wagon?: true;
  color: string;
  selected: boolean;
  /** Fade-in alpha for a non-own hero newly revealed from fog; absent = 1. */
  alpha?: number;
}

// City-view node kinds. `screen`/`center` coordinates below are the same
// pre-camera "world" pixel space as cityRenderer.ts's screenOrigin-relative
// math (city view has no Camera -- it's drawn straight into the canvas --
// but they reuse WorldPoint since it's the same plain {x,y} shape).

export interface CityGridFootprint {
  halfWidth: number;
  halfHeight: number;
  centerX: number;
  centerY: number;
}

export interface CitySkyboxNode {
  kind: "citySkybox";
  viewportW: number;
  viewportH: number;
  spriteVariant: number;
  parallaxEnabled: boolean;
  parallaxLayerCount: number;
  offsetX: number;
  offsetY: number;
  backdrop?: CityBackdropSignature | null;
  backdropMode?: "diorama" | "skybox";
  /** City tier (5/10/15); the diorama plate grows with the grid so large tiers keep a visible border. */
  citySize?: CityViewSize;
  /** Screen-space extent of the isometric grid; the diorama plate and its calm centre are sized from it. */
  gridFootprint?: CityGridFootprint;
}

export interface CityCellNode {
  kind: "cityCell";
  gx: number;
  gy: number;
  screen: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  hovered: boolean;
  /** Set while the build placer is active and the pending building can be placed here; the painter adds a subtle tint so free cells are scannable. */
  buildable?: boolean;
  /** Draw this cell's diamond outline. The floor is always transparent. */
  gridLines: boolean;
}

export interface CityResourceSpotNode {
  kind: "cityResourceSpot";
  gx: number;
  gy: number;
  screen: WorldPoint;
  tileWidth: number;
  tileHeight: number;
  resource: ResourceType;
}

export interface CityMineNode {
  kind: "cityMine";
  gx: number;
  gy: number;
  screen: WorldPoint;
  tileWidth: number;
  tileHeight: number;
  resource: ResourceType;
  level: number;
}

export interface CityBuildingNode {
  kind: "cityBuilding";
  gx: number;
  gy: number;
  buildingKind: BuildingKind;
  level: number;
  center: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  ownerColor: string;
  /** Farm plots only: the deterministic pixel vs pixel-alt art pick (farmFieldStyleAt at scene-build time). Absent for every other kind. */
  farmStyle?: "pixel" | "pixel-alt";
  /**
   * Farm plots only: the exact sprite key the plot draws — one of the committed
   * farm-plot variants (farmPlotVariantAt), or the `?farm=` style when a reviewer
   * forces one. Overrides the legacy `farmStyle` pick.
   */
  farmSpriteKey?: string;
  selected: boolean;
  /** Set while the building's upgrade is in flight; the painter swaps the real sprite for a shared construction-stage sprite. */
  constructionStage?: 1 | 2 | 3;
}

export interface CityGhostBuildingNode {
  kind: "cityGhostBuilding";
  buildingKind: BuildingKind;
  center: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  ownerColor: string;
  valid: boolean;
  /** Why the footprint is refused, in words, drawn under it when it is invalid. */
  reason?: string | null;
}

/** Staffed-building person cluster. `center` is the front-bottom anchor of the
 * building footprint (center.y + halfHeight*0.55); the painter draws `count`
 * persons bottom-anchored on it. */
export interface CityPersonNode {
  kind: "cityPerson";
  gx: number;
  gy: number;
  center: WorldPoint;
  count: number;
}

export interface CityLabelNode {
  kind: "cityLabel";
  text: string;
  x: number;
  y: number;
  fontPx: number;
  alpha: number;
}

// Battle-view node kinds, decomposed from src/screens/combat/
// manualBattleArena.ts's draw()/renderPixelFor(). `hexRadius`/`radius` below
// are fully resolved pixel values (hexSize already multiplied in), matching
// how CityCellNode/CityBuildingNode resolve halfWidth/halfHeight rather than
// leaving a scale factor for the painter -- this scene has no shared Camera
// to apply a zoom later, so hexSize has to be baked in per node instead.

export interface BattleHexNode {
  kind: "battleHex";
  q: number;
  r: number;
  world: WorldPoint;
  hexRadius: number;
  impassable: boolean;
  inMoveRange: boolean;
  available: boolean;
}

export interface BattleAttackTargetRingNode {
  kind: "battleAttackTargetRing";
  side: BattleSide;
  slotIndex: number;
  world: WorldPoint;
  radius: number;
}

// Cast-mode spell target highlight — the violet third ring style (red =
// attack, gold outline = unacted, violet = spell target). Mirrors the legacy
// drawLegacy() castTargets loop in openManualBattleArena.ts.
export interface BattleSpellTargetRingNode {
  kind: "battleSpellTargetRing";
  side: BattleSide;
  slotIndex: number;
  world: WorldPoint;
  radius: number;
}

export interface BattleAiTelegraphHexNode {
  kind: "battleAiTelegraphHex";
  q: number;
  r: number;
  world: WorldPoint;
  hexRadius: number;
}

export interface BattleMovePathNode {
  kind: "battleMovePath";
  side: BattleSide;
  slotIndex: number;
  points: WorldPoint[];
}

export interface BattleImpactRingNode {
  kind: "battleImpactRing";
  world: WorldPoint;
  radius: number;
  alpha: number;
}

export interface BattleAiActingRingNode {
  kind: "battleAiActingRing";
  side: BattleSide;
  slotIndex: number;
  world: WorldPoint;
  radius: number;
}

export interface BattleCombatantNode {
  kind: "battleCombatant";
  side: BattleSide;
  slotIndex: number;
  world: WorldPoint;
  radius: number;
  selected: boolean;
  unitCount: number;
  hpRatio: number;
  // Optional additive unit-sprite fields (plan/2026-09-29-arena-unit-sprites.md).
  // Absent unitTypeId (or a resolver miss) keeps the painter on its original
  // circle rendering; `pose` defaults to "idle" painter-side; `mirror` is set
  // for defenders because the art is authored facing right once. `hexSize` is
  // the arena hex size the node was built with — carried explicitly rather
  // than re-derived from radius (radius = 0.55 × hexSize) so the sprite draw
  // reads the same number the builder used for every other node.
  unitTypeId?: string;
  pose?: "idle" | "attack" | "move";
  mirror?: boolean;
  hexSize?: number;
}

export interface BattleFloatingTextNode {
  kind: "battleFloatingText";
  text: string;
  world: WorldPoint;
  alpha: number;
}

export interface BattleBiomeBackgroundNode {
  kind: "battleBiomeBackground";
  biome: Terrain;
  world: WorldPoint;
  hexRadius: number;
  seed: number;
  variant: number;
  impassable: boolean;
}
