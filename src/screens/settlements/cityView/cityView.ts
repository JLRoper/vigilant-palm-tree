import type { CityBackdropSignature, CityViewSize } from "@heroes/engine";
import { cellsInDrawOrder, cityLayout, screenToGridCell } from "../../../core/cityGrid";
import { drawCityView } from "../../../render/cityRenderer";
import { buildCityScene } from "../../../render/scene/sceneBuilder/cityScene";
import { createPaint2DDep } from "../../../render/paint2dDefaults";
import { createSkyboxProvider } from "../../../render/skybox";
import type { Paint2DDep } from "../../../render/scene/paint2d/deps";
import type { ResourceType } from "../../../map/resourceTiles";
import type { SpriteProvider } from "../../../render/assets";
import type { BuildingDef, BuildingKind, GenerationStyle } from "@heroes/contracts";
import { buildingFootprint, coversCell } from "../../../core/cityGrid";
import { districtKey, hasLegacyStaffing, starterCityOnOpen } from "@heroes/engine";
import {
  assignedWorkersExplicit,
  buildingMaxWorkers,
  canAssignWorkers,
  isProducerKind,
  isRecruitBuilding,
  staffingBase,
  WORKFORCE_UPGRADE_ACCEL_KINDS,
  workforcePool,
} from "@heroes/engine";
import { getUnitImageUrl } from "../../../data/unitImages";
import { advanceChargedOnCommit, netDelta } from "./netCost";
import { syncCartBuildings } from "./syncedBuildings";
import { BuildingMenu, type BuildingMenuOptions, type BuildingMenuWorkforce } from "./buildingMenu";
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
import { CITY_GRID_PAD, cityGridRect, collectPanelRects, elementRect } from "./panelRects";

/** Pre-city selection, captured at open() so close can restore the exact panel state the player left behind. */
export interface CitySelectionSnapshot {
  heroId: string | null;
  settlementId: string | null;
}

/** Workforce tags of a building, in display order: producer, market, recruiter,
 * upgrade-accel. A building can carry several (farmhouse → producer+recruiter,
 * mageGuild → recruiter+upgrade-accel); a building with none reports ["idle"]. */
export type WorkforceBuildingRole = "producer" | "market" | "recruiter" | "upgrade-accel" | "idle";

/** Live staffing snapshot for the workforce panel (district-true: each entry
 * carries its OWN building's district coords, null for main-settlement ones).
 * legacy = the whole live settlement (main + ALL districts) still has buildings
 * without an explicit workers count: the first assignment normalizes them, so
 * stepper/drag targets compute against the post-normalization base 0. */
export interface WorkforceSnapshot {
  pool: number;
  assigned: number;
  legacy: boolean;
  buildings: Array<{
    gx: number;
    gy: number;
    kind: string;
    district: { q: number; r: number } | null;
    staffable: boolean;
    max: number;
    workers: number | undefined;
    roles: WorkforceBuildingRole[];
  }>;
}

const PALETTE_W = 240;
const PALETTE_H = 480;

export class CityView {
  private designBox = new CityDesignBoxManager();
  private openSettlementId: string | null = null;
  private openDistrict: { q: number; r: number } | null = null;
  private backdrop: CityBackdropSignature | null = null;
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
  // One dep for the lifetime of the view: the skybox provider owns the decoded
  // image + parallax layer-canvas caches, so rebuilding it per frame would
  // re-split the skybox on every draw.
  private paint2d: Paint2DDep;
  private buildingMenu: BuildingMenu;
  private placer: BuildingPlacer;
  private selectionMenu: BuildingSelectionMenu;
  private selectedKeys: Set<string> = new Set();
  private selectionAnchor: { x: number; y: number } | null = null;
  private onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>, final: boolean, preCitySelection: CitySelectionSnapshot | null, district?: { q: number; r: number }) => boolean;
  private onPlaceBuildings: (settlementId: string, buildings: BuildingDef[], initialLayout?: boolean, district?: { q: number; r: number }) => boolean;
  /** Net cost already charged via incremental onPlaceBuildings commits since the view opened. */
  private chargedNet: Partial<Record<ResourceType, number>> = {};
  private getSettlement: () => SettlementState | undefined;
  private onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[], district?: { q: number; r: number }) => { ok: boolean; reason: string };
  private getSelection?: () => CitySelectionSnapshot;
  private getFloatingPanelRects?: () => Array<PanelRect | null>;
  private preCitySelection: CitySelectionSnapshot | null = null;
  private onKeyDown: (e: KeyboardEvent) => void;
  /** W4 workforce panel wiring: UIManager assigns both. onAssignWorkers commits
   * one building's staff count (server-side command) with the TARGET building's
   * own district (undefined = main settlement); openWorkforcePanel toggles
   * the panel ('w' key). */
  /** CityView-level assignment callback: district-true target commit; the
   * optional `source` turns the single AssignWorkers command into an atomic
   * transfer (source loses one, target gains it) handled inside the reducer. */
  onAssignWorkers?: (gx: number, gy: number, workers: number, district?: { q: number; r: number }, source?: { gx: number; gy: number }) => boolean;
  openWorkforcePanel?: () => void;
  /** Panel state hooks: Escape closes the panel (topmost surface) before it
   * falls through to closing the city view, and a final close tears it down. */
  isWorkforcePanelOpen?: () => boolean;
  closeWorkforcePanel?: () => void;
  private workforceListeners = new Set<() => void>();
  /** In-flight worker drag: the grab building (source of a transfer or the
   * pool for panel-chip drags), the pressed screen point, and whether motion
   * crossed the click/drag threshold (a ghost only shows after it). */
  private workerDrag: {
    source: { gx: number; gy: number; kind: string; district: { q: number; r: number } | null } | null;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  private workerGhost: HTMLImageElement | null = null;
  private workerDragListeners: Array<() => void> = [];
  private suppressNextCanvasClick = false;
  /** Panel-row hover highlight. Kept separate from `hover`: `hover` is the real
   * canvas pointer cell (Delete acts on it), while this is a pure preview. */
  private previewHover: { gx: number; gy: number } | null = null;

  constructor(opts: BuildingMenuOptions & { onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>, final: boolean, preCitySelection: CitySelectionSnapshot | null, district?: { q: number; r: number }) => boolean; onPlaceBuildings: (settlementId: string, buildings: BuildingDef[], initialLayout?: boolean, district?: { q: number; r: number }) => boolean; provider: SpriteProvider; getSettlement: () => SettlementState | undefined; onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[], district?: { q: number; r: number }) => { ok: boolean; reason: string }; getSelection?: () => CitySelectionSnapshot; getFloatingPanelRects?: () => Array<PanelRect | null> }) {
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
        const dist = this.openDistrict ? { q: this.openDistrict.q, r: this.openDistrict.r } : undefined;
        this.onUpgradeBuildings(
          settlement.id,
          [
            {
              gx: building.gx,
              gy: building.gy,
              kind: building.kind,
              ...(dist ? { district: dist } : {}),
            },
          ],
          dist,
        );
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
      // Typing in a menu field must not trigger city shortcuts ('w' opens the
      // workforce panel, 'b' the palette); Escape still falls through to close.
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" || target.isContentEditable
      );
      if (typing && e.key !== "Escape") return;
      if (e.key === "Escape") {
        if (this.workerDrag) {
          this.cancelWorkerDrag();
          return;
        }
        if (this.selectionMenu.isOpen()) {
          this.selectionMenu.hide();
          return;
        }
        if (this.buildingMenu.isOpen()) {
          this.buildingMenu.hide();
          return;
        }
        if (this.isWorkforcePanelOpen?.()) {
          this.closeWorkforcePanel?.();
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
      if (e.key === "w" || e.key === "W") {
        this.openWorkforcePanel?.();
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
    };
  }

  open(
    settlementId: string, name: string, size: CityViewSize, ownerColor: string,
    spots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>,
    mines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>,
    buildings?: BuildingDef[],
    mapSeed?: number,
    district?: { q: number; r: number },
    backdrop?: CityBackdropSignature,
    districtTerrain?: string | null,
  ): void {
    this.openSettlementId = settlementId;
    this.openDistrict = district ? { q: district.q, r: district.r } : null;
    this.backdrop = backdrop ?? null;
    this.settlementName = district ? `${name} — District (${district.q}, ${district.r})` : name;
    this.size = district ? 5 : size;
    this.ownerColor = ownerColor;
    this.citySpots = spots;
    this.cityMines = mines;
    this.mapSeed = mapSeed ?? null;
    this.hover = null;
    this.previewHover = null;
    this.workerDrag = null;
    this.selectedKeys.clear();
    this.selectionAnchor = null;
    this.preCitySelection = this.getSelection?.() ?? null;

    if (district) {
      const initialBuildings = buildings ? [...buildings] : [];
      this.freeInitialLayout = false;
      this.committedInitialLayout = false;
      this.placer.init(5, null, initialBuildings, true, districtTerrain ?? null);
    } else {
      const starter = starterCityOnOpen({ size: this.size, style: "pixel" as GenerationStyle, existing: buildings });
      const initialBuildings = starter.buildings;
      this.freeInitialLayout = starter.free;
      this.committedInitialLayout = false;
      this.placer.init(size, { gx: Math.floor(size / 2), gy: Math.floor(size / 2) }, initialBuildings, false);
    }
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
      onWorkforce: () => this.openWorkforcePanel?.(),
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

  getOpenDistrict(): { q: number; r: number } | null {
    return this.openDistrict;
  }

  draw(ctx: CanvasRenderingContext2D, viewportW: number, viewportH: number): void {
    if (!this.isOpen()) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, viewportW, viewportH);
    ctx.restore();

    const ghost = this.placer.ghostSnapshot();
    const s = settings();
    // A panel-row hover rings its building (the cell stroke alone sits under
    // the sprite). The drag source itself is intentionally NOT ringed: the
    // ghost under the pointer is the pickup feedback.
    const previewBuilding = this.previewHover
      ? this.liveBuildings().find((b) => coversCell(b, this.previewHover!.gx, this.previewHover!.gy))
      : null;
    const sceneSelected = new Set(this.selectedKeys);
    if (previewBuilding) sceneSelected.add(`${previewBuilding.gx},${previewBuilding.gy},${previewBuilding.kind}`);
    const nodes = buildCityScene({
      viewportW,
      viewportH,
      settlementName: this.settlementName,
      size: this.size,
      hover: this.previewHover ?? this.hover,
      ownerColor: this.ownerColor,
      citySpots: this.citySpots,
      cityMines: this.cityMines,
      upgrades: this.getSettlement()?.upgrade,
      district: this.openDistrict,
      backdrop: this.backdrop,
      buildings: this.buildingsWithWorkers(),
      ghost,
      selectedKeys: sceneSelected,
      topInset: toolbarHeight(),
      labelOffsetY: toolbarHeight(),
      buildableCells: this.buildableCells(),
      citySettings: {
        spriteVariant: s.spriteVariant,
        cityBackdrop: s.cityBackdrop,
        cityGridLines: s.cityGridLines,
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
      this.previewHover = null;
      return;
    }
    this.previewHover = null;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const layout = cityLayout(this.size, viewportW, viewportH, toolbarHeight());
    this.hover = screenToGridCell(layout, this.size, viewportW, canvasX, canvasY);

    // delegate snap computation to placer when in placement mode
    if (this.placer.isActive()) {
      this.placer.computeSnap(canvasX, canvasY, viewportW, viewportH);
    }
  }

  handleBuildingClick(canvasX: number, canvasY: number, modifier?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    if (this.suppressNextCanvasClick) {
      this.suppressNextCanvasClick = false;
      return;
    }
    if (!this.isOpen()) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const layout = cityLayout(this.size, viewportW, viewportH, toolbarHeight());
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

    // The synced cart copy carries no staffing fields; merge the live ones so
    // the menu's Workers stepper and draft-pool readout reflect server state.
    const liveBuilding = this.liveBuildings().find(
      (m) => m.gx === building.gx && m.gy === building.gy && m.kind === building.kind,
    );
    const menuBuilding: BuildingDef = liveBuilding
      ? {
          ...building,
          ...(liveBuilding.workers !== undefined ? { workers: liveBuilding.workers } : {}),
          ...(liveBuilding.draft !== undefined ? { draft: liveBuilding.draft } : {}),
        }
      : building;

    this.buildingMenu.show(
      menuBuilding,
      fp.cx,
      fp.cy - fp.hh * 0.6,
      this.getSettlement(),
      this.cellOutputFor(menuBuilding),
      menuBuilding.construction?.daysRemaining,
      this.workforceMenuOptions(menuBuilding),
    );
  }

  private cellOutputFor(building: BuildingDef): ProducerOutput | null {
    const settlement = this.getSettlement();
    if (!settlement || this.mapSeed === null) return null;
    const target = this.openDistrict
      ? { q: this.openDistrict.q, r: this.openDistrict.r, citySpots: this.citySpots }
      : settlement;
    return producerTurnOutput(building, target, this.mapSeed);
  }

  // ---- Workforce (population-worker distribution, W4 contract) --------------

  /** Live building list for the current context (main settlement, or the open district) -- the same live-side access path syncedBuildings() uses. */
  private liveBuildings(): BuildingDef[] {
    const live = this.getSettlement();
    if (!live) return [];
    return this.openDistrict
      ? (live.districts?.[districtKey(this.openDistrict.q, this.openDistrict.r)]?.buildings ?? [])
      : live.buildings;
  }

  /** Cart buildings for the scene with live `workers` merged in: syncCartBuildings does not copy staffing fields, and the person clusters must read live counts. */
  private buildingsWithWorkers(): BuildingDef[] {
    const live = this.getSettlement();
    const list = this.syncedBuildings();
    if (!live) return list;
    const liveList = this.liveBuildings();
    return list.map((b) => {
      const liveB = liveList.find((m) => m.gx === b.gx && m.gy === b.gy && m.kind === b.kind);
      return liveB && liveB.workers !== undefined ? { ...b, workers: liveB.workers } : b;
    });
  }

  private workforceTotals(): { pool: number; assigned: number } {
    const live = this.getSettlement();
    if (!live) return { pool: 0, assigned: 0 };
    return { pool: workforcePool(live), assigned: assignedWorkersExplicit(live) };
  }

  /** Building covering a cell -- ONLY the currently displayed city's list (the
   * open district when one is open, else the main settlement), so a district
   * grid that shares coordinates with main buildings never fall through to a
   * hidden building. The result carries which list the building came from so
   * assignments are district-true. */
  private workforceBuildingAt(gx: number, gy: number): { building: BuildingDef; district: { q: number; r: number } | null } | null {
    const live = this.getSettlement();
    if (!live) return null;
    const building = this.liveBuildings().find((b) => coversCell(b, gx, gy));
    if (!building) return null;
    return { building, district: this.openDistrict ? { q: this.openDistrict.q, r: this.openDistrict.r } : null };
  }

  private rolesFor(kind: BuildingKind): WorkforceBuildingRole[] {
    const roles: WorkforceBuildingRole[] = [];
    if (isProducerKind(kind)) roles.push("producer");
    if (kind === "market") roles.push("market");
    if (isRecruitBuilding(kind)) roles.push("recruiter");
    if (WORKFORCE_UPGRADE_ACCEL_KINDS.includes(kind)) roles.push("upgrade-accel");
    return roles.length > 0 ? roles : ["idle"];
  }

  private snapshotEntry(b: BuildingDef, district: { q: number; r: number } | null): WorkforceSnapshot["buildings"][number] {
    const max = buildingMaxWorkers(b.kind);
    return {
      gx: b.gx,
      gy: b.gy,
      kind: b.kind,
      district,
      staffable: max >= 1,
      max,
      workers: b.workers,
      roles: this.rolesFor(b.kind),
    };
  }

  /** Live staffing snapshot: main-settlement buildings plus the currently open
   * district's when one is open -- every entry carries its OWN building's
   * district coords (null for main-settlement buildings). */
  workforceSnapshot(): WorkforceSnapshot {
    const live = this.getSettlement();
    const totals = this.workforceTotals();
    const buildings: WorkforceSnapshot["buildings"] = [];
    if (live) {
      const district = this.openDistrict
        ? { q: this.openDistrict.q, r: this.openDistrict.r }
        : null;
      for (const b of live.buildings) buildings.push(this.snapshotEntry(b, null));
      if (district) {
        const d = live.districts?.[districtKey(district.q, district.r)];
        for (const b of d?.buildings ?? []) buildings.push(this.snapshotEntry(b, district));
      }
    }
    return {
      pool: totals.pool,
      assigned: totals.assigned,
      legacy: live ? hasLegacyStaffing(live) : false,
      buildings,
    };
  }

  /** fn runs after every successful assignment commit made by this view. */
  setWorkforceListener(fn: () => void): void {
    this.workforceListeners.add(fn);
  }

  /** Workforce panel row hover: reuse the normal hover highlight so duplicate
   * rows (two markets) are distinguishable on the grid. No-op when the entry
   * is not part of the currently displayed list. */
  previewWorkforceBuilding(gx: number, gy: number, district: { q: number; r: number } | null): void {
    const open = this.openDistrict;
    if (district === null ? open !== null : open === null || open.q !== district.q || open.r !== district.r) return;
    this.previewHover = { gx, gy };
  }

  clearWorkforcePreview(): void {
    this.previewHover = null;
  }

  /** Every successful assignment surface (panel steppers, chip drags, canvas
   * drags) calls this once per commit: listeners re-render and the open
   * building menu refreshes from live state via refreshIfOpen (no recursion —
   * the menu's own stepper commits do NOT route through here; they refresh
   * through their own onChange). */
  notifyWorkforceCommit(): void {
    for (const fn of this.workforceListeners) fn();
    this.buildingMenu.refreshIfOpen();
  }

  private notifyWorkforceListeners(): void {
    for (const fn of this.workforceListeners) fn();
  }

  /** W4's panel starts a worker drag from the pool (assign on drop): no grab
   * building, ghost follows the pointer once motion passes the click/drag
   * threshold, release over a canvas cell commits. A plain click on a chip is
   * a no-op -- it must never resolve to a building hidden under the panel. */
  beginWorkerDrag(startX: number, startY: number): void {
    this.endWorkerDrag();
    this.workerDrag = { source: null, startX, startY, moved: false };
    this.showWorkerGhost();
    this.armWorkerDragListeners();
  }

  /** Disarms a pending worker drag and removes ghost + listeners. An Escape
   * cancellation suppresses the trailing click so the press does not open a
   * building menu (same 350ms window as a real drop). */
  cancelWorkerDrag(): void {
    const hadDrag = this.workerDrag !== null;
    this.endWorkerDrag();
    if (hadDrag) {
      this.suppressNextCanvasClick = true;
      window.setTimeout(() => { this.suppressNextCanvasClick = false; }, 350);
    }
  }

  private showWorkerGhost(): void {
    if (this.workerGhost) return;
    const img = document.createElement("img");
    img.src = getUnitImageUrl("peasant");
    img.alt = "worker";
    img.draggable = false;
    img.dataset.testid = "worker-drag-ghost";
    Object.assign(img.style, {
      position: "fixed",
      width: "28px",
      height: "28px",
      pointerEvents: "none",
      zIndex: "200",
      imageRendering: "pixelated",
      opacity: "0.9",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(img);
    this.workerGhost = img;
  }

  private moveWorkerGhost(x: number, y: number): void {
    if (!this.workerGhost) return;
    this.workerGhost.style.display = "block";
    this.workerGhost.style.left = `${x - 14}px`;
    this.workerGhost.style.top = `${y - 14}px`;
  }

  private endWorkerDrag(): void {
    this.workerDrag = null;
    if (this.workerGhost) {
      this.workerGhost.remove();
      this.workerGhost = null;
    }
    for (const off of this.workerDragListeners) off();
    this.workerDragListeners = [];
  }

  /** Canvas mousedown on a staffable building with staff to give starts a
   * candidate pickup: a ghost appears only after the pointer moves past the
   * click/drag threshold, so plain clicks still open the building menu. Not
   * armed while the build/destroy placer is active -- there a press-drag is
   * the placer's gesture, not a worker pickup. */
  onCanvasMouseDown(x: number, y: number): void {
    if (this.placer.isActive() || this.placer.isDestroyMode()) return;
    const live = this.getSettlement();
    if (!live) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const layout = cityLayout(this.size, viewportW, viewportH, toolbarHeight());
    const cell = screenToGridCell(layout, this.size, viewportW, x, y);
    if (!cell) return;
    const hit = this.workforceBuildingAt(cell.gx, cell.gy);
    if (!hit || buildingMaxWorkers(hit.building.kind) < 1) return;
    const max = buildingMaxWorkers(hit.building.kind);
    const { pool, assigned } = this.workforceTotals();
    const workers = hit.building.workers ?? max;
    if (workers < 1) return;
    if (!canAssignWorkers(workers, max, -1, pool, assigned)) return;
    this.workerDrag = { source: { gx: hit.building.gx, gy: hit.building.gy, kind: hit.building.kind, district: hit.district }, startX: x, startY: y, moved: false };
    this.showWorkerGhost();
    this.moveWorkerGhost(x, y);
    this.armWorkerDragListeners();
  }

  /** Shared pointer lifecycle for canvas pickups and panel-chip drags. */
  private armWorkerDragListeners(): void {
    const move = (e: MouseEvent): void => {
      const drag = this.workerDrag;
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.moved = true;
      this.previewHover = null;
      this.moveWorkerGhost(e.clientX, e.clientY);
      this.hover = this.hoverCellAt(e.clientX, e.clientY);
    };
    const up = (e: MouseEvent): void => {
      this.finishWorkerDrag(e.clientX, e.clientY);
    };
    const blur = (): void => {
      this.cancelWorkerDrag();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
    window.addEventListener("blur", blur);
    this.workerDragListeners.push(() => window.removeEventListener("mousemove", move));
    this.workerDragListeners.push(() => window.removeEventListener("mouseup", up));
    this.workerDragListeners.push(() => window.removeEventListener("blur", blur));
  }

  /** The point must land on the game canvas itself: a release over any floating
   * UI (workforce panel, building menu, HUD) cancels instead of resolving the
   * building hidden underneath it. */
  private pointerOverCanvas(x: number, y: number): boolean {
    const el = document.elementFromPoint(x, y);
    return el instanceof HTMLCanvasElement && el.id === "game";
  }

  private hoverCellAt(x: number, y: number): { gx: number; gy: number } | null {
    if (!this.pointerOverCanvas(x, y)) return null;
    const layout = cityLayout(this.size, window.innerWidth, window.innerHeight, toolbarHeight());
    return screenToGridCell(layout, this.size, window.innerWidth, x, y);
  }

  /** Commit path for a held drag: resolves the drop cell (document-level, so
   * off-canvas release still cleans up), validates the transfer atomically via
   * the AssignWorkers source form, and always tears the ghost down. A held
   * drag that actually moved suppresses the trailing click so no menu opens;
   * an un-moved press cancels silently (menu opens via the normal click). */
  private finishWorkerDrag(x: number, y: number): void {
    const drag = this.workerDrag;
    this.endWorkerDrag();
    if (!drag || !drag.moved) return;
    this.suppressNextCanvasClick = true;
    window.setTimeout(() => { this.suppressNextCanvasClick = false; }, 350);
    const live = this.getSettlement();
    if (!live) return;
    const cell = this.hoverCellAt(x, y);
    if (!cell) return;
    const target = this.workforceBuildingAt(cell.gx, cell.gy);
    if (!target) return;
    const legacy = hasLegacyStaffing(live);
    const targetMax = buildingMaxWorkers(target.building.kind);
    const nextTarget = staffingBase(target.building.workers, targetMax, legacy) + 1;
    if (nextTarget > targetMax) return;
    let ok = false;
    if (drag.source) {
      const list = drag.source.district
        ? live.districts?.[districtKey(drag.source.district.q, drag.source.district.r)]?.buildings
        : live.buildings;
      const source = list?.find((b) => b.gx === drag.source!.gx && b.gy === drag.source!.gy && b.kind === drag.source!.kind);
      if (!source) return;
      if (source.gx === target.building.gx && source.gy === target.building.gy && source.kind === target.building.kind) return;
      const sourceMax = buildingMaxWorkers(source.kind);
      if ((source.workers ?? sourceMax) < 1) return;
      ok = this.onAssignWorkers?.(
        target.building.gx,
        target.building.gy,
        nextTarget,
        target.district ?? undefined,
        { gx: source.gx, gy: source.gy },
      ) ?? false;
    } else {
      ok = this.onAssignWorkers?.(target.building.gx, target.building.gy, nextTarget, target.district ?? undefined) ?? false;
    }
    if (ok) this.notifyWorkforceCommit();
  }

  /** Canvas mouseup without a drag armed is a no-op (the click handler owns
   * menu opening); drags commit through finishWorkerDrag via window mouseup. */
  onCanvasMouseUp(x: number, y: number): void {
    void x;
    void y;
  }

  /** Trailing options object for buildingMenu.show: the district field names
   * the list the building came from (null = main settlement), so the menu's
   * stepper commits are district-true. */
  private workforceMenuOptions(building: BuildingDef): BuildingMenuWorkforce | undefined {
    const live = this.getSettlement();
    if (!live) return undefined;
    const totals = this.workforceTotals();
    const inMain = live.buildings.some(
      (b) => b.gx === building.gx && b.gy === building.gy && b.kind === building.kind,
    );
    let district: { q: number; r: number } | null = null;
    if (!inMain && this.openDistrict) {
      const d = live.districts?.[districtKey(this.openDistrict.q, this.openDistrict.r)];
      if (
        d?.buildings.some((b) => b.gx === building.gx && b.gy === building.gy && b.kind === building.kind)
      ) {
        district = { q: this.openDistrict.q, r: this.openDistrict.r };
      }
    }
    return {
      pool: totals.pool,
      assigned: totals.assigned,
      district,
      onChange: () => this.notifyWorkforceListeners(),
      onAssignWorkers: (gx, gy, workers, d) => this.onAssignWorkers?.(gx, gy, workers, d) ?? false,
      getSettlement: () => this.getSettlement(),
    };
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
    const dist = this.openDistrict ? { q: this.openDistrict.q, r: this.openDistrict.r } : undefined;
    const requests: BuildingUpgradeRequest[] = [];
    for (const key of this.selectedKeys) {
      const [gxs, gys, kind] = key.split(",");
      requests.push({
        gx: parseInt(gxs),
        gy: parseInt(gys),
        kind: kind as BuildingDef["kind"],
        ...(dist ? { district: dist } : {}),
      });
    }
    if (requests.length === 0) return;

    const costText = `${combined.gold}g ${combined.wood}w ${combined.stone}s / ${combined.days}d`;
    const summary = `Upgrade ${requests.length} building${requests.length === 1 ? "" : "s"} for ${costText}?`;

    const perform = () => {
      const result = this.onUpgradeBuildings(settlement.id, requests, dist);
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

  private openBuildPalette(): void {
    const stored = loadPanelGeometry("buildPalette");
    const desired = stored ?? { x: 12, y: Math.max(20, window.innerHeight - PALETTE_H) };
    const occupied = this.collectOccupiedRects();
    occupied.push(cityGridRect(this.size, window.innerWidth, window.innerHeight, CITY_GRID_PAD, toolbarHeight()));
    const resolved = resolvePanelPlacement(
      { x: desired.x, y: desired.y, w: PALETTE_W, h: PALETTE_H },
      occupied,
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
    const dist = this.openDistrict ?? undefined;
    const accepted = this.onClose(this.openSettlementId, synced, delta, false, null, dist);
    const initialLayout = this.freeInitialLayout && !this.committedInitialLayout;
    const result = accepted ? this.onPlaceBuildings(this.openSettlementId, synced, initialLayout, dist) : false;
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
    const liveBuildings = this.openDistrict
      ? (live.districts?.[districtKey(this.openDistrict.q, this.openDistrict.r)]?.buildings ?? [])
      : live.buildings;
    return syncCartBuildings(this.placer.buildings, liveBuildings);
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
    const dist = this.openDistrict ?? undefined;
    this.lastClosedId = id;
    // Synced cart, not the raw snapshot — see persistBuildings(): the raw
    // cart's stale construction timers would re-arm finished builds.
    const finalBuildings = this.syncedBuildings();
    try {
      this.placer.cancelPlacement();
      this.placer.hidePalette();
      this.designBox.hide();
      window.removeEventListener("keydown", this.onKeyDown);
      this.endWorkerDrag();
      this.buildingMenu.hide();
      this.selectionMenu.hide();
      this.selectedKeys.clear();
      this.selectionAnchor = null;
      this.openSettlementId = null;
      this.openDistrict = null;
      this.hover = null;
      this.previewHover = null;
      this.workerDrag = null;
      this.onClose(id, finalBuildings, this.pendingNetDelta(), true, this.preCitySelection, dist);
      return id;
    } finally {
      this.closing = false;
    }
  }
}
