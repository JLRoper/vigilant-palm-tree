import { GameMap } from "../map/gameMap";
import { createDefaultProvider, SpriteProvider } from "../render/assets";
import { HERO_PROCEDURAL_DRAWERS } from "../render/sprites";
import { rng } from "../core/rng";
import { MAP_SEED } from "@screens/adventure/adventureView";
import { colorForOwner } from "../state/playerColors";
import { buildInitialGameState } from "../game/initState";
import { buildTurnHooks } from "../game/turnHooks";
import { cityViewSizeFor } from "@heroes/engine";
import { cachedUnitTypes } from "../data/unitCatalog";
import { hexDistance } from "../core/hex";

import { SessionManager } from "./SessionManager";
import { GameStateManager, type PathPreviewLock } from "./GameStateManager";
import { ViewManager } from "./ViewManager";
import { UIManager } from "./UIManager";
import { GameActions } from "./GameActions";
import { GameSessionManager } from "./GameSessionManager";
import { attachDebugApi } from "../io/debugCommands";
import { bus } from "../core/eventBus";
import { attachEventLog, type EventLog } from "../debug/eventLog";
import { mountPersistentDevConsole, type DevConsoleHandle } from "../debug/devConsole";
import { getInMemoryLocalPlayerId } from "../players/localPlayer";
import { setViewSeat } from "../state/viewSeat";
import { createFrameErrorLog } from "../core/frameErrors";
import { shouldDriveAi } from "../io/serverDrivenGames";
import { resolveCaravanMarkers } from "../render/caravanMarkers";
import { attachCommandFailureToasts, showToast } from "@screens/shared/toast";
import { attachMpPresenceHint } from "@screens/shared/mpPresenceHint";
import { attachBattleOutcomeFeedback } from "@screens/combat/battleOutcomeFeedback";
import { attachAiThinkingHint } from "@screens/shared/aiThinkingHint";
import { attachFirstTurnHint } from "@screens/shared/firstTurnHint";
import { createLogPanel } from "@screens/shared/logPanel";
import { getEntityMirror } from "../io/multiplayerSync";
import { attachGarrisonEventBridge } from "../game/garrisonEventBridge";
import { applyNetToSettlement, invertNet } from "@screens/settlements/cityView/netCost";
import { evaluateCharterRequirements } from "@screens/adventure/charterRequirements";
import { openCharterRequirementsModal } from "@screens/adventure/charterModal";

// One per process: a fault that persists across frames must not turn into a
// console flood, while a NEW fault still has to surface immediately.
const frameErrors = createFrameErrorLog();

export class GameEngine {
  // Infrastructure
  private spriteProvider: SpriteProvider = createDefaultProvider(HERO_PROCEDURAL_DRAWERS);
  private canvas: HTMLCanvasElement;
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
  public eventLog: EventLog | null = null;
  public consoleHandle: DevConsoleHandle | null = null;

  constructor() {
    this.canvas = document.getElementById("game") as HTMLCanvasElement;
    this.toolbarEl = document.getElementById("toolbar")!;
    this.view = new ViewManager(this.canvas, this.spriteProvider);
    this.ui = new UIManager(this.toolbarEl, this.spriteProvider);
    this.actions = new GameActions(this.state, this.session);
    this.sessions = new GameSessionManager(
      this.session, this.state, this.view, this.ui,
      () => this.gameMap,
      (m) => { this.gameMap = m; },
    );
    // plan/2026-09-29-ai-enemies.md D3: seat 0's client drives the AI turn;
    // solo/no-server games have no in-memory seat and default to 0 (primary).
    // Server-side AI actor (plan/2026-09-30-server-side-ai-actor.md Phase 1,
    // Gate 1): a flagged game (lobby.aiDriver === "server") never drives
    // locally -- the server's aiDriver owns those turns.
    this.state.setPrimaryActorSource(() => {
      const gameName = this.session.getActiveGameName();
      return shouldDriveAi(gameName, getInMemoryLocalPlayerId(gameName ?? ""));
    });
    // S3 (logistics-interface-fixes plan §5.8): the five logistics controller
    // methods gate on the local seat's own PLAYER_TURN; the seat is re-read on
    // every controller rebuild (each game load rebuilds it).
    this.state.setLocalSeatSource(() => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""));
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
    this.initEventListeners();

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
    const attached = attachEventLog();
    this.eventLog = attached.log;
    const hooks = buildTurnHooks({
      gameName: () => this.session.getActiveGameName(),
      gameMap: () => this.gameMap,
      rng,
      localSeat: () => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""),
      // S1 (logistics-interface-fixes plan §5.8): the logistics hooks merge
      // their command results back into the live controller through this
      // getter -- resolved lazily at result time, long after the controller
      // exists.
      getController: () => this.state.getTurnController(),
      onPlaceBuildingsRejected: (settlementId, appliedDelta) => {
        const next = applyNetToSettlement(this.state.getState(), settlementId, invertNet(appliedDelta));
        if (next) this.state.replaceState(next);
      },
    });
    this.state.setHooks(attached.wrapHooks(hooks));
    // The catalog prices the starting heroes' weekly food bill against the starter
// farmland (engine init.ts's seedStarterBuildings). Empty when the catalog has
// not loaded, which falls back to the flat 1g/1f per-unit default -- never
// worse than today's population-only sizing.
const initialState = buildInitialGameState(this.gameMap, rng, { unitTypes: cachedUnitTypes() });
    this.state.setState(initialState);
    this.state.rebuildHeroesFromState();
    this.state.rebuildSettlementsFromState();
    getEntityMirror().syncWith(this.state.getHeroesMap(), this.state.getSettlementsMap());
  }

  private initRendering(): void {
    this.view.initializeRenderer(this.gameMap, getEntityMirror());
    this.view.initializeAdventureView({
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
      onTileInspect: (tile) => {
        if (this.ui.getCityView()?.isOpen()) return;
        this.ui.setInspectedTile(tile);
        this.fullFrame();
      },
      isCityOpen: () => this.ui.getCityView()?.isOpen() ?? false,
      getLocalSeat: () => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""),
    });
  }

  private initUI(): void {
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
      onStartCharter: () => this.openCharterRequirements(),
      canStartCharter: () => this.canOpenCharterFlow(),
    }, () => this.view.camera.zoom);
    this.ui.initHeroMenu(
      (heroId, settlementId, direction) => {
        const result = this.state.getTurnController().transferGold(heroId, settlementId, direction);
        if (result.ok) {
          this.state.replaceState(this.state.getTurnController().getState());
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
      },
    );
    this.ui.initSettlementInfo();
    this.ui.initTileInfo();
    this.ui.initCityView(() => this.state, this.view, () => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""));
  }

  private initInput(): void {
    this.canvas.addEventListener("dblclick", (e) => this.handleDblClick(e));
    this.canvas.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    this.canvas.addEventListener("click", (e) => this.handleClick(e));
  }

  private initDebug(): void {
    if (this.eventLog) {
      this.consoleHandle = mountPersistentDevConsole(this.eventLog);
    }
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
      eventLog: this.eventLog,
      consoleHandle: this.consoleHandle,
      setConsoleHandle: (handle: DevConsoleHandle | null) => { this.consoleHandle = handle; },
    });
  }

  private initEventListeners(): void {
    bus.on("state:committed", () => {
      this.state.rebuildHeroesFromState();
      this.state.rebuildSettlementsFromState();
      this.state.syncHeroVisualsToState();
      getEntityMirror().syncWith(this.state.getHeroesMap(), this.state.getSettlementsMap());
      this.fullFrame();
      // Battle offers arrive via the bridge's replaceState path, which bypasses
      // the rAF loop's `changed` detection -- trigger the (phase-gated,
      // battleInFlight-guarded) battle flow here so the defender's modal opens.
      void this.actions.maybeAutoResolveBattle();
    });
    // #100: surfaces a toast whenever a fire-and-forget command hook
    // (src/game/turnHooks.ts) rejects, instead of the previous
    // console.warn-only silence.
    attachCommandFailureToasts();
    // Drop policy (2026-09-27): "waiting for seat N (disconnected)" hint
    // while a disconnected seat holds the active turn (mp:presenceUpdated
    // + mp:stateChanged off the bus).
    attachMpPresenceHint();
    // "AI is thinking" turn indicator while an AI seat holds the turn
    // (mp:stateChanged + mp:turnStarted off the bus); auto-hides on turn end.
    attachAiThinkingHint();
    // F12a (playtest fixes 2026-09-29): one-time first-turn hint. Shows on
    // the first state:committed after a game becomes active (SessionManager
    // adopt() precedes loadGame's replaceState, so activeGameName is already
    // set when that commit fires); skipped permanently via the persisted
    // heroesJs.firstTurnHint.v1 flag. The panel is pointer-events:none with
    // only its button clickable, so it cannot intercept canvas input.
    attachFirstTurnHint({ hasActiveGame: () => this.session.getActiveGameName() != null });
    // Log Message Panel (plan 2026-09-28-sse-event-push.md, use case 1):
    // attach is unconditional like the toasts above -- the panel itself
    // gates visibility and buffering on settings().showLogPanel, so the
    // settings toggle works mid-session without re-attaching.
    createLogPanel();
    // Multiplayer garrison sync (UnitsRecruited/UnitsTransferred deltas +
    // SettlementBattleResolved's full-refetch snapshot) into the live
    // TurnController. Same explicit-attach convention as the consumers
    // above; safe-phase gates live in the bridge itself.
    attachGarrisonEventBridge({
      getController: () => this.state.getTurnController(),
      replaceState: (next) => this.state.replaceState(next),
      // Server-side AI actor Gate 2: same policy as Gate 1 -- a flagged
      // game's local client never mutates during AI turns, so the bridge's
      // safe-phase gates open up there while unflagged behavior is
      // byte-identical. localSeat stays the real seat (selection rules).
      isPrimaryActor: () => {
        const gameName = this.session.getActiveGameName();
        return shouldDriveAi(gameName, getInMemoryLocalPlayerId(gameName ?? ""));
      },
      localSeat: () => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""),
    });
    // D5 parity (server-side AI actor plan Phase 2): verdict result cards /
    // info toasts derived from battle events on server-driven games, where
    // the AI driver resolves battles server-side and no browser sees the
    // command response. Unflagged games are ignored by the consumer, so the
    // direct-response arena paths stay byte-identical.
    attachBattleOutcomeFeedback({
      getState: () => this.state.getState(),
      getGameName: () => this.session.getActiveGameName(),
      getLocalSeat: () => getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""),
    });
  }

  // =========================================================================
  // STATE INFO
  // =========================================================================

  private getMapInfo(): import("@screens/home/settingsMenu").MapInfo | null {
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

  // Gate for opening the charter flow (toolbar button): player turn with a
  // hero selected. Resource/position requirements are surfaced by the
  // requirements modal instead of disabling the button (F15).
  private canOpenCharterFlow(): boolean {
    const gs = this.state.getState();
    const localId = getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? "") ?? 0;
    if (!gs || gs.phase.kind !== "PLAYER_TURN" || gs.activePlayerId !== localId) return false;
    const selectedId = gs.selectedHeroId;
    return selectedId != null && gs.heroes[selectedId] != null;
  }

  private openCharterRequirements(): void {
    const gs = this.state.getState();
    if (!gs || !this.canOpenCharterFlow()) return;
    const heroId = gs.selectedHeroId;
    if (!heroId) return;
    openCharterRequirementsModal(evaluateCharterRequirements(gs, heroId), {
      onConfirm: () => {
        if (!this.canStartCharter()) {
          showToast("Charter requirements are no longer met", "error");
          return;
        }
        this.enterCharterMode();
      },
    });
  }

  private canStartCharter(): boolean {
    const gs = this.state.getState();
    const localId = getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? "") ?? 0;
    if (!gs || gs.phase.kind !== "PLAYER_TURN" || gs.activePlayerId !== localId) return false;
    return evaluateCharterRequirements(gs, gs.selectedHeroId).canStart;
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
      showToast(`Charter failed: ${result.reason}`, "error");
      return false;
    }

    this.state.replaceState(tc.getState());
    this.charterPlacementMode = false;
    this.validCharterHexes = null;
    return true;
  }

  // =========================================================================
  // FRAME LOOP
  // =========================================================================

  fullFrame(): void {
    this.draw();
    this.refreshHud();
    this.ui.setMapDimensions(this.gameMap.width, this.gameMap.height);
  }

  refreshToolbarAndFrame(): void {
    this.ui.getToolbar()?.refresh();
    void this.actions.maybeAutoResolveBattle();
    this.fullFrame();
  }

  // The frame must ALWAYS be rescheduled. requestAnimationFrame used to be
  // the last statement, so any throw in state.update / maybeAutoResolveBattle
  // / fullFrame killed the loop permanently -- the client froze with a stale
  // toolbar and dead input, and the only evidence was one uncaught console
  // error. try/finally keeps the loop alive; the body is idempotent (it
  // recomputes from live state every frame), so a rethrow next frame is
  // harmless and gets its own chance.
  loop(now: number): void {
    try {
      // Per frame: the active game and the local seat both change on load/adopt.
      setViewSeat(getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? ""));
      const dt = now - this.lastTime;
      this.lastTime = now;
      const changed = this.state.update(dt);
      if (changed) {
        this.actions.maybeAutoResolveBattle();
      }
      this.fullFrame();
    } catch (e) {
      frameErrors.report(e);
    } finally {
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  // =========================================================================
  // DRAW
  // =========================================================================

  draw(): void {
    const gs = this.state.getState();
    if (!gs) return;
    const selectedHero = gs.selectedHeroId ? gs.heroes[gs.selectedHeroId] : null;
    const localId = getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? "") ?? 0;
    this.view.draw(
      this.view.getHover(),
      this.view.getPath(),
      {
        selectedHeroId: gs.selectedHeroId,
        selectedSettlementId: gs.selectedSettlementId,
        colorForOwner,
        viewPlayerId: localId,
        pathReachableIdx: this.state.getPathReachableIdx() ?? undefined,
        pathOrigin: this.state.getPathOrigin() ?? undefined,
        selectedHeroTile: selectedHero ? { q: selectedHero.q, r: selectedHero.r } : undefined,
        inspectedTile: this.view.getInspectedTile() ?? undefined,
      },
      gs.activeCharters,
      this.validCharterHexes,
      resolveCaravanMarkers(gs.tradeRoutes, gs.settlements, gs.heroes),
    );
    this.view.drawCityOverlay(this.ui.getCityView());
  }

  private refreshHud(): void {
    const gameName = this.session.getActiveGameName() ?? "";
    this.ui.refreshHud(
      this.state.getState(),
      this.state.getHeroesMap(),
      this.session.getLastSavedAt(),
      getInMemoryLocalPlayerId(gameName),
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
    const localId = getInMemoryLocalPlayerId(this.session.getActiveGameName() ?? "") ?? 0;
    if (!gs || gs.phase.kind !== "PLAYER_TURN" || gs.activePlayerId !== localId) return;
    const t = this.view.hoverFromScreen(e.clientX, e.clientY);
    if (!t) return;
    const castle = this.state.getSettlements().find((c) => c.tile.q === t.q && c.tile.r === t.r);
    if (!castle || castle.ownerId !== localId) return;
    // Every spot is shown, food included: food spots exist (citySpots.ts's
    // RESOURCE_POOL rolls them, terrain-biased) and a farm on one earns the
    // ~3x spot multiplier, which is the whole placement decision. They also
    // render fine -- RESOURCE_PAL has a food entry and `resource.food` has a
    // descriptor, so paintCityResourceSpot draws art (procedural fallback
    // otherwise). The old `isMineable` filter predates food spots entirely
    // (citySpots.ts's pool was gold/wood/stone/iron/arcane only), so it
    // filtered nothing and hid a real mechanic once food was added.
    const cityView = this.ui.getCityView();
    if (!cityView) return;
    cityView.open(
      castle.id, castle.name, cityViewSizeFor(castle.level),
      colorForOwner(castle.ownerId),
      castle.citySpots,
      castle.cityMines,
      castle.buildings,
      gs.castleSeed,
    );
    if (cityView.isOpen() && gs.selectedSettlementId !== castle.id) {
      const tc = this.state.getTurnController();
      tc.selectSettlement(castle.id);
      this.state.replaceState(tc.getState());
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    this.ui.getCityView()?.updateMouse(e.clientX, e.clientY);
  }

  private handleClick(e: MouseEvent): void {
    this.ui.getCityView()?.handleBuildingClick(e.clientX, e.clientY, {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });
  }

  private handleResize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.view.resize(dpr);
    this.draw();
  }
}
