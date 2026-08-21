import type { GameState, SettlementState } from "../../state/gameState";
import { MAX_HEROES_PER_PLAYER, HERO_RECRUIT_COST, SETTLEMENT_UPGRADE_COSTS } from "../../state/gameState";
import { PopupMenu, menuTheme, openCenteredModal, styleButton, anchorMenuToBottom, clampMenuIntoView } from "@screens/shared/menu";
import { toolbarHeight } from "@screens/shared/panelRail";
import { RESOURCE_PILE_BUBBLY_SPRITES, SETTLEMENT_BANNERS } from "../../render/assetDescriptors";
import { settings } from "../../state/settings";
import type { HorseVariant } from "../../state/settings";
import { POP_BY_LEVEL } from "@heroes/engine";
import { pickHeroName } from "../../data/heroNames";
import { HORSE_VARIANT_REGISTRY } from "@heroes/engine";

export interface SettlementInfoMenuOptions {
  parent: HTMLElement;
  onClose?: () => void;
  onRecruitHero?: (name: string, variant: HorseVariant) => void;
  onUpgradeSettlement?: () => void;
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

const PANEL_X = 16;

export class SettlementInfoMenu {
  private menu: PopupMenu;
  private visible = false;
  private currentSettlementId: string | null = null;
  // Once the player drags the panel, their position wins: reposition() then
  // only clamps it back into view rather than re-anchoring it.
  private userMoved = false;
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
  private onRecruitHero?: (name: string, variant: HorseVariant) => void;
  private recruitContainer: HTMLDivElement;
  private recruitBtn: HTMLButtonElement;
  private onUpgradeSettlement?: () => void;
  private upgradeContainer: HTMLDivElement;
  private upgradeBtn: HTMLButtonElement;
  private upgradeInfo: HTMLSpanElement;

  constructor(opts: SettlementInfoMenuOptions) {
    this.onCloseCallback = opts.onClose;
    this.onRecruitHero = opts.onRecruitHero;
    this.onUpgradeSettlement = opts.onUpgradeSettlement;
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Settlement",
      // Placeholder only. The real position is derived from the panel's
      // measured height by reposition(), once it is on screen and displayed.
      initialPosition: { x: PANEL_X, y: toolbarHeight() },
      width: 240,
      closeable: true,
      draggable: true,
      zIndex: 60,
      minTop: toolbarHeight,
      onMove: () => {
        this.userMoved = true;
      },
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
      if (this.onRecruitHero) {
        openRecruitHeroModal(this.onRecruitHero);
      }
    });
    this.recruitContainer.appendChild(this.recruitBtn);

    this.upgradeContainer = document.createElement("div");
    body.appendChild(this.upgradeContainer);

    this.upgradeBtn = document.createElement("button");
    Object.assign(this.upgradeBtn.style, {
      padding: "7px 10px",
      fontSize: "12px",
      cursor: "pointer",
      background: "rgba(90,60,20,0.7)",
      color: menuTheme.button.color,
      border: menuTheme.button.border,
      borderRadius: menuTheme.button.borderRadius,
      fontFamily: menuTheme.font,
      width: "100%",
      marginTop: "4px",
    });
    this.upgradeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onUpgradeSettlement?.();
    });
    this.upgradeContainer.appendChild(this.upgradeBtn);

    this.upgradeInfo = document.createElement("span");
    Object.assign(this.upgradeInfo.style, {
      fontSize: "10px",
      opacity: "0.6",
      display: "block",
      marginTop: "2px",
    });
    this.upgradeContainer.appendChild(this.upgradeInfo);

    this.menu.root.style.display = "none";

    // The panel is appended straight to document.body rather than through
    // panelRail, so it does not inherit the rail's resize re-clamp.
    window.addEventListener("resize", () => this.reposition());
  }

  // The panel's height varies with the settlement (recruit and upgrade rows
  // appear conditionally), so the anchor has to come from a measured box
  // rather than a constant. Must run *after* `display` is restored: a
  // `display: none` element measures 0x0 and would anchor a zero-height box.
  private reposition(): void {
    if (!this.visible) return;
    const minTop = toolbarHeight();
    if (this.userMoved) clampMenuIntoView(this.menu, minTop);
    else anchorMenuToBottom(this.menu, PANEL_X, minTop);
  }

  show(settlement: SettlementState, state: GameState): void {
    this.currentSettlementId = settlement.id;
    this.update(settlement, state);
    if (!this.visible) {
      if (!this.menu.root.parentNode) {
        document.body.appendChild(this.menu.root);
      }
      // "flex", never "": the root's inline `display: flex` is what makes the
      // header stay pinned while the body scrolls. Clearing it drops the root
      // to `block`, and the body then overflows the root's max-height instead
      // of shrinking inside it -- which is why this panel's body never
      // scrolled (issue #140). Matches heroRosterMenu / tileInfoPanel.
      this.menu.root.style.display = "flex";
      this.visible = true;
    }
    // Runs on every show(), not just the hidden -> visible transition: the
    // panel is reused across settlements and its height varies with them.
    this.reposition();
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
    this.bannerEl.src = SETTLEMENT_BANNERS[settlement.level] ?? SETTLEMENT_BANNERS[1];
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

    if (this.onUpgradeSettlement && settlement.ownerId === state.activePlayerId && settlement.level < 3) {
      this.upgradeContainer.style.display = "";
      if (settlement.upgrade) {
        this.upgradeBtn.style.display = "none";
        this.upgradeInfo.style.display = "";
        this.upgradeInfo.textContent = `Upgrade in progress... ${settlement.upgrade.daysRemaining}d remaining`;
      } else {
        this.upgradeInfo.style.display = "";
        const cost = SETTLEMENT_UPGRADE_COSTS[settlement.level];
        const gatePct = settings().upgradePopulationGate;
        const levelMax = POP_BY_LEVEL[settlement.level] ?? 500;
        const popReq = Math.ceil(gatePct * levelMax);
        const townHall = settlement.buildings.find((b) => b.kind === "townHall");
        const thLevelOk = townHall && townHall.level >= settlement.level + 1;

        const missing: string[] = [];
        if (settlement.population < popReq) missing.push(`Pop ${settlement.population}/${popReq}`);
        if (!thLevelOk) missing.push(`TH L${settlement.level + 1}`);
        if (cost && settlement.gold < cost.gold) missing.push(`Gold ${settlement.gold}/${cost.gold}`);
        if (cost && (settlement.warehouse.wood ?? 0) < cost.wood) missing.push(`Wood`);
        if (cost && (settlement.warehouse.stone ?? 0) < cost.stone) missing.push(`Stone`);
        if (cost && (settlement.warehouse.iron ?? 0) < cost.iron) missing.push(`Iron`);
        if (cost && (settlement.warehouse.arcane ?? 0) < cost.arcane) missing.push(`Arcane`);

        if (missing.length > 0) {
          this.upgradeBtn.style.display = "";
          this.upgradeBtn.style.opacity = "0.4";
          this.upgradeBtn.style.cursor = "not-allowed";
          this.upgradeBtn.disabled = true;
          const nextLevel = settlement.level + 1;
          this.upgradeBtn.textContent = `Upgrade to L${nextLevel}`;
          this.upgradeInfo.textContent = `Needs: ${missing.join(", ")}`;
        } else {
          this.upgradeBtn.style.display = "";
          this.upgradeBtn.style.opacity = "1";
          this.upgradeBtn.style.cursor = "pointer";
          this.upgradeBtn.disabled = false;
          const nextLevel = settlement.level + 1;
          const costStr = cost ? `${cost.gold}g` : "";
          this.upgradeBtn.textContent = `Upgrade to L${nextLevel} — ${costStr}`;
          this.upgradeInfo.textContent = "";
        }
      }
    } else {
      this.upgradeContainer.style.display = "none";
    }
  }
}

function openRecruitHeroModal(onRecruit: (name: string, variant: HorseVariant) => void): void {
  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Hero Name";
  nameLabel.style.opacity = "0.7";
  content.appendChild(nameLabel);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = pickHeroName() ?? "Hero";
  Object.assign(nameInput.style, {
    padding: "6px 8px",
    fontSize: "13px",
    borderRadius: "3px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "#0e0e0e",
    color: "#eee",
    fontFamily: menuTheme.font,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  });
  content.appendChild(nameInput);

  const variantLabel = document.createElement("label");
  variantLabel.textContent = "Horse Variant";
  variantLabel.style.opacity = "0.7";
  content.appendChild(variantLabel);

  const variantGrid = document.createElement("div");
  Object.assign(variantGrid.style, {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "4px",
  });
  content.appendChild(variantGrid);

  let selectedVariant: HorseVariant = HORSE_VARIANT_REGISTRY[0].id;
  const buttons: HTMLButtonElement[] = [];

  for (const v of HORSE_VARIANT_REGISTRY) {
    const btn = document.createElement("button");
    btn.textContent = v.label;
    styleButton(btn);
    btn.style.width = "100%";
    btn.style.textAlign = "center";
    btn.style.padding = "6px 8px";
    btn.style.fontSize = "12px";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => {
      selectedVariant = v.id;
      for (const b of buttons) {
        b.style.border = menuTheme.button.border;
        b.style.background = menuTheme.button.background;
      }
      btn.style.border = "1px solid rgba(100,200,100,0.6)";
      btn.style.background = "rgba(40,90,40,0.5)";
    });
    if (v.id === selectedVariant) {
      btn.style.border = "1px solid rgba(100,200,100,0.6)";
      btn.style.background = "rgba(40,90,40,0.5)";
    }
    buttons.push(btn);
    variantGrid.appendChild(btn);
  }

  const errorLine = document.createElement("div");
  Object.assign(errorLine.style, { minHeight: "14px", fontSize: "11px" });
  content.appendChild(errorLine);

  const actionRow = document.createElement("div");
  Object.assign(actionRow.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "4px",
  });

  const modal = openCenteredModal(document.body, "Recruit Hero", 340);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => modal.close());
  actionRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Recruit";
  styleButton(confirmBtn, true);
  confirmBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorLine.textContent = "Name is required";
      return;
    }
    onRecruit(name, selectedVariant);
    modal.close();
  });
  actionRow.appendChild(confirmBtn);

  content.appendChild(actionRow);
  modal.setContent(content);
  nameInput.focus();
  nameInput.select();
}
