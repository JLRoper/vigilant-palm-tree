import type { GameState, SettlementState } from "../state/gameState";
import { PopupMenu, menuTheme } from "./menu";
import { MAX_HEROES_PER_PLAYER, HERO_RECRUIT_COST } from "../state/gameState";
import { RESOURCE_PILE_BUBBLY_SPRITES, SETTLEMENT_BANNERS } from "../render/assetDescriptors";
import type { CastleLevel } from "../entities/settlement";

export interface SettlementInfoMenuOptions {
  parent: HTMLElement;
  onClose?: () => void;
  onRecruitHero?: () => void;
}

function makeRow(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    opacity: "0.85",
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

const WAREHOUSE_RESOURCE_ORDER = ["wood", "stone", "iron", "arcane", "food"] as const;

export class SettlementInfoMenu {
  private menu: PopupMenu;
  private visible = false;
  private currentSettlementId: string | null = null;
  private nameEl: HTMLElement;
  private levelBadge: HTMLElement;
  private populationEl: HTMLSpanElement;
  private incomeEl: HTMLSpanElement;
  private treasuryEl: HTMLSpanElement;
  private moraleEl: HTMLSpanElement;
  private foodEl: HTMLSpanElement;
  private bannerEl: HTMLImageElement;
  private warehouseEls: Record<string, HTMLSpanElement>;
  private onCloseCallback?: () => void;
  private onRecruitHero?: () => void;
  private recruitContainer: HTMLDivElement;
  private recruitBtn: HTMLButtonElement;

  constructor(opts: SettlementInfoMenuOptions) {
    this.onCloseCallback = opts.onClose;
    this.onRecruitHero = opts.onRecruitHero;
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Settlement",
      initialPosition: { x: 16, y: Math.max(24, window.innerHeight - 420) },
      width: 240,
      closeable: true,
      draggable: true,
      zIndex: 60,
      onClose: () => {
        this.visible = false;
        this.currentSettlementId = null;
        this.onCloseCallback?.();
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

    this.levelBadge = document.createElement("span");
    Object.assign(this.levelBadge.style, {
      fontSize: "10px",
      opacity: "0.65",
      padding: "1px 5px",
      borderRadius: "2px",
      background: "rgba(255,255,255,0.06)",
      marginLeft: "6px",
      verticalAlign: "middle",
    });
    this.nameEl.appendChild(this.levelBadge);

    const { row: popRow, value: popVal } = makeRow("Population");
    this.populationEl = popVal;
    body.appendChild(popRow);

    const { row: incRow, value: incVal } = makeRow("Income/turn");
    this.incomeEl = incVal;
    body.appendChild(incRow);

    const { row: treasuryRow, value: treasuryVal } = makeRow("Treasury");
    this.treasuryEl = treasuryVal;
    body.appendChild(treasuryRow);

    const { row: moraleRow, value: moraleVal } = makeRow("Morale");
    this.moraleEl = moraleVal;
    body.appendChild(moraleRow);

    const { row: foodRow, value: foodVal } = makeRow("Food");
    this.foodEl = foodVal;
    body.appendChild(foodRow);

    const divider = document.createElement("div");
    Object.assign(divider.style, {
      margin: "4px 0",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    });
    body.appendChild(divider);

    const warehouseLabel = document.createElement("div");
    warehouseLabel.textContent = "Warehouse";
    Object.assign(warehouseLabel.style, {
      fontSize: "11px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      marginBottom: "6px",
    });
    body.appendChild(warehouseLabel);

    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridAutoFlow: "row",
      gridTemplateColumns: "repeat(4, 1fr)",
      columnGap: "2px",
      rowGap: "4px",
      marginBottom: "4px",
      justifyItems: "center",
    });
    body.appendChild(grid);

    this.warehouseEls = {};
    for (const r of WAREHOUSE_RESOURCE_ORDER) {
      const cell = document.createElement("div");
      Object.assign(cell.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
      });

      const img = document.createElement("img");
      img.src = RESOURCE_PILE_BUBBLY_SPRITES[r as keyof typeof RESOURCE_PILE_BUBBLY_SPRITES];
      Object.assign(img.style, {
        width: "28px",
        height: "28px",
        imageRendering: "pixelated",
        objectFit: "contain",
      });
      cell.appendChild(img);

      const value = document.createElement("span");
      value.textContent = "0";
      Object.assign(value.style, {
        fontSize: "11px",
        fontVariantNumeric: "tabular-nums",
        opacity: "0.85",
        lineHeight: "1",
      });
      cell.appendChild(value);

      this.warehouseEls[r] = value;
      grid.appendChild(cell);
    }

    this.recruitContainer = document.createElement("div");
    body.appendChild(this.recruitContainer);

    this.recruitBtn = document.createElement("button");
    Object.assign(this.recruitBtn.style, {
      padding: "7px 10px",
      fontSize: "12px",
      cursor: "pointer",
      background: "rgba(40,90,40,0.7)",
      color: menuTheme.button.color,
      border: menuTheme.button.border,
      borderRadius: menuTheme.button.borderRadius,
      fontFamily: menuTheme.font,
      width: "100%",
      marginTop: "8px",
    });
    this.recruitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onRecruitHero?.();
    });
    this.recruitContainer.appendChild(this.recruitBtn);

    this.menu.root.style.display = "none";
  }

  show(settlement: SettlementState, state: GameState): void {
    this.currentSettlementId = settlement.id;
    this.update(settlement, state);
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
      this.currentSettlementId = null;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  getCurrentSettlementId(): string | null {
    return this.currentSettlementId;
  }

  update(settlement: SettlementState, state: GameState): void {
    const ownerText = settlement.ownerId !== null ? ` — Player ${settlement.ownerId + 1}` : " — Neutral";
    this.menu.setTitle(`Settlement${ownerText}`);
    this.bannerEl.src = SETTLEMENT_BANNERS[settlement.level as CastleLevel] ?? SETTLEMENT_BANNERS[1];
    this.nameEl.childNodes[0].textContent = settlement.name;
    this.levelBadge.textContent = `L${settlement.level}`;
    this.populationEl.textContent = settlement.population.toLocaleString();
    this.incomeEl.textContent = `${(settlement.population * settlement.goldTax).toLocaleString()}g`;
    this.treasuryEl.textContent = `${settlement.gold}g`;
    this.moraleEl.textContent = `${Math.round(settlement.morale ?? 100)}%${settlement.autoTrade ? " · auto" : ""}`;
    
    const foodReq = Math.ceil((settlement.population ?? 0) / 100);
    this.foodEl.textContent = `${settlement.warehouse.food ?? 0} / ${foodReq} req`;

    this.warehouseEls["wood"].textContent = String(settlement.warehouse.wood ?? 0);
    this.warehouseEls["stone"].textContent = String(settlement.warehouse.stone ?? 0);
    this.warehouseEls["iron"].textContent = String(settlement.warehouse.iron ?? 0);
    this.warehouseEls["arcane"].textContent = String(settlement.warehouse.arcane ?? 0);
    this.warehouseEls["food"].textContent = String(settlement.warehouse.food ?? 0);

    let showRecruit = false;
    if (this.onRecruitHero && settlement.ownerId !== null) {
      const player = state.players.find((p) => p.id === settlement.ownerId);
      if (player) {
        const hexOccupied = Object.values(state.heroes).some(
          (h) => h.q === settlement.q && h.r === settlement.r
        );
        showRecruit =
          player.heroIds.length < MAX_HEROES_PER_PLAYER &&
          settlement.gold >= HERO_RECRUIT_COST &&
          settlement.ownerId === state.activePlayerId &&
          state.phase.kind === "PLAYER_TURN" &&
          player.faction === "player" &&
          !hexOccupied;
      }
    }
    this.recruitBtn.style.display = showRecruit ? "" : "none";
    this.recruitBtn.textContent = `Recruit Hero (${HERO_RECRUIT_COST}g)`;
  }
}
