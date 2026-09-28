import { ARMY_STACK_SLOTS, type Platoon } from "../../state/units";
import { catalogReady, catalogFailed, getCachedUnit, loadUnitCatalog } from "../../data/unitCatalog";
import { getUnitImageUrl } from "../../data/unitImages";

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

interface ExpandedRow {
  row: HTMLDivElement;
  nameEl: HTMLSpanElement;
  statsEl: HTMLSpanElement;
  countEl: HTMLSpanElement;
}

export class ArmySection {
  readonly element: HTMLDivElement;

  private expanded = false;
  private chevron: HTMLSpanElement;
  private collapsedGrid: HTMLDivElement;
  private expandedList: HTMLDivElement;
  private tiles: CollapsedTile[] = [];
  private rows: ExpandedRow[] = [];
  private onReorder?: ReorderHandler;
  private onToggle?: () => void;

  constructor(opts: ArmySectionOptions = {}) {
    this.onReorder = opts.onReorder;
    this.onToggle = opts.onToggle;

    const armyBlock = document.createElement("div");
    Object.assign(armyBlock.style, {
      marginTop: "4px",
      paddingTop: "8px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    });
    const armyHeader = document.createElement("div");
    Object.assign(armyHeader.style, {
      display: "flex",
      alignItems: "baseline",
      gap: "6px",
      marginBottom: "6px",
      cursor: "pointer",
      userSelect: "none",
    });
    const armyChevron = document.createElement("span");
    armyChevron.textContent = "\u25B6";
    Object.assign(armyChevron.style, {
      fontSize: "9px",
      opacity: "0.55",
      transition: "transform 120ms ease-out",
    });
    this.chevron = armyChevron;
    armyHeader.appendChild(armyChevron);
    const armyTitle = document.createElement("span");
    armyTitle.textContent = "Army";
    Object.assign(armyTitle.style, {
      fontSize: "11px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      flex: "1",
    });
    armyHeader.appendChild(armyTitle);
    const armySlotCount = document.createElement("span");
    armySlotCount.textContent = `${ARMY_STACK_SLOTS} slots`;
    Object.assign(armySlotCount.style, {
      fontSize: "10px",
      opacity: "0.4",
    });
    armyHeader.appendChild(armySlotCount);
    armyHeader.addEventListener("click", () => this.toggle());
    armyBlock.appendChild(armyHeader);

    // Collapsed view: compact 2-row x 4-col grid of square tiles, each showing
    // just the creature image with a count badge in the bottom-right.
    const armyCollapsedGrid = document.createElement("div");
    Object.assign(armyCollapsedGrid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "4px",
    });
    this.collapsedGrid = armyCollapsedGrid;
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
    armyBlock.appendChild(armyCollapsedGrid);

    // Expanded view: one row per stack with name, stats, count (hidden by default).
    const armyList = document.createElement("div");
    this.expandedList = armyList;
    Object.assign(armyList.style, {
      display: "none",
      flexDirection: "column",
      gap: "3px",
      marginTop: "6px",
    });
    for (let i = 0; i < ARMY_STACK_SLOTS; i++) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "16px 1fr auto",
        alignItems: "center",
        gap: "6px",
        padding: "3px 4px",
        borderRadius: "3px",
        background: "rgba(255,255,255,0.03)",
        fontSize: "11px",
        opacity: "0.85",
      });
      const slotIdx = document.createElement("span");
      slotIdx.textContent = String(i + 1);
      Object.assign(slotIdx.style, {
        fontVariantNumeric: "tabular-nums",
        textAlign: "center",
        opacity: "0.4",
      });
      const nameCol = document.createElement("div");
      Object.assign(nameCol.style, { display: "flex", flexDirection: "column", minWidth: "0" });
      const nameEl = document.createElement("span");
      Object.assign(nameEl.style, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      const statsEl = document.createElement("span");
      Object.assign(statsEl.style, {
        fontSize: "10px",
        opacity: "0.55",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      nameCol.appendChild(nameEl);
      nameCol.appendChild(statsEl);
      const countEl = document.createElement("span");
      Object.assign(countEl.style, {
        fontVariantNumeric: "tabular-nums",
        fontWeight: "600",
        opacity: "0.9",
      });
      row.appendChild(slotIdx);
      row.appendChild(nameCol);
      row.appendChild(countEl);
      row.dataset.slotIdx = String(i);
      row.title = "";
      this.attachDragHandlers(row, i);
      armyList.appendChild(row);
      this.rows.push({ row, nameEl, statsEl, countEl });
    }
    armyBlock.appendChild(armyList);

    this.element = armyBlock;
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.chevron.style.transform = this.expanded ? "rotate(90deg)" : "";
    this.collapsedGrid.style.display = this.expanded ? "none" : "grid";
    this.expandedList.style.display = this.expanded ? "flex" : "none";
    // Expanding grows the panel downwards; re-anchor so the extra rows do not
    // push the bottom of the panel off screen. Deliberately not a
    // ResizeObserver -- see plan/2026-08-09-modal-viewport-overflow.md, an
    // observer on the root stops firing once max-height is reached.
    this.onToggle?.();
  }

  // Wires HTML5 drag-and-drop onto an army slot element (either a collapsed
  // tile or an expanded row). The same handler works for both since the slot
  // index is what matters, not the DOM container.
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
      for (const r of this.rows) {
        r.row.style.outline = "";
        r.row.style.outlineOffset = "";
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
      // refresh tick will call update() again and fill in the rows.
      void loadUnitCatalog();
    }
    for (let i = 0; i < ARMY_STACK_SLOTS; i++) {
      const platoon = stacks[i];
      const entries = (platoon?.entries ?? []).filter((e) => e.count > 0);
      const isEmpty = entries.length === 0;
      const primary = isEmpty ? null : entries[0];
      const id = primary?.unitTypeId ?? null;
      const u = id ? getCachedUnit(id) : null;
      const totalCount = entries.reduce((sum, e) => sum + e.count, 0);
      const extraTypes = entries.length - 1;

      // --- Collapsed tile: primary unit's image + total count badge, plus a
      // "+N" badge when the platoon carries more than one unit type. ---
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

      // --- Expanded row: composition + count ---
      const { row, nameEl, statsEl, countEl } = this.rows[i];
      countEl.textContent = isEmpty ? "" : String(totalCount);
      if (isEmpty) {
        nameEl.textContent = "—";
        statsEl.textContent = "empty";
        row.title = "Empty platoon";
        row.style.opacity = "0.35";
      } else if (entries.length > 1) {
        nameEl.textContent = entries.map((e) => getCachedUnit(e.unitTypeId)?.name ?? e.unitTypeId).join(" + ");
        statsEl.textContent = entries.map((e) => `${e.count}x`).join(" / ");
        row.title = `Mixed platoon: ${entries.map((e) => `${getCachedUnit(e.unitTypeId)?.name ?? e.unitTypeId} x${e.count}`).join(", ")}`;
        row.style.opacity = "0.9";
      } else if (u) {
        nameEl.textContent = u.name;
        statsEl.textContent = `A ${u.attack} · D ${u.defence} · H ${u.health} · S ${u.speed}`;
        row.title = `${u.name} — ${u.description}`;
        row.style.opacity = "0.9";
      } else if (catalogReady() || catalogFailed()) {
        // Catalog resolved but this id isn't in it (unknown unit type).
        nameEl.textContent = id!;
        statsEl.textContent = "unknown unit";
        row.title = `Unknown unit type: ${id}`;
        row.style.opacity = "0.55";
      } else {
        nameEl.textContent = id!;
        statsEl.textContent = "loading…";
        row.title = "Loading unit catalog…";
        row.style.opacity = "0.55";
      }
    }
  }
}
