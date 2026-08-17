import type { Terrain } from "../../map/terrain";
import type { ResourceType } from "../../map/resourceTiles";
import type { Faction, HeroDirection } from "../../entities/hero";
import type { HorseVariant } from "../../state/settings";
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase, GenerationStyle } from "@heroes/contracts";

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
  | HeroNode
  | CitySkyboxNode
  | CityCellNode
  | CityResourceSpotNode
  | CityMineNode
  | CityBuildingNode
  | CityGhostBuildingNode
  | CityLabelNode;

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
