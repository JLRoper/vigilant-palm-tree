import { ARMY_STACK_SLOTS, type Platoon } from "../../state/units";
import { catalogFailed, catalogReady, getCachedUnit, loadUnitCatalog } from "../../data/unitCatalog";
import { getUnitImageUrl } from "../../data/unitImages";

// A 4x2 grid of square unit tiles over one set of army slots (a hero's army, a
// settlement garrison, ...). It is the shared representation behind the hero
// panel's Army section and the garrison grids: identical art, identical count
// badges, identical drag behaviour, so a change here lands in every place that
// shows troops as squares.
//
// Drag semantics: a tile dragged onto another tile of the SAME grid is a
// reorder (onReorder); a tile dragged in from ANOTHER grid is a transfer
// (onDropFromOtherGrid), which is how garrison <-> hero-army moves work.

export interface SquadDragSource {
  gridId: string;
  slotIdx: number;
}

export type SquadReorderHandler = (fromIdx: number, toIdx: number) => void;
export type SquadCrossDropHandler = (fromSlotIdx: number, toSlotIdx: number) => void;

export interface SquadGridOptions {
  /** Identifies this grid among the grids on screen (drag routing). */
  gridId: string;
  /** Drop of one of this grid's tiles onto another of its tiles. */
  onReorder?: SquadReorderHandler;
  /** Drop of a tile dragged in from a different grid. */
  onDropFromOtherGrid?: SquadCrossDropHandler;
  /** Called after any successful drop, so the host can refresh. */
  onDropped?: () => void;
}

interface SquadTile {
  tile: HTMLDivElement;
  img: HTMLImageElement;
  count: HTMLSpanElement;
  extra: HTMLSpanElement;
}

// One drag at a time, shared across every grid on the page: a drop needs to
// know which grid (and slot) the dragged tile came from. dataTransfer carries a
// copy for cross-document/frame robustness, but the in-memory source is what
// the handlers trust (dataTransfer payloads are restricted in some browsers).
let activeDrag: SquadDragSource | null = null;

export function activeSquadDrag(): SquadDragSource | null {
  return activeDrag;
}

export class SquadGrid {
  readonly element: HTMLDivElement;

  private readonly gridId: string;
  private readonly onReorder?: SquadReorderHandler;
  private readonly onDropFromOtherGrid?: SquadCrossDropHandler;
  private readonly onDropped?: () => void;
  private readonly tiles: SquadTile[] = [];
  private interactive = true;

  constructor(opts: SquadGridOptions) {
    this.gridId = opts.gridId;
    this.onReorder = opts.onReorder;
    this.onDropFromOtherGrid = opts.onDropFromOtherGrid;
    this.onDropped = opts.onDropped;

    this.element = document.createElement("div");
    Object.assign(this.element.style, {
      display: "grid",
      gridTemplateColumns: `repeat(4, 1fr)`,
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
      this.element.appendChild(tile);
      this.tiles.push({ tile, img, count, extra });
    }
  }

  /** Off while the surface must not change state (e.g. a settlement you do not
   * own): tiles stop being draggable and stop accepting drops. */
  setInteractive(value: boolean): void {
    this.interactive = value;
    for (const { tile } of this.tiles) {
      tile.draggable = value;
      tile.style.cursor = value ? "grab" : "default";
    }
  }

  /**
   * Hides/shows the whole grid. Never assign `display = ""` to reveal it: that
   * drops the inline `display: grid` and turns the 4-column grid into a
   * full-width column of 1:1 squares.
   */
  setVisible(value: boolean): void {
    this.element.style.display = value ? "grid" : "none";
  }

  render(stacks: Platoon[]): void {
    if (!catalogReady() && !catalogFailed()) {
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

  private attachDragHandlers(el: HTMLElement, slotIdx: number): void {
    el.draggable = true;
    el.style.cursor = "grab";
    el.addEventListener("dragstart", (e) => {
      if (!this.interactive) {
        e.preventDefault();
        return;
      }
      activeDrag = { gridId: this.gridId, slotIdx };
      el.dataset.dragging = "true";
      el.style.opacity = "0.35";
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(activeDrag));
      }
    });
    el.addEventListener("dragend", () => {
      activeDrag = null;
      delete el.dataset.dragging;
      el.style.opacity = "";
      this.clearHighlights();
    });
    el.addEventListener("dragover", (e) => {
      if (!this.interactive || !activeDrag) return;
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
      if (!this.interactive) return;
      const source = activeDrag ?? readDragPayload(e);
      activeDrag = null;
      if (!source) return;
      if (source.gridId === this.gridId) {
        if (source.slotIdx !== slotIdx) {
          this.onReorder?.(source.slotIdx, slotIdx);
          this.onDropped?.();
        }
        return;
      }
      this.onDropFromOtherGrid?.(source.slotIdx, slotIdx);
      this.onDropped?.();
    });
  }

  private clearHighlights(): void {
    for (const { tile } of this.tiles) {
      tile.style.outline = "";
      tile.style.outlineOffset = "";
    }
  }
}

function readDragPayload(e: DragEvent): SquadDragSource | null {
  const raw = e.dataTransfer?.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SquadDragSource;
    if (typeof parsed?.gridId === "string" && Number.isInteger(parsed?.slotIdx)) return parsed;
  } catch {
    /* not our payload */
  }
  return null;
}
