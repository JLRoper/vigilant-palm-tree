import type { GameState, Player, SettlementState } from "../../state/gameState";
import type { Hero } from "../../entities/hero";
import { PopupMenu, menuTheme } from "@screens/shared/menu";
import { toolbarHeight } from "@screens/shared/panelRail";
import { DockedPanel } from "@screens/shared/dockedPanel";
import { makeRow } from "@screens/shared/panelWidgets";
import { ArmySection, type ReorderHandler } from "./armySection";
import { HERO_BANNERS, RESOURCE_PILE_BUBBLY_SPRITES } from "../../render/assetDescriptors";
import { HERO_BASE_ATTACK, HERO_BASE_DEFENCE, heroCargo, heroGoldCap, heroResourceCap, heroWagons } from "@heroes/engine";
import type { WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";

const MOVEMENT_PER_TURN = 7;

const PANEL_X = 16;

export type TransferHandler = (
  heroId: string,
  settlementId: string,
  direction: "deposit" | "withdraw",
) => { ok: boolean; reason: string };

export type { ReorderHandler };

export interface HeroInfoMenuOptions {
  parent: HTMLElement;
  onTransfer?: TransferHandler;
  onReorder?: ReorderHandler;
  onClose?: () => void;
}

interface HeroPanelDom {
  bannerEl: HTMLImageElement;
  nameEl: HTMLElement;
  goldEl: HTMLElement;
  foodEl: HTMLElement;
  transferRow: HTMLDivElement;
  withdrawBtn: HTMLButtonElement;
  depositBtn: HTMLButtonElement;
  movementFill: HTMLElement;
  movementLabel: HTMLElement;
  troopsEl: HTMLElement;
  cargoWagonsEl: HTMLElement;
  cargoEls: Record<string, HTMLSpanElement>;
  statValues: Record<string, HTMLSpanElement>;
}

function buildHeroPanelDom(
  body: HTMLElement,
  onTransferClick: (direction: "deposit" | "withdraw") => void,
): HeroPanelDom {
  const bannerEl = document.createElement("img");
  Object.assign(bannerEl.style, {
    width: "100%",
    height: "60px",
    objectFit: "cover",
    objectPosition: "center",
    borderRadius: "3px 3px 0 0",
    marginBottom: "6px",
    display: "block",
  });
  body.appendChild(bannerEl);

  const nameEl = document.createElement("div");
  Object.assign(nameEl.style, {
    fontSize: "15px",
    fontWeight: "600",
    color: menuTheme.panel.color,
  });
  body.appendChild(nameEl);

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
  const goldEl = document.createElement("span");
  goldEl.textContent = "0g";
  goldWrap.appendChild(goldEl);
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
  const foodEl = document.createElement("span");
  foodEl.textContent = "0 food";
  foodWrap.appendChild(foodEl);
  resourcesRow.appendChild(foodWrap);

  body.appendChild(resourcesRow);

  const transferRow = document.createElement("div");
  Object.assign(transferRow.style, {
    display: "flex",
    gap: "6px",
    marginTop: "6px",
  });
  const withdrawBtn = document.createElement("button");
  withdrawBtn.textContent = "Withdraw all";
  withdrawBtn.style.flex = "1";
  withdrawBtn.style.padding = "5px 6px";
  withdrawBtn.style.fontSize = "11px";
  withdrawBtn.style.cursor = "pointer";
  withdrawBtn.addEventListener("click", () => onTransferClick("withdraw"));
  transferRow.appendChild(withdrawBtn);
  const depositBtn = document.createElement("button");
  depositBtn.textContent = "Deposit all";
  depositBtn.style.flex = "1";
  depositBtn.style.padding = "5px 6px";
  depositBtn.style.fontSize = "11px";
  depositBtn.style.cursor = "pointer";
  depositBtn.addEventListener("click", () => onTransferClick("deposit"));
  transferRow.appendChild(depositBtn);
  body.appendChild(transferRow);

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
  const movementLabel = document.createElement("span");
  movementLabel.textContent = `${MOVEMENT_PER_TURN} / ${MOVEMENT_PER_TURN}`;
  movementLabelRow.appendChild(movementLabel);
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
  const movementFill = document.createElement("div");
  Object.assign(movementFill.style, {
    height: "100%",
    width: "100%",
    background: "linear-gradient(90deg, #2d8a2d 0%, #4cd964 100%)",
    transition: "width 180ms ease-out",
  });
  barTrack.appendChild(movementFill);
  movementSection.appendChild(barTrack);

  body.appendChild(movementSection);

  const cargoBlock = document.createElement("div");
  Object.assign(cargoBlock.style, {
    marginTop: "4px",
    paddingTop: "8px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  });

  const cargoHeader = document.createElement("div");
  Object.assign(cargoHeader.style, {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: "0.55",
    marginBottom: "6px",
  });
  const cargoTitle = document.createElement("span");
  cargoTitle.textContent = "Cargo";
  cargoHeader.appendChild(cargoTitle);
  const cargoWagonsEl = document.createElement("span");
  cargoWagonsEl.textContent = "0 wagons";
  cargoWagonsEl.style.textTransform = "none";
  cargoWagonsEl.style.letterSpacing = "0";
  cargoHeader.appendChild(cargoWagonsEl);
  cargoBlock.appendChild(cargoHeader);

  const cargoGrid = document.createElement("div");
  Object.assign(cargoGrid.style, {
    display: "grid",
    gridAutoFlow: "row",
    gridTemplateColumns: "repeat(5, 1fr)",
    columnGap: "2px",
    rowGap: "4px",
    justifyItems: "center",
  });
  const cargoEls: Record<string, HTMLSpanElement> = {};
  for (const r of WAREHOUSE_RESOURCES) {
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
      width: "24px",
      height: "24px",
      imageRendering: "pixelated",
      objectFit: "contain",
    });
    cell.appendChild(img);

    const name = document.createElement("span");
    name.textContent = r.charAt(0).toUpperCase() + r.slice(1);
    Object.assign(name.style, {
      fontSize: "9px",
      opacity: "0.6",
      lineHeight: "1",
    });
    cell.appendChild(name);

    const value = document.createElement("span");
    value.textContent = "0";
    Object.assign(value.style, {
      fontSize: "11px",
      fontVariantNumeric: "tabular-nums",
      opacity: "0.85",
      lineHeight: "1",
    });
    cell.appendChild(value);

    cargoEls[r as WarehouseResource] = value;
    cargoGrid.appendChild(cell);
  }
  cargoBlock.appendChild(cargoGrid);
  body.appendChild(cargoBlock);

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
  const troopsEl = document.createElement("span");
  troopsEl.style.fontVariantNumeric = "tabular-nums";
  troopsRow.appendChild(troopsEl);
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
  const statValues: Record<string, HTMLSpanElement> = {};
  for (const stat of ["Attack", "Defence", "Arcane", "Intelligence"]) {
    const { row, value } = makeRow(stat, { opacity: 0.4 });
    statsGrid.appendChild(row);
    statValues[stat] = value;
  }
  statsBlock.appendChild(statsGrid);

  body.appendChild(statsBlock);

  return {
    bannerEl,
    nameEl,
    goldEl,
    foodEl,
    transferRow,
    withdrawBtn,
    depositBtn,
    movementFill,
    movementLabel,
    troopsEl,
    cargoWagonsEl,
    cargoEls,
    statValues,
  };
}

export class HeroInfoMenu {
  private menu: PopupMenu;
  private visible = false;
  private currentHeroId: string | null = null;
  private docked: DockedPanel;

  private dom: HeroPanelDom;
  private army: ArmySection;

  private onTransfer?: TransferHandler;
  private settlementAtTile: SettlementState | null = null;

  constructor(opts: HeroInfoMenuOptions) {
    this.onTransfer = opts.onTransfer;

    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Hero",
      // Placeholder only. The real position is derived from the panel's
      // measured height by reposition(), once it is on screen and displayed.
      initialPosition: { x: PANEL_X, y: toolbarHeight() },
      width: 240,
      closeable: true,
      draggable: true,
      zIndex: 60,
      minTop: toolbarHeight,
      onMove: () => {
        this.docked.markUserMoved();
      },
      onClose: () => {
        this.visible = false;
        this.currentHeroId = null;
        opts.onClose?.();
      },
    });

    this.docked = new DockedPanel(this.menu, PANEL_X);

    this.army = new ArmySection({
      onReorder: opts.onReorder,
      onToggle: () => this.reposition(),
    });

    this.dom = buildHeroPanelDom(this.menu.body, (direction) => this.handleTransfer(direction));
    this.menu.body.appendChild(this.army.element);

    this.menu.root.style.display = "none";

    // The panel is appended straight to document.body rather than through
    // panelRail, so it does not inherit the rail's resize re-clamp.
    window.addEventListener("resize", () => this.reposition());
  }

  // The panel's height depends on the hero (army composition) and on whether
  // the Army section is expanded, so no constant can predict it -- the anchor
  // has to come from a measured box. Must run *after* `display` is restored:
  // a `display: none` element measures 0x0 and would anchor a zero-height box.
  private reposition(): void {
    this.docked.reposition(this.visible);
  }

  show(hero: Hero, player: Player, state: GameState): void {
    this.currentHeroId = hero.id;
    this.menu.setTitle(`Hero \u2014 ${player.name}`);
    this.update(hero, state);
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
    // panel is reused across heroes and its height changes with the army.
    this.reposition();
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
    this.dom.nameEl.textContent = hero.name;
    this.dom.bannerEl.src = HERO_BANNERS[hero.horseVariant] ?? HERO_BANNERS["bubbly"];
    this.dom.goldEl.textContent = `${hero.gold}g`;
    this.dom.foodEl.textContent = "0 food";
    const remaining = Math.max(0, hero.movementRemaining);
    const shown = Math.round(remaining);
    const pct = Math.max(0, Math.min(1, remaining / MOVEMENT_PER_TURN)) * 100;
    this.dom.movementFill.style.width = `${pct}%`;
    this.dom.movementLabel.textContent = `${shown} / ${MOVEMENT_PER_TURN}`;
    this.dom.troopsEl.textContent = `${hero.troops}  Â·  Upkeep: ${hero.troops}g/week`;

    this.renderCargo(hero, state);

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
    this.dom.withdrawBtn.disabled = !canTransfer || settlementGold <= 0;
    this.dom.depositBtn.disabled = !canTransfer || hero.gold <= 0;
    this.dom.withdrawBtn.style.opacity = this.dom.withdrawBtn.disabled ? "0.4" : "1";
    this.dom.depositBtn.style.opacity = this.dom.depositBtn.disabled ? "0.4" : "1";
    this.dom.withdrawBtn.style.cursor = this.dom.withdrawBtn.disabled ? "default" : "pointer";
    this.dom.depositBtn.style.cursor = this.dom.depositBtn.disabled ? "default" : "pointer";
    this.army.render(hero.stacks);
    this.renderStats(hero);
  }

  // Cargo shows the hero's wagon stockpile: every warehouse resource the hero
  // carries plus the assigned wagon count. Values come from the synced
  // HeroState (helpers backfill legacy saves' missing fields); tooltips carry
  // the per-wagon capacity caps.
  private renderCargo(hero: Hero, state: GameState): void {
    const heroState = state.heroes[hero.id];
    if (!heroState) return;
    const cargo = heroCargo(heroState);
    const caps = heroResourceCap(heroState);
    for (const r of WAREHOUSE_RESOURCES) {
      const el = this.dom.cargoEls[r];
      if (!el) continue;
      el.textContent = String(cargo[r] ?? 0);
      el.title = `${r}: ${cargo[r] ?? 0} / ${caps[r]} cap`;
    }
    const wagons = heroWagons(heroState);
    this.dom.cargoWagonsEl.textContent = `${wagons} wagons`;
    this.dom.cargoWagonsEl.title = `Gold purse capacity: ${heroGoldCap(heroState)}g`;
  }

  // Wires the four stat rows to real values (spellcasting v1's side effect —
  // roadmap §"Spellcasting v1", decision 3): Arcane/Intelligence read the
  // new HeroState fields; Attack/Defence show the flat v1 hero constants
  // from combatConfig — HeroState carries no per-hero attack/defence yet
  // (units do; hero stat progression is a later feature).
  private renderStats(hero: Hero): void {
    const values: Record<string, number> = {
      Attack: HERO_BASE_ATTACK,
      Defence: HERO_BASE_DEFENCE,
      Arcane: hero.arcane,
      Intelligence: hero.intelligence,
    };
    for (const [stat, value] of Object.entries(values)) {
      const el = this.dom.statValues[stat];
      if (!el) continue;
      el.textContent = String(value);
      const row = el.parentElement;
      if (row) {
        row.style.opacity = "0.85";
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
