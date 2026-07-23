import { PopupMenu, menuTheme } from "./menu";
import type { GameState, SettlementId, SettlementState } from "../state/gameState";

export interface SettlementRosterMenuOptions {
  onCenterSettlement?: (settlementId: SettlementId) => void;
}

export class SettlementRosterMenu {
  private menu: PopupMenu;
  private visible = false;
  private opts: SettlementRosterMenuOptions;
  private content: HTMLDivElement;

  constructor(opts: SettlementRosterMenuOptions) {
    this.opts = opts;

    this.menu = new PopupMenu({
      parent: document.body,
      title: "Settlements",
      initialPosition: { x: 260, y: 220 },
      width: 280,
      closeable: true,
      draggable: true,
      zIndex: 60,
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
      maxHeight: "360px",
      overflowY: "auto",
    });

    this.menu.setContent(this.content);
    this.menu.root.style.display = "none";
  }

  show(state: GameState): void {
    this.update(state);
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
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(state: GameState): void {
    const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
    this.menu.setTitle(activePlayer ? `${activePlayer.name}'s Settlements` : "Settlements");

    this.content.replaceChildren();

    const activePlayerId = activePlayer?.id ?? null;
    const settlements = Object.values(state.settlements).filter(
      (s) => activePlayerId === null || s.ownerId === activePlayerId,
    );

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
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "8px 10px",
      background: "rgba(255,255,255,0.05)",
      borderRadius: "4px",
    });

    const topRow = document.createElement("div");
    Object.assign(topRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "8px",
    });

    const nameEl = document.createElement("div");
    nameEl.textContent = settlement.name;
    Object.assign(nameEl.style, {
      fontWeight: "600",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    topRow.appendChild(nameEl);

    const buttons = document.createElement("div");
    Object.assign(buttons.style, {
      display: "flex",
      gap: "4px",
      flexShrink: "0",
    });

    if (this.opts.onCenterSettlement) {
      const locateBtn = document.createElement("button");
      locateBtn.textContent = "Locate";
      Object.assign(locateBtn.style, {
        padding: "3px 6px",
        fontSize: "11px",
        cursor: "pointer",
        background: menuTheme.button.background,
        color: menuTheme.button.color,
        border: menuTheme.button.border,
        borderRadius: menuTheme.button.borderRadius,
        fontFamily: menuTheme.font,
      });
      locateBtn.addEventListener("click", () => this.opts.onCenterSettlement?.(settlement.id));
      buttons.appendChild(locateBtn);
    }

    topRow.appendChild(buttons);
    row.appendChild(topRow);

    const metaEl = document.createElement("div");
    metaEl.textContent = `(${settlement.q}, ${settlement.r}) · L${settlement.level} · ${settlement.population} pop · ${settlement.gold}g · Morale ${settlement.morale ?? 100}%`;
    Object.assign(metaEl.style, {
      fontSize: "11px",
      opacity: "0.75",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    row.appendChild(metaEl);

    return row;
  }
}
