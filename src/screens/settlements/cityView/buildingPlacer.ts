import { cityLayout, screenToGridCell } from "../../../core/cityGrid";
import type { CityViewSize } from "@heroes/engine";
import type { BuildingDef, BuildingKind } from "../../../render/cityBuildingDraw";
import { coversCell as reCoversCell } from "../../../render/cityBuildingDraw";
import { PopupMenu, styleButton, menuTheme } from "@screens/shared/menu";
import { savePanelGeometry } from "@screens/shared/panelLayout";
import { toolbarHeight } from "@screens/shared/panelRail";
import {
  buildingPlacementCost,
  buildingLabel,
  buildingBuildDays,
  buildingFootprintFromRegistry,
} from "@heroes/engine";
import { buildListSections } from "./buildListSections";
import { pickStyleForBuilding } from "../../../render/assetDescriptors";
import type { ResourceType } from "../../../state/gameState";
import resourceGoldPileSmol from "../../../resources/resource-gold-pile-smol.png?url";
import resourceWoodPileSmol from "../../../resources/resource-wood-pile-smol.png?url";
import resourceStonePileSmol from "../../../resources/resource-stone-pile-smol.png?url";
import resourceIronPileSmol from "../../../resources/resource-iron-pile-smol.png?url";
import resourceArcanePileSmol from "../../../resources/resource-arcane-pile-smol.png?url";

type PaletteMode = "build" | "destroy";

const DESTROY_REFUND_PCT = 0.5;

const RESOURCE_ICON_URLS: Partial<Record<ResourceType, string>> = {
  gold: resourceGoldPileSmol,
  wood: resourceWoodPileSmol,
  stone: resourceStonePileSmol,
  iron: resourceIronPileSmol,
  arcane: resourceArcanePileSmol,
};

const RESOURCE_ORDER: ResourceType[] = ["gold", "wood", "stone", "iron", "arcane"];

const HOURGLASS_SVG = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
    <path d="M8 4h16v4l-8 8-8-8V4z" fill="#c8a050" stroke="#8a6a30" stroke-width="1"/>
    <path d="M8 28h16v-4l-8-8-8 8v4z" fill="#e0c060" stroke="#8a6a30" stroke-width="1"/>
    <line x1="10" y1="16" x2="22" y2="16" stroke="#8a6a30" stroke-width="1.5"/>
  </svg>`
)}`;

const ICON_SIZE = 14;

export interface Affordability {
  gold: number;
  warehouse: {
    wood: number;
    stone: number;
    iron: number;
    arcane: number;
    food: number;
  };
}

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
  private originalBuildings: BuildingDef[] = [];
  private affordability: Affordability | null = null;
  /** Net cost already committed server-side since the view opened; canAfford gates only the uncommitted remainder. */
  private committedNet: Partial<Record<ResourceType, number>> = {};

  init(size: CityViewSize, center: { gx: number; gy: number }, initialBuildings: BuildingDef[], style: string): void {
    this.size = size;
    this.center = center;
    this.buildings = [...initialBuildings];
    this.originalBuildings = [...initialBuildings];
    this.committedNet = {};
    this.style = style;
    this.active = null;
    this.hoverCell = null;
    this.valid = false;
    this.selectedKind = null;
  }

  setAffordability(aff: Affordability | null): void {
    this.affordability = aff;
  }

  isActive(): boolean {
    return this.active !== null;
  }

  selectBuilding(kind: BuildingKind): void {
    this.selectedKind = kind;
    this.active = kind;
    const fp = buildingFootprintFromRegistry(kind);
    this.w = fp.w;
    this.h = fp.h;
    this.hoverCell = null;
    this.valid = false;
    this.refreshPaletteSelection();
  }

  confirmPlacement(): boolean {
    if (!this.active || !this.hoverCell || !this.valid) return false;
    // A placement that would push the cart past affordability is rejected
    // outright -- the server applies the same check and a rejected command
    // would leave a building on screen that was never paid for.
    if (!this.canAfford()) return false;
    const style = pickStyleForBuilding(this.active, 1, this.style);
    const b: BuildingDef = {
      gx: this.hoverCell.gx,
      gy: this.hoverCell.gy,
      kind: this.active,
      level: 1,
      style: style as BuildingDef["style"],
      w: this.w,
      h: this.h,
      construction: { daysRemaining: buildingBuildDays(this.active) },
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

  // ─── net cost calculation for shopping cart model ────────────────────

  private computeNetCost(): Partial<Record<ResourceType, number>> {
    const net: Partial<Record<ResourceType, number>> = {};
    const origMap = new Map<string, BuildingDef>();
    for (const b of this.originalBuildings) {
      origMap.set(`${b.gx},${b.gy}`, b);
    }
    const currMap = new Map<string, BuildingDef>();
    for (const b of this.buildings) {
      currMap.set(`${b.gx},${b.gy}`, b);
    }

    for (const b of this.buildings) {
      if (!origMap.has(`${b.gx},${b.gy}`)) {
        const cost = buildingPlacementCost(b.kind);
        for (const [r, v] of Object.entries(cost)) {
          net[r as ResourceType] = (net[r as ResourceType] ?? 0) + v;
        }
      }
    }

    for (const b of this.originalBuildings) {
      if (!currMap.has(`${b.gx},${b.gy}`)) {
        const cost = buildingPlacementCost(b.kind);
        for (const [r, v] of Object.entries(cost)) {
          net[r as ResourceType] = (net[r as ResourceType] ?? 0) - Math.ceil(v * DESTROY_REFUND_PCT);
        }
      }
    }

    return net;
  }

  getNetCost(): Partial<Record<ResourceType, number>> {
    return this.computeNetCost();
  }

  canAfford(): boolean {
    if (!this.affordability) return true;
    const net = this.computeNetCost();
    const committed = this.committedNet;
    const goldCost = Math.max(0, (net.gold ?? 0) - (committed.gold ?? 0));
    if (goldCost > this.affordability.gold) return false;
    const woodCost = Math.max(0, (net.wood ?? 0) - (committed.wood ?? 0));
    if (woodCost > this.affordability.warehouse.wood) return false;
    const stoneCost = Math.max(0, (net.stone ?? 0) - (committed.stone ?? 0));
    if (stoneCost > this.affordability.warehouse.stone) return false;
    const ironCost = Math.max(0, (net.iron ?? 0) - (committed.iron ?? 0));
    if (ironCost > this.affordability.warehouse.iron) return false;
    const arcaneCost = Math.max(0, (net.arcane ?? 0) - (committed.arcane ?? 0));
    if (arcaneCost > this.affordability.warehouse.arcane) return false;
    return true;
  }

  /** Called after a successful incremental PlaceBuildings commit: the baseline advances, so already-paid buildings stop counting toward affordability. */
  markSynced(): void {
    this.committedNet = { ...this.computeNetCost() };
  }

  canAffordSingle(kind: BuildingKind): boolean {
    if (!this.affordability) return true;
    const cost = buildingPlacementCost(kind);
    if ((cost.gold ?? 0) > this.affordability.gold) return false;
    if ((cost.wood ?? 0) > this.affordability.warehouse.wood) return false;
    if ((cost.stone ?? 0) > this.affordability.warehouse.stone) return false;
    if ((cost.iron ?? 0) > this.affordability.warehouse.iron) return false;
    if ((cost.arcane ?? 0) > this.affordability.warehouse.arcane) return false;
    return true;
  }

  getNetCostSummary(): string {
    const net = this.computeNetCost();
    const parts: string[] = [];
    for (const [r, v] of Object.entries(net)) {
      if (v !== 0) {
        const prefix = r === "gold" ? "g" : r[0];
        const sign = v > 0 ? `+${v}${prefix}` : `${v}${prefix}`;
        parts.push(sign);
      }
    }
    return parts.join(" ") || "No changes";
  }

  // ─── palette popup ──────────────────────────────────────────────────

  showPalette(parent: HTMLElement, anchorX: number, anchorY: number): void {
    this.hidePalette();
    this.paletteMode = "build";
    this.selectedKind = null;

    this.palette = new PopupMenu({
      parent,
      title: "Building Palette",
      width: 240,
      initialPosition: { x: anchorX, y: anchorY },
      minTop: toolbarHeight,
      zIndex: 75,
      clickToFront: true,
      onClose: () => this.handlePaletteClose(),
      onMove: (pos) => savePanelGeometry("buildPalette", pos),
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

    const modeRow = document.createElement("div");
    Object.assign(modeRow.style, {
      display: "flex",
      gap: "6px",
      marginBottom: "10px",
    });

    modeRow.appendChild(this.makeModeButton("Build", "build"));
    modeRow.appendChild(this.makeModeButton("Destroy", "destroy"));
    this.palette.appendContent(modeRow);

    if (this.paletteMode === "build") {
      this.renderBuildList();
    } else {
      this.renderDestroyInstructions();
    }

    const costSummary = this.getNetCostSummary();
    if (costSummary !== "No changes") {
      const summaryDiv = document.createElement("div");
      summaryDiv.textContent = `Cart: ${costSummary}`;
      Object.assign(summaryDiv.style, {
        fontSize: "10px",
        color: this.canAfford() ? "#8f8" : "#f88",
        marginTop: "6px",
        padding: "3px 6px",
        background: "rgba(0,0,0,0.3)",
        borderRadius: "3px",
      });
      this.palette.appendContent(summaryDiv);
    }

    const actionRow = document.createElement("div");
    Object.assign(actionRow.style, {
      display: "flex",
      gap: "6px",
      marginTop: "10px",
      justifyContent: "flex-end",
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "\u2713 Confirm";
    styleButton(confirmBtn, this.canAfford());
    if (!this.canAfford()) {
      confirmBtn.style.opacity = "0.4";
      confirmBtn.style.cursor = "not-allowed";
      confirmBtn.title = "Cannot afford the net cost of these changes";
    }
    confirmBtn.addEventListener("click", () => {
      if (!this.canAfford()) return;
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

    const sections = buildListSections();

    for (const { title: sectionTitle, kinds } of sections) {
      if (kinds.length === 0) continue;
      const header = document.createElement("div");
      header.textContent = sectionTitle;
      Object.assign(header.style, {
        fontSize: "10px",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        opacity: "0.5",
        margin: "4px 4px 2px",
      });
      scrollWrap.appendChild(header);
      for (const kind of kinds) {
        const row = document.createElement("button");
        const label = buildingLabel(kind);
        const cost = buildingPlacementCost(kind);
        const days = buildingBuildDays(kind);
        const canAfford = this.canAffordSingle(kind);
        const hasTownHall = kind === "townHall" && this.buildings.some((b) => b.kind === "townHall");
        const isSelected = this.selectedKind === kind;
        const disabled = !canAfford || hasTownHall;

        Object.assign(row.style, {
          width: "100%",
          textAlign: "left",
          padding: "3px 6px",
          marginBottom: "1px",
          background: isSelected ? "rgba(60,120,60,0.6)" : "rgba(255,255,255,0.04)",
          color: disabled ? "#666" : "#eee",
          border: isSelected ? "1px solid rgba(100,200,100,0.4)" : "1px solid transparent",
          borderRadius: "2px",
          fontSize: "11px",
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: menuTheme.button.fontFamily,
          opacity: disabled ? "0.5" : "1",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        });

        const costWrap = document.createElement("span");
        Object.assign(costWrap.style, {
          display: "flex",
          alignItems: "center",
          gap: "1px",
          flexShrink: "0",
        });

        if (days > 0) {
          const hgIcon = document.createElement("img");
          hgIcon.src = HOURGLASS_SVG;
          Object.assign(hgIcon.style, {
            width: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
            imageRendering: "pixelated",
          });
          costWrap.appendChild(hgIcon);
          const hgNum = document.createElement("span");
          hgNum.textContent = `${days}`;
          Object.assign(hgNum.style, { fontSize: "10px", marginRight: "3px" });
          costWrap.appendChild(hgNum);
        }

        for (const r of RESOURCE_ORDER) {
          const v = cost[r];
          if (!v) continue;
          const url = RESOURCE_ICON_URLS[r];
          if (url) {
            const icon = document.createElement("img");
            icon.src = url;
            Object.assign(icon.style, {
              width: `${ICON_SIZE}px`,
              height: `${ICON_SIZE}px`,
              imageRendering: "pixelated",
            });
            costWrap.appendChild(icon);
          }
          const num = document.createElement("span");
          num.textContent = `${v}`;
          Object.assign(num.style, { fontSize: "10px", marginRight: "3px" });
          costWrap.appendChild(num);
        }

        const labelSpan = document.createElement("span");
        labelSpan.textContent = hasTownHall ? `${label} (built)` : label;
        Object.assign(labelSpan.style, { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

        row.appendChild(costWrap);
        row.appendChild(labelSpan);

        row.addEventListener("click", () => {
          if (disabled) return;
          this.selectBuilding(kind);
        });
        scrollWrap.appendChild(row);
      }
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

    const refundPct = Math.round(DESTROY_REFUND_PCT * 100);
    const msg = document.createElement("div");
    msg.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px;">Click any building on the grid to remove it. (${refundPct}% refund)</div>
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

    const layout = cityLayout(this.size, viewportW, viewportH);
    const cell = screenToGridCell(layout, this.size, viewportW, canvasX, canvasY);

    if (!cell) {
      this.hoverCell = null;
      this.valid = false;
      return;
    }

    this.hoverCell = cell;
    this.valid = this.canPlaceAt(cell.gx, cell.gy);
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
