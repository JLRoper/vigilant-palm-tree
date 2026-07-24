import { GameMap } from "../map/gameMap";
import { createDefaultProvider, SpriteProvider } from "../render/assets";
import { HERO_PROCEDURAL_DRAWERS } from "../render/sprites";
import { rng } from "../core/rng";
import { MAP_SEED } from "../views/adventureView";
import { colorForOwner } from "../state/playerColors";
import { buildInitialGameState } from "../game/initState";
import { buildTurnHooks } from "../game/turnHooks";
import { cityViewSizeFor } from "../core/cityGrid";
import { hexDistance } from "../core/hex";
import { CHARTER_GOLD_COST, CHARTER_WAREHOUSE_COST } from "../state/gameState";

import { SessionManager } from "./SessionManager";
import { GameStateManager, type PathPreviewLock } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import { UIManager } from "./UIManager";
import { GameActions } from "./GameActions";
import { GameSessionManager } from "./GameSessionManager";
import { attachDebugApi } from "../io/debugCommands";

export class GameEngine {
  // Infrastructure
  private spriteProvider: SpriteProvider = createDefaultProvider(HERO_PROCEDURAL_DRAWERS);
  private canvas: HTMLCanvasElement;
  private hudEl: HTMLElement;
  private toolbarEl: HTMLElement;

  // Managers
  public session = new SessionManager();
  public state = new GameStateManager();
  public view: ViewManager;
  public ui: UIManager;
  public actions: GameActions;
  public sessions: GameSessionManager;

  // Owned state
  private gameMap = new GameMap(MAP_SEED);
  private lastTime = performance.now();
  private charterPlacementMode = false;
  private validCharterHexes: Set<string> | null = null;

  constructor() {
    this.canvas = document.getElementById("game") as HTMLCanvasElement;
    this.hudEl = document.getElementById("hud")!;
    this.toolbarEl = document.getElementById("toolbar")!;
    this.view = new ViewManager(this.canvas, this.spriteProvider);
    this.ui = new UIManager(this.hudEl, this.toolbarEl, this.spriteProvider);
    this.actions = new GameActions(this.state, this.session);
    this.sessions = new GameSessionManager(
      this.session, this.state, this.view, this.ui,
      () => this.gameMap,
      (m) => { this.gameMap = m; },
    );
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  async init(): Promise<void> {
    this.initProviders();
    this.initGameState();
    this.initRendering();
    this.initUI();
    this.initInput();
    this.initDebug();

    const center = this.state.getHero("pa-hero")?.tile ?? { q: 6, r: 5 };
    this.view.centerOn(center.q, center.r);

    this.handleResize();
    window.addEventListener("resize", () => this.handleResize());
  }

  async initBackend(): Promise<void> {
    await this.sessions.initBackend();
    this.ui.getToolbar()?.refresh();
    this.fullFrame();
  }

  // =========================================================================
  // INIT PHASES
  // =========================================================================

  private initProviders(): void {
    this.spriteProvider.preload();
  }

  private initGameState(): void {
    this.state.setGameMap(this.gameMap);
    const hooks = buildTurnHooks({
      gameName: () => this.session.getActiveGameName(),
      gameMap: () => this.gameMap,
      rng,
    });
    this.state.setHooks(hooks);
    const initialState = buildInitialGameState(this.gameMap, rng);
    this.state.setState(initialState);
    this.state.rebuildHeroesFromState();
    this.state.rebuildSettlementsFromState();
  }

  private initRendering(): void {
    this.view.initializeRenderer(this.gameMap);
    this.view.initializeAdventureView(this.hudEl, {
      heroes: () => this.state.getHeroesMap(),
      getGameState: () => this.state.getState(),
      getTurnController: () => this.state.getTurnController(),
      onStateChanged: () => this.actions.syncFromController(() => this.actions.maybeAutoResolveBattle()),
      onHudUpdate: () => this.fullFrame(),
      onRedraw: () => this.draw(),
      getPathPreviewLock: () => this.state.getPathPreviewLock(),
      setPathPreviewLock: (lock: PathPreviewLock | null) => this.state.setPathPreviewLock(lock),
      onStartCharter: (targetQ: number, targetR: number, name: string) => this.handleStartCharter(targetQ, targetR, name),
      getCharterMode: () => this.charterPlacementMode,
      setCharterMode: (v: boolean) => { this.charterPlacementMode = v; if (!v) this.validCharterHexes = null; },
      getValidCharterHexes: () => this.validCharterHexes,
    });
  }

  private initUI(): void {
    this.ui.initHud();
    this.ui.initToolbar(this.session, this.state, () => this.getCalendar(), {
      onNew: (opts) => void this.sessions.handleNewGame(opts).then(() => this.fullFrame()),
      onLoad: (loaded, tiles) => void this.sessions.loadGame(loaded, tiles).then(() => {
        this.actions.maybeAutoResolveBattle();
        this.fullFrame();
      }),
      onSave: () => void this.sessions.handleManualSave().then(() => this.fullFrame()),
      onEndTurn: () => void this.actions.handleEndTurn().then(() => this.fullFrame()),
      onForget: (_id) => this.ui.getToolbar()?.refresh(),
      getMapInfo: () => this.getMapInfo(),
      onStartCharter: () => this.enterCharterMode(),
      canStartCharter: () => this.canStartCharter(),
    }, () => this.view.camera.zoom);
    this.ui.initHeroMenu(
      (heroId, settlementId, direction) => {
        const result = this.state.getTurnController().transferGold(heroId, settlementId, direction);
        if (result.ok) {
          this.state.replaceState(this.state.getTurnController().getState());
          this.state.rebuildHeroesFromState();
          this.state.syncHeroVisualsToState();
          this.fullFrame();
        }
        return result;
      },
      (fromIdx, toIdx) => {
        const gs = this.state.getState();
        const selectedId = gs.selectedHeroId;
        if (!selectedId) return;
        const result = this.state.getTurnController().reorderStack(selectedId, fromIdx, toIdx);
        if (!result.ok) return;
        this.state.replaceState(this.state.getTurnController().getState());
        this.state.rebuildHeroesFromState();
        this.state.syncHeroVisualsToState();
        this.fullFrame();
      },
    );
    this.ui.initSettlementInfo();
    this.ui.initCityView(() => this.state, this.view);
  }

  private initInput(): void {
    this.canvas.addEventListener("dblclick", (e) => this.handleDblClick(e));
    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("click", (e) => this.handleClick(e));
  }

  private initDebug(): void {
    attachDebugApi({
      getState: () => this.state.getTurnController()?.getState() ?? this.state.getState(),
      getTurnController: () => this.state.getTurnController(),
      handleEndTurn: () => this.actions.handleEndTurn(),
      syncFromController: () => this.actions.syncFromController(() => this.actions.maybeAutoResolveBattle()),
      maybeAutoResolveBattle: () => this.actions.maybeAutoResolveBattle(),
      refresh: () => this.fullFrame(),
      state: this.state,
      view: { camera: this.view.camera, view: this.view.view },
      session: this.session,
    });
  }

  // =========================================================================
  // STATE INFO
  // =========================================================================

  private getMapInfo(): import("../views/settingsMenu").MapInfo | null {
    const gs = this.state.getState();
    if (!gs) return null;
    const hero = this.state.getHero("pa-hero");
    const playerName = gs.players.find((p) => p.id === gs.activePlayerId)?.name ?? "—";
    return {
      name: this.sessions.getGameName() ?? this.session.getActiveGameName() ?? "—",
      seed: this.sessions.getGameSeed(),
      mapSize: this.sessions.getMapSize(),
      width: this.gameMap.width,
      height: this.gameMap.height,
      castleSeed: gs.castleSeed,
      castleCount: gs.castleCount,
      heroQ: hero?.tile.q ?? gs.heroes["pa-hero"]?.q ?? 0,
      heroR: hero?.tile.r ?? gs.heroes["pa-hero"]?.r ?? 0,
      round: gs.round,
      day: gs.day,
      activePlayerName: playerName,
    };
  }

  // =========================================================================
  // CHARTER
  // =========================================================================

  private canStartCharter(): boolean {
    const gs = this.state.getState();
    if (!gs || gs.phase.kind !== "PLAYER_TURN" || gs.activePlayerId !== 0) return false;
    const selectedId = gs.selectedHeroId;
    if (!selectedId) return false;
    const hero = gs.heroes[selectedId];
    if (!hero || hero.isChartering || hero.gold < CHARTER_GOLD_COST) return false;
    const settlement = Object.values(gs.settlements).find(
      (s) => s.q === hero.q && s.r === hero.r && s.ownerId === hero.ownerId,
    );
    if (!settlement) return false;
    if ((settlement.warehouse.wood ?? 0) < CHARTER_WAREHOUSE_COST.wood) return false;
    if ((settlement.warehouse.stone ?? 0) < CHARTER_WAREHOUSE_COST.stone) return false;
    return true;
  }

  private enterCharterMode(): void {
    const gs = this.state.getState();
    if (!gs) return;
    const selectedId = gs.selectedHeroId;
    if (!selectedId) return;
    this.charterPlacementMode = true;
    this.validCharterHexes = this.computeValidCharterHexes(gs);
    this.fullFrame();
  }

  private computeValidCharterHexes(gs: import("../state/gameState").GameState): Set<string> {
    const hexes = new Set<string>();
    const settlementSet = new Set<string>();
    for (const s of Object.values(gs.settlements)) {
      settlementSet.add(`${s.q},${s.r}`);
    }
    const charterSet = new Set<string>();
    for (const c of gs.activeCharters) {
      charterSet.add(`${c.targetQ},${c.targetR}`);
    }
    const heroSet = new Set<string>();
    for (const h of Object.values(gs.heroes)) {
      heroSet.add(`${h.q},${h.r}`);
    }

    for (let r = 0; r < this.gameMap.height; r++) {
      for (let q = 0; q < this.gameMap.width; q++) {
        if (!this.gameMap.isPassable(q, r)) continue;
        const key = `${q},${r}`;
        if (settlementSet.has(key)) continue;
        if (charterSet.has(key)) continue;
        if (heroSet.has(key)) continue;
        let tooClose = false;
        for (const s of Object.values(gs.settlements)) {
          if (hexDistance({ q, r }, { q: s.q, r: s.r }) < 4) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        hexes.add(key);
      }
    }
    return hexes;
  }

  private handleStartCharter(targetQ: number, targetR: number, name: string): boolean {
    const tc = this.state.getTurnController();
    const gs = this.state.getState();
    if (!gs || !gs.selectedHeroId) return false;

    const result = tc.startCharter(targetQ, targetR, name);
    if (!result.ok) {
      console.warn("[charter] start failed:", result.reason);
      return false;
    }

    this.state.replaceState(tc.getState());
    this.state.rebuildHeroesFromState();
    this.state.syncHeroVisualsToState();
    this.charterPlacementMode = false;
    this.validCharterHexes = null;
    return true;
  }

  // =========================================================================
  // FRAME LOOP
  // =========================================================================

  loop(now: number): void {
    const dt = now - this.lastTime;
    this.lastTime = now;
    const changed = this.state.update(dt);
    if (changed) {
      this.actions.maybeAutoResolveBattle();
    }
    this.fullFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  // =========================================================================
  // DRAW
  // =========================================================================

  draw(): void {
    const gs = this.state.getState();
    if (!gs) return;
    const selectedHero = gs.selectedHeroId ? gs.heroes[gs.selectedHeroId] : null;
    this.view.draw(
      this.view.getHover(),
      this.state.getHeroes(),
      this.view.getPath(),
      this.state.getSettlements(),
      {
        selectedHeroId: gs.selectedHeroId,
        selectedSettlementId: gs.selectedSettlementId,
        colorForOwner,
        viewPlayerId: 0,
        pathReachableIdx: this.state.getPathReachableIdx() ?? undefined,
        pathOrigin: this.state.getPathOrigin() ?? undefined,
        selectedHeroTile: selectedHero ? { q: selectedHero.q, r: selectedHero.r } : undefined,
      },
      gs.activeCharters,
      this.validCharterHexes,
    );
    this.view.drawCityOverlay(this.ui.getCityView());
  }

  private fullFrame(): void {
    this.draw();
    this.refreshHud();
  }

  private refreshHud(): void {
    this.ui.refreshHud(
      this.state.getState(),
      this.state.getHeroesMap(),
      this.state.getSettlementsMap(),
      this.view.getHover(),
      this.gameMap,
      this.view.camera,
      this.session.isBackendOk(),
      this.session.getSaveStatus(),
      this.session.getLastSavedAt(),
    );
  }

  private getCalendar() {
    return UIManager.buildCalendarSnapshot(this.state.getState());
  }

  // =========================================================================
  // INPUT
  // =========================================================================

  private handleDblClick(e: MouseEvent): void {
    if (this.ui.getCityView()?.isOpen()) return;
    const gs = this.state.getState();
    if (!gs || gs.phase.kind !== "PLAYER_TURN" || gs.activePlayerId !== 0) return;
    const t = this.view.hoverFromScreen(e.clientX, e.clientY);
    if (!t) return;
    const castle = this.state.getSettlements().find((c) => c.tile.q === t.q && c.tile.r === t.r);
    if (!castle || castle.ownerId !== 0) return;
    const isMineable = (r: import("../state/gameState").ResourceType): r is Exclude<import("../state/gameState").ResourceType, "food"> => r !== "food";
    const spots = castle.citySpots.filter((s) => isMineable(s.resource));
    const mines = castle.cityMines.filter((m) => isMineable(m.resource));
    const cityView = this.ui.getCityView();
    if (!cityView) return;
    cityView.open(
      castle.id, castle.name, cityViewSizeFor(castle.level),
      colorForOwner(castle.ownerId),
      spots as unknown as Parameters<typeof cityView.open>[4],
      mines as unknown as Parameters<typeof cityView.open>[5],
    );
  }

  private handleMouseMove(e: MouseEvent): void {
    this.ui.getCityView()?.updateMouse(e.clientX, e.clientY);
  }

  private handleClick(e: MouseEvent): void {
    this.ui.getCityView()?.handleBuildingClick(e.clientX, e.clientY);
  }

  private handleResize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.view.resize(dpr);
    this.draw();
  }
}
