import type { GameState, Player, SettlementState } from "../state/gameState";
import type { Hero } from "../entities/hero";
import { PopupMenu, menuTheme } from "./menu";

const MOVEMENT_PER_TURN = 7;

export type TransferHandler = (
  heroId: string,
  settlementId: string,
  direction: "deposit" | "withdraw",
) => { ok: boolean; reason: string };

export interface HeroInfoMenuOptions {
  parent: HTMLElement;
  onTransfer?: TransferHandler;
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
  private settlementAtTile: SettlementState | null = null;
  private troopsEl: HTMLElement;

  constructor(opts: HeroInfoMenuOptions) {
    this.onTransfer = opts.onTransfer;
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
      },
    });

    const body = this.menu.body;

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

    this.menu.root.style.display = "none";
  }

  show(hero: Hero, player: Player, state: GameState): void {
    this.currentHeroId = hero.id;
    this.menu.setTitle(`Hero — ${player.name}`);
    this.update(hero, state);
    if (!this.visible) {
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
    this.nameEl.textContent = hero.id;
    this.goldEl.textContent = `${hero.gold}g`;
    this.foodEl.textContent = "0 food";
    const remaining = Math.max(0, hero.movementRemaining);
    const pct = Math.max(0, Math.min(1, remaining / MOVEMENT_PER_TURN)) * 100;
    this.movementFill.style.width = `${pct}%`;
    this.movementLabel.textContent = `${remaining.toFixed(1)} / ${MOVEMENT_PER_TURN}`;
    this.troopsEl.textContent = `${hero.troops}  ·  Upkeep: ${hero.troops}g/week`;

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
