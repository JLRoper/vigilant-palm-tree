import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../core/cityGrid";
import { computeCityScale } from "../render/cityRenderer";
import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw";
import { coversCell as reCoversCell } from "../render/cityBuildingDraw";
import { PopupMenu, styleButton } from "./menu";

function buildingLabel(kind: BuildingKind): string {
  const names: Record<BuildingKind, string> = {
    townHall: "Town Hall",
    house: "House",
    tower: "Tower",
    mageGuild: "Mage Guild",
    mine: "Mine",
    market: "Market",
    barracks: "Barracks",
    smithy: "Smithy",
    apartment: "Apartment",
    farmField: "Farm Field",
    farmhouse: "Farmhouse",
    archeryRange: "Archery Range",
  };
  return names[kind] ?? kind;
}

function defaultFootprint(kind: BuildingKind): { w: number; h: number } {
  switch (kind) {
    case "townHall":    return { w: 2, h: 2 };
    case "farmField":   return { w: 2, h: 2 };
    case "apartment":   return { w: 2, h: 2 };
    case "tower":       return { w: 1, h: 1 };
    case "archeryRange": return { w: 1, h: 2 };
    default:            return { w: 1, h: 1 };
  }
}

const BUILDABLE_KINDS: BuildingKind[] = [
  "house", "tower", "archeryRange", "barracks", "smithy",
  "market", "mine", "mageGuild", "apartment", "farmField", "farmhouse",
];

export class BuildingPlacer {
  active: BuildingKind | null = null;
  w = 1;
  h = 1;
  hoverCell: { gx: number; gy: number } | null = null;
  valid = false;
  buildings: BuildingDef[] = [];
  style: string = "classic";

  private size: CityViewSize = 5;
  private center: { gx: number; gy: number } = { gx: 2, gy: 2 };
  private palette: PopupMenu | null = null;
  private onPlaced: (() => void) | null = null;

  init(size: CityViewSize, center: { gx: number; gy: number }, initialBuildings: BuildingDef[], style: string): void {
    this.size = size;
    this.center = center;
    this.buildings = [...initialBuildings];
    this.style = style;
    this.active = null;
    this.hoverCell = null;
    this.valid = false;
  }

  isActive(): boolean {
    return this.active !== null;
  }

  selectBuilding(kind: BuildingKind): void {
    this.active = kind;
    const fp = defaultFootprint(kind);
    this.w = fp.w;
    this.h = fp.h;
    this.hoverCell = null;
    this.valid = false;
    this.hidePalette();
  }

  cancelPlacement(): void {
    this.active = null;
    this.hoverCell = null;
    this.valid = false;
  }

  // ─── palette popup ──────────────────────────────────────────────────

  showPalette(parent: HTMLElement, anchorX: number, anchorY: number): void {
    this.hidePalette();
    this.palette = new PopupMenu({
      parent,
      title: "Build",
      width: 180,
      initialPosition: { x: anchorX, y: anchorY },
      onClose: () => { this.palette = null; },
    });

    for (const kind of BUILDABLE_KINDS) {
      const row = document.createElement("button");
      row.textContent = buildingLabel(kind);
      styleButton(row);
      Object.assign(row.style, {
        width: "100%",
        textAlign: "left",
        marginBottom: "2px",
      });
      row.addEventListener("click", () => this.selectBuilding(kind));
      this.palette.appendContent(row);
    }

    const cancelRow = document.createElement("div");
    cancelRow.style.marginTop = "6px";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    styleButton(cancelBtn);
    cancelBtn.style.width = "100%";
    cancelBtn.addEventListener("click", () => {
      this.cancelPlacement();
      this.hidePalette();
    });
    cancelRow.appendChild(cancelBtn);
    this.palette.appendContent(cancelRow);
  }

  hidePalette(): void {
    if (this.palette) {
      this.palette.close();
      this.palette = null;
    }
  }

  isPaletteOpen(): boolean {
    return this.palette !== null;
  }

  // ─── snap and validation ────────────────────────────────────────────

  computeSnap(canvasX: number, canvasY: number, viewportW: number, viewportH: number): void {
    if (!this.active) {
      this.hoverCell = null;
      this.valid = false;
      return;
    }

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
      this.hoverCell = null;
      this.valid = false;
      return;
    }

    this.hoverCell = { gx, gy };
    this.valid = this.canPlaceAt(gx, gy);
  }

  canPlaceAt(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx + this.w > this.size || gy + this.h > this.size) return false;
    for (let dx = 0; dx < this.w; dx++) {
      for (let dy = 0; dy < this.h; dy++) {
        const cx = gx + dx;
        const cy = gy + dy;
        if (cx === this.center.gx && cy === this.center.gy) return false;
        if (this.buildings.some((b) => reCoversCell(b, cx, cy))) return false;
      }
    }
    return true;
  }

  // ─── place / remove ─────────────────────────────────────────────────

  place(): BuildingDef | null {
    if (!this.active || !this.hoverCell || !this.valid) return null;
    const b: BuildingDef = {
      gx: this.hoverCell.gx,
      gy: this.hoverCell.gy,
      kind: this.active,
      level: 1,
      style: this.style as BuildingDef["style"],
      w: this.w,
      h: this.h,
    };
    this.buildings.push(b);
    this.onPlaced?.();
    return b;
  }

  removeAt(gx: number, gy: number): BuildingDef | null {
    const idx = this.buildings.findIndex((b) => reCoversCell(b, gx, gy));
    if (idx < 0) return null;
    const b = this.buildings[idx];
    if (b.kind === "townHall" && this.isCenterCell(b)) return null;
    this.buildings.splice(idx, 1);
    this.onPlaced?.();
    return b;
  }

  private isCenterCell(b: BuildingDef): boolean {
    const w = b.w ?? 1;
    const h = b.h ?? 1;
    return (
      this.center.gx >= b.gx &&
      this.center.gx < b.gx + w &&
      this.center.gy >= b.gy &&
      this.center.gy < b.gy + h
    );
  }

  setOnPlaced(cb: (() => void) | null): void {
    this.onPlaced = cb;
  }

  // ─── snapshot for rendering ─────────────────────────────────────────

  ghostSnapshot(): { gx: number; gy: number; kind: BuildingKind; w: number; h: number; valid: boolean } | null {
    if (!this.active || !this.hoverCell) return null;
    return {
      gx: this.hoverCell.gx,
      gy: this.hoverCell.gy,
      kind: this.active,
      w: this.w,
      h: this.h,
      valid: this.valid,
    };
  }
}
