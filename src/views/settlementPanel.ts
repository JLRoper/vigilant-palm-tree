import type { GameState, ResourceType, SettlementId, SettlementState } from "../state/gameState";
import { RESOURCES } from "../map/resourceTiles";
import { PopupMenu, menuTheme } from "./menu";

const RESOURCE_ICONS: Record<ResourceType, string> = {
  gold: "\u{1F4B0}",
  wood: "\u{1FAB5}",
  stone: "\u{1FAA8}",
  iron: "\u{1F528}",
  arcane: "\u{1F52E}",
};

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

export interface SettlementPanelOptions {
  parent: HTMLElement;
  onSelect?: (settlementId: SettlementId) => void;
}

export class SettlementPanel {
  private menu: PopupMenu;
  private body: HTMLElement;
  private onSelect?: (settlementId: SettlementId) => void;

  constructor(opts: SettlementPanelOptions) {
    this.onSelect = opts.onSelect;
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Settlements",
      initialPosition: { x: window.innerWidth - 280, y: 16 },
      width: 260,
      closeable: false,
      draggable: true,
      zIndex: 55,
    });
    this.body = this.menu.body;
  }

  update(state: GameState): void {
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
        this.renderOwnerGroup(player.name, player.color, bucket, state.selectedSettlementId);
      }
    }
    const neutral = grouped.get(null);
    if (neutral && Object.keys(neutral).length > 0) {
      this.renderOwnerGroup("Neutral", "#888888", neutral, state.selectedSettlementId);
    }
  }

  private renderOwnerGroup(
    label: string,
    color: string,
    settlements: Record<string, SettlementState>,
    selectedId: SettlementId | null,
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
      section.appendChild(this.renderSettlement(s, color, selectedId));
    }
    this.body.appendChild(section);
  }

  private renderSettlement(
    s: SettlementState,
    ownerColor: string,
    selectedId: SettlementId | null,
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

    return card;
  }
}
