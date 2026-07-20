import type { GameState, ResourceType, SettlementState } from "../state/gameState";
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
}

export class SettlementPanel {
  private menu: PopupMenu;
  private body: HTMLElement;

  constructor(opts: SettlementPanelOptions) {
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
        this.renderOwnerGroup(player.name, bucket);
      }
    }
    const neutral = grouped.get(null);
    if (neutral && Object.keys(neutral).length > 0) {
      this.renderOwnerGroup("Neutral", neutral);
    }
  }

  private renderOwnerGroup(
    label: string,
    settlements: Record<string, SettlementState>,
  ): void {
    const section = document.createElement("div");
    Object.assign(section.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      paddingBottom: "4px",
    });

    const header = document.createElement("div");
    header.textContent = label;
    Object.assign(header.style, {
      fontSize: "11px",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      opacity: "0.6",
      paddingBottom: "2px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    });
    section.appendChild(header);

    for (const s of Object.values(settlements)) {
      section.appendChild(this.renderSettlement(s));
    }
    this.body.appendChild(section);
  }

  private renderSettlement(s: SettlementState): HTMLDivElement {
    const card = document.createElement("div");
    Object.assign(card.style, {
      padding: "6px 8px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "3px",
      display: "flex",
      flexDirection: "column",
      gap: "3px",
    });

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
    incomeRow.left.textContent = "Gold/tax";
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
