import { PopupMenu, menuTheme } from "./menu";
import type { GameState, HeroId } from "../state/gameState";
import { MOVEMENT_PER_TURN } from "../state/gameState";

export interface HeroRosterMenuOptions {
  onSelectHero?: (heroId: HeroId) => void;
  onCenterHero?: (heroId: HeroId) => void;
}

export class HeroRosterMenu {
  private menu: PopupMenu;
  private visible = false;
  private opts: HeroRosterMenuOptions;
  private content: HTMLDivElement;

  constructor(opts: HeroRosterMenuOptions) {
    this.opts = opts;

    this.menu = new PopupMenu({
      parent: document.body,
      title: "Heroes",
      initialPosition: { x: 260, y: 16 },
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
    if (!this.visible) {
      if (!this.menu.root.parentNode) {
        document.body.appendChild(this.menu.root);
      }
      this.menu.root.style.display = "";
      this.visible = true;
    }
    this.update(state);
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
    if (!this.visible) return;
    const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
    this.menu.setTitle(activePlayer ? `${activePlayer.name}'s Heroes` : "Heroes");

    this.content.replaceChildren();

    const heroIds = activePlayer?.heroIds ?? [];
    const heroes = heroIds
      .map((id) => state.heroes[id])
      .filter((h): h is NonNullable<typeof h> => h != null);

    const canSelectHero =
      this.opts.onSelectHero != null &&
      state.phase.kind === "PLAYER_TURN" &&
      activePlayer?.faction === "player";

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
      this.content.appendChild(this.buildHeroRow(hero, canSelectHero));
    }
  }

  private buildHeroRow(
    hero: NonNullable<GameState["heroes"][HeroId]>,
    canSelectHero: boolean,
  ): HTMLDivElement {
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
    nameEl.textContent = hero.name;
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

    if (canSelectHero) {
      const selectBtn = document.createElement("button");
      selectBtn.textContent = "Select";
      Object.assign(selectBtn.style, {
        padding: "3px 6px",
        fontSize: "11px",
        cursor: "pointer",
        background: menuTheme.button.background,
        color: menuTheme.button.color,
        border: menuTheme.button.border,
        borderRadius: menuTheme.button.borderRadius,
        fontFamily: menuTheme.font,
      });
      selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onSelectHero?.(hero.id);
      });
      buttons.appendChild(selectBtn);
    }

    if (this.opts.onCenterHero) {
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
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onCenterHero?.(hero.id);
      });
      buttons.appendChild(locateBtn);
    }

    topRow.appendChild(buttons);
    row.appendChild(topRow);

    const metaEl = document.createElement("div");
    const remaining = hero.movementRemaining < 1 ? 0 : hero.movementRemaining;
    metaEl.textContent = `(${hero.q}, ${hero.r}) · Move ${remaining.toFixed(1)}/${MOVEMENT_PER_TURN} · ${hero.gold}g · ${hero.troops} troops`;
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
