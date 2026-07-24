import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../core/cityGrid";
import { computeCityScale, drawCityView } from "../render/cityRenderer";
import type { ResourceType } from "../map/resourceTiles";
import type { SpriteProvider } from "../render/assets";
import type { BuildingDef, GenerationStyle } from "../render/cityBuildingDraw";
import { coversCell, buildingFootprint } from "../render/cityBuildingDraw";
import { generateBuildings, type GenerationPattern } from "../render/cityBuildingGen";
import { BuildingMenu } from "./buildingMenu";
import { BuildingPlacer } from "./buildingPlacer";

export class CityView {
  private backBtn: HTMLButtonElement | null = null;
  private buildBtn: HTMLButtonElement | null = null;
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
  private onClose: () => void;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: { onClose: () => void; provider: SpriteProvider }) {
    this.provider = opts.provider;
    this.buildingMenu = new BuildingMenu();
    this.placer = new BuildingPlacer();
    this.onClose = opts.onClose;
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.buildingMenu.isOpen()) {
          this.buildingMenu.hide();
          return;
        }
        if (this.placer.isActive()) {
          this.placer.cancelPlacement();
          this.placer.hidePalette();
          this.updateBuildButton();
          return;
        }
        if (this.placer.isPaletteOpen()) {
          this.placer.hidePalette();
          return;
        }
        this.handleClose();
        return;
      }
      if (e.key === "b" || e.key === "B") {
        if (this.placer.isActive()) {
          this.placer.cancelPlacement();
          this.placer.hidePalette();
        } else if (this.placer.isPaletteOpen()) {
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
  ): void {
    this.openSettlementId = settlementId;
    this.settlementName = name;
    this.size = size;
    this.ownerColor = ownerColor;
    this.citySpots = spots;
    this.cityMines = mines;
    this.hover = null;

    const buildings = this.generateBuildingsArray();
    this.placer.init(size, { gx: Math.floor(size / 2), gy: Math.floor(size / 2) }, buildings, this.style);

    this.backBtn = document.createElement("button");
    this.backBtn.textContent = "\u2190 Back";
    Object.assign(this.backBtn.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "100",
      padding: "4px 12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
    });
    this.backBtn.addEventListener("click", () => this.handleClose());
    document.body.appendChild(this.backBtn);

    this.createBuildButton();

    window.addEventListener("keydown", this.onKeyDown);
  }

  isOpen(): boolean {
    return this.openSettlementId !== null;
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

  handleBuildingClick(canvasX: number, canvasY: number): void {
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
      return;
    }

    // placement mode: place building
    if (this.placer.isActive()) {
      const placed = this.placer.place();
      if (placed) {
        this.updateBuildButton();
      }
      return;
    }

    // inspection mode: show building menu
    const building = this.placer.buildings.find((b) => coversCell(b, gx, gy));
    if (!building) {
      this.buildingMenu.hide();
      return;
    }

    const screenOrigin = { x: viewportW / 2, y: viewportH / 2 - ((this.size - 1) * TILE_D / 2 + this.size * TILE_D * 0.18) * tileScale };
    const gridOrigin = cellOrigin(this.size);
    const w = building.w ?? 1;
    const h = building.h ?? 1;
    const fp = buildingFootprint(building.gx, building.gy, gridOrigin, screenOrigin, tileScale, w, h);

    this.buildingMenu.show(building, fp.cx, fp.cy - fp.hh * 0.6);
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
    const x = window.innerWidth - 220;
    const y = 60;
    this.placer.showPalette(document.body, x, y);
    this.updateBuildButton();
  }

  private createBuildButton(): void {
    if (this.buildBtn) this.buildBtn.remove();
    this.buildBtn = document.createElement("button");
    this.buildBtn.textContent = this.placer.isActive() ? "\u2716 Cancel Build" : "\u2692 Build";
    Object.assign(this.buildBtn.style, {
      position: "fixed",
      top: "44px",
      right: "12px",
      zIndex: "100",
      padding: "4px 12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: this.placer.isActive() ? "rgba(120,40,40,0.7)" : "rgba(0,0,0,0.7)",
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
    });
    this.buildBtn.addEventListener("click", () => {
      if (this.placer.isActive()) {
        this.placer.cancelPlacement();
        this.placer.hidePalette();
      } else if (this.placer.isPaletteOpen()) {
        this.placer.hidePalette();
      } else {
        this.openBuildPalette();
      }
      this.updateBuildButton();
    });
    document.body.appendChild(this.buildBtn);
  }

  private updateBuildButton(): void {
    if (!this.buildBtn) return;
    this.buildBtn.textContent = this.placer.isActive() ? "\u2716 Cancel Build" : "\u2692 Build";
    this.buildBtn.style.background = this.placer.isActive()
      ? "rgba(120,40,40,0.7)"
      : "rgba(0,0,0,0.7)";
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
    const id = this.openSettlementId;
    this.lastClosedId = id;
    try {
      this.placer.cancelPlacement();
      this.placer.hidePalette();
      if (this.backBtn) {
        this.backBtn.remove();
        this.backBtn = null;
      }
      if (this.buildBtn) {
        this.buildBtn.remove();
        this.buildBtn = null;
      }
      window.removeEventListener("keydown", this.onKeyDown);
      this.buildingMenu.hide();
      this.openSettlementId = null;
      this.hover = null;
      this.onClose();
      return id;
    } finally {
      this.closing = false;
    }
  }
}
