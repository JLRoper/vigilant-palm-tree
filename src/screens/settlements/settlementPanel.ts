import type { GameState, ResourceType, SettlementId, SettlementState, WarehouseResource } from "../../state/gameState";
import { RESOURCES } from "../../map/resourceTiles";
import { settlementResourceCap, settlementTreasuryCap, heroCargo, heroGoldCap, heroResourceCap, heroWagons, playerWagonsOwned, playerWagonsUnassigned } from "@heroes/engine";
import { PopupMenu, menuTheme, styleButton, clampMenuIntoView } from "@screens/shared/menu";
import { toolbarHeight } from "@screens/shared/panelRail";
import { openTradeModal } from "./tradeModal";

const RESOURCE_ICONS: Record<ResourceType, string> = {
  gold: "\u{1F4B0}",
  wood: "\u{1FAB5}",
  stone: "\u{1FAA8}",
  iron: "\u{1F528}",
  arcane: "\u{1F52E}",
  food: "\u{1F33E}",
};

const WAREHOUSE_SHORT: WarehouseResource[] = ["wood", "stone", "iron", "arcane"];

const PANEL_WIDTH = 260;
const PANEL_MARGIN = 16;

function makeRow(): { row: HTMLDivElement; left: HTMLSpanElement; right: HTMLSpanElement } {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    fontSize: "12px",
    opacity: "0.85",
  });
  const left = document.createElement("span");
  row.appendChild(left);
  const right = document.createElement("span");
  right.style.fontVariantNumeric = "tabular-nums";
  row.appendChild(right);
  return { row, left, right };
}

export type TradeHandler = (
  fromId: SettlementId,
  toId: SettlementId,
  resource: WarehouseResource,
  amount: number,
) => { ok: boolean; reason: string };

export interface SettlementPanelOptions {
  parent: HTMLElement;
  onSelect?: (settlementId: SettlementId) => void;
  onTrade?: TradeHandler;
  onToggleAutoTrade?: (settlementId: SettlementId, autoTrade: boolean) => void;
  onBuyWagons?: (settlementId: SettlementId, count: number) => { ok: boolean; reason: string };
  onTransferResources?: (
    heroId: string,
    settlementId: SettlementId,
    direction: "load" | "unload",
    amounts: Partial<Record<WarehouseResource, number>>,
  ) => { ok: boolean; reason: string };
  onAssignWagons?: (heroId: string, delta: number) => { ok: boolean; reason: string };
  onCreateTradeRoute?: (
    fromId: SettlementId,
    toId: SettlementId,
    resource: WarehouseResource,
    wagons: number,
  ) => { ok: boolean; reason: string };
  onUpdateTradeRoute?: (
    routeId: string,
    change: { wagonsDelta?: number; remove?: boolean },
  ) => { ok: boolean; reason: string };
}

export class SettlementPanel {
  private menu: PopupMenu;
  private body: HTMLElement;
  private onSelect?: (settlementId: SettlementId) => void;
  private onToggleAutoTrade?: (settlementId: SettlementId, autoTrade: boolean) => void;
  private onTrade?: TradeHandler;
  private lastState?: GameState;
  private onBuyWagons?: (settlementId: SettlementId, count: number) => { ok: boolean; reason: string };
  private onTransferResources?: (
    heroId: string,
    settlementId: SettlementId,
    direction: "load" | "unload",
    amounts: Partial<Record<WarehouseResource, number>>,
  ) => { ok: boolean; reason: string };
  private onAssignWagons?: (heroId: string, delta: number) => { ok: boolean; reason: string };
  private onCreateTradeRoute?: (
    fromId: SettlementId,
    toId: SettlementId,
    resource: WarehouseResource,
    wagons: number,
  ) => { ok: boolean; reason: string };
  private onUpdateTradeRoute?: (
    routeId: string,
    change: { wagonsDelta?: number; remove?: boolean },
  ) => { ok: boolean; reason: string };

  constructor(opts: SettlementPanelOptions) {
    this.onSelect = opts.onSelect;
    this.onBuyWagons = opts.onBuyWagons;
    this.onTransferResources = opts.onTransferResources;
    this.onAssignWagons = opts.onAssignWagons;
    this.onCreateTradeRoute = opts.onCreateTradeRoute;
    this.onUpdateTradeRoute = opts.onUpdateTradeRoute;
    this.onTrade = opts.onTrade;
    this.onToggleAutoTrade = opts.onToggleAutoTrade;
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Settlements",
      // Math.max keeps the panel on screen on a viewport narrower than the
      // panel itself; the clamp below corrects the position from the panel's
      // real measured box, and re-runs whenever the viewport changes.
      initialPosition: {
        x: Math.max(0, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN),
        y: toolbarHeight() + PANEL_MARGIN,
      },
      width: PANEL_WIDTH,
      closeable: false,
      draggable: true,
      zIndex: 55,
      minTop: toolbarHeight,
    });
    this.body = this.menu.body;
    clampMenuIntoView(this.menu, toolbarHeight());
    window.addEventListener("resize", () => clampMenuIntoView(this.menu, toolbarHeight()));
  }

  update(state: GameState): void {
    this.lastState = state;
    this.body.replaceChildren();

    const grouped = new Map<number | null, Record<string, SettlementState>>();
    for (const s of Object.values(state.settlements)) {
      const key = s.ownerId;
      if (!grouped.has(key)) grouped.set(key, {});
      grouped.get(key)![s.id] = s;
    }

    for (const player of state.players) {
      const bucket = grouped.get(player.id);
      if (bucket && Object.keys(bucket).length > 0) {
        this.renderOwnerGroup(player.name, player.color, bucket, state.selectedSettlementId, state);
      }
    }
    const neutral = grouped.get(null);
    if (neutral && Object.keys(neutral).length > 0) {
      this.renderOwnerGroup("Neutral", "#888888", neutral, state.selectedSettlementId, state);
    }
  }

  private renderOwnerGroup(
    label: string,
    color: string,
    settlements: Record<string, SettlementState>,
    selectedId: SettlementId | null,
    state: GameState,
  ): void {
    const section = document.createElement("div");
    Object.assign(section.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      paddingBottom: "4px",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      paddingBottom: "4px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      marginBottom: "2px",
    });
    const swatch = document.createElement("span");
    Object.assign(swatch.style, {
      display: "inline-block",
      width: "12px",
      height: "12px",
      borderRadius: "2px",
      background: color,
      border: "1px solid rgba(0,0,0,0.5)",
      flex: "0 0 auto",
    });
    header.appendChild(swatch);
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.opacity = "0.85";
    header.appendChild(labelEl);
    section.appendChild(header);

    for (const s of Object.values(settlements)) {
      section.appendChild(this.renderSettlement(s, color, selectedId, state));
    }
    this.body.appendChild(section);
  }

  private renderSettlement(
    s: SettlementState,
    ownerColor: string,
    selectedId: SettlementId | null,
    state: GameState,
  ): HTMLDivElement {
    const isSelected = selectedId === s.id;
    const card = document.createElement("div");
    Object.assign(card.style, {
      padding: "6px 8px 6px 10px",
      background: isSelected
        ? "rgba(255,255,255,0.10)"
        : "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderLeft: `4px solid ${ownerColor}`,
      borderRadius: "3px",
      display: "flex",
      flexDirection: "column",
      gap: "3px",
      cursor: this.onSelect ? "pointer" : "default",
      boxShadow: isSelected ? `0 0 0 1px ${ownerColor}` : "none",
    });
    if (this.onSelect) {
      card.addEventListener("click", () => this.onSelect?.(s.id));
    }

    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
    });
    const name = document.createElement("span");
    name.textContent = s.name;
    Object.assign(name.style, {
      fontWeight: "600",
      fontSize: "13px",
      color: menuTheme.panel.color,
    });
    titleRow.appendChild(name);
    const levelBadge = document.createElement("span");
    levelBadge.textContent = `L${s.level}`;
    Object.assign(levelBadge.style, {
      fontSize: "10px",
      opacity: "0.65",
      padding: "1px 5px",
      borderRadius: "2px",
      background: "rgba(255,255,255,0.06)",
    });
    titleRow.appendChild(levelBadge);
    card.appendChild(titleRow);

    const popRow = makeRow();
    popRow.left.textContent = "Population";
    popRow.right.textContent = s.population.toLocaleString();
    card.appendChild(popRow.row);

    const incomeRow = makeRow();
    incomeRow.left.textContent = "Income/turn";
    incomeRow.right.textContent = `${s.population * s.goldTax}g`;
    card.appendChild(incomeRow.row);

    const moraleRow = makeRow();
    moraleRow.left.textContent = "Morale (click to toggle)";
    const moraleVal = Math.round(s.morale ?? 100);
    moraleRow.right.textContent = `${moraleVal}% · ${(s.autoTrade ?? true) ? "on" : "off"}`;
    moraleRow.row.style.cursor =
      this.onToggleAutoTrade && s.ownerId === state.activePlayerId ? "pointer" : "default";
    moraleRow.row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.onToggleAutoTrade && s.ownerId === state.activePlayerId) {
        this.onToggleAutoTrade(s.id, !(s.autoTrade ?? true));
      }
    });
    card.appendChild(moraleRow.row);

    const foodReq = Math.ceil((s.population ?? 0) / 100);
    const foodRow = makeRow();
    foodRow.left.textContent = "Food";
    foodRow.right.textContent = `${s.warehouse.food ?? 0} / ${foodReq} req`;
    card.appendChild(foodRow.row);

    const treasuryRow = makeRow();
    treasuryRow.left.textContent = "Treasury";
    treasuryRow.right.textContent = `${s.gold}g / ${settlementTreasuryCap(s)}g`;
    card.appendChild(treasuryRow.row);

    if (s.foundedOnResource) {
      const foundedRow = makeRow();
      foundedRow.left.textContent = "Founded on";
      foundedRow.right.textContent = `${RESOURCE_ICONS[s.foundedOnResource]} ${s.foundedOnResource}`;
      card.appendChild(foundedRow.row);
    }

    const rateKeys = RESOURCES.filter((r) => (s.resourceRates[r] ?? 0) > 0);
    if (rateKeys.length > 0) {
      const ratesHeader = document.createElement("div");
      ratesHeader.textContent = "Resource rates";
      Object.assign(ratesHeader.style, {
        fontSize: "10px",
        opacity: "0.55",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginTop: "3px",
      });
      card.appendChild(ratesHeader);

      for (const r of rateKeys) {
        const rRow = makeRow();
        rRow.left.textContent = `${RESOURCE_ICONS[r]} ${r}`;
        rRow.right.textContent = `${s.resourceRates[r]}/turn`;
        card.appendChild(rRow.row);
      }
    }

    const warehouseParts = WAREHOUSE_SHORT.map((r) => {
      const count = s.warehouse[r] ?? 0;
      const letter = r[0];
      return `${count}${letter}`;
    });
    const caps = settlementResourceCap(s);
    const warehouseLine = document.createElement("div");
    warehouseLine.textContent = `\u{1F3E0} ${warehouseParts.join(" ")} / ${caps.wood}`;
    Object.assign(warehouseLine.style, {
      fontSize: "11px",
      opacity: "0.75",
      marginTop: "4px",
      fontVariantNumeric: "tabular-nums",
    });
    card.appendChild(warehouseLine);

    const isOwn = s.ownerId !== null && s.ownerId === state.activePlayerId;

    // Trade routes touching this settlement (docs plan §5.2).
    if (isOwn && this.onUpdateTradeRoute && this.onCreateTradeRoute) {
      const routes = state.tradeRoutes ?? [];
      const touching = routes.filter(
        (r) => r.fromSettlementId === s.id || r.toSettlementId === s.id,
      );
      for (const route of touching) {
        const otherId = route.fromSettlementId === s.id ? route.toSettlementId : route.fromSettlementId;
        const other = state.settlements[otherId];
        const row = makeRow();
        row.left.textContent = `${route.wagons}\u{1F69F} ${route.resource} \u2192 ${
          route.fromSettlementId === s.id ? (other?.name ?? otherId) : `${s.name} (${other?.name ?? otherId})`
        }`;
        row.right.textContent = route.caravan
          ? route.caravan.phase === "toDestination"
            ? "\u2192 on road"
            : "\u2190 returning"
          : "loading";
        row.row.title = "Click to remove the route (wagons return to the pool)";
        row.row.style.cursor = "pointer";
        row.row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onUpdateTradeRoute?.(route.id, { remove: true });
        });
        row.row.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.onUpdateTradeRoute?.(route.id, { wagonsDelta: -1 });
        });
        card.appendChild(row.row);
      }

      const player = state.players.find((p) => p.id === state.activePlayerId);
      const unassigned = playerWagonsUnassigned(player ?? { id: 0, faction: "player", name: "", color: "", heroIds: [], settlementIds: [] });
      const owned = playerWagonsOwned(player ?? { id: 0, faction: "player", name: "", color: "", heroIds: [], settlementIds: [] });
      const poolRow = makeRow();
      poolRow.left.textContent = "\u{1F69F} Wagons";
      poolRow.right.textContent = `${unassigned} free / ${owned} owned`;
      card.appendChild(poolRow.row);

      if (this.onBuyWagons) {
        const buyRow = document.createElement("div");
        buyRow.style.display = "flex";
        buyRow.style.gap = "6px";
        buyRow.style.marginBottom = "2px";
        const buyBtn = document.createElement("button");
        buyBtn.textContent = "Buy wagon (200g 5w)";
        styleButton(buyBtn);
        buyBtn.style.fontSize = "10px";
        buyBtn.style.padding = "2px 6px";
        buyBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onBuyWagons?.(s.id, 1);
        });
        buyRow.appendChild(buyBtn);
        card.appendChild(buyRow);
      }

      if (unassigned > 0) {
        const destinations = Object.values(state.settlements).filter(
          (other) => other.id !== s.id && other.ownerId === s.ownerId,
        );
        if (destinations.length > 0) {
          const createRow = document.createElement("div");
          Object.assign(createRow.style, { display: "flex", gap: "4px", marginTop: "2px" });
          const targetSel = document.createElement("select");
          targetSel.style.flex = "1.4";
          for (const d of destinations) {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = d.name;
            targetSel.appendChild(opt);
          }
          const resSel = document.createElement("select");
          resSel.style.flex = "1";
          for (const r of ["wood", "stone", "iron", "arcane", "food"] as WarehouseResource[]) {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = `${RESOURCE_ICONS[r]} ${r}`;
            resSel.appendChild(opt);
          }
          const wagonInput = document.createElement("input");
          wagonInput.type = "number";
          wagonInput.min = "1";
          wagonInput.max = String(unassigned);
          wagonInput.value = "1";
          wagonInput.style.flex = "0.7";
          const createBtn = document.createElement("button");
          createBtn.textContent = "Route";
          styleButton(createBtn);
          createBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.onCreateTradeRoute?.(
              s.id,
              targetSel.value,
              resSel.value as WarehouseResource,
              Math.max(1, Math.floor(Number(wagonInput.value) || 1)),
            );
          });
          createRow.append(targetSel, resSel, wagonInput, createBtn);
          card.appendChild(createRow);
        }
      }
    }

    // Hero cargo / wagon assignment: any owned hero standing on this settlement.
    if (isOwn && (this.onTransferResources || this.onAssignWagons)) {
      const heroHere = Object.values(state.heroes).find(
        (h) => h.ownerId === state.activePlayerId && h.q === s.q && h.r === s.r,
      );
      if (heroHere) {
        const cargoBtn = document.createElement("button");
        cargoBtn.textContent = `Cargo & wagons\u2026 (${heroWagons(heroHere)}\u{1F69F})`;
        styleButton(cargoBtn);
        cargoBtn.style.width = "100%";
        cargoBtn.style.marginTop = "6px";
        cargoBtn.style.fontSize = "11px";
        cargoBtn.style.padding = "4px 6px";
        cargoBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.openCargoModal(state, s, heroHere.id);
        });
        card.appendChild(cargoBtn);
      }
    }

    const canTrade =
      this.onTrade !== undefined &&
      s.ownerId !== null &&
      s.ownerId === state.activePlayerId;
    if (canTrade) {
      const destinations = Object.values(state.settlements).filter(
        (other) => other.id !== s.id && other.ownerId === s.ownerId,
      );
      const tradeBtn = document.createElement("button");
      tradeBtn.textContent = "Trade\u2026";
      styleButton(tradeBtn);
      tradeBtn.style.width = "100%";
      tradeBtn.style.marginTop = "6px";
      tradeBtn.style.fontSize = "11px";
      tradeBtn.style.padding = "4px 6px";
      tradeBtn.disabled = destinations.length === 0;
      tradeBtn.style.opacity = tradeBtn.disabled ? "0.4" : "1";
      tradeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openTradeModal({
          parent: document.body,
          fromId: s.id,
          fromSettlement: s,
          destinations,
          onConfirm: (toId, resource, amount) =>
            this.onTrade!(s.id, toId, resource, amount),
        });
      });
      card.appendChild(tradeBtn);
    }

    return card;
  }

  /** Hero cargo load/unload + wagon assignment (docs plan §6/§7). */
  private openCargoModal(state: GameState, s: SettlementState, heroId: string): void {
    const hero = state.heroes[heroId];
    if (!hero || !this.onTransferResources) return;
    const modal = new PopupMenu({
      parent: document.body,
      title: `Cargo — ${hero.name}`,
      initialPosition: { x: Math.max(0, window.innerWidth / 2 - 150), y: toolbarHeight() + 80 },
      width: 320,
      closeable: true,
      zIndex: 90,
    });
    const render = (): void => {
      const live = this.lastState;
      if (!live) return;
      const h = live.heroes[heroId];
      const st = live.settlements[s.id];
      if (!h || !st) return;
      const cargo = heroCargo(h);
      const cargoCaps = heroResourceCap(h);
      const stockCaps = settlementResourceCap(st);
      modal.body.replaceChildren();

      const purse = document.createElement("div");
      purse.textContent = `Purse ${h.gold}g / ${heroGoldCap(h)}g · Wagons ${heroWagons(h)}`;
      Object.assign(purse.style, { fontSize: "12px", opacity: "0.85", marginBottom: "6px" });
      modal.body.appendChild(purse);

      if (this.onAssignWagons) {
        const poolRow = document.createElement("div");
        poolRow.style.display = "flex";
        poolRow.style.gap = "6px";
        poolRow.style.marginBottom = "6px";
        const player = live.players.find((p) => p.id === h.ownerId);
        const label = document.createElement("span");
        label.style.fontSize = "12px";
        label.textContent = `Pool: ${playerWagonsUnassigned(player ?? { id: 0, faction: "player", name: "", color: "", heroIds: [], settlementIds: [] })} free`;
        const minus = document.createElement("button");
        minus.textContent = "\u2212 wagon";
        styleButton(minus);
        minus.addEventListener("click", () => {
          this.onAssignWagons?.(heroId, -1);
          setTimeout(render, 30);
        });
        const plus = document.createElement("button");
        plus.textContent = "+ wagon";
        styleButton(plus);
        plus.addEventListener("click", () => {
          this.onAssignWagons?.(heroId, 1);
          setTimeout(render, 30);
        });
        poolRow.append(label, minus, plus);
        modal.body.appendChild(poolRow);
      }

      for (const r of ["wood", "stone", "iron", "arcane", "food"] as WarehouseResource[]) {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          marginBottom: "4px",
          fontVariantNumeric: "tabular-nums",
        });
        const amounts = document.createElement("span");
        amounts.style.flex = "1";
        amounts.textContent = `${RESOURCE_ICONS[r]} hero ${cargo[r] ?? 0}/${cargoCaps[r]} · town ${st.warehouse[r] ?? 0}/${stockCaps[r]}`;
        const loadBtn = document.createElement("button");
        loadBtn.textContent = "\u2191 load";
        styleButton(loadBtn);
        loadBtn.style.fontSize = "10px";
        loadBtn.addEventListener("click", () => {
          this.onTransferResources?.(heroId, s.id, "load", { [r]: cargoCaps[r] });
          setTimeout(render, 30);
        });
        const unloadBtn = document.createElement("button");
        unloadBtn.textContent = "\u2193 unload";
        styleButton(unloadBtn);
        unloadBtn.style.fontSize = "10px";
        unloadBtn.addEventListener("click", () => {
          this.onTransferResources?.(heroId, s.id, "unload", { [r]: stockCaps[r] });
          setTimeout(render, 30);
        });
        row.append(amounts, loadBtn, unloadBtn);
        modal.body.appendChild(row);
      }
      const hint = document.createElement("div");
      hint.textContent = "load = wagon \u2192 town · unload = town \u2192 wagon (caps truncate)";
      Object.assign(hint.style, { fontSize: "10px", opacity: "0.55", marginTop: "4px" });
      modal.body.appendChild(hint);
    };
    render();
    clampMenuIntoView(modal, toolbarHeight());
  }
}
