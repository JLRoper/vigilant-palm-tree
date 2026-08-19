import { PopupMenu, menuTheme } from "@screens/shared/menu";
import {
  attachDockControl,
  getPanelRail,
  mountPanel,
  savePanelPosition,
  toolbarHeight,
} from "@screens/shared/panelRail";
import type { GameState, HeroId } from "../../state/gameState";
import { MOVEMENT_PER_TURN } from "../../state/gameState";
import { HERO_BANNERS } from "../../render/assetDescriptors";

export interface HeroRosterMenuOptions {
  onSelectHero?: (heroId: HeroId) => void;
  onCenterHero?: (heroId: HeroId) => void;
}

export class HeroRosterMenu {
  private menu: PopupMenu;
  private visible = false;
  private opts: HeroRosterMenuOptions;
  private content: HTMLDivElement;
  private lastRosterKey = "";

  constructor(opts: HeroRosterMenuOptions) {
    this.opts = opts;

    this.menu = new PopupMenu({
      parent: getPanelRail(),
      title: "Heroes",
      width: 280,
      closeable: true,
      draggable: true,
      zIndex: 60,
      minTop: toolbarHeight,
      onMove: (pos) => savePanelPosition("heroes", pos),
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
    attachDockControl(this.menu, "heroes");
  }

  show(state: GameState): void {
    if (!this.visible) {
      mountPanel(this.menu, "heroes");
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
    if (!this.visible) return;
    const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
    this.menu.setTitle(activePlayer ? `${activePlayer.name}'s Heroes` : "Heroes");

    const heroIds = activePlayer?.heroIds ?? [];
    const heroes = heroIds
      .map((id) => state.heroes[id])
      .filter((h): h is NonNullable<typeof h> => h != null);

    const canSelectHero =
      this.opts.onSelectHero != null &&
      state.phase.kind === "PLAYER_TURN" &&
      activePlayer?.faction === "player";

    const hasLocate = this.opts.onCenterHero != null;

    const rosterKey = JSON.stringify({
      activePlayerId: state.activePlayerId,
      phaseKind: state.phase.kind,
      heroes: heroes.map((h) => ({
        id: h.id, q: h.q, r: h.r, gold: h.gold,
        troops: h.troops, movementRemaining: h.movementRemaining,
        isChartering: h.isChartering, name: h.name,
        horseVariant: h.horseVariant,
      })),
      canSelectHero,
      hasLocate,
    });

    if (rosterKey === this.lastRosterKey) return;
    this.lastRosterKey = rosterKey;

    this.content.replaceChildren();

    if (heroes.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = activePlayer
        ? `${activePlayer.name} has no heroes.`
        : "No active player.";
      Object.assign(empty.style, {
        opacity: "0.7",
        padding: "8px 0",
      });
      this.content.appendChild(empty);
      return;
    }

    for (const hero of heroes) {
      this.content.appendChild(this.buildHeroRow(hero, canSelectHero, hasLocate));
    }
  }

  private buildHeroRow(
    hero: NonNullable<GameState["heroes"][HeroId]>,
    canSelectHero: boolean,
    hasLocate: boolean,
  ): HTMLDivElement {
    const bannerUrl = HERO_BANNERS[hero.horseVariant];

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "8px 10px",
      borderRadius: "4px",
      background: `linear-gradient(rgba(26, 26, 26, 0.3), rgba(26, 26, 26, 0.3)), url(${bannerUrl}) center / cover no-repeat`,
    });

    if (canSelectHero) {
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onSelectHero?.(hero.id);
      });
      row.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.opts.onCenterHero?.(hero.id);
      });
    } else if (hasLocate) {
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onCenterHero?.(hero.id);
      });
    }

    const nameEl = document.createElement("div");
    nameEl.textContent = hero.name;
    Object.assign(nameEl.style, {
      fontWeight: "600",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    });
    row.appendChild(nameEl);

    const metaEl = document.createElement("div");
    const remaining = Math.round(Math.max(0, hero.movementRemaining));
    metaEl.textContent = `(${hero.q}, ${hero.r}) · Move ${remaining}/${MOVEMENT_PER_TURN} · ${hero.gold}g · ${hero.troops} troops`;
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
