import type { Terrain } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import type { Faction, HeroDirection } from "../../entities/hero";
import type { HorseVariant } from "../../state/settings";
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase, GenerationStyle } from "@heroes/contracts";
import type { BattleSide } from "@heroes/engine";

/** World-space pixel coordinates (pre-Camera-transform), same space axialToPixel() returns. */
export interface WorldPoint {
  x: number;
  y: number;
}

export type SceneNode =
  | TerrainHexNode
  | TerrainDecorationNode
  | FogHexNode
  | ResourceIconNode
  | CharterOverlayNode
  | ValidCharterHexNode
  | CastleNode
  | TerritoryOutlineEdgeNode
  | PathSegmentNode
  | HeroTrailNode
  | HoverHighlightNode
  | SelectedTileHighlightNode
  | HeroNode
  | CitySkyboxNode
  | CityCellNode
  | CityResourceSpotNode
  | CityMineNode
  | CityBuildingNode
  | CityGhostBuildingNode
  | CityLabelNode
  | BattleHexNode
  | BattleAttackTargetRingNode
  | BattleAiTelegraphHexNode
  | BattleMovePathNode
  | BattleImpactRingNode
  | BattleAiActingRingNode
  | BattleCombatantNode
  | BattleFloatingTextNode;

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

export interface FogHexNode {
  kind: "fogHex";
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
  ownerId: number | null;
  selected: boolean;
  color: string;
  dashedBorder: boolean;
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
}

export interface HeroTrailNode {
  kind: "heroTrail";
  heroId: string;
  color: string;
  points: WorldPoint[];
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
  world: WorldPoint;
  facingDirection: HeroDirection;
  horseVariant: HorseVariant;
  faction: Faction;
  scaleY: number;
  color: string;
  selected: boolean;
}

// City-view node kinds. `screen`/`center` coordinates below are the same
// pre-camera "world" pixel space as cityRenderer.ts's screenOrigin-relative
// math (city view has no Camera -- it's drawn straight into the canvas --
// but they reuse WorldPoint since it's the same plain {x,y} shape).

export interface CitySkyboxNode {
  kind: "citySkybox";
  viewportW: number;
  viewportH: number;
  spriteVariant: number;
  parallaxEnabled: boolean;
  parallaxLayerCount: number;
  offsetX: number;
  offsetY: number;
}

export interface CityCellNode {
  kind: "cityCell";
  gx: number;
  gy: number;
  screen: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  hovered: boolean;
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
  style: GenerationStyle;
  selected: boolean;
}

export interface CityGhostBuildingNode {
  kind: "cityGhostBuilding";
  buildingKind: BuildingKind;
  center: WorldPoint;
  halfWidth: number;
  halfHeight: number;
  ownerColor: string;
  style: GenerationStyle;
  valid: boolean;
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
}

export interface BattleFloatingTextNode {
  kind: "battleFloatingText";
  text: string;
  world: WorldPoint;
  alpha: number;
}
