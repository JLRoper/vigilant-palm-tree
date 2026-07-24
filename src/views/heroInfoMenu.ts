import type { GameState, Player, SettlementState } from "../state/gameState";
import type { Hero } from "../entities/hero";
import { PopupMenu, menuTheme } from "./menu";
import { ARMY_STACK_SLOTS, type UnitStack } from "../state/units";
import { catalogReady, catalogFailed, getCachedUnit, loadUnitCatalog } from "../data/unitCatalog";
import { getUnitImageUrl } from "../data/unitImages";
import { HERO_BANNERS } from "../render/assetDescriptors";
import { settings } from "../state/settings";

const MOVEMENT_PER_TURN = 7;
const MIN_USABLE_MOVEMENT = 1.0;

function displayableRemaining(remaining: number): number {
  return remaining < MIN_USABLE_MOVEMENT ? 0 : remaining;
}

export type TransferHandler = (
  heroId: string,
  settlementId: string,
  direction: "deposit" | "withdraw",
) => { ok: boolean; reason: string };

export type ReorderHandler = (fromIdx: number, toIdx: number) => void;

export interface HeroInfoMenuOptions {
  parent: HTMLElement;
  onTransfer?: TransferHandler;
  onReorder?: ReorderHandler;
  onClose?: () => void;
}

function makeRow(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    opacity: "0.4",
    fontSize: "12px",
  });
  const lbl = document.createElement("span");
  lbl.textContent = label;
  row.appendChild(lbl);
  const value = document.createElement("span");
  value.textContent = "\u2014";
  value.style.fontVariantNumeric = "tabular-nums";
  row.appendChild(value);
  return { row, value };
}

export class HeroInfoMenu {
  private menu: PopupMenu;
  private visible = false;
  private currentHeroId: string | null = null;

  private bannerEl: HTMLImageElement;
  private nameEl: HTMLElement;
  private goldEl: HTMLElement;
  private foodEl: HTMLElement;
  private movementFill: HTMLElement;
  private movementLabel: HTMLElement;
  private transferRow: HTMLDivElement;
  private withdrawBtn: HTMLButtonElement;
  private depositBtn: HTMLButtonElement;
  private statValues: Record<string, HTMLSpanElement>;

  private onTransfer?: TransferHandler;
  private onReorder?: ReorderHandler;
  private settlementAtTile: SettlementState | null = null;
  private troopsEl: HTMLElement;
  private armyRows: HTMLDivElement[] = [];
  private armyExpanded = false;
  private armyChevron: HTMLSpanElement | null = null;
  private armyCollapsedGrid: HTMLDivElement | null = null;
  private armyExpandedList: HTMLDivElement | null = null;
  private armyTiles: { tile: HTMLDivElement; img: HTMLImageElement; count: HTMLSpanElement }[] = [];

  constructor(opts: HeroInfoMenuOptions) {
    this.onTransfer = opts.onTransfer;
    this.onReorder = opts.onReorder;
    this.statValues = {};

    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Hero",
      initialPosition: { x: 16, y: Math.max(24, window.innerHeight - 280) },
      width: 240,
      closeable: true,
      draggable: true,
      zIndex: 60,
      onClose: () => {
        this.visible = false;
        this.currentHeroId = null;
        opts.onClose?.();
      },
    });

    const body = this.menu.body;

    this.bannerEl = document.createElement("img");
    Object.assign(this.bannerEl.style, {
      width: "100%",
      height: "60px",
      objectFit: "cover",
      objectPosition: "center",
      borderRadius: "3px 3px 0 0",
      marginBottom: "6px",
      display: "block",
    });
    body.appendChild(this.bannerEl);

    this.nameEl = document.createElement("div");
    Object.assign(this.nameEl.style, {
      fontSize: "15px",
      fontWeight: "600",
      color: menuTheme.panel.color,
    });
    body.appendChild(this.nameEl);

    const resourcesRow = document.createElement("div");
    Object.assign(resourcesRow.style, {
      display: "flex",
      gap: "14px",
      alignItems: "baseline",
    });

    const goldWrap = document.createElement("div");
    Object.assign(goldWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
    });
    const goldIcon = document.createElement("span");
    goldIcon.textContent = "\u{1F4B0}";
    goldIcon.style.fontSize = "14px";
    goldWrap.appendChild(goldIcon);
    this.goldEl = document.createElement("span");
    this.goldEl.textContent = "0g";
    goldWrap.appendChild(this.goldEl);
    resourcesRow.appendChild(goldWrap);

    const foodWrap = document.createElement("div");
    Object.assign(foodWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      opacity: "0.5",
    });
    const foodIcon = document.createElement("span");
    foodIcon.textContent = "\u{1F356}";
    foodIcon.style.fontSize = "14px";
    foodWrap.appendChild(foodIcon);
    this.foodEl = document.createElement("span");
    this.foodEl.textContent = "0 food";
    foodWrap.appendChild(this.foodEl);
    resourcesRow.appendChild(foodWrap);

    body.appendChild(resourcesRow);

    this.transferRow = document.createElement("div");
    Object.assign(this.transferRow.style, {
      display: "flex",
      gap: "6px",
      marginTop: "6px",
    });
    this.withdrawBtn = document.createElement("button");
    this.withdrawBtn.textContent = "Withdraw all";
    this.withdrawBtn.style.flex = "1";
    this.withdrawBtn.style.padding = "5px 6px";
    this.withdrawBtn.style.fontSize = "11px";
    this.withdrawBtn.style.cursor = "pointer";
    this.withdrawBtn.addEventListener("click", () => this.handleTransfer("withdraw"));
    this.transferRow.appendChild(this.withdrawBtn);
    this.depositBtn = document.createElement("button");
    this.depositBtn.textContent = "Deposit all";
    this.depositBtn.style.flex = "1";
    this.depositBtn.style.padding = "5px 6px";
    this.depositBtn.style.fontSize = "11px";
    this.depositBtn.style.cursor = "pointer";
    this.depositBtn.addEventListener("click", () => this.handleTransfer("deposit"));
    this.transferRow.appendChild(this.depositBtn);
    body.appendChild(this.transferRow);

    const movementSection = document.createElement("div");
    Object.assign(movementSection.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });

    const movementLabelRow = document.createElement("div");
    Object.assign(movementLabelRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.75",
    });
    const movementCaption = document.createElement("span");
    movementCaption.textContent = "Movement";
    movementLabelRow.appendChild(movementCaption);
    this.movementLabel = document.createElement("span");
    this.movementLabel.textContent = `${MOVEMENT_PER_TURN.toFixed(1)} / ${MOVEMENT_PER_TURN}`;
    movementLabelRow.appendChild(this.movementLabel);
    movementSection.appendChild(movementLabelRow);

    const barTrack = document.createElement("div");
    Object.assign(barTrack.style, {
      width: "100%",
      height: "10px",
      background: "rgba(0,0,0,0.5)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "3px",
      overflow: "hidden",
    });
    this.movementFill = document.createElement("div");
    Object.assign(this.movementFill.style, {
      height: "100%",
      width: "100%",
      background: "linear-gradient(90deg, #2d8a2d 0%, #4cd964 100%)",
      transition: "width 180ms ease-out",
    });
    barTrack.appendChild(this.movementFill);
    movementSection.appendChild(barTrack);

    body.appendChild(movementSection);

    const troopsRow = document.createElement("div");
    Object.assign(troopsRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      fontSize: "11px",
      opacity: "0.85",
      marginTop: "4px",
    });
    const troopsLabel = document.createElement("span");
    troopsLabel.textContent = "Troops";
    troopsRow.appendChild(troopsLabel);
    this.troopsEl = document.createElement("span");
    this.troopsEl.style.fontVariantNumeric = "tabular-nums";
    troopsRow.appendChild(this.troopsEl);
    body.appendChild(troopsRow);

    const statsBlock = document.createElement("div");
    Object.assign(statsBlock.style, {
      marginTop: "4px",
      paddingTop: "8px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    });
    const statsHeader = document.createElement("div");
    statsHeader.textContent = "Stats & Army";
    Object.assign(statsHeader.style, {
      fontSize: "11px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      marginBottom: "6px",
    });
    statsBlock.appendChild(statsHeader);

    const statsGrid = document.createElement("div");
    Object.assign(statsGrid.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "4px 12px",
      minHeight: "44px",
      alignItems: "center",
      justifyItems: "start",
    });
    for (const stat of ["Attack", "Defence", "Arcane", "Intelligence"]) {
      const { row, value } = makeRow(stat);
      statsGrid.appendChild(row);
      this.statValues[stat] = value;
    }
    statsBlock.appendChild(statsGrid);

    body.appendChild(statsBlock);

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
    this.armyChevron = armyChevron;
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
    armyHeader.addEventListener("click", () => this.toggleArmy());
    armyBlock.appendChild(armyHeader);

    // Collapsed view: compact 2-row x 4-col grid of square tiles, each showing
    // just the creature image with a count badge in the bottom-right.
    const armyCollapsedGrid = document.createElement("div");
    Object.assign(armyCollapsedGrid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "4px",
    });
    this.armyCollapsedGrid = armyCollapsedGrid;
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
      tile.title = "";
      this.attachArmyDragHandlers(tile, i);
      armyCollapsedGrid.appendChild(tile);
      this.armyTiles.push({ tile, img, count });
    }
    armyBlock.appendChild(armyCollapsedGrid);

    // Expanded view: one row per stack with name, stats, count (hidden by default).
    const armyList = document.createElement("div");
    this.armyExpandedList = armyList;
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
      this.attachArmyDragHandlers(row, i);
      armyList.appendChild(row);
      this.armyRows.push(row);
    }
    armyBlock.appendChild(armyList);
    body.appendChild(armyBlock);

    this.menu.root.style.display = "none";
  }

  show(hero: Hero, player: Player, state: GameState): void {
    this.currentHeroId = hero.id;
    this.menu.setTitle(`Hero \u2014 ${player.name}`);
    this.update(hero, state);
    if (!this.visible) {
      if (!this.menu.root.parentNode) {
        document.body.appendChild(this.menu.root);
      }
      this.menu.root.style.display = "";
      this.visible = true;
    }
  }

  hide(): void {
    if (this.visible) {
      this.menu.root.style.display = "none";
      this.visible = false;
      this.currentHeroId = null;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  getCurrentHeroId(): string | null {
    return this.currentHeroId;
  }

  update(hero: Hero, state: GameState): void {
    this.nameEl.textContent = hero.name;
    this.bannerEl.src = HERO_BANNERS[settings().horseVariant];
    this.goldEl.textContent = `${hero.gold}g`;
    this.foodEl.textContent = "0 food";
    const remaining = Math.max(0, hero.movementRemaining);
    const shown = displayableRemaining(remaining);
    const pct = Math.max(0, Math.min(1, shown / MOVEMENT_PER_TURN)) * 100;
    this.movementFill.style.width = `${pct}%`;
    this.movementLabel.textContent = `${shown.toFixed(1)} / ${MOVEMENT_PER_TURN}`;
    this.troopsEl.textContent = `${hero.troops}  Â·  Upkeep: ${hero.troops}g/week`;

    this.settlementAtTile = null;
    for (const s of Object.values(state.settlements)) {
      if (s.q === hero.tile.q && s.r === hero.tile.r) {
        this.settlementAtTile = s;
        break;
      }
    }
    const settlementGold = this.settlementAtTile?.gold ?? 0;
    const canTransfer =
      this.settlementAtTile !== null &&
      this.settlementAtTile.ownerId === hero.ownerId;
    this.withdrawBtn.disabled = !canTransfer || settlementGold <= 0;
    this.depositBtn.disabled = !canTransfer || hero.gold <= 0;
    this.withdrawBtn.style.opacity = this.withdrawBtn.disabled ? "0.4" : "1";
    this.depositBtn.style.opacity = this.depositBtn.disabled ? "0.4" : "1";
    this.withdrawBtn.style.cursor = this.withdrawBtn.disabled ? "default" : "pointer";
    this.depositBtn.style.cursor = this.depositBtn.disabled ? "default" : "pointer";
    this.renderArmy(hero.stacks);
  }

  private toggleArmy(): void {
    this.armyExpanded = !this.armyExpanded;
    if (this.armyChevron) {
      this.armyChevron.style.transform = this.armyExpanded ? "rotate(90deg)" : "";
    }
    if (this.armyCollapsedGrid) {
      this.armyCollapsedGrid.style.display = this.armyExpanded ? "none" : "grid";
    }
    if (this.armyExpandedList) {
      this.armyExpandedList.style.display = this.armyExpanded ? "flex" : "none";
    }
  }

  // Wires HTML5 drag-and-drop onto an army slot element (either a collapsed
  // tile or an expanded row). The same handler works for both since the slot
  // index is what matters, not the DOM container.
  private attachArmyDragHandlers(el: HTMLElement, slotIdx: number): void {
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
      for (const t of this.armyTiles) {
        t.tile.style.outline = "";
        t.tile.style.outlineOffset = "";
      }
      for (const r of this.armyRows) {
        r.style.outline = "";
        r.style.outlineOffset = "";
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

  private renderArmy(stacks: UnitStack[]): void {
    if (!catalogReady() && !catalogFailed()) {
      // Catalog still loading: kick off a fetch; when it resolves, the HUD
      // refresh tick will call update() again and fill in the rows.
      void loadUnitCatalog();
    }
    for (let i = 0; i < ARMY_STACK_SLOTS; i++) {
      const stack = stacks[i];
      const isEmpty = !stack || !stack.unitTypeId || stack.count <= 0;
      const id = isEmpty ? null : stack!.unitTypeId;
      const u = id ? getCachedUnit(id) : null;

      // --- Collapsed tile: image + count badge ---
      const { tile, img, count } = this.armyTiles[i];
      if (isEmpty) {
        img.src = "";
        img.style.display = "none";
        count.style.display = "none";
        tile.style.opacity = "0.3";
        tile.title = `Slot ${i + 1}: empty`;
      } else {
        img.src = getUnitImageUrl(id);
        img.style.display = "block";
        count.textContent = String(stack!.count);
        count.style.display = "block";
        tile.style.opacity = "1";
        const name = u?.name ?? id!;
        const stats = u ? ` Â· A ${u.attack} D ${u.defence} H ${u.health} S ${u.speed}` : "";
        tile.title = `Slot ${i + 1}: ${name} x${stack!.count}${stats}`;
      }

      // --- Expanded row: name + stats + count ---
      const row = this.armyRows[i];
      const nameEl = row.children[1].firstChild as HTMLSpanElement;
      const statsEl = row.children[1].lastChild as HTMLSpanElement;
      const countEl = row.children[2] as HTMLSpanElement;
      nameEl.textContent = isEmpty ? "â€”" : (id!);
      countEl.textContent = isEmpty ? "" : String(stack!.count);
      if (isEmpty) {
        statsEl.textContent = "empty";
        row.title = "Empty stack";
        row.style.opacity = "0.35";
      } else if (u) {
        nameEl.textContent = u.name;
        statsEl.textContent = `A ${u.attack} Â· D ${u.defence} Â· H ${u.health} Â· S ${u.speed}`;
        row.title = `${u.name} â€” ${u.description}`;
        row.style.opacity = "0.9";
      } else if (catalogReady() || catalogFailed()) {
        // Catalog resolved but this id isn't in it (unknown unit type).
        nameEl.textContent = id!;
        statsEl.textContent = "unknown unit";
        row.title = `Unknown unit type: ${id}`;
        row.style.opacity = "0.55";
      } else {
        nameEl.textContent = id!;
        statsEl.textContent = "loadingâ€¦";
        row.title = "Loading unit catalogâ€¦";
        row.style.opacity = "0.55";
      }
    }
  }

  private handleTransfer(direction: "deposit" | "withdraw"): void {
    if (!this.settlementAtTile || !this.currentHeroId) return;
    if (!this.onTransfer) return;
    const result = this.onTransfer(this.currentHeroId, this.settlementAtTile.id, direction);
    if (!result.ok) {
      console.warn("[heroInfoMenu] transfer failed:", result.reason);
    }
  }
}


