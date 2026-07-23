import { GameMap } from "../map/gameMap";
import { createDefaultProvider, SpriteProvider } from "../render/assets";
import { HERO_PROCEDURAL_DRAWERS } from "../render/sprites";
import { rng } from "../core/rng";
import { MAP_SEED } from "../views/adventureView";
import { colorForOwner } from "../state/playerColors";
import { buildInitialGameState } from "../game/initState";
import { buildTurnHooks } from "../game/turnHooks";
import { cityViewSizeFor } from "../core/cityGrid";

import { SessionManager } from "./SessionManager";
import { GameStateManager } from "./GameStateManager";
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
    });
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
    this.ui.initSettlementPanel(() => this.state);
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
      },
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
