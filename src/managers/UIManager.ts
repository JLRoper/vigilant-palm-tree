import { buildHud, updateHud, canEndTurn, type HudHandles } from "../views/hud";
import { Toolbar, type CalendarSnapshot } from "../views/toolbar";
import { HeroInfoMenu } from "../views/heroInfoMenu";
import { HeroRosterMenu } from "../views/heroRosterMenu";
import { SettlementRosterMenu } from "../views/settlementRosterMenu";
import { SettlementInfoMenu } from "../views/settlementInfoMenu";
import { CityView } from "../views/cityView";
import { GameState, calendarFromDay, monthName } from "../state/gameState";
import type { HeroId } from "../state/gameState";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { SpriteProvider } from "../render/assets";
import { playerIncome, playerWealth } from "../economy/income";
import { pickHeroName } from "../data/heroNames";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import { SessionManager, type SaveStatus } from "./SessionManager";
import { GameStateManager } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import type { MapInfo } from "../views/settingsMenu";

type ToolbarCallbacks = {
  onNew: (opts: { name: string; seed: number; castleSeed?: number; castleCount?: number; mapSize?: "small" | "medium" | "large" }) => void;
  onLoad: (loaded: import("../io/api").Game, tiles: import("../io/api").TileRow[]) => void;
  onSave: () => void;
  onEndTurn: () => void;
  onForget: (id: number) => void;
  getMapInfo?: () => MapInfo | null;
};

export class UIManager {
  private hudHandles?: HudHandles;
  private toolbar?: Toolbar;
  private heroInfoMenu?: HeroInfoMenu;
  private heroRosterMenu?: HeroRosterMenu;
  private settlementRosterMenu?: SettlementRosterMenu;
  private settlementInfoMenu?: SettlementInfoMenu;
  private cityView?: CityView;
  private gameStateManager?: GameStateManager;
  private viewManager?: ViewManager;

  constructor(
    private hudEl: HTMLElement,
    private toolbarEl: HTMLElement,
    private spriteProvider: SpriteProvider,
  ) {}

  initHud(): void {
    this.hudHandles = buildHud(this.hudEl);
  }

  initToolbar(
    session: SessionManager,
    state: GameStateManager,
    getCalendar: () => CalendarSnapshot | null,
    callbacks: ToolbarCallbacks,
    getZoom?: () => number,
  ): void {
    this.gameStateManager = state;
    this.toolbar = new Toolbar({
      parent: this.toolbarEl,
      state: {
        backendOk: () => session.isBackendOk(),
        hasActiveGame: () => session.getActiveGameId() !== null,
        canEndTurnNow: () => canEndTurn(state.getState()),
        getCalendar,
        getSaveStatus: () => session.getSaveStatus(),
        getLastSavedAt: () => session.getLastSavedAt(),
        getZoom: getZoom ?? (() => 1),
      },
      callbacks: {
        onNew: callbacks.onNew,
        onLoad: callbacks.onLoad,
        onSave: callbacks.onSave,
        onEndTurn: callbacks.onEndTurn,
        onHeroes: () => this.openHeroRoster(),
        onSettlements: () => this.openSettlementRoster(),
        onForget: (id: number) => {
          session.forget(id);
          callbacks.onForget(id);
        },
        getMapInfo: callbacks.getMapInfo,
      },
    });

    this.heroRosterMenu = new HeroRosterMenu({
      onSelectHero: (heroId) => this.handleRosterHeroSelect(heroId),
      onCenterHero: (heroId) => this.handleRosterHeroCenter(heroId),
    });
    this.settlementRosterMenu = new SettlementRosterMenu({
      onCenterSettlement: (settlementId) => this.handleRosterSettlementCenter(settlementId),
    });

    document.addEventListener("keydown", (e) => this.handleKeyDown(e));
  }

  initHeroMenu(
    onTransfer: (heroId: string, settlementId: string, direction: "deposit" | "withdraw") => { ok: boolean; reason: string },
    onReorder: (fromIdx: number, toIdx: number) => void,
  ): void {
    this.heroInfoMenu = new HeroInfoMenu({
      parent: document.body,
      onTransfer,
      onReorder,
      onClose: () => {
        if (this.gameStateManager) {
          const tc = this.gameStateManager.getTurnController();
          tc.clearSelection();
          this.gameStateManager.replaceState(tc.getState());
        }
      },
    });
  }

  initSettlementInfo(): void {
    this.settlementInfoMenu = new SettlementInfoMenu({
      parent: document.body,
      onClose: () => {
        if (this.gameStateManager) {
          const tc = this.gameStateManager.getTurnController();
          tc.clearSettlementSelection();
          this.gameStateManager.replaceState(tc.getState());
        }
      },
      onRecruitHero: () => this.handleRecruitHero(),
    });
  }

  initCityView(
    state: () => GameStateManager,
    viewManager: ViewManager,
  ): void {
    this.viewManager = viewManager;
    const getTc = () => state().getTurnController();
    this.cityView = new CityView({
      provider: this.spriteProvider,
      onClose: () => {
        const closedId = this.cityView!.close();
        if (closedId) {
          getTc().selectSettlement(closedId);
          state().replaceState(getTc().getState());
          const s = state().getSettlement(closedId);
          if (s) {
            viewManager.centerOn(s.tile.q, s.tile.r);
          }
        }
      },
    });
  }

  getToolbar(): Toolbar | undefined { return this.toolbar; }
  getCityView(): CityView | undefined { return this.cityView; }

  refreshHud(
    gameState: GameState,
    heroes: Record<string, Hero>,
    settlements: Record<string, Castle>,
    viewHover: { q: number; r: number } | null,
    gameMap: GameMap,
    camera: Camera,
    backendOk: boolean,
    saveStatus: SaveStatus,
    lastSavedAt: string | null,
  ): void {
    if (!this.hudHandles) return;
    updateHud(
      this.hudEl,
      gameState,
      heroes,
      settlements,
      viewHover,
      gameMap,
      camera,
      backendOk,
      saveStatus,
      lastSavedAt,
      this.hudHandles,
    );
    this.refreshHeroInfoMenu(gameState, heroes);
    this.refreshSettlementInfoMenu(gameState);
    this.refreshRosterMenus(gameState);
    this.toolbar?.refresh();
  }

  private refreshHeroInfoMenu(gameState: GameState, heroes: Record<string, Hero>): void {
    if (!this.heroInfoMenu) return;
    const selectedId = gameState.selectedHeroId;
    if (!selectedId) {
      this.heroInfoMenu.hide();
      return;
    }
    const hero = heroes[selectedId];
    if (!hero) {
      this.heroInfoMenu.hide();
      return;
    }
    const player = gameState.players.find((p) => p.id === hero.ownerId);
    if (!player) {
      this.heroInfoMenu.hide();
      return;
    }
    if (this.heroInfoMenu.getCurrentHeroId() !== selectedId) {
      this.heroInfoMenu.show(hero, player, gameState);
    } else {
      this.heroInfoMenu.update(hero, gameState);
    }
  }

  private refreshSettlementInfoMenu(gameState: GameState): void {
    if (!this.settlementInfoMenu) return;
    const selectedId = gameState.selectedSettlementId;
    if (!selectedId) {
      this.settlementInfoMenu.hide();
      return;
    }
    const settlement = gameState.settlements[selectedId];
    if (!settlement) {
      this.settlementInfoMenu.hide();
      return;
    }
    if (this.settlementInfoMenu.getCurrentSettlementId() !== selectedId) {
      this.settlementInfoMenu.show(settlement, gameState);
    } else {
      this.settlementInfoMenu.update(settlement, gameState);
    }
  }

  private refreshRosterMenus(_gameState: GameState): void {
    // Rosters are populated by show() and persist until hide().
    // Per-frame update() would destroy/recreate buttons every 16ms,
    // causing click events to be lost when the target element is
    // detached from the DOM between mousedown and mouseup.
  }

  private openHeroRoster(): void {
    if (!this.gameStateManager || !this.heroRosterMenu) return;
    const state = this.gameStateManager.getState();
    if (this.heroRosterMenu.isVisible()) {
      this.heroRosterMenu.hide();
    } else {
      this.heroRosterMenu.show(state);
    }
  }

  private openSettlementRoster(): void {
    if (!this.gameStateManager || !this.settlementRosterMenu) return;
    const state = this.gameStateManager.getState();
    if (this.settlementRosterMenu.isVisible()) {
      this.settlementRosterMenu.hide();
    } else {
      this.settlementRosterMenu.show(state);
    }
  }

  private handleRosterHeroSelect(heroId: HeroId): void {
    if (!this.gameStateManager) return;
    const tc = this.gameStateManager.getTurnController();
    tc.selectHero(heroId);
    this.gameStateManager.replaceState(tc.getState());
    this.gameStateManager.rebuildHeroesFromState();
    this.gameStateManager.syncHeroVisualsToState();
    this.handleRosterHeroCenter(heroId);
  }

  private handleRosterHeroCenter(heroId: HeroId): void {
    if (!this.gameStateManager || !this.viewManager) return;
    const hero = this.gameStateManager.getHero(heroId);
    if (hero) {
      this.viewManager.centerOn(hero.tile.q, hero.tile.r);
    }
  }

  private handleRecruitHero(): void {
    if (!this.gameStateManager) { console.warn("[recruit] no gameStateManager"); return; }
    const gs = this.gameStateManager.getState();
    const settlementId = gs.selectedSettlementId;
    if (!settlementId) { console.warn("[recruit] no selected settlement"); return; }
    const name = pickHeroName();
    if (!name) { console.warn("[recruit] no name available"); return; }
    console.log("[recruit] attempting: name=", name, "settlement=", settlementId, "gold=", gs.settlements[settlementId]?.gold);
    const tc = this.gameStateManager.getTurnController();
    const result = tc.recruitHero(name, settlementId);
    console.log("[recruit] result ok=", !!result.hero, "error=", result.error, "heroId=", result.hero?.id);
    if (result.hero) {
      this.gameStateManager.replaceState(result.state);
      this.gameStateManager.rebuildHeroesFromState();
      this.gameStateManager.syncHeroVisualsToState();
      console.log("[recruit] hero rebuild done, heroes count:", Object.keys(this.gameStateManager.getHeroesMap()).length);
      if (this.viewManager) {
        this.viewManager.centerOn(result.hero.q, result.hero.r);
      }
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (this.heroInfoMenu?.isVisible()) {
      if (this.gameStateManager) {
        const tc = this.gameStateManager.getTurnController();
        tc.clearSelection();
        this.gameStateManager.replaceState(tc.getState());
      }
    } else if (this.settlementInfoMenu?.isVisible()) {
      if (this.gameStateManager) {
        const tc = this.gameStateManager.getTurnController();
        tc.clearSettlementSelection();
        this.gameStateManager.replaceState(tc.getState());
      }
    }
  }

  private handleRosterSettlementCenter(settlementId: string): void {
    if (!this.gameStateManager || !this.viewManager) return;
    const settlement = this.gameStateManager.getSettlement(settlementId);
    if (settlement) {
      this.viewManager.centerOn(settlement.tile.q, settlement.tile.r);
    }
  }

  static buildCalendarSnapshot(state: GameState): CalendarSnapshot | null {
    if (!state.players.length) return null;
    const cal = calendarFromDay(state.day);
    const activePlayer =
      state.players.find((p) => p.id === state.activePlayerId) ?? state.players[0];
    const ownedSettlements = Object.values(state.settlements).filter(
      (s) => s.ownerId === activePlayer.id,
    );
    const morale =
      ownedSettlements.length > 0
        ? Math.round(
            ownedSettlements.reduce((acc, s) => acc + (s.morale ?? 100), 0) /
              ownedSettlements.length,
          )
        : null;
    const effectiveIncome =
      ownedSettlements.length > 0
        ? ownedSettlements.reduce((acc, s) => {
            const m = Math.max(0, Math.min(100, s.morale ?? 100));
            return acc + Math.round(((s.population ?? 0) * (s.goldTax ?? 0) * m) / 100);
          }, 0)
        : null;
    return {
      day: state.day,
      week: cal.week,
      dayOfWeek: cal.dayOfWeek,
      month: cal.month,
      dayOfMonth: cal.dayOfMonth,
      monthName: monthName(cal.month),
      activePlayerName: activePlayer.name,
      activePlayerColor: activePlayer.color,
      nextTurnGold: playerIncome(state, activePlayer.id),
      wealth: playerWealth(state, activePlayer.id),
      morale,
      effectiveIncome,
    };
  }
}
