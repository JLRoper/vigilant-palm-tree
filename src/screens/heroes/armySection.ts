import { ARMY_STACK_SLOTS, type Platoon } from "../../state/units";
import { catalogReady, catalogFailed, getCachedUnit, loadUnitCatalog } from "../../data/unitCatalog";
import { getUnitImageUrl } from "../../data/unitImages";
import { AccordionSection } from "@screens/shared/panelWidgets";

export type ReorderHandler = (fromIdx: number, toIdx: number) => void;

export interface ArmySectionOptions {
  onReorder?: ReorderHandler;
  onToggle?: () => void;
}

interface CollapsedTile {
  tile: HTMLDivElement;
  img: HTMLImageElement;
  count: HTMLSpanElement;
  extra: HTMLSpanElement;
}

export class ArmySection {
  readonly element: HTMLDivElement;

  private accordion: AccordionSection;
  private tiles: CollapsedTile[] = [];
  private onReorder?: ReorderHandler;

  constructor(opts: ArmySectionOptions = {}) {
    this.onReorder = opts.onReorder;

    this.accordion = new AccordionSection({ label: "Army", onToggle: opts.onToggle });
    this.accordion.rightEl.textContent = `${ARMY_STACK_SLOTS} slots`;
    this.element = this.accordion.element;

    // Collapsed-expand view: compact 2-row x 4-col grid of square tiles, each
    // showing just the creature image with a count badge in the bottom-right.
    const armyCollapsedGrid = document.createElement("div");
    Object.assign(armyCollapsedGrid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "4px",
    });
    for (let i = 0; i < ARMY_STACK_SLOTS; i++) {
      const tile = document.createElement("div");
      Object.assign(tile.style, {
        position: "relative",
        aspectRatio: "1",
        borderRadius: "4px",
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
      });
      const img = document.createElement("img");
      Object.assign(img.style, {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
      });
      img.alt = "";
      img.draggable = false;
      tile.appendChild(img);
      const count = document.createElement("span");
      Object.assign(count.style, {
        position: "absolute",
        right: "2px",
        bottom: "1px",
        fontSize: "10px",
        fontWeight: "700",
        lineHeight: "1",
        padding: "1px 3px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.65)",
        color: "#f4f4f8",
        fontVariantNumeric: "tabular-nums",
        pointerEvents: "none",
        display: "none",
      });
      tile.appendChild(count);
      const extra = document.createElement("span");
      Object.assign(extra.style, {
        position: "absolute",
        left: "2px",
        top: "1px",
        fontSize: "9px",
        fontWeight: "700",
        lineHeight: "1",
        padding: "1px 3px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.65)",
        color: "#ffcc00",
        pointerEvents: "none",
        display: "none",
      });
      tile.appendChild(extra);
      tile.title = "";
      this.attachDragHandlers(tile, i);
      armyCollapsedGrid.appendChild(tile);
      this.tiles.push({ tile, img, count, extra });
    }
    this.accordion.body.appendChild(armyCollapsedGrid);
  }

  // Wires HTML5 drag-and-drop onto an army tile. The slot index is what
  // matters, not the DOM container.
  private attachDragHandlers(el: HTMLElement, slotIdx: number): void {
    el.draggable = true;
    el.style.cursor = "grab";
    el.addEventListener("dragstart", (e) => {
      el.dataset.dragging = "true";
      el.style.opacity = "0.35";
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(slotIdx));
      }
      console.debug("[army] dragstart from slot", slotIdx, "onReorder?", !!this.onReorder);
    });
    el.addEventListener("dragend", () => {
      delete el.dataset.dragging;
      el.style.opacity = "";
      el.style.outline = "";
      el.style.outlineOffset = "";
      // Defensive cleanup in case dragleave didn't fire for any sibling target.
      for (const t of this.tiles) {
        t.tile.style.outline = "";
        t.tile.style.outlineOffset = "";
      }
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      el.style.outline = "2px solid #ffcc00";
      el.style.outlineOffset = "1px";
    });
    el.addEventListener("dragleave", () => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.style.outline = "";
      el.style.outlineOffset = "";
      const raw = e.dataTransfer?.getData("text/plain");
      const fromIdx = raw != null ? parseInt(raw, 10) : NaN;
      console.debug("[army] drop on slot", slotIdx, "raw=", raw, "fromIdx=", fromIdx, "valid=", Number.isInteger(fromIdx) && fromIdx !== slotIdx);
      if (Number.isInteger(fromIdx) && fromIdx !== slotIdx) {
        console.debug("[army] calling onReorder(", fromIdx, "->", slotIdx, ")");
        this.onReorder?.(fromIdx, slotIdx);
      }
    });
  }

  render(stacks: Platoon[]): void {
    if (!catalogReady() && !catalogFailed()) {
      // Catalog still loading: kick off a fetch; when it resolves, the HUD
      // refresh tick will call update() again and fill in the tiles.
      void loadUnitCatalog();
    }
    for (let i = 0; i < ARMY_STACK_SLOTS; i++) {
      const platoon = stacks[i];
      const entries = (platoon?.entries ?? []).filter((e) => e.count > 0);
      const isEmpty = entries.length === 0;
      const primary = isEmpty ? null : entries[0];
      const id = primary?.unitTypeId ?? null;
      const totalCount = entries.reduce((sum, e) => sum + e.count, 0);
      const extraTypes = entries.length - 1;

      // Collapsed tile: primary unit's image + total count badge, plus a
      // "+N" badge when the platoon carries more than one unit type.
      const { tile, img, count, extra } = this.tiles[i];
      if (isEmpty) {
        img.src = "";
        img.style.display = "none";
        count.style.display = "none";
        extra.style.display = "none";
        tile.style.opacity = "0.3";
        tile.title = `Slot ${i + 1}: empty`;
      } else {
        img.src = getUnitImageUrl(id);
        img.style.display = "block";
        count.textContent = String(totalCount);
        count.style.display = "block";
        tile.style.opacity = "1";
        if (extraTypes > 0) {
          extra.textContent = `+${extraTypes}`;
          extra.style.display = "block";
        } else {
          extra.style.display = "none";
        }
        const composition = entries
          .map((e) => `${getCachedUnit(e.unitTypeId)?.name ?? e.unitTypeId} x${e.count}`)
          .join(", ");
        tile.title = `Slot ${i + 1}: ${composition}`;
      }
    }
  }
}
