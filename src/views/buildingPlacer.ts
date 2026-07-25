import { TILE_W, TILE_D, cellOrigin, type CityViewSize } from "../core/cityGrid";
import { computeCityScale } from "../render/cityRenderer";
import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw";
import { coversCell as reCoversCell } from "../render/cityBuildingDraw";
import { PopupMenu, styleButton, menuTheme } from "./menu";

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
  "townHall", "house", "tower", "archeryRange", "barracks", "smithy",
  "market", "mine", "mageGuild", "apartment", "farmField", "farmhouse",
];

type PaletteMode = "build" | "destroy";

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
  private paletteMode: PaletteMode = "build";
  private onPlaced: (() => void) | null = null;
  private selectedKind: BuildingKind | null = null;
  private onConfirm: (() => void) | null = null;

  init(size: CityViewSize, center: { gx: number; gy: number }, initialBuildings: BuildingDef[], style: string): void {
    this.size = size;
    this.center = center;
    this.buildings = [...initialBuildings];
    this.style = style;
    this.active = null;
    this.hoverCell = null;
    this.valid = false;
    this.selectedKind = null;
  }

  isActive(): boolean {
    return this.active !== null;
  }

  selectBuilding(kind: BuildingKind): void {
    this.selectedKind = kind;
    this.active = kind;
    const fp = defaultFootprint(kind);
    this.w = fp.w;
    this.h = fp.h;
    this.hoverCell = null;
    this.valid = false;
    this.refreshPaletteSelection();
  }

  confirmPlacement(): boolean {
    if (!this.active || !this.hoverCell || !this.valid) return false;
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
    return true;
  }

  cancelPlacement(): void {
    this.active = null;
    this.selectedKind = null;
    this.hoverCell = null;
    this.valid = false;
  }

  // ─── palette popup ──────────────────────────────────────────────────

  showPalette(parent: HTMLElement, anchorX: number, anchorY: number): void {
    this.hidePalette();
    this.paletteMode = "build";
    this.selectedKind = null;

    this.palette = new PopupMenu({
      parent,
      title: "Building Palette",
      width: 220,
      initialPosition: { x: anchorX, y: anchorY },
      onClose: () => this.handlePaletteClose(),
    });
    this.palette.setDraggable(true);

    this.renderPaletteBody();
  }

  private handlePaletteClose(): void {
    this.cancelPlacement();
    this.palette = null;
  }

  private refreshPaletteSelection(): void {
    if (!this.palette) return;
    this.renderPaletteBody();
  }

  private renderPaletteBody(): void {
    if (!this.palette) return;
    this.palette.clearContent();

    // ── mode toggle row ──
    const modeRow = document.createElement("div");
    Object.assign(modeRow.style, {
      display: "flex",
      gap: "6px",
      marginBottom: "10px",
    });

    modeRow.appendChild(this.makeModeButton("Build", "build"));
    modeRow.appendChild(this.makeModeButton("Destroy", "destroy"));
    this.palette.appendContent(modeRow);
    this.palette.appendContent(modeRow);

    // ── content area ──
    if (this.paletteMode === "build") {
      this.renderBuildList();
    } else {
      this.renderDestroyInstructions();
    }

    // ── action bar ──
    const actionRow = document.createElement("div");
    Object.assign(actionRow.style, {
      display: "flex",
      gap: "6px",
      marginTop: "10px",
      justifyContent: "flex-end",
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "\u2713 Confirm";
    styleButton(confirmBtn, true);
    confirmBtn.addEventListener("click", () => {
      this.cancelPlacement();
      this.hidePalette();
      this.onConfirm?.();
    });
    actionRow.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "\u2715 Cancel";
    styleButton(cancelBtn);
    cancelBtn.addEventListener("click", () => {
      this.cancelPlacement();
      this.hidePalette();
    });
    actionRow.appendChild(cancelBtn);

    this.palette.appendContent(actionRow);
  }

  private makeModeButton(label: string, mode: PaletteMode): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    const isActive = this.paletteMode === mode;
    Object.assign(btn.style, {
      flex: "1",
      padding: "4px 6px",
      background: isActive ? "rgba(60,120,60,0.8)" : "rgba(255,255,255,0.08)",
      color: "#eee",
      border: `1px solid ${isActive ? "rgba(100,200,100,0.6)" : "rgba(255,255,255,0.15)"}`,
      borderRadius: "4px",
      fontSize: "11px",
      cursor: "pointer",
      fontFamily: menuTheme.button.fontFamily,
    });
    btn.addEventListener("click", () => {
      if (this.paletteMode === mode) return;
      this.paletteMode = mode;
      if (mode === "build") {
        this.cancelPlacement();
        this.selectedKind = null;
      } else {
        this.cancelPlacement();
      }
      this.renderPaletteBody();
    });
    return btn;
  }

  private renderBuildList(): void {
    if (!this.palette) return;

    const scrollWrap = document.createElement("div");
    Object.assign(scrollWrap.style, {
      maxHeight: "240px",
      overflowY: "auto",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "3px",
      padding: "2px",
    });

    for (const kind of BUILDABLE_KINDS) {
      const row = document.createElement("button");
      row.textContent = buildingLabel(kind);
      const isSelected = this.selectedKind === kind;
      Object.assign(row.style, {
        width: "100%",
        textAlign: "left",
        padding: "4px 8px",
        marginBottom: "1px",
        background: isSelected ? "rgba(60,120,60,0.6)" : "rgba(255,255,255,0.04)",
        color: "#eee",
        border: isSelected ? "1px solid rgba(100,200,100,0.4)" : "1px solid transparent",
        borderRadius: "2px",
        fontSize: "11px",
        cursor: "pointer",
        fontFamily: menuTheme.button.fontFamily,
      });
      row.addEventListener("click", () => this.selectBuilding(kind));
      scrollWrap.appendChild(row);
    }

    this.palette.appendContent(scrollWrap);

    const hint = document.createElement("div");
    hint.textContent = "Select a building, then click a cell on the grid.";
    Object.assign(hint.style, {
      fontSize: "10px",
      opacity: "0.6",
      marginTop: "6px",
      lineHeight: "1.3",
    });
    this.palette.appendContent(hint);
  }

  private renderDestroyInstructions(): void {
    if (!this.palette) return;

    const msg = document.createElement("div");
    msg.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px;">Click any building on the grid to remove it.</div>
      <div style="font-size:10px;opacity:0.5;">The town hall on the center cell cannot be removed.</div>
    `;
    this.palette.appendContent(msg);
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

  isDestroyMode(): boolean {
    return this.paletteMode === "destroy" && this.isPaletteOpen();
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
    if (this.active === "townHall" && this.buildings.some((b) => b.kind === "townHall")) return false;
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
    return this.confirmPlacement() ? this.buildings[this.buildings.length - 1] : null;
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

  setOnConfirm(cb: (() => void) | null): void {
    this.onConfirm = cb;
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
