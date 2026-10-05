import type { CityViewSize } from "@heroes/engine";
import { cellsInDrawOrder, cityLayout, screenToGridCell } from "../../../core/cityGrid";
import { drawCityView } from "../../../render/cityRenderer";
import { buildCityScene } from "../../../render/scene/sceneBuilder/cityScene";
import { createPaint2DDep } from "../../../render/paint2dDefaults";
import { createSkyboxProvider } from "../../../render/skybox";
import type { Paint2DDep } from "../../../render/scene/paint2d/deps";
import type { ResourceType } from "../../../map/resourceTiles";
import type { SpriteProvider } from "../../../render/assets";
import type { BuildingDef, GenerationStyle } from "@heroes/contracts";
import { buildingFootprint, coversCell } from "../../../core/cityGrid";
import { generateBuildings, type GenerationPattern } from "../../../render/cityBuildingGen";
import { starterCityOnOpen } from "@heroes/engine";
import { advanceChargedOnCommit, netDelta, resetChargedToPlacerNet } from "./netCost";
import { syncCartBuildings } from "./syncedBuildings";
import { BuildingMenu, type BuildingMenuOptions } from "./buildingMenu";
import { BuildingPlacer } from "./buildingPlacer";
import { BuildingSelectionMenu, type SelectedBuildingEntry } from "./buildingSelectionMenu";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
import { loadPanelGeometry } from "@screens/shared/panelLayout";
import { resolvePanelPlacement, type PanelRect } from "@screens/shared/panelPlacement";
import { toolbarHeight } from "@screens/shared/panelRail";
import { settings } from "../../../state/settings";
import type { SettlementState } from "../../../state/gameState";
import type { BuildingUpgradeRequest } from "../../../state/gameState";
import type { BuildingUpgradeCost, ProducerOutput } from "@heroes/engine";
import { producerTurnOutput } from "@heroes/engine";
import { CityDesignBoxManager } from "./CityDesignBoxManager";
import { collectPanelRects, elementRect } from "./panelRects";

const STYLE_KEYS: Record<string, GenerationStyle> = {
  "1": "classic",
  "2": "blocky",
  "3": "crystalline",
  "4": "organic",
  "5": "industrial",
};

const PATTERN_KEYS: Record<string, GenerationPattern> = {
  "!": "denseUrban",
  "@": "sparseRural",
  "#": "radial",
  "$": "grid",
  "%": "clustered",
  "^": "sampler",
};

/** Pre-city selection, captured at open() so close can restore the exact panel state the player left behind. */
export interface CitySelectionSnapshot {
  heroId: string | null;
  settlementId: string | null;
}

const PALETTE_W = 240;
const PALETTE_H = 480;

export class CityView {
  private designBox = new CityDesignBoxManager();
  private openSettlementId: string | null = null;
  private settlementName = "";
  private size: CityViewSize = 5;
  private ownerColor = "#888888";
  private hover: { gx: number; gy: number } | null = null;
  private citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }> = [];
  private cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }> = [];
  private mapSeed: number | null = null;
  /** True when the city view handed a previously-empty settlement its free starter set (buildStarterLayout). */
  private freeInitialLayout = false;
  private committedInitialLayout = false;
  private style: GenerationStyle = "classic";
  private pattern: GenerationPattern = "denseUrban";
  private seed = 42;
  // One dep for the lifetime of the view: the skybox provider owns the decoded
  // image + parallax layer-canvas caches, so rebuilding it per frame would
  // re-split the skybox on every draw.
  private paint2d: Paint2DDep;
  private buildingMenu: BuildingMenu;
  private placer: BuildingPlacer;
  private selectionMenu: BuildingSelectionMenu;
  private selectedKeys: Set<string> = new Set();
  private selectionAnchor: { x: number; y: number } | null = null;
  private onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>, final: boolean, preCitySelection: CitySelectionSnapshot | null) => boolean;
  private onPlaceBuildings: (settlementId: string, buildings: BuildingDef[], initialLayout?: boolean) => boolean;
  /** Net cost already charged via incremental onPlaceBuildings commits since the view opened. */
  private chargedNet: Partial<Record<ResourceType, number>> = {};
  private getSettlement: () => SettlementState | undefined;
  private onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[]) => { ok: boolean; reason: string };
  private getSelection?: () => CitySelectionSnapshot;
  private getFloatingPanelRects?: () => Array<PanelRect | null>;
  private preCitySelection: CitySelectionSnapshot | null = null;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: BuildingMenuOptions & { onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>, final: boolean, preCitySelection: CitySelectionSnapshot | null) => boolean; onPlaceBuildings: (settlementId: string, buildings: BuildingDef[], initialLayout?: boolean) => boolean; provider: SpriteProvider; getSettlement: () => SettlementState | undefined; onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[]) => { ok: boolean; reason: string }; getSelection?: () => CitySelectionSnapshot; getFloatingPanelRects?: () => Array<PanelRect | null> }) {
    this.paint2d = createPaint2DDep({
      spriteProvider: opts.provider,
      skybox: createSkyboxProvider(),
      colorForOwner: () => this.ownerColor,
    });
    this.buildingMenu = new BuildingMenu({
      onRecruitUnits: opts.onRecruitUnits,
      isUnitRecruitable: opts.isUnitRecruitable,
      onUpgradeTownHall: opts.onUpgradeTownHall,
      onUpgradeBuilding: (building) => {
        const settlement = this.getSettlement();
        if (!settlement) return;
        this.onUpgradeBuildings(settlement.id, [
          { gx: building.gx, gy: building.gy, kind: building.kind },
        ]);
      },
    });
    this.placer = new BuildingPlacer();
    this.selectionMenu = new BuildingSelectionMenu({
      onUpgrade: (combined) => this.commitUpgrade(combined),
    });
    this.onClose = opts.onClose;
    this.onPlaceBuildings = opts.onPlaceBuildings;
    this.getSettlement = opts.getSettlement;
    this.onUpgradeBuildings = opts.onUpgradeBuildings;
    this.getSelection = opts.getSelection;
    this.getFloatingPanelRects = opts.getFloatingPanelRects;
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.selectionMenu.isOpen()) {
          this.selectionMenu.hide();
          return;
        }
        if (this.buildingMenu.isOpen()) {
          this.buildingMenu.hide();
          return;
        }
        if (this.placer.isActive()) {
          this.placer.cancelPlacement();
          this.updateBuildButton();
          return;
        }
        if (this.placer.isPaletteOpen()) {
          this.placer.hidePalette();
          this.updateBuildButton();
          return;
        }
        if (this.selectedKeys.size > 0) {
          this.clearSelection();
          return;
        }
        this.handleClose();
        return;
      }
      if (e.key === "b" || e.key === "B") {
        if (this.placer.isPaletteOpen()) {
          this.placer.hidePalette();
        } else {
          this.openBuildPalette();
        }
        this.updateBuildButton();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (this.placer.isActive()) return;
        if (this.hover) {
          this.placer.removeAt(this.hover.gx, this.hover.gy);
        }
        return;
      }
      const styleKey = STYLE_KEYS[e.key];
      if (styleKey) {
        this.style = styleKey;
        this.regenerate();
        return;
      }
      const patternKey = PATTERN_KEYS[e.key];
      if (patternKey) {
        this.pattern = patternKey;
        this.regenerate();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        this.seed = Math.floor(Math.random() * 100000);
        this.regenerate();
        return;
      }
    };
  }

  open(
    settlementId: string, name: string, size: CityViewSize, ownerColor: string,
    spots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>,
    mines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>,
    buildings?: BuildingDef[],
    mapSeed?: number,
  ): void {
    this.openSettlementId = settlementId;
    this.settlementName = name;
    this.size = size;
    this.ownerColor = ownerColor;
    this.citySpots = spots;
    this.cityMines = mines;
    this.mapSeed = mapSeed ?? null;
    this.hover = null;
    this.selectedKeys.clear();
    this.selectionAnchor = null;
    this.preCitySelection = this.getSelection?.() ?? null;

    const starter = starterCityOnOpen({ size: this.size, style: "pixel" as GenerationStyle, existing: buildings });
    const initialBuildings = starter.buildings;
    // A settlement with no persisted buildings gets the explicit starter set
    // committed FREE (townHall L1 + farm field + 2 houses + two woodcutter's
    // huts, a stone mine and the farmhouse troop producer, engine
    // buildStarterLayout) -- not a procedurally
    // generated city. The old dense-procedural free layout charged ~24 wood +
    // 14 stone per turn against a 300/300 start and had no producer; see
    // packages/engine/src/settlement/starterLayout.ts. Everything added on top
    // is charged.
    //
    // In practice this is now a RARE path: init.ts seeds EVERY settlement at
    // game creation (a seeded settlement skips this free commit, so an empty
    // one would never be handed a city at all). It still fires for a settlement
    // created later -- by a charter, or as a test fixture -- which is exactly
    // what it is for.
    this.freeInitialLayout = starter.free;
    this.committedInitialLayout = false;
    this.placer.init(size, { gx: Math.floor(size / 2), gy: Math.floor(size / 2) }, initialBuildings);
    this.refreshAffordability();
    this.placer.setOnConfirm(() => this.persistBuildings());
    this.placer.setOnPlaced(() => this.persistBuildings());
    this.chargedNet = {};

    // Commit the starter layout immediately and FREE. Doing it at open —
    // rather than lazily on the first placement — means user buildings are
    // charged on their own: place a 100g house on top and the
    // treasury/warehouse actually drop.
    if (this.freeInitialLayout && this.openSettlementId) {
      const ok = this.onPlaceBuildings(this.openSettlementId, [...this.placer.buildings], true);
      if (ok) {
        this.committedInitialLayout = true;
        this.placer.markSynced();
        this.refreshAffordability();
      }
    }

    this.designBox.show({
      onBuild: () => {
        if (this.placer.isPaletteOpen()) {
          this.placer.hidePalette();
        } else {
          this.openBuildPalette();
        }
        this.updateBuildButton();
      },
      onGenerate: () => this.regenerate(),
      onBack: () => this.handleClose(),
    }, this.getFloatingPanelRects);

    window.addEventListener("keydown", this.onKeyDown);
  }

  isOpen(): boolean {
    return this.openSettlementId !== null;
  }

  getOpenSettlementId(): string | null {
    return this.openSettlementId;
  }

  draw(ctx: CanvasRenderingContext2D, viewportW: number, viewportH: number): void {
    if (!this.isOpen()) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, viewportW, viewportH);
    ctx.restore();

    const ghost = this.placer.ghostSnapshot();
    const s = settings();
    const nodes = buildCityScene({
      viewportW,
      viewportH,
      settlementName: this.settlementName,
      size: this.size,
      hover: this.hover,
      ownerColor: this.ownerColor,
      citySpots: this.citySpots,
      cityMines: this.cityMines,
      upgrades: this.getSettlement()?.upgrade,
      buildings: this.syncedBuildings(),
      ghost,
      selectedKeys: this.selectedKeys,
      labelOffsetY: toolbarHeight(),
      buildableCells: this.buildableCells(),
      citySettings: {
        spriteVariant: s.spriteVariant,
        parallaxEnabled: s.parallaxEnabled,
        parallaxLayerCount: s.parallaxLayerCount,
        cityBgOffsetX: s.cityBgOffsetX,
        cityBgOffsetY: s.cityBgOffsetY,
      },
    });
    drawCityView(ctx, nodes, this.paint2d, { viewportW, viewportH });
  }

  /** Free cells for the placement tint, recomputed per draw only while the build placer is active. */
  private buildableCells(): Set<string> {
    const cells = new Set<string>();
    if (!this.placer.isActive()) return cells;
    for (const cell of cellsInDrawOrder(this.size)) {
      if (this.placer.canPlaceAt(cell.gx, cell.gy)) cells.add(`${cell.gx},${cell.gy}`);
    }
    return cells;
  }

  updateMouse(canvasX: number, canvasY: number): void {    if (!this.isOpen()) {
      this.hover = null;
      return;
    }
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const layout = cityLayout(this.size, viewportW, viewportH);
    this.hover = screenToGridCell(layout, this.size, viewportW, canvasX, canvasY);

    // delegate snap computation to placer when in placement mode
    if (this.placer.isActive()) {
      this.placer.computeSnap(canvasX, canvasY, viewportW, viewportH);
    }
  }

  handleBuildingClick(canvasX: number, canvasY: number, modifier?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    if (!this.isOpen()) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const layout = cityLayout(this.size, viewportW, viewportH);
    const cell = screenToGridCell(layout, this.size, viewportW, canvasX, canvasY);

    if (!cell) {
      this.buildingMenu.hide();
      if (!modifier?.ctrlKey && !modifier?.metaKey) this.clearSelection();
      return;
    }
    const { gx, gy } = cell;

    const ctrlLike = !!(modifier?.ctrlKey || modifier?.metaKey);

    // destroy mode: remove building under cursor
    if (this.placer.isDestroyMode()) {
      this.placer.removeAt(gx, gy);
      this.updateBuildButton();
      return;
    }

    // placement mode: place building
    if (this.placer.isActive()) {
      this.placer.place();
      this.updateBuildButton();
      return;
    }

    // inspection / selection mode
    const building = this.syncedBuildings().find((b) => coversCell(b, gx, gy));
    if (!building) {
      this.buildingMenu.hide();
      if (!ctrlLike) this.clearSelection();
      return;
    }

    const key = `${building.gx},${building.gy},${building.kind}`;

    if (ctrlLike) {
      if (this.selectedKeys.has(key)) {
        this.selectedKeys.delete(key);
      } else {
        this.selectedKeys.add(key);
      }
      this.buildingMenu.hide();
      this.refreshSelectionMenu(canvasX, canvasY);
      return;
    }

    // single click: show the building's own menu
    if (this.selectedKeys.size > 0) {
      this.clearSelection();
    }
    const w = building.w ?? 1;
    const h = building.h ?? 1;
    const fp = buildingFootprint(building.gx, building.gy, layout.gridOrigin, layout.screenOrigin, layout.tileScale, w, h);

    this.buildingMenu.show(
      building,
      fp.cx,
      fp.cy - fp.hh * 0.6,
      this.getSettlement(),
      this.cellOutputFor(building),
      building.construction?.daysRemaining,
    );
  }

  private cellOutputFor(building: BuildingDef): ProducerOutput | null {
    const settlement = this.getSettlement();
    if (!settlement || this.mapSeed === null) return null;
    return producerTurnOutput(building, settlement, this.mapSeed);
  }

  private clearSelection(): void {
    this.selectedKeys.clear();
    this.selectionAnchor = null;
    this.selectionMenu.hide();
  }

  private refreshSelectionMenu(screenX?: number, screenY?: number): void {
    if (this.selectedKeys.size === 0) {
      this.selectionMenu.hide();
      return;
    }
    const entries: SelectedBuildingEntry[] = [];
    for (const key of this.selectedKeys) {
      const [gxs, gys, kind] = key.split(",");
      const gx = parseInt(gxs);
      const gy = parseInt(gys);
      const b = this.syncedBuildings().find((x) => x.gx === gx && x.gy === gy && x.kind === kind);
      if (b) entries.push({ key, building: b });
    }
    const settlement = this.getSettlement() ?? null;
    const x = screenX ?? this.selectionAnchor?.x ?? window.innerWidth - 300;
    const y = screenY ?? this.selectionAnchor?.y ?? 80;
    this.selectionMenu.show(entries, settlement, x, y);
  }

  private commitUpgrade(combined: BuildingUpgradeCost): void {
    const settlement = this.getSettlement();
    if (!settlement) return;
    const requests: BuildingUpgradeRequest[] = [];
    for (const key of this.selectedKeys) {
      const [gxs, gys, kind] = key.split(",");
      requests.push({ gx: parseInt(gxs), gy: parseInt(gys), kind: kind as BuildingDef["kind"] });
    }
    if (requests.length === 0) return;

    const costText = `${combined.gold}g ${combined.wood}w ${combined.stone}s / ${combined.days}d`;
    const summary = `Upgrade ${requests.length} building${requests.length === 1 ? "" : "s"} for ${costText}?`;

    const perform = () => {
      const result = this.onUpgradeBuildings(settlement.id, requests);
      if (!result.ok) {
        openConfirmDialog({
          title: "Upgrade failed",
          message: `Could not start upgrade: ${result.reason}`,
          confirmLabel: "OK",
          onConfirm: () => {},
        });
        return;
      }
      this.clearSelection();
    };

    if (settings().buildingUpgradeConfirm) {
      openConfirmDialog({
        title: "Confirm upgrade",
        message: summary,
        confirmLabel: "Upgrade",
        onConfirm: perform,
      });
    } else {
      perform();
    }
  }

  /** The design box's Generate button: a procedural preview layout (and the only remaining consumer of cityBuildingGen). Not a starting city — a settlement's starter set is the engine's buildStarterLayout. */
  private generateBuildingsArray(): BuildingDef[] {
    const center = Math.floor(this.size / 2);
    return generateBuildings({
      size: this.size,
      pattern: this.pattern,
      style: this.style,
      seed: this.seed,
      townHallAt: { gx: center, gy: center },
    });
  }

  private regenerate(): void {
    if (!this.isOpen()) return;
    const buildings = this.generateBuildingsArray();
    this.placer.cancelPlacement();
    this.placer.hidePalette();
    this.placer.init(this.size, { gx: Math.floor(this.size / 2), gy: Math.floor(this.size / 2) }, buildings);
    this.chargedNet = resetChargedToPlacerNet(this.placer.getNetCost());
    this.updateBuildButton();
  }

  private openBuildPalette(): void {
    const stored = loadPanelGeometry("buildPalette");
    const desired = stored ?? { x: 12, y: Math.max(20, window.innerHeight - PALETTE_H) };
    const resolved = resolvePanelPlacement(
      { x: desired.x, y: desired.y, w: PALETTE_W, h: PALETTE_H },
      this.collectOccupiedRects(),
      { width: window.innerWidth, height: window.innerHeight },
      toolbarHeight(),
    );
    this.placer.showPalette(document.body, resolved.x, resolved.y);
    this.updateBuildButton();
  }

  private collectOccupiedRects(): PanelRect[] {
    const out = collectPanelRects(this.getFloatingPanelRects);
    const rect = elementRect(this.designBox.getElement());
    if (rect) out.push(rect);
    return out;
  }

  private persistBuildings(): void {
    if (!this.openSettlementId) return;
    // Only the delta since the last incremental commit is charged -- every
    // placement/destroy is committed immediately (locally below, and
    // server-side via the PlaceBuildings command), so at close the
    // remaining delta is always zero.
    //
    // The commit payload is the SYNCED cart, not the raw cart: EndTurn's
    // round wrap replaces state objects (construction ticks down, builds
    // complete) while the cart still holds the placement-time copies.
    // Writing the raw cart would re-arm finished timers (user report,
    // 2026-09-27: re-entering a city showed finished houses as tier-1
    // in-progress again).
    const delta = this.pendingNetDelta();
    const synced = this.syncedBuildings();
    const accepted = this.onClose(this.openSettlementId, synced, delta, false, null);
    const initialLayout = this.freeInitialLayout && !this.committedInitialLayout;
    const result = accepted ? this.onPlaceBuildings(this.openSettlementId, synced, initialLayout) : false;
    this.chargedNet = advanceChargedOnCommit(result, this.placer.getNetCost(), this.chargedNet);
    if (result) {
      this.placer.markSynced();
      if (initialLayout) this.committedInitialLayout = true;
    }
    this.refreshAffordability();
    this.updateBuildButton();
  }

  /** Cart buildings with construction/level/style/bank re-synced from live state -- EndTurn's round wrap replaces state objects, so the cart snapshot goes stale otherwise. */
  private syncedBuildings(): BuildingDef[] {
    const live = this.getSettlement();
    if (!live) return this.placer.buildings;
    return syncCartBuildings(this.placer.buildings, live.buildings);
  }

  private pendingNetDelta(): Partial<Record<ResourceType, number>> {
    return netDelta(this.placer.getNetCost(), this.chargedNet);
  }

  private refreshAffordability(): void {
    const s = this.getSettlement();
    if (s) {
      this.placer.setAffordability({
        gold: s.gold,
        warehouse: {
          wood: s.warehouse.wood ?? 0,
          stone: s.warehouse.stone ?? 0,
          iron: s.warehouse.iron ?? 0,
          arcane: s.warehouse.arcane ?? 0,
          food: s.warehouse.food ?? 0,
        },
      });
    }
  }

  private updateBuildButton(): void {
    this.designBox.setBuildPaletteOpen(this.placer.isPaletteOpen());
  }

  private closing = false;
  private lastClosedId: string | null = null;

  close(): string | null {
    if (!this.isOpen()) return this.lastClosedId;
    return this.handleClose();
  }

  private handleClose(): string | null {
    if (this.closing) return this.lastClosedId;
    if (!this.isOpen()) return this.lastClosedId;

    this.closing = true;
    const id = this.openSettlementId!;
    this.lastClosedId = id;
    // Synced cart, not the raw snapshot — see persistBuildings(): the raw
    // cart's stale construction timers would re-arm finished builds.
    const finalBuildings = this.syncedBuildings();
    try {
      this.placer.cancelPlacement();
      this.placer.hidePalette();
      this.designBox.hide();
      window.removeEventListener("keydown", this.onKeyDown);
      this.buildingMenu.hide();
      this.selectionMenu.hide();
      this.selectedKeys.clear();
      this.selectionAnchor = null;
      this.openSettlementId = null;
      this.hover = null;
      this.onClose(id, finalBuildings, this.pendingNetDelta(), true, this.preCitySelection);
      return id;
    } finally {
      this.closing = false;
    }
  }
}
