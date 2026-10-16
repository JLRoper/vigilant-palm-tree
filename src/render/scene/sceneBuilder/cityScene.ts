import type { CityViewSize } from "@heroes/engine";
import { buildingConstructionProgress, buildingFootprintFromRegistry, constructionStageFor, farmFieldStyleAt, upgradeProgress, upgradeRefs } from "@heroes/engine";
import type { BuildingDef, BuildingKind, UpgradeState } from "@heroes/contracts";
import { buildingFootprint, cellsInDrawOrder, cellToScreen, cityLayout } from "../../../core/cityGrid";
import type { ResourceType } from "../../../map/resourceTiles";
import type { GameSettings } from "../../../state/settings";
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
  ghost?: { gx: number; gy: number; kind: BuildingKind; w: number; h: number; valid: boolean } | null;
  selectedKeys?: ReadonlySet<string>;
  /** CSS px top overlay inset (fixed toolbar height); the grid fits below `topInset + CITY_VIEW_MARGIN`. */
  topInset?: number;
  /** CSS px to shift the two corner labels down by (the fixed toolbar overlays the canvas top; render must not measure it itself). */
  labelOffsetY?: number;
  /** Cells (keys `"gx,gy"`) the active build placer can accept a building on; flagged on the matching cityCell nodes for the tint paint. */
  buildableCells?: ReadonlySet<string>;
  citySettings: Pick<
    GameSettings,
    "spriteVariant" | "parallaxEnabled" | "parallaxLayerCount" | "cityBgOffsetX" | "cityBgOffsetY"
  >;

  /** The settlement's single in-flight upgrade, if any; targeted buildings render construction-stage sprites. */
  upgrades?: UpgradeState;
}

export function buildCityScene(input: CitySceneInput): SceneNode[] {
  const {
    viewportW, viewportH, settlementName, size, hover,
    citySpots, cityMines, buildings, ghost, selectedKeys, citySettings,
    upgrades, labelOffsetY, buildableCells, topInset,
  } = input;
  const ownerColor = input.ownerColor ?? "#888888";
  const labelY = labelOffsetY ?? 0;
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

  const { tileScale, tw, td, gridOrigin, screenOrigin } = cityLayout(size, viewportW, viewportH, topInset ?? 0);
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
      buildable: buildableCells?.has(`${cell.gx},${cell.gy}`) ?? false,
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
  const constructionStages = (() => {
    if (!upgrades || upgrades.kind === "settlement") return null;
    const stage = constructionStageFor(upgradeProgress(upgrades));
    const map = new Map<string, 1 | 2 | 3>();
    if (upgrades.kind === "townHall") {
      for (const b of orderedBuildings) {
        if (b.kind === "townHall") map.set(`${b.gx},${b.gy},${b.kind}`, stage);
      }
    } else {
      for (const ref of upgradeRefs(upgrades)) map.set(`${ref.gx},${ref.gy},${ref.kind}`, stage);
    }
    return map;
  })();
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
      ...(b.kind === "farmField"
        ? { farmStyle: farmFieldStyleAt(settlementName, b.gx, b.gy) as "pixel" | "pixel-alt" }
        : {}),
      selected: selectedKeys?.has(`${b.gx},${b.gy},${b.kind}`) ?? false,
      constructionStage: b.construction
        ? constructionStageFor(buildingConstructionProgress(b))
        : constructionStages?.get(`${b.gx},${b.gy},${b.kind}`),
    });
  }

  if (ghost) {
    const fp = buildingFootprint(ghost.gx, ghost.gy, gridOrigin, screenOrigin, tileScale, ghost.w, ghost.h);
    nodes.push({
      kind: "cityGhostBuilding",
      buildingKind: ghost.kind,
      center: { x: fp.cx, y: fp.cy },
      halfWidth: fp.hw,
      halfHeight: fp.hh,
      ownerColor,
      valid: ghost.valid,
    });
  }

  nodes.push({ kind: "cityLabel", text: settlementName, x: 12, y: 12 + labelY, fontPx: 14, alpha: 1 });
  nodes.push({
    kind: "cityLabel",
    text: TIER_LABELS[size],
    x: 12,
    y: 30 + labelY,
    fontPx: 11,
    alpha: 0.7,
  });

  return nodes;
}
