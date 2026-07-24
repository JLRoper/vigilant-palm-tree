import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../core/cityGrid";
import { computeCityScale, drawCityView } from "../render/cityRenderer";
import type { ResourceType } from "../map/resourceTiles";
import type { SpriteProvider } from "../render/assets";
import type { BuildingDef, GenerationStyle } from "../render/cityBuildingDraw";
import { coversCell, buildingFootprint } from "../render/cityBuildingDraw";
import { generateBuildings, type GenerationPattern } from "../render/cityBuildingGen";
import { BuildingMenu } from "./buildingMenu";

export class CityView {
  private backBtn: HTMLButtonElement | null = null;
  private openSettlementId: string | null = null;
  private settlementName = "";
  private size: CityViewSize = 5;
  private ownerColor = "#888888";
  private hover: { gx: number; gy: number } | null = null;
  private citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }> = [];
  private cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }> = [];
  private buildings: BuildingDef[] = [];
  private style: GenerationStyle = "classic";
  private pattern: GenerationPattern = "denseUrban";
  private seed = 42;
  private provider: SpriteProvider;
  private buildingMenu: BuildingMenu;
  private onClose: () => void;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(opts: { onClose: () => void; provider: SpriteProvider }) {
    this.provider = opts.provider;
    this.buildingMenu = new BuildingMenu();
    this.onClose = opts.onClose;
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.buildingMenu.isOpen()) {
          this.buildingMenu.hide();
          return;
        }
        this.handleClose();
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

    const center = Math.floor(size / 2);
    this.buildings = generateBuildings({
      size,
      pattern: this.pattern,
      style: this.style,
      seed: this.seed,
      townHallAt: { gx: center, gy: center },
    });

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
      buildings: this.buildings,
      style: this.style,
      pattern: this.pattern,
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
  }

  handleBuildingClick(canvasX: number, canvasY: number): void {
    if (!this.isOpen()) return;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const tileScale = computeCityScale(this.size, viewportW, viewportH);
    const tw = TILE_W * tileScale;
    const td = TILE_D * tileScale;
    const origin = cellOrigin(this.size);

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

    const building = this.buildings.find((b) => coversCell(b, gx, gy));
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

  private regenerate(): void {
    if (!this.isOpen()) return;
    const center = Math.floor(this.size / 2);
    this.buildings = generateBuildings({
      size: this.size,
      pattern: this.pattern,
      style: this.style,
      seed: this.seed,
      townHallAt: { gx: center, gy: center },
    });
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
      if (this.backBtn) {
        this.backBtn.remove();
        this.backBtn = null;
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
