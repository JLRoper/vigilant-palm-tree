import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../../../core/cityGrid";
import { computeCityScale, drawCityView } from "../../../render/cityRenderer";
import type { ResourceType } from "../../../map/resourceTiles";
import type { SpriteProvider } from "../../../render/assets";
import type { BuildingDef, GenerationStyle } from "../../../render/cityBuildingDraw";
import { coversCell, buildingFootprint } from "../../../render/cityBuildingDraw";
import { generateBuildings, type GenerationPattern } from "../../../render/cityBuildingGen";
import { BuildingMenu, type BuildingMenuOptions } from "./buildingMenu";
import { BuildingPlacer } from "./buildingPlacer";
import { BuildingSelectionMenu, type SelectedBuildingEntry } from "./buildingSelectionMenu";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
import { settings } from "../../../state/settings";
import type { SettlementState } from "../../../state/gameState";
import type { BuildingUpgradeRequest } from "../../../state/gameState";
import type { BuildingUpgradeCost } from "@heroes/engine";
import { CityDesignBoxManager } from "./CityDesignBoxManager";

export class CityView {
  private designBox = new CityDesignBoxManager();
  private openSettlementId: string | null = null;
  private settlementName = "";
  private size: CityViewSize = 5;
  private ownerColor = "#888888";
  private hover: { gx: number; gy: number } | null = null;
  private citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }> = [];
  private cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }> = [];
  private style: GenerationStyle = "classic";
  private pattern: GenerationPattern = "denseUrban";
  private seed = 42;
  private provider: SpriteProvider;
  private buildingMenu: BuildingMenu;
  private placer: BuildingPlacer;
  private selectionMenu: BuildingSelectionMenu;
  private selectedKeys: Set<string> = new Set();
  private selectionAnchor: { x: number; y: number } | null = null;
  private onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>) => void;
  private getSettlement: () => SettlementState | undefined;
  private onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[]) => { ok: boolean; reason: string };
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: BuildingMenuOptions & { onClose: (settlementId: string, buildings: BuildingDef[], netCost: Partial<Record<ResourceType, number>>) => void; provider: SpriteProvider; getSettlement: () => SettlementState | undefined; onUpgradeBuildings: (settlementId: string, requests: BuildingUpgradeRequest[]) => { ok: boolean; reason: string } }) {
    this.provider = opts.provider;
    this.buildingMenu = new BuildingMenu({
      onRecruitArcher: opts.onRecruitArcher,
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
    this.getSettlement = opts.getSettlement;
    this.onUpgradeBuildings = opts.onUpgradeBuildings;
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
      if (e.key >= "1" && e.key <= "5") {
        const styles: GenerationStyle[] = ["classic", "blocky", "crystalline", "organic", "industrial"];
        this.style = styles[parseInt(e.key) - 1];
        this.regenerate();
        return;
      }
      if (e.key === "!" || e.key === "@" || e.key === "#" || e.key === "$" || e.key === "%" || e.key === "^") {
        const patterns: GenerationPattern[] = ["denseUrban", "sparseRural", "radial", "grid", "clustered", "sampler"];
        const idx = "!@#$%^".indexOf(e.key);
        if (idx >= 0 && idx < patterns.length) {
          this.pattern = patterns[idx];
          this.regenerate();
        }
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
  ): void {
    this.openSettlementId = settlementId;
    this.settlementName = name;
    this.size = size;
    this.ownerColor = ownerColor;
    this.citySpots = spots;
    this.cityMines = mines;
    this.hover = null;
    this.selectedKeys.clear();
    this.selectionAnchor = null;

    const initialBuildings = buildings && buildings.length > 0
      ? buildings
      : this.generateBuildingsArray();
    this.placer.init(size, { gx: Math.floor(size / 2), gy: Math.floor(size / 2) }, initialBuildings, this.style);
    this.refreshAffordability();
    this.placer.setOnConfirm(() => this.persistBuildings());

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
    });

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
    drawCityView(ctx, {
      viewportW,
      viewportH,
      settlementName: this.settlementName,
      size: this.size,
      hover: this.hover,
      ownerColor: this.ownerColor,
      provider: this.provider,
      citySpots: this.citySpots,
      cityMines: this.cityMines,
      buildings: this.placer.buildings,
      style: this.style,
      pattern: this.pattern,
      ghost,
      selectedKeys: this.selectedKeys,
    });
  }

  updateMouse(canvasX: number, canvasY: number): void {
    if (!this.isOpen()) {
      this.hover = null;
      return;
    }
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const tileScale = computeCityScale(this.size, viewportW, viewportH);
    const tw = TILE_W * tileScale;
    const td = TILE_D * tileScale;
    const origin = cellOrigin(this.size);

    const gridVCenter = (this.size - 1) * TILE_D / 2;
    const buildingPad = this.size * TILE_D * 0.18;
    const screenOriginY = viewportH / 2 - (gridVCenter + buildingPad) * tileScale;
    const wdx = canvasX - viewportW / 2 - origin.x * tileScale;
    const wdy = canvasY - screenOriginY - origin.y * tileScale;

    const gxf = wdx / tw + wdy / td;
    const gyf = wdy / td - wdx / tw;
    const gx = Math.floor(gxf);
    const gy = Math.floor(gyf);

    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) {
      this.hover = null;
    } else {
      this.hover = { gx, gy };
    }

    // delegate snap computation to placer when in placement mode
    if (this.placer.isActive()) {
      this.placer.computeSnap(canvasX, canvasY, viewportW, viewportH);
    }
  }

  handleBuildingClick(canvasX: number, canvasY: number, modifier?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    if (!this.isOpen()) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const tileScale = computeCityScale(this.size, viewportW, viewportH);
    const origin = cellOrigin(this.size);
    const tw = TILE_W * tileScale;
    const td = TILE_D * tileScale;

    const screenOriginY = viewportH / 2 - ((this.size - 1) * TILE_D / 2 + this.size * TILE_D * 0.18) * tileScale;
    const wdx = canvasX - viewportW / 2 - origin.x * tileScale;
    const wdy = canvasY - screenOriginY - origin.y * tileScale;
    const gxf = wdx / tw + wdy / td;
    const gyf = wdy / td - wdx / tw;
    const gx = Math.floor(gxf);
    const gy = Math.floor(gyf);

    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) {
      this.buildingMenu.hide();
      if (!modifier?.ctrlKey && !modifier?.metaKey) this.clearSelection();
      return;
    }

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
    const building = this.placer.buildings.find((b) => coversCell(b, gx, gy));
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
    const screenOrigin = { x: viewportW / 2, y: viewportH / 2 - ((this.size - 1) * TILE_D / 2 + this.size * TILE_D * 0.18) * tileScale };
    const gridOrigin = cellOrigin(this.size);
    const w = building.w ?? 1;
    const h = building.h ?? 1;
    const fp = buildingFootprint(building.gx, building.gy, gridOrigin, screenOrigin, tileScale, w, h);

    this.buildingMenu.show(building, fp.cx, fp.cy - fp.hh * 0.6, this.getSettlement());
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
      const b = this.placer.buildings.find((x) => x.gx === gx && x.gy === gy && x.kind === kind);
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
    this.placer.init(this.size, { gx: Math.floor(this.size / 2), gy: Math.floor(this.size / 2) }, buildings, this.style);
    this.updateBuildButton();
  }

  private openBuildPalette(): void {
    const x = 12;
    const y = Math.max(20, window.innerHeight - 480);
    this.placer.showPalette(document.body, x, y);
    this.updateBuildButton();
  }

  private persistBuildings(): void {
    if (!this.openSettlementId) return;
    const netCost = this.placer.getNetCost();
    this.onClose(this.openSettlementId, [...this.placer.buildings], netCost);
    this.refreshAffordability();
    this.updateBuildButton();
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
    const finalBuildings = [...this.placer.buildings];
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
      this.onClose(id, finalBuildings, this.placer.getNetCost());
      return id;
    } finally {
      this.closing = false;
    }
  }
}
