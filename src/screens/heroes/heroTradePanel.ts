import type { GameState, HeroState, HeroTradeOffer, WarehouseResource } from "../../state/gameState";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { canTradeHeroes } from "@heroes/engine";
import { createPanel, styleButton, type FloatingPanel } from "@screens/shared/panel";
import { toolbarHeight } from "@screens/shared/panelRail";
import { SquadGrid, activeSquadDrag } from "@screens/shared/squadGrid";
import { RESOURCE_PILE_BUBBLY_SPRITES } from "../../render/assetDescriptors";
import { catalogFailed, catalogReady, getCachedUnit, loadUnitCatalog } from "../../data/unitCatalog";
import { getUnitImageUrl } from "../../data/unitImages";
import {
  TRADE_GOLD_KEY,
  adjustStaged,
  emptyStaging,
  holdingFor,
  holdingsOf,
  requestFromStaging,
  resourceKey,
  stageAll,
  stagedEntries,
  stagingIsEmpty,
  tradeCaps,
  tradeFailureText,
  unstage,
  unitKey,
  type TradeHolding,
  type TradeSide,
  type TradeStaging,
} from "./heroTradeModel";

// The field-trade panel: two heroes side by side (the selected hero on the
// left, the adjacent partner on the right), each showing what it holds, and a
// drag across the middle stages that holding as that hero's offer. Both
// offers are committed as ONE TradeHeroes command (see
// packages/engine/src/hero/tradeHeroes.ts) -- the trade applies whole or not
// at all, so the panel never shows a half-done deal.
//
// The army tiles are the shared SquadGrid (the same square tiles the hero
// panel and the garrison use), so a platoon is dragged between the two armies
// exactly as it is between a hero and a settlement garrison.

const PANEL_GEOMETRY_KEY = "heroTrade";
const PANEL_WIDTH = 560;

/** One in-flight chip drag, shared by every chip on the page (one drag at a time). */
let activeChipDrag: { side: TradeSide; key: string } | null = null;

export interface HeroTradePanelOptions {
  parent?: HTMLElement;
  getState: () => GameState | undefined;
  /** Commits the swap through TurnController; returns the engine's verdict. */
  onTrade: (
    heroId: string,
    partnerId: string,
    give: HeroTradeOffer,
    take: HeroTradeOffer,
  ) => { ok: boolean; reason: string };
  onClose?: () => void;
}

interface SideColumn {
  side: TradeSide;
  root: HTMLDivElement;
  nameEl: HTMLDivElement;
  roleEl: HTMLDivElement;
  goldEl: HTMLDivElement;
  goldValue: HTMLSpanElement;
  chips: Partial<Record<WarehouseResource, HTMLDivElement>>;
  resourceValues: Partial<Record<WarehouseResource, HTMLSpanElement>>;
  grid: SquadGrid;
  offeringEl: HTMLDivElement;
}

function icon(src: string, size: number): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  Object.assign(img.style, {
    width: `${size}px`,
    height: `${size}px`,
    imageRendering: "pixelated",
    objectFit: "contain",
    display: "block",
    pointerEvents: "none",
  });
  return img;
}

function muted(text: string, size: number): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: `${size}px`,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: "0.55",
  });
  return el;
}

function label(holding: TradeHolding): string {
  if (holding.kind === "gold") return "Gold";
  if (holding.kind === "resource") return holding.resource ?? "";
  const id = holding.unitTypeId ?? "";
  return getCachedUnit(id)?.name ?? id;
}

function holdingIcon(holding: TradeHolding): string {
  if (holding.kind === "gold") return RESOURCE_PILE_BUBBLY_SPRITES.gold;
  if (holding.kind === "resource" && holding.resource) {
    return RESOURCE_PILE_BUBBLY_SPRITES[holding.resource];
  }
  return getUnitImageUrl(holding.unitTypeId ?? null);
}

export class HeroTradePanel {
  private readonly parent: HTMLElement;
  private readonly getState: () => GameState | undefined;
  private readonly onTrade: HeroTradePanelOptions["onTrade"];
  private readonly onCloseHook?: () => void;

  private menu: FloatingPanel | null = null;
  private heroId: string | null = null;
  private partnerId: string | null = null;
  private staging: TradeStaging = emptyStaging();
  private columns: Record<TradeSide, SideColumn> | null = null;
  private statusEl: HTMLDivElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;

  constructor(opts: HeroTradePanelOptions) {
    this.parent = opts.parent ?? document.body;
    this.getState = opts.getState;
    this.onTrade = opts.onTrade;
    this.onCloseHook = opts.onClose;
  }

  isOpen(): boolean {
    return this.menu !== null;
  }

  /** The open trade's pair, for the owner's refresh pass. */
  getPair(): { heroId: string; partnerId: string } | null {
    if (!this.heroId || !this.partnerId) return null;
    return { heroId: this.heroId, partnerId: this.partnerId };
  }

  open(heroId: string, partnerId: string): void {
    if (this.menu) {
      // Re-opening for a different pair (or the same one) restarts the deal
      // rather than carrying another pair's staged offers across.
      if (this.heroId === heroId && this.partnerId === partnerId) return;
      this.close();
    }
    this.heroId = heroId;
    this.partnerId = partnerId;
    this.staging = emptyStaging();

    const menu = createPanel({
      parent: this.parent,
      title: "Trade",
      key: PANEL_GEOMETRY_KEY,
      width: PANEL_WIDTH,
      defaultPosition: { x: 220, y: 120 },
      minTop: toolbarHeight,
      zIndex: 76,
      closeable: true,
      draggable: true,
      onClose: () => {
        this.menu = null;
        this.columns = null;
        this.statusEl = null;
        this.confirmBtn = null;
        this.clearBtn = null;
        this.heroId = null;
        this.partnerId = null;
        this.staging = emptyStaging();
        this.onCloseHook?.();
      },
    });
    this.menu = menu;

    const root = document.createElement("div");
    Object.assign(root.style, { display: "flex", gap: "10px", padding: "2px" });

    const give = this.buildColumn("give");
    const take = this.buildColumn("take");
    root.appendChild(give.root);
    root.appendChild(take.root);
    menu.appendContent(root);

    const divider = document.createElement("div");
    Object.assign(divider.style, {
      borderTop: "1px solid rgba(255,255,255,0.12)",
      margin: "8px 0 6px",
    });
    menu.appendContent(divider);

    const footer = document.createElement("div");
    Object.assign(footer.style, { display: "flex", alignItems: "center", gap: "8px" });

    this.statusEl = document.createElement("div");
    Object.assign(this.statusEl.style, { flex: "1", fontSize: "11px", opacity: "0.75" });
    this.statusEl.dataset.tradeStatus = "true";
    footer.appendChild(this.statusEl);

    this.clearBtn = document.createElement("button");
    this.clearBtn.textContent = "Clear";
    this.clearBtn.dataset.tradeClear = "true";
    styleButton(this.clearBtn);
    this.clearBtn.addEventListener("click", () => {
      this.staging = emptyStaging();
      this.render();
    });
    footer.appendChild(this.clearBtn);

    this.confirmBtn = document.createElement("button");
    this.confirmBtn.textContent = "Confirm trade";
    this.confirmBtn.dataset.tradeConfirm = "true";
    styleButton(this.confirmBtn, true);
    this.confirmBtn.addEventListener("click", () => this.commit());
    footer.appendChild(this.confirmBtn);

    menu.appendContent(footer);

    this.columns = { give, take };
    this.render();
  }

  close(): void {
    const menu = this.menu;
    this.menu = null;
    menu?.close();
  }

  /** Re-renders from live state (UIManager's dirty-keyed refresh pass). */
  refresh(state: GameState): void {
    if (!this.menu) return;
    // A pair that can no longer trade (a hero died, or walked off the
    // adjacent hex) has nothing left to trade: close rather than leave a
    // dead panel standing over the map.
    if (!this.pairIsValid(state)) {
      this.close();
      return;
    }
    this.render(state);
  }

  /**
   * True when the panel still has something to show: both heroes exist and
   * are adjacent. The panel closes itself when the pair breaks (a hero left,
   * died, or walked off), because there is nothing left to trade.
   */
  private pairIsValid(state: GameState): boolean {
    if (!this.heroId || !this.partnerId) return false;
    return canTradeHeroes(state.heroes[this.heroId], state.heroes[this.partnerId]);
  }

  private hero(side: TradeSide, state: GameState): HeroState | undefined {
    const id = side === "give" ? this.heroId : this.partnerId;
    return id ? state.heroes[id] : undefined;
  }

  private buildColumn(side: TradeSide): SideColumn {
    const root = document.createElement("div");
    root.dataset.tradeColumn = side;
    Object.assign(root.style, {
      flex: "1",
      minWidth: "0",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: "4px",
      padding: "6px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });

    const nameEl = document.createElement("div");
    Object.assign(nameEl.style, { fontSize: "13px", fontWeight: "600" });
    root.appendChild(nameEl);

    const roleEl = muted(side === "give" ? "You" : "Partner", 9);
    root.appendChild(roleEl);

    // Purse row: the gold chip is draggable like any other holding.
    const goldChip = document.createElement("div");
    goldChip.dataset.tradeHolding = TRADE_GOLD_KEY;
    goldChip.dataset.tradeSide = side;
    Object.assign(goldChip.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "3px 4px",
      borderRadius: "3px",
      background: "rgba(0,0,0,0.28)",
    });
    goldChip.appendChild(icon(RESOURCE_PILE_BUBBLY_SPRITES.gold, 18));
    const goldLabel = document.createElement("span");
    goldLabel.textContent = "Gold";
    Object.assign(goldLabel.style, { flex: "1", fontSize: "11px", opacity: "0.8" });
    goldChip.appendChild(goldLabel);
    const goldValue = document.createElement("span");
    Object.assign(goldValue.style, { fontSize: "11px", fontVariantNumeric: "tabular-nums" });
    goldChip.appendChild(goldValue);
    this.attachChipDrag(goldChip, side, TRADE_GOLD_KEY);
    root.appendChild(goldChip);

    const resourceRow = document.createElement("div");
    Object.assign(resourceRow.style, {
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: "3px",
    });
    const resourceValues: Partial<Record<WarehouseResource, HTMLSpanElement>> = {};
    const chips: Partial<Record<WarehouseResource, HTMLDivElement>> = {};
    for (const resource of WAREHOUSE_RESOURCES) {
      const chip = document.createElement("div");
      chip.dataset.tradeHolding = resourceKey(resource);
      chip.dataset.tradeSide = side;
      Object.assign(chip.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1px",
        padding: "3px 2px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.28)",
      });
      chip.appendChild(icon(RESOURCE_PILE_BUBBLY_SPRITES[resource], 20));
      const value = document.createElement("span");
      Object.assign(value.style, { fontSize: "10px", fontVariantNumeric: "tabular-nums", opacity: "0.85" });
      chip.appendChild(value);
      resourceValues[resource] = value;
      chips[resource] = chip;
      this.attachChipDrag(chip, side, resourceKey(resource));
      resourceRow.appendChild(chip);
    }
    root.appendChild(resourceRow);

    const armyLabelEl = muted("Army", 9);
    root.appendChild(armyLabelEl);

    const grid = new SquadGrid({
      gridId: `trade-${side}`,
      // A tile dragged within its own grid stages that platoon as this side's
      // offer (the grid belongs to that hero); a tile dragged in from the
      // OTHER grid stages the other hero's platoon.
      onReorder: (fromIdx) => this.stagePlatoon(side, fromIdx),
      onDropFromOtherGrid: (fromIdx) => this.stagePlatoon(otherSide(side), fromIdx),
    });
    grid.element.dataset.tradeArmy = side;
    root.appendChild(grid.element);

    const offeringEl = document.createElement("div");
    Object.assign(offeringEl.style, { display: "flex", flexDirection: "column", gap: "3px", minHeight: "18px" });
    root.appendChild(offeringEl);

    this.attachColumnDrop(root, side);

    return {
      side,
      root,
      nameEl,
      roleEl,
      goldEl: goldChip,
      goldValue,
      chips,
      resourceValues,
      grid,
      offeringEl,
    };
  }

  /**
   * Chip drag/drop. A chip dragged onto the OTHER column stages everything
   * that hero holds of it; dragged back onto its own column it is unstaged
   * (so a drag is reversible without hunting for a button).
   */
  private attachChipDrag(chip: HTMLElement, side: TradeSide, key: string): void {
    chip.draggable = true;
    chip.style.cursor = "grab";
    chip.addEventListener("dragstart", (e) => {
      const state = this.getState();
      const hero = state ? this.hero(side, state) : undefined;
      const holding = holdingFor(hero, key);
      if (!holding || holding.amount <= 0) {
        e.preventDefault();
        return;
      }
      activeChipDrag = { side, key };
      chip.dataset.dragging = "true";
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify({ trade: key, side }));
      }
    });
    chip.addEventListener("dragend", () => {
      activeChipDrag = null;
      delete chip.dataset.dragging;
      this.clearDropHighlight();
    });
  }

  private attachColumnDrop(column: HTMLElement, side: TradeSide): void {
    column.addEventListener("dragover", (e) => {
      const dragged = activeChipDrag;
      const squad = activeSquadDrag();
      if (!dragged && !squad) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      column.style.outline = "2px solid #ffcc00";
      column.style.outlineOffset = "1px";
    });
    column.addEventListener("dragleave", () => {
      column.style.outline = "";
      column.style.outlineOffset = "";
    });
    column.addEventListener("drop", (e) => {
      e.preventDefault();
      column.style.outline = "";
      column.style.outlineOffset = "";
      const dragged = activeChipDrag;
      const squad = activeSquadDrag();
      activeChipDrag = null;
      if (dragged) {
        if (dragged.side === side) this.unstageKey(side, dragged.key);
        else this.stageKey(dragged.side, dragged.key);
        return;
      }
      if (squad) {
        // An army tile dropped on the column body (not on one of the other
        // grid's tiles): the same rule as the grid-level handlers.
        if (squad.gridId === `trade-${side}`) this.stagePlatoon(side, squad.slotIdx);
        else this.stagePlatoon(otherSide(side), squad.slotIdx);
      }
    });
  }

  private stageKey(side: TradeSide, key: string): void {
    const state = this.getState();
    if (!state) return;
    const hero = this.hero(side, state);
    const holding = holdingFor(hero, key);
    if (!holding || holding.amount <= 0) return;
    this.staging = stageAll(this.staging, side, key, holding.amount);
    this.render(state);
  }

  private unstageKey(side: TradeSide, key: string): void {
    this.staging = unstage(this.staging, side, key);
    this.render();
  }

  /** Stages every unit of one whole platoon slot as that side's offer. */
  private stagePlatoon(side: TradeSide, slotIdx: number): void {
    const state = this.getState();
    if (!state) return;
    const hero = this.hero(side, state);
    if (!hero) return;
    const entries = (hero.stacks ?? [])[slotIdx]?.entries ?? [];
    let next = this.staging;
    for (const entry of entries) {
      if (!entry || entry.count <= 0) continue;
      next = stageAll(next, side, unitKey(entry.unitTypeId), holdingFor(hero, unitKey(entry.unitTypeId))?.amount ?? 0);
    }
    this.staging = next;
    this.render(state);
  }

  private clearDropHighlight(): void {
    for (const column of [this.columns?.give, this.columns?.take]) {
      if (!column) continue;
      column.root.style.outline = "";
      column.root.style.outlineOffset = "";
    }
  }

  private commit(): void {
    const state = this.getState();
    if (!state || !this.heroId || !this.partnerId || !this.statusEl) return;
    if (stagingIsEmpty(this.staging)) {
      this.setStatus("Nothing is on the table yet.");
      return;
    }
    const request = requestFromStaging(this.staging, this.heroId, this.partnerId);
    const result = this.onTrade(request.heroId, request.partnerId, request.give, request.take);
    if (!result.ok) {
      const names = { hero: this.heroName("give", state), partner: this.heroName("take", state) };
      this.setStatus(tradeFailureText(result.reason, names), true);
      return;
    }
    this.staging = emptyStaging();
    this.setStatus("Traded.", false);
    // Re-read live state: the commit replaced it, so the captured `state`
    // above is the pre-trade snapshot and would repaint the old holdings.
    this.render();
  }

  private setStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.style.color = isError ? "#f88" : "";
  }

  private heroName(side: TradeSide, state: GameState): string {
    return this.hero(side, state)?.name ?? "That hero";
  }

  private render(state?: GameState): void {
    if (!this.menu || !this.columns) return;
    const live = state ?? this.getState();
    if (!live) return;
    if (!catalogReady() && !catalogFailed()) void loadUnitCatalog();

    const valid = this.pairIsValid(live);
    const give = this.hero("give", live);
    const take = this.hero("take", live);

    this.menu.setTitle("Trade");
    this.renderColumn(this.columns.give, "give", live, valid);
    this.renderColumn(this.columns.take, "take", live, valid);

    if (this.confirmBtn) {
      const empty = stagingIsEmpty(this.staging);
      this.confirmBtn.disabled = !valid || empty;
      this.confirmBtn.title = !valid
        ? "Those heroes can no longer trade (they must stand on adjacent hexes)"
        : empty
          ? "Drag something across first"
          : "Hand both offers over in one swap";
      this.confirmBtn.style.opacity = this.confirmBtn.disabled ? "0.4" : "1";
      this.confirmBtn.style.cursor = this.confirmBtn.disabled ? "default" : "pointer";
    }
    if (this.clearBtn) {
      this.clearBtn.disabled = stagingIsEmpty(this.staging);
      this.clearBtn.style.opacity = this.clearBtn.disabled ? "0.4" : "1";
    }
    if (!valid) {
      this.setStatus("Those heroes can no longer trade — they must stand on adjacent hexes.", true);
    } else if (!give || !take) {
      this.setStatus("That hero is gone.", true);
    }
  }

  private renderColumn(column: SideColumn, side: TradeSide, state: GameState, valid: boolean): void {
    const hero = this.hero(side, state);
    column.nameEl.textContent = hero?.name ?? "—";
    const caps = tradeCaps(hero);
    const holdings = holdingsOf(hero);
    const gold = holdings.find((h) => h.key === TRADE_GOLD_KEY);
    const goldAmount = gold?.amount ?? 0;
    column.goldValue.textContent = `${goldAmount} / ${caps.gold}`;
    column.goldEl.dataset.tradeHoldingAmount = String(goldAmount);
    for (const resource of WAREHOUSE_RESOURCES) {
      const value = column.resourceValues[resource];
      const chip = column.chips[resource];
      if (!value || !chip) continue;
      const amount = holdings.find((h) => h.key === resourceKey(resource))?.amount ?? 0;
      value.textContent = String(amount);
      value.title = `${resource}: ${amount} / ${caps.resources[resource]} cap`;
      chip.dataset.tradeHoldingAmount = String(amount);
    }

    column.grid.setVisible(hero !== undefined);
    if (hero) {
      column.grid.setInteractive(valid && holdings.some((h) => h.kind === "unit" && h.amount > 0));
      column.grid.render(hero.stacks ?? []);
    }

    column.offeringEl.replaceChildren();
    column.offeringEl.appendChild(muted(`Giving to ${this.heroName(otherSide(side), state)}`, 9));
    const staged = stagedEntries(this.staging, side, holdings);
    if (staged.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "Drag something across to offer it";
      Object.assign(empty.style, { fontSize: "10px", opacity: "0.45" });
      column.offeringEl.appendChild(empty);
      return;
    }
    for (const holding of staged) {
      column.offeringEl.appendChild(this.buildStagedRow(side, holding));
    }
  }

  private buildStagedRow(side: TradeSide, holding: TradeHolding): HTMLDivElement {
    const row = document.createElement("div");
    row.dataset.tradeStaged = holding.key;
    row.dataset.tradeSide = side;
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 4px",
      borderRadius: "3px",
      background: "rgba(255,204,0,0.12)",
      border: "1px solid rgba(255,204,0,0.35)",
    });
    row.appendChild(icon(holdingIcon(holding), 16));
    const name = document.createElement("span");
    name.textContent = label(holding);
    Object.assign(name.style, {
      flex: "1",
      fontSize: "10px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    row.appendChild(name);

    const amount = document.createElement("span");
    amount.dataset.tradeStagedAmount = String(holding.amount);
    amount.textContent = String(holding.amount);
    Object.assign(amount.style, { fontSize: "11px", fontVariantNumeric: "tabular-nums" });
    row.appendChild(amount);

    const step = (delta: number) => {
      const state = this.getState();
      if (!state) return;
      this.staging = adjustStaged(this.staging, side, holding.key, delta, holdingFor(this.hero(side, state), holding.key));
      this.render(state);
    };
    const down = document.createElement("button");
    down.textContent = "−";
    down.dataset.tradeStep = "down";
    this.styleStepper(down);
    down.addEventListener("click", () => step(-1));
    row.appendChild(down);

    const up = document.createElement("button");
    up.textContent = "+";
    up.dataset.tradeStep = "up";
    this.styleStepper(up);
    up.addEventListener("click", () => step(1));
    row.appendChild(up);

    const cancel = document.createElement("button");
    cancel.textContent = "×";
    cancel.dataset.tradeUnstage = "true";
    cancel.title = "Take it off the table";
    this.styleStepper(cancel);
    cancel.addEventListener("click", () => this.unstageKey(side, holding.key));
    row.appendChild(cancel);

    return row;
  }

  private styleStepper(btn: HTMLButtonElement): void {
    Object.assign(btn.style, {
      width: "16px",
      height: "16px",
      lineHeight: "1",
      padding: "0",
      fontSize: "11px",
      background: "rgba(0,0,0,0.5)",
      color: "#eee",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "3px",
      cursor: "pointer",
    });
  }
}

function otherSide(side: TradeSide): TradeSide {
  return side === "give" ? "take" : "give";
}
