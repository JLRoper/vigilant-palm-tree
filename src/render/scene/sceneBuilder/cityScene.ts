import type { CityBackdropSignature, CityViewSize } from "@heroes/engine";
import { buildingConstructionProgress, buildingFootprintFromRegistry, buildingMaxWorkers, constructionStageFor, farmFieldStyleAt, farmPlotVariantAt, upgradeProgress, upgradeRefs } from "@heroes/engine";
import type { BuildingDef, BuildingKind, UpgradeState } from "@heroes/contracts";
import { buildingFootprint, cellsInDrawOrder, cellToScreen, cityLayout } from "../../../core/cityGrid";
import type { ResourceType } from "../../../map/resourceTiles";
import type { GameSettings } from "../../../state/settings";
import type { CitySkyboxNode, SceneNode } from "../types";

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
  ghost?: { gx: number; gy: number; kind: BuildingKind; w: number; h: number; valid: boolean; reason?: string | null } | null;
  selectedKeys?: ReadonlySet<string>;
  /** CSS px top overlay inset (fixed toolbar height); the grid fits below `topInset + CITY_VIEW_MARGIN`. */
  topInset?: number;
  /** CSS px to shift the two corner labels down by (the fixed toolbar overlays the canvas top; render must not measure it itself). */
  labelOffsetY?: number;
  /** Cells (keys `"gx,gy"`) the active build placer can accept a building on; flagged on the matching cityCell nodes for the tint paint. */
  buildableCells?: ReadonlySet<string>;
  citySettings: Pick<
    GameSettings,
    | "spriteVariant"
    | "parallaxEnabled"
    | "parallaxLayerCount"
    | "cityBgOffsetX"
    | "cityBgOffsetY"
    | "cityBackdrop"
    | "cityGridLines"
  >;

  /** The settlement's terrain signature for the biome diorama backdrop; absent = legacy skybox path. */
  backdrop?: CityBackdropSignature | null;

  /** The settlement's single in-flight upgrade, if any; targeted buildings render construction-stage sprites. */
  upgrades?: UpgradeState;
  district?: { q: number; r: number } | null;
  /**
   * Farm-plot art A/B hook: a `building-pixel-<style>-1.png` style segment. When
   * set, every farm field renders that style instead of its deterministic
   * pixel/pixel-alt pick. Used by the city view's `?farm=` query param.
   */
  farmSpriteStyle?: string;
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

  const skybox: CitySkyboxNode = {
    kind: "citySkybox",
    viewportW,
    viewportH,
    spriteVariant: citySettings.spriteVariant,
    parallaxEnabled: citySettings.parallaxEnabled,
    parallaxLayerCount: citySettings.parallaxLayerCount,
    offsetX: citySettings.cityBgOffsetX,
    offsetY: citySettings.cityBgOffsetY,
    citySize: size,
  };
  if (input.backdrop) {
    skybox.backdrop = input.backdrop;
    skybox.backdropMode = citySettings.cityBackdrop;
  }
  nodes.push(skybox);

  const { tileScale, tw, td, gridOrigin, screenOrigin } = cityLayout(size, viewportW, viewportH, topInset ?? 0);
  const cellScreen = (gx: number, gy: number) => {
    const c = cellToScreen(gx, gy, gridOrigin);
    return { x: screenOrigin.x + c.x * tileScale, y: screenOrigin.y + c.y * tileScale };
  };
  const gridCenter = cellScreen((size - 1) / 2, (size - 1) / 2);
  skybox.gridFootprint = {
    halfWidth: (size * tw) / 2,
    halfHeight: (size * td) / 2,
    centerX: gridCenter.x,
    centerY: gridCenter.y,
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
      gridLines: citySettings.cityGridLines,
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
      if (!input.district) {
        for (const b of orderedBuildings) {
          if (b.kind === "townHall") map.set(`${b.gx},${b.gy},${b.kind}`, stage);
        }
      }
    } else {
      for (const ref of upgradeRefs(upgrades)) {
        const refDist = ref.district ?? upgrades.district;
        const matchesContext = input.district
          ? Boolean(refDist && refDist.q === input.district.q && refDist.r === input.district.r)
          : !refDist;
        if (matchesContext) {
          map.set(`${ref.gx},${ref.gy},${ref.kind}`, stage);
        }
      }
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
        ? {
            farmStyle: farmFieldStyleAt(settlementName, b.gx, b.gy) as "pixel" | "pixel-alt",
            farmSpriteKey: `building.pixel.${input.farmSpriteStyle ?? farmPlotVariantAt(settlementName, b.gx, b.gy)}.1`,
          }
        : {}),
      selected: selectedKeys?.has(`${b.gx},${b.gy},${b.kind}`) ?? false,
      constructionStage: b.construction
        ? constructionStageFor(buildingConstructionProgress(b))
        : constructionStages?.get(`${b.gx},${b.gy},${b.kind}`),
    });
  }

  // Worker person clusters (population-workforce wave): one node per staffed,
  // not-under-construction building. Legacy buildings (workers undefined) read
  // as fully staffed so existing saves keep their look; a visible cap of 4
  // keeps clusters readable. Emitted after the building run so persons paint
  // above building bodies and below labels.
  for (const b of orderedBuildings) {
    if (b.construction) continue;
    const count = Math.min(b.workers ?? buildingMaxWorkers(b.kind), 4);
    if (count <= 0) continue;
    const fpSize = buildingFootprintFromRegistry(b.kind, b.level);
    const fp = buildingFootprint(b.gx, b.gy, gridOrigin, screenOrigin, tileScale, fpSize.w, fpSize.h);
    nodes.push({
      kind: "cityPerson",
      gx: b.gx,
      gy: b.gy,
      center: { x: fp.cx, y: fp.cy + fp.hh * 0.55 },
      count,
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
      // Only carried when there is something to say: a valid ghost's node stays
      // byte-identical to the pre-reason shape.
      ...(ghost.reason ? { reason: ghost.reason } : {}),
    });
  }

  nodes.push({ kind: "cityLabel", text: settlementName, x: 12, y: 12 + labelY, fontPx: 14, alpha: 1 });
  nodes.push({
    kind: "cityLabel",
    // A district is a 5x5 satellite grid, not the settlement's own tier -- the
    // TIER_LABELS entry for size 5 would present it as a "5x5 Settlement".
    text: input.district ? "District (5×5 grid)" : TIER_LABELS[size],
    x: 12,
    y: 30 + labelY,
    fontPx: 11,
    alpha: 0.7,
  });

  return nodes;
}
