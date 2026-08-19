import { PopupMenu, menuTheme } from "@screens/shared/menu";
import {
  attachDockControl,
  getPanelRail,
  mountPanel,
  savePanelPosition,
  toolbarHeight,
} from "@screens/shared/panelRail";
import type { GameState, SettlementId, SettlementState } from "../../state/gameState";
import { SETTLEMENT_BANNERS } from "../../render/assetDescriptors";

export interface SettlementRosterMenuOptions {
  onSelectSettlement?: (settlementId: SettlementId) => void;
  onCenterSettlement?: (settlementId: SettlementId) => void;
}

export class SettlementRosterMenu {
  private menu: PopupMenu;
  private visible = false;
  private opts: SettlementRosterMenuOptions;
  private content: HTMLDivElement;
  private lastRosterKey = "";

  constructor(opts: SettlementRosterMenuOptions) {
    this.opts = opts;

    this.menu = new PopupMenu({
      parent: getPanelRail(),
      title: "Settlements",
      width: 280,
      closeable: true,
      draggable: true,
      zIndex: 60,
      minTop: toolbarHeight,
      onMove: (pos) => savePanelPosition("settlements", pos),
      onClose: () => {
        this.visible = false;
      },
    });

    this.content = document.createElement("div");
    Object.assign(this.content.style, {
      fontFamily: menuTheme.font,
      fontSize: menuTheme.fontSize,
      color: menuTheme.panel.color,
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      flex: "1 1 auto",
      minHeight: "0",
      overflowY: "auto",
    });

    this.menu.setContent(this.content);
    this.menu.root.style.display = "none";
    attachDockControl(this.menu, "settlements");
  }

  show(state: GameState): void {
    if (!this.visible) {
      mountPanel(this.menu, "settlements");
      this.menu.root.style.display = "flex";
      this.visible = true;
    }
    this.update(state);
  }

  hide(): void {
    if (this.visible) {
      this.menu.root.style.display = "none";
      this.visible = false;
      this.lastRosterKey = "";
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(state: GameState): void {
    const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
    this.menu.setTitle(activePlayer ? `${activePlayer.name}'s Settlements` : "Settlements");

    const activePlayerId = activePlayer?.id ?? null;
    const settlements = Object.values(state.settlements).filter(
      (s) => activePlayerId === null || s.ownerId === activePlayerId,
    );

    const rosterKey = JSON.stringify({
      activePlayerId: state.activePlayerId,
      settlements: settlements.map((s) => ({
        id: s.id, q: s.q, r: s.r, gold: s.gold,
        level: s.level, population: s.population,
        morale: s.morale, name: s.name,
      })),
    });

    if (rosterKey === this.lastRosterKey) return;
    this.lastRosterKey = rosterKey;

    this.content.replaceChildren();

    if (settlements.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = activePlayer
        ? `${activePlayer.name} has no settlements.`
        : "No active player.";
      Object.assign(empty.style, {
        opacity: "0.7",
        padding: "8px 0",
      });
      this.content.appendChild(empty);
      return;
    }

    for (const settlement of settlements) {
      this.content.appendChild(this.buildSettlementRow(settlement));
    }
  }

  private buildSettlementRow(settlement: SettlementState): HTMLDivElement {
    const bannerUrl = SETTLEMENT_BANNERS[settlement.level as 1 | 2 | 3];

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "8px 10px",
      borderRadius: "4px",
      background: `linear-gradient(rgba(26, 26, 26, 0.3), rgba(26, 26, 26, 0.3)), url(${bannerUrl}) center / cover no-repeat`,
    });

    if (this.opts.onSelectSettlement || this.opts.onCenterSettlement) {
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onSelectSettlement?.(settlement.id);
      });
      row.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.opts.onCenterSettlement?.(settlement.id);
      });
    }

    const nameEl = document.createElement("div");
    nameEl.textContent = settlement.name;
    Object.assign(nameEl.style, {
      fontWeight: "600",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    });
    row.appendChild(nameEl);

    const metaEl = document.createElement("div");
    metaEl.textContent = `(${settlement.q}, ${settlement.r}) · L${settlement.level} · ${settlement.population} pop · ${settlement.gold}g · Morale ${settlement.morale ?? 100}%`;
    Object.assign(metaEl.style, {
      fontSize: "11px",
      opacity: "0.85",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    });
    row.appendChild(metaEl);

    return row;
  }
}
