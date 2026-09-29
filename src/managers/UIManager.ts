import { buildHud, updateHud, canEndTurn, type HudHandles, type PathCostReadout } from "@screens/shared/hud";
import type { PlayerId } from "../state/gameState";
import { Toolbar, type CalendarSnapshot } from "@screens/shared/toolbar";
import { HeroInfoMenu } from "@screens/heroes/heroInfoMenu";
import { HeroRosterMenu } from "@screens/heroes/heroRosterMenu";
import { SettlementRosterMenu } from "@screens/settlements/settlementRosterMenu";
import { openLogisticsModal } from "@screens/logistics/logisticsModal";
import { SettlementInfoMenu } from "@screens/settlements/settlementInfoMenu";
import { TileInfoPanel } from "@screens/adventure/tileInfoPanel";
import { describeTile } from "@screens/adventure/tileInfo";
import { setMinimapReserve } from "@screens/shared/panelRail";
import { getMinimapReserveHeight } from "../render/minimap";
import { CityView, type CitySelectionSnapshot } from "@screens/settlements/cityView/cityView";
import { settleNet } from "@screens/settlements/cityView/netCost";
import { recordBuildCommit } from "../game/buildCommitLedger";
import { GameState, calendarFromDay, monthName } from "../state/gameState";
import type { HeroId, SettlementState } from "../state/gameState";
import type { Axial } from "../core/hex";
import { Hero } from "../entities/hero";
import { SpriteProvider } from "../render/assets";
import { playerIncome, playerWealth } from "@heroes/engine";
import { SessionManager } from "./SessionManager";
import { GameStateManager } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import type { MapInfo } from "@screens/home/settingsMenu";

type ToolbarCallbacks = {
  onNew: (opts: { name: string; seed: number; castleSeed?: number; castleCount?: number; mapSize?: "small" | "medium" | "large"; enemyCount?: number }) => void;
  onLoad: (loaded: import("../io/api").Game, tiles: import("../io/api").TileRow[]) => void;
  onSave: () => void;
  onEndTurn: () => void;
  onForget: (id: number) => void;
  getMapInfo?: () => MapInfo | null;
  onStartCharter?: () => void;
  canStartCharter?: () => boolean;
};

export class UIManager {
  private hudHandles?: HudHandles;
  private toolbar?: Toolbar;
  private heroInfoMenu?: HeroInfoMenu;
  private heroRosterMenu?: HeroRosterMenu;
  private settlementRosterMenu?: SettlementRosterMenu;
  private settlementInfoMenu?: SettlementInfoMenu;
  private tileInfoPanel?: TileInfoPanel;
  private inspectedTile: Axial | null = null;
  private cityView?: CityView;
  private gameStateManager?: GameStateManager;
  private viewManager?: ViewManager;

  constructor(
    private toolbarEl: HTMLElement,
    private spriteProvider: SpriteProvider,
  ) {}

  private initHud(): void {
    this.hudHandles = buildHud(this.toolbar?.statusSlot ?? this.toolbarEl);
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
        onStartCharter: callbacks.onStartCharter,
        canStartCharter: callbacks.canStartCharter,
        onOpenLogistics: () => this.openLogisticsModal(),
      },
    });

    this.initHud();

    this.heroRosterMenu = new HeroRosterMenu({
      onSelectHero: (heroId) => this.handleRosterHeroSelect(heroId),
      onCenterHero: (heroId) => this.handleRosterHeroCenter(heroId),
    });
    this.settlementRosterMenu = new SettlementRosterMenu({
      onSelectSettlement: (settlementId) => this.handleRosterSettlementSelect(settlementId),
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
      onRecruitHero: (name, variant) => this.handleRecruitHero(name, variant),
      onUpgradeSettlement: () => this.handleUpgradeSettlement(),
      getHeroesAtSettlement: (settlementId) => {
        if (!this.gameStateManager) return [];
        const gs = this.gameStateManager.getState();
        const s = gs.settlements[settlementId];
        if (!s) return [];
        return Object.values(gs.heroes).filter(
          (h) => h.q === s.q && h.r === s.r && h.ownerId === s.ownerId,
        );
      },
      onTransferUnits: (heroId, settlementId, direction, unitTypeId, count) => {
        if (!this.gameStateManager) return false;
        const tc = this.gameStateManager.getTurnController();
        if (!tc.transferUnits(heroId, settlementId, direction, unitTypeId, count)) return false;
        this.gameStateManager.replaceState(tc.getState());
        return true;
      },
    });
  }

  initTileInfo(): void {
    this.tileInfoPanel = new TileInfoPanel({
      parent: document.body,
      onClose: () => {
        this.inspectedTile = null;
        this.viewManager?.clearInspectedTile();
      },
    });
  }

  setInspectedTile(tile: Axial | null): void {
    this.inspectedTile = tile;
  }

  initCityView(
    state: () => GameStateManager,
    viewManager: ViewManager,
  ): void {
    this.viewManager = viewManager;
    const getStateMgr = () => state();
    this.cityView = new CityView({
      provider: this.spriteProvider,
      onUpgradeTownHall: () => {
        const openId = this.cityView?.getOpenSettlementId();
        if (!openId) return;
        const gs = state().getState();
        const s = gs.settlements[openId];
        if (!s) return;
        const townHall = s.buildings.find((b) => b.kind === "townHall");
        if (!townHall || townHall.level >= 3) return;
        const tc = state().getTurnController();
        const result = tc.startTownHallUpgrade(openId, (townHall.level + 1) as 2 | 3);
        if (result.ok) {
          state().replaceState(tc.getState());
        }
      },
      onRecruitUnits: (building, unitTypeId, count) => {
        const openId = this.cityView?.getOpenSettlementId();
        if (!openId) return;
        const tc = state().getTurnController();
        if (tc.recruitUnits(openId, building.kind, building.gx, building.gy, unitTypeId, count)) {
          state().replaceState(tc.getState());
        }
      },
      onUpgradeBuildings: (settlementId, requests) => {
        const tc = state().getTurnController();
        const result = tc.startBuildingUpgrade(settlementId, requests);
        if (result.ok) {
          state().replaceState(tc.getState());
        }
        return result;
      },
      getSettlement: () => {
        const gs = getStateMgr().getState();
        const openId = this.cityView?.getOpenSettlementId();
        return openId ? gs.settlements[openId] : undefined;
      },
      getSelection: (): CitySelectionSnapshot => {
        const gs = getStateMgr().getState();
        return { heroId: gs.selectedHeroId, settlementId: gs.selectedSettlementId };
      },
      getFloatingPanelRects: () => [
        this.heroInfoMenu?.floatingRect() ?? null,
        this.settlementInfoMenu?.floatingRect() ?? null,
      ],
      onClose: (closedId, buildings, netCost, final, preCitySelection) => {
        const gs = state().getState();
        const s = gs.settlements[closedId];
        let written = true;
        if (s) {
          const settled = settleNet(
            {
              gold: s.gold,
              wood: s.warehouse.wood ?? 0,
              stone: s.warehouse.stone ?? 0,
              iron: s.warehouse.iron ?? 0,
              arcane: s.warehouse.arcane ?? 0,
            },
            netCost,
          );
          if (settled.ok) {
            recordBuildCommit(closedId, netCost);
            const updatedSettlement: SettlementState = {
              ...s,
              buildings,
              gold: settled.gold,
              warehouse: {
                ...s.warehouse,
                wood: settled.wood,
                stone: settled.stone,
                iron: settled.iron,
                arcane: settled.arcane,
                food: s.warehouse.food ?? 0,
              },
            };
            const updated = {
              ...gs,
              settlements: {
                ...gs.settlements,
                [closedId]: updatedSettlement,
              },
              dirty: true,
            };
            state().replaceState(updated);
          } else {
            written = false;
          }
        }
        // Incremental commits (every placement/destroy while the planner is
        // open) skip the camera/select tail -- it would yank the viewport on
        // every grid click. Only a real close re-selects and re-centers.
        if (!final) return written;
        // Restore the selection captured at open() instead of force-selecting
        // the closed settlement: leaving the city must hand each floating
        // panel back exactly the open/closed state it had on entry.
        const tc = state().getTurnController();
        const after = state().getState();
        const heroId = preCitySelection?.heroId ?? null;
        if (heroId && after.heroes[heroId]) {
          tc.selectHero(heroId);
        }
        if (tc.getState().selectedHeroId === null) {
          const settlementId = preCitySelection?.settlementId ?? null;
          if (settlementId && after.settlements[settlementId]) {
            tc.selectSettlement(settlementId);
          } else {
            tc.clearSelection();
          }
        }
        state().replaceState(tc.getState());
        const castle = state().getSettlement(closedId);
        if (castle) {
          viewManager.centerOn(castle.tile.q, castle.tile.r);
        }
        return written;
      },
      onPlaceBuildings: (settlementId, buildings, initialLayout) => {
        const tc = state().getTurnController();
        const result = tc.placeBuildings(settlementId, buildings, initialLayout === true);
        if (result.ok) {
          state().replaceState(tc.getState());
        }
        return result.ok;
      },
    });
  }

  getToolbar(): Toolbar | undefined { return this.toolbar; }
  getCityView(): CityView | undefined { return this.cityView; }

  // Breathing room between the panel rail's hard stop and the minimap's own
  // drawn box, so the rail doesn't sit flush against it.
  private static readonly MINIMAP_RAIL_GAP = 16;

  setMapDimensions(width: number, height: number): void {
    setMinimapReserve(getMinimapReserveHeight(width, height) + UIManager.MINIMAP_RAIL_GAP);
  }

  refreshHud(
    gameState: GameState,
    heroes: Record<string, Hero>,
    lastSavedAt: string | null,
    localPlayerId: PlayerId | null,
  ): void {
    if (!this.hudHandles) return;
    updateHud(
      this.toolbarEl,
      gameState,
      lastSavedAt,
      this.hudHandles,
      localPlayerId,
      this.hudPathReadout(),
    );
    this.refreshHeroInfoMenu(gameState, heroes);
    this.refreshSettlementInfoMenu(gameState);
    this.refreshTileInfoPanel(gameState, heroes, localPlayerId);
    this.refreshRosterMenus(gameState);
    this.toolbar?.refresh();
  }

  // F10 (playtest fixes 2026-09-29): the AdventureView owns the hovered
  // path's cost numbers; the HUD snapshot pulls them at refresh time (the
  // frame loop refreshes the HUD every frame, so no extra wiring needed).
  private hudPathReadout(): PathCostReadout | null {
    return this.viewManager?.view.pathCostReadout ?? null;
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
    // Deliberately NO city-view check here: the stats menu stays open inside
    // the city grid — that's where live stockpile info matters most while
    // building (user request, 2026-09-27).
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

  private refreshTileInfoPanel(gameState: GameState, heroes: Record<string, Hero>, localPlayerId: PlayerId | null): void {
    if (!this.tileInfoPanel || !this.gameStateManager) return;
    if (this.cityView?.isOpen()) {
      this.tileInfoPanel.hide();
      return;
    }
    if (!this.inspectedTile) {
      this.tileInfoPanel.hide();
      return;
    }
    const info = describeTile({
      map: this.gameStateManager.getGameMap(),
      state: gameState,
      heroes: Object.values(heroes),
      castles: this.gameStateManager.getSettlements(),
      viewPlayerId: localPlayerId ?? 0,
      tile: this.inspectedTile,
    });
    if (!info) {
      this.tileInfoPanel.hide();
      return;
    }
    this.tileInfoPanel.update(info);
  }

  private refreshRosterMenus(gameState: GameState): void {
    if (this.heroRosterMenu?.isVisible()) {
      this.heroRosterMenu.update(gameState);
    }
    if (this.settlementRosterMenu?.isVisible()) {
      this.settlementRosterMenu.update(gameState);
    }
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

  private openLogisticsModal(): void {
    if (!this.gameStateManager) return;
    const stateManager = this.gameStateManager;
    const tc = () => stateManager.getTurnController();
    openLogisticsModal({
      parent: document.body,
      getState: () => stateManager.getState(),
      actions: {
        transferResources: (heroId, settlementId, direction, amounts) => {
          const result = tc().transferResources(heroId, settlementId, direction, amounts);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        assignWagons: (heroId, delta) => {
          const result = tc().assignWagons(heroId, delta);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        buyWagons: (settlementId, count) => {
          const result = tc().buyWagons(settlementId, count);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        createTradeRoute: (fromId, toId, resource, wagons) => {
          const result = tc().createTradeRoute(fromId, toId, resource, wagons);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        updateTradeRoute: (routeId, change) => {
          const result = tc().updateTradeRoute(routeId, change);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
      },
    });
  }

  private handleRosterHeroSelect(heroId: HeroId): void {
    if (!this.gameStateManager) return;
    const tc = this.gameStateManager.getTurnController();
    tc.selectHero(heroId);
    this.gameStateManager.replaceState(tc.getState());
    this.handleRosterHeroCenter(heroId);
  }

  private handleRosterHeroCenter(heroId: HeroId): void {
    if (!this.gameStateManager || !this.viewManager) return;
    const hero = this.gameStateManager.getHero(heroId);
    if (hero) {
      this.viewManager.centerOn(hero.tile.q, hero.tile.r);
    }
  }

  private handleRecruitHero(name: string, horseVariant: import("../state/settings").HorseVariant): void {
    if (!this.gameStateManager) { console.warn("[recruit] no gameStateManager"); return; }
    const gs = this.gameStateManager.getState();
    const settlementId = gs.selectedSettlementId;
    if (!settlementId) { console.warn("[recruit] no selected settlement"); return; }
    console.log("[recruit] attempting: name=", name, "settlement=", settlementId, "gold=", gs.settlements[settlementId]?.gold);
    const tc = this.gameStateManager.getTurnController();
    const result = tc.recruitHero(name, settlementId, horseVariant);
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

  private handleUpgradeSettlement(): void {
    if (!this.gameStateManager) return;
    const gs = this.gameStateManager.getState();
    const settlementId = gs.selectedSettlementId;
    if (!settlementId) return;
    const tc = this.gameStateManager.getTurnController();
    const result = tc.startSettlementUpgrade(settlementId);
    if (result.ok) {
      this.gameStateManager.replaceState(tc.getState());
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

  private handleRosterSettlementSelect(settlementId: string): void {
    if (!this.gameStateManager) return;
    const tc = this.gameStateManager.getTurnController();
    tc.selectSettlement(settlementId);
    this.gameStateManager.replaceState(tc.getState());
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
