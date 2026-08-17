import type { CityViewSize } from "@heroes/engine";
import { buildingFootprintFromRegistry, pickStyleForBuilding } from "@heroes/engine";
import type { BuildingDef, BuildingKind, GenerationStyle } from "@heroes/contracts";
import { cellOrigin, cellsInDrawOrder, cellToScreen, computeCityScale, TILE_D, TILE_W } from "../../../core/cityGrid";
import type { ResourceType } from "../../../map/resourceTiles";
import type { GameSettings } from "../../../state/settings";
import { BUILDING_STYLE_REGISTRY } from "../../buildingStyles";
import { buildingFootprint } from "../../cityBuildingDraw/primitives";
import type { SceneNode } from "../types";

// Faithful decomposition of cityRenderer.ts's drawCityView()'s per-frame
// "what to draw" decisions. The skybox's actual image loading/caching/layer
// splitting stays a paint2d concern (it's stateful, asset-loading behavior,
// not game data) -- this only resolves the *decision* of which variant/
// parallax settings apply into a CitySkyboxNode for the painter to act on.

const TIER_LABELS: Record<CityViewSize, string> = {
  5: "5\u00d75 Settlement",
  10: "10\u00d710 Town",
  15: "15\u00d715 Castle",
};

const STYLE_LABELS: Record<string, string> = Object.fromEntries(
  BUILDING_STYLE_REGISTRY.map((s) => [s.id, s.label]),
);

export interface CitySceneInput {
  viewportW: number;
  viewportH: number;
  settlementName: string;
  size: CityViewSize;
  hover: { gx: number; gy: number } | null;
  ownerColor?: string;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
  cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>;
  buildings: BuildingDef[];
  style: GenerationStyle;
  pattern: string;
  ghost?: { gx: number; gy: number; kind: BuildingKind; w: number; h: number; valid: boolean } | null;
  selectedKeys?: ReadonlySet<string>;
  citySettings: Pick<
    GameSettings,
    "spriteVariant" | "parallaxEnabled" | "parallaxLayerCount" | "cityBgOffsetX" | "cityBgOffsetY"
  >;
}

export function buildCityScene(input: CitySceneInput): SceneNode[] {
  const {
    viewportW, viewportH, settlementName, size, hover,
    citySpots, cityMines, buildings, style, pattern, ghost, selectedKeys, citySettings,
  } = input;
  const ownerColor = input.ownerColor ?? "#888888";
  const nodes: SceneNode[] = [];

  nodes.push({
    kind: "citySkybox",
    viewportW,
    viewportH,
    spriteVariant: citySettings.spriteVariant,
    parallaxEnabled: citySettings.parallaxEnabled,
    parallaxLayerCount: citySettings.parallaxLayerCount,
    offsetX: citySettings.cityBgOffsetX,
    offsetY: citySettings.cityBgOffsetY,
  });

  const tileScale = computeCityScale(size, viewportW, viewportH);
  const tw = TILE_W * tileScale;
  const td = TILE_D * tileScale;
  const gridVCenter = ((size - 1) * TILE_D) / 2;
  const buildingPad = size * TILE_D * 0.18;
  const screenOrigin = {
    x: viewportW / 2,
    y: viewportH / 2 - (gridVCenter + buildingPad) * tileScale,
  };
  const gridOrigin = cellOrigin(size);
  const cellScreen = (gx: number, gy: number) => {
    const c = cellToScreen(gx, gy, gridOrigin);
    return { x: screenOrigin.x + c.x * tileScale, y: screenOrigin.y + c.y * tileScale };
  };

  for (const cell of cellsInDrawOrder(size)) {
    nodes.push({
      kind: "cityCell",
      gx: cell.gx,
      gy: cell.gy,
      screen: cellScreen(cell.gx, cell.gy),
      halfWidth: tw / 2,
      halfHeight: td / 2,
      hovered: hover !== null && hover.gx === cell.gx && hover.gy === cell.gy,
    });
  }

  const spotMap = new Map(citySpots.map((s) => [`${s.cell.x},${s.cell.y}`, s]));
  const mineMap = new Map(cityMines.map((m) => [`${m.cell.x},${m.cell.y}`, m]));
  for (const cell of cellsInDrawOrder(size)) {
    const key = `${cell.gx},${cell.gy}`;
    const spot = spotMap.get(key);
    if (spot) {
      nodes.push({
        kind: "cityResourceSpot",
        gx: cell.gx,
        gy: cell.gy,
        screen: cellScreen(cell.gx, cell.gy),
        tileWidth: tw,
        tileHeight: td,
        resource: spot.resource,
      });
    }
    const mine = mineMap.get(key);
    if (mine) {
      nodes.push({
        kind: "cityMine",
        gx: cell.gx,
        gy: cell.gy,
        screen: cellScreen(cell.gx, cell.gy),
        tileWidth: tw,
        tileHeight: td,
        resource: mine.resource,
        level: mine.level,
      });
    }
  }

  const orderedBuildings = [...buildings].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  for (const b of orderedBuildings) {
    const fpSize = buildingFootprintFromRegistry(b.kind, b.level);
    const fp = buildingFootprint(b.gx, b.gy, gridOrigin, screenOrigin, tileScale, fpSize.w, fpSize.h);
    nodes.push({
      kind: "cityBuilding",
      gx: b.gx,
      gy: b.gy,
      buildingKind: b.kind,
      level: b.level,
      center: { x: fp.cx, y: fp.cy },
      halfWidth: fp.hw,
      halfHeight: fp.hh,
      ownerColor,
      style: b.style,
      selected: selectedKeys?.has(`${b.gx},${b.gy},${b.kind}`) ?? false,
    });
  }

  if (ghost) {
    const fp = buildingFootprint(ghost.gx, ghost.gy, gridOrigin, screenOrigin, tileScale, ghost.w, ghost.h);
    const ghostStyle = pickStyleForBuilding(ghost.kind, 1, style);
    nodes.push({
      kind: "cityGhostBuilding",
      buildingKind: ghost.kind,
      center: { x: fp.cx, y: fp.cy },
      halfWidth: fp.hw,
      halfHeight: fp.hh,
      ownerColor,
      style: ghostStyle as GenerationStyle,
      valid: ghost.valid,
    });
  }

  nodes.push({ kind: "cityLabel", text: settlementName, x: 12, y: 12, fontPx: 14, alpha: 1 });
  nodes.push({
    kind: "cityLabel",
    text: `${TIER_LABELS[size]}  \u2014  ${STYLE_LABELS[style]}  \u2014  ${pattern}`,
    x: 12,
    y: 30,
    fontPx: 11,
    alpha: 0.7,
  });

  return nodes;
}
