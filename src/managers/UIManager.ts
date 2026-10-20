import { buildHud, updateHud, canEndTurn, type HudHandles, type PathCostReadout } from "@screens/shared/hud";
import type { PlayerId } from "../state/gameState";
import type { MapSize } from "../map/gameMap";
import { getInMemoryLocalPlayerId } from "../players/localPlayer";
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
import { RESOURCE_PILE_SMOL_SPRITES } from "../render/assetDescriptors";
import type { CityView, CitySelectionSnapshot } from "@screens/settlements/cityView/cityView";
import type { WorkforcePanel } from "@screens/settlements/cityView/workforcePanel";
import type { RecruitmentPanel } from "@screens/settlements/cityView/recruitmentPanel";
import { settleNet } from "@screens/settlements/cityView/netCost";
import { recordBuildCommit } from "../game/buildCommitLedger";
import { GameState, calendarFromDay, monthName } from "../state/gameState";
import type { HeroId, HeroState, SettlementState } from "../state/gameState";
import type { Axial } from "../core/hex";
import { Hero } from "../entities/hero";
import { SpriteProvider } from "../render/assets";
import { cachedUnitTypes } from "../data/unitCatalog";
import { districtKey, generateDistrictSpots, playerFactionId, playerIncome, playerWealth, playerEffectiveSettlementIncome, touchesTerrain, unitAllowedForSeatFaction, type CitySpot } from "@heroes/engine";
import { SessionManager } from "./SessionManager";
import { GameStateManager } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import type { MapInfo } from "@screens/home/settingsMenu";
import type { DistrictState, FactionId, BuildingKind } from "@heroes/contracts";

type ToolbarCallbacks = {
  onNew: (opts: { name: string; seed: number; castleSeed?: number; castleCount?: number; mapSize?: MapSize; enemyCount?: number; factionId?: FactionId }) => void;
  onLoad: (loaded: import("../io/api").Game, tiles?: import("../io/api").TileRow[]) => void;
  onSave: () => void;
  onEndTurn: () => void;
  onForget: (id: number) => void;
  getMapInfo?: () => MapInfo | null;
  onStartCharter?: () => void;
  canStartCharter?: () => boolean;
};

// The settlement panel's outward hooks the engine supplies: entering a
// settlement's city view from the panel's banner is the same door the
// adventure map's double-click uses, so the engine owns the gate and the
// panel only asks.
export type SettlementInfoCallbacks = {
  onEnterCityView?: (settlementId: string) => void;
  canEnterCityView?: (settlementId: string) => boolean;
  /** The engine's city/district doors as one entry: resolves true when that grid
   * is the one now displayed. `district: null` means the settlement's own city. */
  onEnterCityContext?: (
    settlementId: string,
    district: { q: number; r: number } | null,
  ) => Promise<boolean> | boolean;
};

const stateIdentityIds = new WeakMap<GameState, number>();
let nextStateIdentityId = 1;

/** District identity for "is this the grid the city view is showing" checks:
 *  both sides null (the settlement's own city), or the same hex. */
function sameCityContext(
  a: { q: number; r: number } | null | undefined,
  b: { q: number; r: number } | null,
): boolean {
  if (!a || !b) return !a && !b;
  return a.q === b.q && a.r === b.r;
}

function getStateIdentityId(state: GameState): number {
  let id = stateIdentityIds.get(state);
  if (id === undefined) {
    id = nextStateIdentityId++;
    stateIdentityIds.set(state, id);
  }
  return id;
}

export class UIManager {
  private hudHandles?: HudHandles;
  private toolbar?: Toolbar;
  private heroInfoMenu?: HeroInfoMenu;
  private heroRosterMenu?: HeroRosterMenu;
  private settlementRosterMenu?: SettlementRosterMenu;
  private settlementInfoMenu?: SettlementInfoMenu;
  private settlementCityView: SettlementInfoCallbacks = {};
  private tileInfoPanel?: TileInfoPanel;
  private inspectedTile: Axial | null = null;
  private cityView: CityView | null = null;
  private cityViewPromise: Promise<CityView> | null = null;
  private cityViewState?: () => GameStateManager;
  private cityViewLocalSeat?: () => PlayerId | null;
  private workforcePanel?: WorkforcePanel;
  private workforcePanelPromise: Promise<WorkforcePanel> | null = null;
  private recruitmentPanel?: RecruitmentPanel;
  private recruitmentPanelPromise: Promise<RecruitmentPanel> | null = null;
  private gameStateManager?: GameStateManager;
  private viewManager?: ViewManager;
  private lastMapWidth = -1;
  private lastMapHeight = -1;
  private lastHudKey = "";
  private lastMenusKey = "";
  private lastTileInfoKey = "";

  constructor(
    private toolbarEl: HTMLElement,
    private spriteProvider: SpriteProvider,
  ) {}

  private initHud(): void {
    this.hudHandles = buildHud(this.toolbar?.statusSlot ?? this.toolbarEl, {
      gold: RESOURCE_PILE_SMOL_SPRITES.gold,
      food: RESOURCE_PILE_SMOL_SPRITES.food,
    });
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
        // S3 (logistics-interface-fixes plan §5.8): mirrors the controller's
        // turn gate. Unknown local seat keeps the button enabled (today's
        // behavior) -- the controller rejects only a known mismatched seat.
        canOpenLogistics: () => {
          const gs = state.getState();
          if (!gs) return false;
          const seat = getInMemoryLocalPlayerId(session.getActiveGameName() ?? "");
          return seat == null || (gs.phase.kind === "PLAYER_TURN" && gs.activePlayerId === seat);
        },
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
      // Lazy: initSettlementInfo() supplies these after this menu is built.
      onEnterCityView: (settlementId) => this.settlementCityView.onEnterCityView?.(settlementId),
      canEnterCityView: (settlementId) => this.settlementCityView.canEnterCityView?.(settlementId) ?? false,
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
      onClose: () => {
        if (this.gameStateManager) {
          const tc = this.gameStateManager.getTurnController();
          tc.clearSelection();
          this.gameStateManager.replaceState(tc.getState());
        }
      },
    });
  }

  initSettlementInfo(callbacks: SettlementInfoCallbacks = {}): void {
    // Kept on the manager, not just handed to the info panel: the settlements
    // roster's rows open the same city view through the same gate.
    this.settlementCityView = callbacks;
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
      onEnterCityView: callbacks.onEnterCityView,
      canEnterCityView: callbacks.canEnterCityView,
      getHeroesAtSettlement: (settlementId) => this.heroesAtSettlement(settlementId),
      onTransferUnits: (heroId, settlementId, direction, unitTypeId, count, toSlot) =>
        this.transferUnitsFor(heroId, settlementId, direction, unitTypeId, count, toSlot),
      onReorderGarrison: (settlementId, fromIdx, toIdx) =>
        this.reorderGarrisonFor(settlementId, fromIdx, toIdx),
      onReorderHero: (heroId, fromIdx, toIdx) => this.reorderHeroStackFor(heroId, fromIdx, toIdx),
      onBankGold: (settlementId, gx, gy, amount, direction, district) => {
        if (!this.gameStateManager) return { ok: false, reason: "no_settlement" };
        const tc = this.gameStateManager.getTurnController();
        const result = tc.bankGold(settlementId, gx, gy, amount, direction, district);
        if (!result.ok) return result;
        this.gameStateManager.replaceState(tc.getState());
        return result;
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
    getLocalSeat?: () => PlayerId | null,
  ): void {
    // Lazy: CityView (and its skybox/sprite/asset chain) is imported and
    // constructed on the first open() -- a settlement double-click -- not at
    // boot. Everything it needs is stashed here for constructCityView().
    this.viewManager = viewManager;
    this.cityViewState = state;
    this.cityViewLocalSeat = getLocalSeat;
  }

  // Single construction point, reached only from the open path. The promise
  // (not just the instance) is cached, so two fast double-clicks can never
  // build two views; every sync path keeps using getCityView(). A failed
  // construction clears the cache so the next open retries.
  async ensureCityView(): Promise<CityView> {
    if (!this.cityViewPromise) {
      this.cityViewPromise = this.constructCityView().catch((err) => {
        this.cityViewPromise = null;
        throw err;
      });
    }
    return this.cityViewPromise;
  }

  private async constructCityView(): Promise<CityView> {
    const state = this.cityViewState;
    const viewManager = this.viewManager;
    if (!state || !viewManager) {
      throw new Error("[ui] initCityView() must run before the city view can open");
    }
    const { CityView } = await import("@screens/settlements/cityView/cityView");
    const getStateMgr = () => state();
    const getLocalSeat = this.cityViewLocalSeat;
    const view = new CityView({
      provider: this.spriteProvider,
      isUnitRecruitable: getLocalSeat
        ? (unitTypeId) => {
            const gs = getStateMgr().getState();
            const seat = getLocalSeat();
            const player = seat !== null ? gs.players.find((p) => p.id === seat) : undefined;
            return unitAllowedForSeatFaction(unitTypeId, {
              unitTypes: cachedUnitTypes(),
              seatFactionId: playerFactionId(player),
            });
          }
        : undefined,
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
        if (tc.recruitUnits(openId, building.kind, building.gx, building.gy, unitTypeId, count, this.cityView?.getOpenDistrict() ?? undefined)) {
          state().replaceState(tc.getState());
        }
      },
      onUpgradeBuildings: (settlementId, requests, district) => {
        const tc = state().getTurnController();
        const result = tc.startBuildingUpgrade(settlementId, requests, district ?? this.cityView?.getOpenDistrict() ?? undefined);
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
      onClose: (closedId, buildings, netCost, final, preCitySelection, district) => {
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
            let updatedSettlement: SettlementState;
            if (district) {
              const key = districtKey(district.q, district.r);
              const nextDistricts: Record<string, DistrictState> = { ...(s.districts ?? {}) };
              if (buildings.length > 0) {
                const map = state().getGameMap();
                const terrain = map.get(district.q, district.r);
                const mapRes = map.resourceTileAt(district.q, district.r)?.resource ?? null;
                const prevSpots = nextDistricts[key]?.citySpots;
                const citySpots =
                  prevSpots && prevSpots.length > 0
                    ? prevSpots
                    : generateDistrictSpots(district.q, district.r, gs.castleSeed, terrain, mapRes, {
                        touchesDenseForest: touchesTerrain(map, district.q, district.r, "denseForest"),
                      });
                nextDistricts[key] = {
                  q: district.q,
                  r: district.r,
                  citySpots,
                  buildings,
                };
              } else {
                delete nextDistricts[key];
              }
              const { districts: _prevDistricts, ...sWithoutDistricts } = s;
              updatedSettlement = {
                ...sWithoutDistricts,
                ...(Object.keys(nextDistricts).length > 0 ? { districts: nextDistricts } : {}),
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
            } else {
              updatedSettlement = {
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
            }
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
        // The workforce panel is a city-view surface: it must not outlive the
        // view it edits (otherwise it floats over the world map, its steppers
        // silently no-op, and 'w' can no longer reach it).
        this.workforcePanel?.close();
        this.recruitmentPanel?.close();
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
        if (district) {
          viewManager.centerOn(district.q, district.r);
        } else if (castle) {
          viewManager.centerOn(castle.tile.q, castle.tile.r);
        }
        return written;
      },
      onPlaceBuildings: (settlementId, buildings, initialLayout, district) => {
        const tc = state().getTurnController();
        let districtTarget: { q: number; r: number; citySpots?: CitySpot[] } | undefined;
        if (district) {
          const gs = state().getState();
          const s = gs.settlements[settlementId];
          const key = districtKey(district.q, district.r);
          const prevSpots = s?.districts?.[key]?.citySpots;
          const map = state().getGameMap();
          const terrain = map.get(district.q, district.r);
          const mapRes = map.resourceTileAt(district.q, district.r)?.resource ?? null;
          const citySpots =
            prevSpots && prevSpots.length > 0
              ? prevSpots
              : generateDistrictSpots(district.q, district.r, gs.castleSeed, terrain, mapRes, {
                  touchesDenseForest: touchesTerrain(map, district.q, district.r, "denseForest"),
                });
          districtTarget = { q: district.q, r: district.r, citySpots };
        }
        const result = tc.placeBuildings(settlementId, buildings, initialLayout === true, districtTarget);
        if (result.ok) {
          state().replaceState(tc.getState());
        }
        return result.ok;
      },
    });
    this.cityView = view;
    // Workforce wiring: onAssignWorkers commits one building's staff count as
    // a server-side command with the TARGET building's own district (undefined
    // = main settlement); openWorkforcePanel toggles the panel ('w' key).
    view.onAssignWorkers = (gx, gy, workers, district, source): boolean => {
      const openId = this.cityView?.getOpenSettlementId();
      if (!openId) return false;
      const tc = state().getTurnController();
      const ok = tc.assignWorkers(openId, gx, gy, workers, district, source).ok;
      if (ok) {
        state().replaceState(tc.getState());
      }
      return ok;
    };
    view.openWorkforcePanel = () => this.toggleWorkforcePanel();
    view.isWorkforcePanelOpen = () => this.workforcePanel?.isOpen() ?? false;
    view.closeWorkforcePanel = () => this.workforcePanel?.close();
    // Recruitment panel wiring: onRecruitFromPanel commits against the row's
    // OWN building and district (the panel lists every district), so a
    // district barracks recruits without the city view being opened on it.
    view.onRecruitFromPanel = (req): boolean => {
      const openId = this.cityView?.getOpenSettlementId();
      if (!openId) return false;
      const tc = state().getTurnController();
      const ok = tc.recruitUnits(
        openId,
        req.buildingKind,
        req.gx,
        req.gy,
        req.unitTypeId,
        req.count,
        req.district ?? undefined,
      );
      if (ok) {
        state().replaceState(tc.getState());
        view.notifyRecruitmentCommit();
      }
      return ok;
    };
    view.openRecruitmentPanel = () => this.toggleRecruitmentPanel();
    view.isRecruitmentPanelOpen = () => this.recruitmentPanel?.isOpen() ?? false;
    view.closeRecruitmentPanel = () => this.recruitmentPanel?.close();
    return view;
  }

  private toggleWorkforcePanel(): void {
    if (this.workforcePanel?.isOpen()) {
      this.workforcePanel.close();
      return;
    }
    void this.ensureWorkforcePanel().then((panel) => panel.open());
  }

  // Same lazy single-construction pattern as ensureCityView(): the panel
  // (and its menu import) is only built on the first toggle.
  private async ensureWorkforcePanel(): Promise<WorkforcePanel> {
    if (!this.workforcePanelPromise) {
      this.workforcePanelPromise = (async () => {
        const view = await this.ensureCityView();
        const { WorkforcePanel } = await import("@screens/settlements/cityView/workforcePanel");
        const panel = new WorkforcePanel({
          parent: document.body,
          cityView: view,
          onAssignWorkers: (gx, gy, workers, district) => view.onAssignWorkers?.(gx, gy, workers, district) ?? false,
        });
        this.workforcePanel = panel;
        return panel;
      })().catch((err) => {
        this.workforcePanelPromise = null;
        throw err;
      });
    }
    return this.workforcePanelPromise;
  }

  private toggleRecruitmentPanel(): void {
    if (this.recruitmentPanel?.isOpen()) {
      this.recruitmentPanel.close();
      return;
    }
    void this.ensureRecruitmentPanel().then((panel) => panel.open());
  }

  private async ensureRecruitmentPanel(): Promise<RecruitmentPanel> {
    if (!this.recruitmentPanelPromise) {
      this.recruitmentPanelPromise = (async () => {
        const view = await this.ensureCityView();
        const state = this.cityViewState;
        const { RecruitmentPanel } = await import("@screens/settlements/cityView/recruitmentPanel");
        const panel = new RecruitmentPanel({
          parent: document.body,
          cityView: view,
          onRecruit: (req) => view.onRecruitFromPanel?.(req) ?? false,
          getGameState: () => state?.().getState(),
          getHeroesAtSettlement: (settlementId) => this.heroesAtSettlement(settlementId),
          onTransfer: (req) =>
            this.transferUnitsFor(
              req.heroId,
              req.settlementId,
              req.direction,
              req.unitTypeId,
              req.count,
              req.toSlot,
            ),
          onReorderGarrison: (settlementId, fromIdx, toIdx) =>
            this.reorderGarrisonFor(settlementId, fromIdx, toIdx),
          onReorderHero: (heroId, fromIdx, toIdx) => this.reorderHeroStackFor(heroId, fromIdx, toIdx),
          onOpenBuilding: (req) => {
            void this.revealRecruitBuilding(req);
            return true;
          },
        });
        this.recruitmentPanel = panel;
        return panel;
      })().catch((err) => {
        this.recruitmentPanelPromise = null;
        throw err;
      });
    }
    return this.recruitmentPanelPromise;
  }

  /**
   * Recruitment panel building row -> that building's own menu, exactly as if
   * its cell had been clicked on the city grid (same menu, same placement at
   * the building, plus a ring on it until the menu closes). A row whose building
   * lives in a district the view is not showing switches context first, through
   * the engine's own district door, so the two doors cannot diverge.
   */
  private async revealRecruitBuilding(req: {
    buildingKind: BuildingKind;
    gx: number;
    gy: number;
    district: { q: number; r: number } | null;
  }): Promise<boolean> {
    const view = this.cityView;
    const openId = view?.getOpenSettlementId();
    if (!view || !openId) return false;
    if (!sameCityContext(view.getOpenDistrict(), req.district)) {
      const enter = this.settlementCityView.onEnterCityContext;
      if (!enter) return false;
      const entered = await enter(openId, req.district);
      if (!entered) return false;
    }
    return this.cityView?.openBuildingMenu(req.buildingKind, req.gx, req.gy) ?? false;
  }

  /** The hero standing on a settlement's tile (the shared garrison view's input). */
  private heroesAtSettlement(settlementId: string): HeroState[] {
    if (!this.gameStateManager) return [];
    const gs = this.gameStateManager.getState();
    const s = gs.settlements[settlementId];
    if (!s) return [];
    return Object.values(gs.heroes).filter(
      (h) => h.q === s.q && h.r === s.r && h.ownerId === s.ownerId,
    );
  }

  /** One garrison transfer, shared by the settlement panel and the recruitment panel. */
  private transferUnitsFor(
    heroId: string,
    settlementId: string,
    direction: "toHero" | "toGarrison",
    unitTypeId: string,
    count: number,
    toSlot?: number,
  ): boolean {
    if (!this.gameStateManager) return false;
    const tc = this.gameStateManager.getTurnController();
    if (!tc.transferUnits(heroId, settlementId, direction, unitTypeId, count, toSlot)) return false;
    this.gameStateManager.replaceState(tc.getState());
    return true;
  }

  /** Swap two garrison slots (the garrison grid's drag-and-drop). */
  private reorderGarrisonFor(settlementId: string, fromIdx: number, toIdx: number): boolean {
    if (!this.gameStateManager) return false;
    const tc = this.gameStateManager.getTurnController();
    if (!tc.reorderGarrison(settlementId, fromIdx, toIdx).ok) return false;
    this.gameStateManager.replaceState(tc.getState());
    return true;
  }

  /** Swap two of a hero's army slots (the same grid drag, hero side). */
  private reorderHeroStackFor(heroId: string, fromIdx: number, toIdx: number): boolean {
    if (!this.gameStateManager) return false;
    const tc = this.gameStateManager.getTurnController();
    if (!tc.reorderStack(heroId, fromIdx, toIdx).ok) return false;
    this.gameStateManager.replaceState(tc.getState());
    return true;
  }

  getToolbar(): Toolbar | undefined { return this.toolbar; }
  getCityView(): CityView | undefined { return this.cityView ?? undefined; }

  // Breathing room between the panel rail's hard stop and the minimap's own
  // drawn box, so the rail doesn't sit flush against it.
  private static readonly MINIMAP_RAIL_GAP = 16;

  setMapDimensions(width: number, height: number): void {
    if (width === this.lastMapWidth && height === this.lastMapHeight) return;
    this.lastMapWidth = width;
    this.lastMapHeight = height;
    setMinimapReserve(getMinimapReserveHeight(width, height) + UIManager.MINIMAP_RAIL_GAP);
  }

  refreshHud(
    gameState: GameState,
    heroes: Record<string, Hero>,
    lastSavedAt: string | null,
    localPlayerId: PlayerId | null,
  ): void {
    if (!this.hudHandles) return;
    const stateId = getStateIdentityId(gameState);
    const stateKey = `${stateId}:${gameState.round}:${gameState.day}:${gameState.activePlayerId}:${gameState.phase.kind}:${gameState.selectedHeroId ?? ""}:${gameState.selectedSettlementId ?? ""}:${localPlayerId ?? ""}`;
    const readout = this.hudPathReadout();
    const readoutKey = readout
      ? `${readout.costToSplit}:${readout.totalCost}:${readout.destinationReachable ? 1 : 0}`
      : "";
    const hudKey = `${stateKey}|${lastSavedAt ?? ""}|${readoutKey}`;
    if (hudKey !== this.lastHudKey) {
      this.lastHudKey = hudKey;
      updateHud(
        gameState,
        lastSavedAt,
        this.hudHandles,
        localPlayerId,
        readout,
      );
    }

    const selHero = gameState.selectedHeroId ? heroes[gameState.selectedHeroId] : undefined;
    const selectedHeroVisualKey = selHero
      ? `${selHero.tile.q},${selHero.tile.r}:${selHero.moving ? 1 : 0}:${selHero.movementRemaining}`
      : "";
    const menusKey = `${stateKey}|${selectedHeroVisualKey}|${this.heroInfoMenu?.getCurrentHeroId() ?? ""}|${this.settlementInfoMenu?.getCurrentSettlementId() ?? ""}|${this.heroRosterMenu?.isVisible() ? 1 : 0}:${this.settlementRosterMenu?.isVisible() ? 1 : 0}`;
    if (menusKey !== this.lastMenusKey) {
      this.lastMenusKey = menusKey;
      this.refreshHeroInfoMenu(gameState, heroes);
      this.refreshSettlementInfoMenu(gameState);
      this.refreshRosterMenus(gameState);
      // The recruitment panel mounts the same GarrisonView as the settlement
      // panel, so it refreshes from the same dirty-keyed pass -- a transfer
      // made on either surface shows on both immediately.
      if (this.recruitmentPanel?.isOpen()) this.recruitmentPanel.refreshGarrison(gameState);
      this.toolbar?.refresh();
    }

    if (!this.inspectedTile && !this.tileInfoPanel?.isVisible()) {
      this.lastTileInfoKey = "hidden";
      return;
    }

    let heroPosSig = "";
    for (const id of Object.keys(heroes)) {
      const h = heroes[id];
      heroPosSig += `${id}@${h.tile.q},${h.tile.r}:${h.movementRemaining};`;
    }
    const tileInfoKey = `${stateKey}|${this.inspectedTile ? `${this.inspectedTile.q},${this.inspectedTile.r}` : "none"}|${this.cityView?.isOpen() ? 1 : 0}|${this.tileInfoPanel?.isVisible() ? 1 : 0}|${heroPosSig}`;
    if (tileInfoKey !== this.lastTileInfoKey) {
      this.lastTileInfoKey = tileInfoKey;
      this.refreshTileInfoPanel(gameState, heroes, localPlayerId);
    }
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
        assignWagons: (heroId, delta, slot) => {
          const result = tc().assignWagons(heroId, delta, slot);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        buyWagons: (settlementId, count, slot) => {
          const result = tc().buyWagons(settlementId, count, slot);
          if (result.ok) stateManager.replaceState(tc().getState());
          return result;
        },
        createTradeRoute: (from, to, payload, wagons) => {
          const result = tc().createTradeRoute(from, to, payload, wagons);
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

  static buildCalendarSnapshot(state: GameState, localPlayerId: PlayerId | null): CalendarSnapshot | null {
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
        ? playerEffectiveSettlementIncome(state, activePlayer.id)
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
      activePlayerIsYou: localPlayerId != null && activePlayer.id === localPlayerId,
      nextTurnGold: playerIncome(state, activePlayer.id),
      wealth: playerWealth(state, activePlayer.id),
      morale,
      effectiveIncome,
    };
  }
}
