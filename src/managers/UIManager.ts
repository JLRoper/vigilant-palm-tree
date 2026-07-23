import { buildHud, updateHud, canEndTurn, type HudHandles } from "../views/hud";
import { Toolbar, type CalendarSnapshot } from "../views/toolbar";
import { HeroInfoMenu } from "../views/heroInfoMenu";
import { SettlementPanel } from "../views/settlementPanel";
import { CityView } from "../views/cityView";
import { GameState, calendarFromDay, monthName } from "../state/gameState";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { SpriteProvider } from "../render/assets";
import { playerIncome, playerWealth } from "../economy/income";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import { SessionManager, type SaveStatus } from "./SessionManager";
import { GameStateManager } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import type { WarehouseResource } from "../state/gameState";
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
  private settlementPanel?: SettlementPanel;
  private cityView?: CityView;

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
  ): void {
    this.toolbar = new Toolbar({
      parent: this.toolbarEl,
      state: {
        backendOk: () => session.isBackendOk(),
        hasActiveGame: () => session.getActiveGameId() !== null,
        canEndTurnNow: () => canEndTurn(state.getState()),
        getCalendar,
      },
      callbacks: {
        onNew: callbacks.onNew,
        onLoad: callbacks.onLoad,
        onSave: callbacks.onSave,
        onEndTurn: callbacks.onEndTurn,
        onForget: (id: number) => {
          session.forget(id);
          callbacks.onForget(id);
        },
        getMapInfo: callbacks.getMapInfo,
      },
    });
  }

  initHeroMenu(
    onTransfer: (heroId: string, settlementId: string, direction: "deposit" | "withdraw") => { ok: boolean; reason: string },
    onReorder: (fromIdx: number, toIdx: number) => void,
  ): void {
    this.heroInfoMenu = new HeroInfoMenu({
      parent: document.body,
      onTransfer,
      onReorder,
    });
  }

  initSettlementPanel(
    state: () => GameStateManager,
  ): void {
    const getTc = () => state().getTurnController();
    this.settlementPanel = new SettlementPanel({
      parent: document.body,
      onSelect: (id: string) => {
        getTc().selectSettlement(id);
        state().replaceState(getTc().getState());
      },
      onTrade: (fromId: string, toId: string, resource: WarehouseResource, amount: number) => {
        const result = getTc().tradeResources(fromId, toId, resource, amount);
        if (result.ok) {
          state().replaceState(getTc().getState());
        }
        return result;
      },
      onToggleAutoTrade: (settlementId: string, autoTrade: boolean) => {
        const ok = getTc().setAutoTrade(settlementId, autoTrade);
        if (ok) {
          state().replaceState(getTc().getState());
        }
        return ok;
      },
    });
  }

  initCityView(
    state: () => GameStateManager,
    viewManager: ViewManager,
  ): void {
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
    this.refreshSettlementPanel(gameState);
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

  private refreshSettlementPanel(gameState: GameState): void {
    this.settlementPanel?.update(gameState);
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
