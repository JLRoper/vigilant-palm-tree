import { Hero } from "./entities/hero";
import { GameMap } from "./map/gameMap";
import { Renderer } from "./render/renderer";
import { Camera } from "./render/camera";
import { api, type Game, type TileRow } from "./io/api";
import { createDefaultProvider, SpriteProvider } from "./render/assets";
import { HERO_PROCEDURAL_DRAWERS } from "./render/sprites";
import { rng } from "./core/rng";
import { AdventureView, MAP_SEED } from "./views/adventureView";
import { findPath } from "./map/pathfinding";
import { TERRAIN_COST } from "./map/terrain";
import {
  buildHud,
  type HudHandles,
  updateHud,
  canEndTurn,
} from "./views/hud";
import { Toolbar } from "./views/toolbar";
import { HeroInfoMenu } from "./views/heroInfoMenu";
import { SettlementPanel } from "./views/settlementPanel";
import { colorForOwner } from "./state/playerColors";
import { listUserGames, rememberGame } from "./io/userGames";
import { axialToPixel, type Axial } from "./core/hex";
import { Castle } from "./entities/settlement";
import {
  buildInitialGameState,
  hydrateGameState,
  playerHeroId,
} from "./game/initState";
import {
  CASTLE_COUNT_DEFAULT,
  defaultCastleSeedFromMapSeed,
  generateCastles,
} from "./map/castlePlacement";
import { buildTurnHooks } from "./game/turnHooks";
import {
  calendarFromDay,
  monthName,
  markSaved,
  type GameState,
  type HeroId,
} from "./state/gameState";
import { playerIncome, playerWealth } from "./economy/income";
import type { CalendarSnapshot } from "./views/toolbar";
import { TurnController } from "./state/turnController";
import { showBattleModal } from "./views/battleModal";
import { CityView } from "./views/cityView";
import { cityViewSizeFor } from "./core/cityGrid";

const spriteProvider: SpriteProvider = createDefaultProvider(HERO_PROCEDURAL_DRAWERS);
spriteProvider.preload();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;
const toolbarEl = document.getElementById("toolbar")!;

const camera = new Camera();
let gameMap = new GameMap(MAP_SEED);
let renderer: Renderer;
let view: AdventureView;
let hudHandles: HudHandles;
let toolbar: Toolbar;

let gameState: GameState;
let turnController: TurnController;
let heroes: Record<string, Hero> = {};
let settlements: Record<string, Castle> = {};
let heroInfoMenu: HeroInfoMenu;
let settlementPanel: SettlementPanel;
let cityView: CityView;

let saveStatus: "idle" | "saving" | "saved" | "error" = "idle";
let backendOk = false;
let activeGameId: number | null = null;
let activeGameName: string | null = null;
let lastSavedAt: string | null = null;
let battleInFlight = false;

function getActiveGameName(): string | null {
  return activeGameName;
}

function buildHooks() {
  return buildTurnHooks({
    gameName: getActiveGameName,
    gameMap: () => gameMap,
    rng,
  });
}

function buildCalendarSnapshot(state: GameState): CalendarSnapshot | null {
  if (!state.players.length) return null;
  const cal = calendarFromDay(state.day);
  const activePlayer =
    state.players.find((p) => p.id === state.activePlayerId) ?? state.players[0];
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
  };
}

function rebuildHeroesFromState(): void {
  const next: Record<string, Hero> = {};
  for (const [id, h] of Object.entries(gameState.heroes)) {
    const existing = heroes[id];
    if (existing) {
      existing.syncFromState(h);
      existing.tile = { q: h.q, r: h.r };
      existing.fromTile = { q: h.q, r: h.r };
      existing.toTile = { q: h.q, r: h.r };
      existing.moving = false;
      existing.pixelOffset = { x: 0, y: 0 };
      next[id] = existing;
    } else {
      next[id] = Hero.fromGameState(h);
    }
  }
  heroes = next;
}

function rebuildSettlementsFromState(): void {
  const next: Record<string, Castle> = {};
  for (const [id, s] of Object.entries(gameState.settlements)) {
    next[id] = Castle.fromGameState(s);
  }
  settlements = next;
}

function getHeroesArray(): Hero[] {
  return Object.values(heroes);
}

function getCastlesArray(): Castle[] {
  return Object.values(settlements);
}

function syncHeroVisualsToState(): void {
  for (const [id, h] of Object.entries(gameState.heroes)) {
    const v = heroes[id];
    if (!v) continue;
    v.movementRemaining = h.movementRemaining;
    v.trail = (h.trail ?? []).map((p) => ({ q: p.q, r: p.r }));
    v.gold = h.gold ?? 0;
    if (v.moving) continue;
    if (v.tile.q === h.q && v.tile.r === h.r) continue;
    const start: Axial = { ...v.tile };
    const end: Axial = { q: h.q, r: h.r };
    const partialPath = findPath(gameMap, start, end);
    if (partialPath.length > 0) {
      v.startMoveToPath([start, ...partialPath]);
    } else {
      v.tile = end;
      v.fromTile = end;
      v.toTile = end;
    }
  }
}

function syncStateFromController(): void {
  if (!turnController) return;
  const next = turnController.getState();
  if (next !== gameState) {
    gameState = next;
    syncHeroVisualsToState();
    maybeAutoResolveBattle();
  }
}

function refreshHud(): void {
  if (!hudHandles) return;
  updateHud(
    hud,
    gameState,
    heroes,
    settlements,
    view.hover,
    gameMap,
    camera,
    backendOk,
    saveStatus,
    lastSavedAt,
    hudHandles
  );
  refreshHeroInfoMenu();
  refreshSettlementPanel();
  toolbar?.refresh();
}

function refreshSettlementPanel(): void {
  if (!settlementPanel) return;
  settlementPanel.update(gameState);
}

function refreshHeroInfoMenu(): void {
  if (!heroInfoMenu) return;
  const selectedId = gameState.selectedHeroId;
  if (!selectedId) {
    heroInfoMenu.hide();
    return;
  }
  const hero = heroes[selectedId];
  if (!hero) {
    heroInfoMenu.hide();
    return;
  }
  const player = gameState.players.find((p) => p.id === hero.ownerId);
  if (!player) {
    heroInfoMenu.hide();
    return;
  }
  if (heroInfoMenu.getCurrentHeroId() !== selectedId) {
    heroInfoMenu.show(hero, player, gameState);
  } else {
    heroInfoMenu.update(hero, gameState);
  }
}

function draw(): void {
  if (!renderer) return;
  renderer.map = gameMap;
  renderer.draw(view.hover, getHeroesArray(), view.path, getCastlesArray(), {
    selectedHeroId: gameState.selectedHeroId,
    selectedSettlementId: gameState.selectedSettlementId,
    colorForOwner,
    viewPlayerId: 0,
  });
  if (cityView && cityView.isOpen()) {
    cityView.draw(ctx, window.innerWidth, window.innerHeight);
  }
}

function drawGame(): void {
  syncHeroVisualsToState();
  draw();
}

function refreshAll(): void {
  refreshHud();
  draw();
}

function replaceTurnControllerState(next: GameState): void {
  gameState = next;
  turnController = new TurnController(next, buildHooks());
}

async function startBattleFlow(): Promise<void> {
  if (gameState.phase.kind !== "BATTLE") return;
  if (battleInFlight) return;
  battleInFlight = true;
  try {
    const { attackerId, defenderId } = gameState.phase;
    const attackerName = heroes[attackerId]?.id ?? attackerId;
    const defenderName = heroes[defenderId]?.id ?? defenderId;
    const result = await showBattleModal({
      attackerName: `Hero ${attackerName}`,
      defenderName: `Hero ${defenderName}`,
    });
    if (result === "resolve") {
      await turnController.resolveCurrentBattle();
      gameState = turnController.getState();
    } else {
      turnController.cancelMove(attackerId);
      gameState = turnController.getState();
    }
  } finally {
    battleInFlight = false;
    rebuildHeroesFromState();
    syncHeroVisualsToState();
    refreshAll();
  }
}

function maybeAutoResolveBattle(): void {
  if (gameState.phase.kind === "BATTLE" && !battleInFlight) {
    void startBattleFlow();
  }
}

async function endHumanTurn(): Promise<void> {
  const phase = gameState.phase;
  if (phase.kind !== "PLAYER_TURN") return;
  if (gameState.players.find((p) => p.id === phase.playerId)?.faction !== "player") return;
  await turnController.endHumanTurn();
  gameState = turnController.getState();
  saveStatus = "saved";
  lastSavedAt = new Date().toISOString();
  rebuildHeroesFromState();
  syncHeroVisualsToState();
  refreshAll();
  maybeAutoResolveBattle();
}

async function manualSave(): Promise<void> {
  if (!backendOk || !activeGameName) return;
  saveStatus = "saving";
  refreshHud();
  try {
    const playerHero = heroes[playerHeroId()];
    const updated = await api.patchGame(activeGameName, {
      hero_q: playerHero?.tile.q ?? 0,
      hero_r: playerHero?.tile.r ?? 0,
      turn: gameState.round,
      gold: playerWealth(gameState, 0),
      enemy_positions: getHeroesArray()
        .filter((h) => h.ownerId !== 0)
        .map((h) => ({ q: h.tile.q, r: h.tile.r })),
    });
    lastSavedAt = updated.updated_at;
    saveStatus = "saved";
    replaceTurnControllerState(markSaved(gameState));
    setTimeout(() => {
      if (saveStatus === "saved" || saveStatus === "error") saveStatus = "idle";
      refreshHud();
    }, 1500);
  } catch (e) {
    console.warn("manual save failed:", e);
    saveStatus = "error";
  }
  refreshHud();
}

async function loadGameIntoState(
  loaded: Game,
  tiles: TileRow[],
  castleOpts?: { castleSeed?: number; castleCount?: number },
): Promise<void> {
  activeGameId = loaded.id;
  activeGameName = loaded.name;
  rememberGame(loaded.id, loaded.name);
  gameMap = GameMap.fromTiles(tiles);
  const hydrated = hydrateGameState(loaded, castleOpts);
  replaceTurnControllerState(hydrated);
  rebuildHeroesFromState();
  rebuildSettlementsFromState();
  if (renderer) {
    (renderer as unknown as { map: GameMap }).map = gameMap;
  }
  syncHeroVisualsToState();
  const center = heroes[playerHeroId()]?.tile ?? { q: 6, r: 5 };
  view.centerOn(center.q, center.r);
  toolbar?.refresh();
  refreshAll();
  maybeAutoResolveBattle();
}

async function startFreshStarter(): Promise<void> {
  const name = `starter-${Date.now().toString(36)}`;
  try {
    const castleSeed = defaultCastleSeedFromMapSeed(MAP_SEED);
    const castles = generateCastles(gameMap, {
      castleSeed,
      playerCount: 3,
      castleCount: CASTLE_COUNT_DEFAULT,
    });
    const playerCastle = castles.find((c) => c.ownerId === 0);
    const aiCastle = castles.find((c) => c.ownerId === 1);
    const heroQ = playerCastle?.tile.q ?? 6;
    const heroR = playerCastle?.tile.r ?? 5;
    const enemyPositions = aiCastle
      ? [
          { q: aiCastle.tile.q, r: aiCastle.tile.r },
          { q: aiCastle.tile.q + 3, r: aiCastle.tile.r + 1 },
        ]
      : [{ q: 14, r: 8 }, { q: 17, r: 9 }];
    const created = await api.createGame(name, MAP_SEED, heroQ, heroR, enemyPositions);
    const tiles = await api.getTiles(created.name);
    await loadGameIntoState(created, tiles, { castleSeed, castleCount: CASTLE_COUNT_DEFAULT });
    await api.logEvent(created.name, "session_start", {
      seed: created.seed,
      castleSeed,
      castleCount: CASTLE_COUNT_DEFAULT,
      round: 1,
    });
  } catch (e) {
    console.warn("failed to start starter game:", e);
    saveStatus = "error";
  }
}

async function initBackend(): Promise<void> {
  try {
    await api.health();
    backendOk = true;
  } catch (e) {
    backendOk = false;
    console.warn("backend offline:", e);
    toolbar?.refresh();
    return;
  }
  toolbar?.refresh();
  const cached = listUserGames();
  if (cached.length === 0) {
    await startFreshStarter();
  }
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  view.resize(dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function initialize(): void {
  gameState = buildInitialGameState(gameMap, rng);
  rebuildHeroesFromState();
  rebuildSettlementsFromState();

  renderer = new Renderer(ctx, gameMap, camera, spriteProvider);

  turnController = new TurnController(gameState, buildHooks());

  view = new AdventureView({
    canvas,
    hud,
    renderer,
    map: gameMap,
    camera,
    heroes: () => heroes,
    getGameState: () => gameState,
    getTurnController: () => turnController,
    onStateChanged: syncStateFromController,
    onPathChanged: () => {
      // path is read from view.path on next draw
    },
    onHudUpdate: refreshHud,
    onRedraw: draw,
  });

  hudHandles = buildHud(hud);

  heroInfoMenu = new HeroInfoMenu({
    parent: document.body,
    onTransfer: (heroId, settlementId, direction) => {
      const result = turnController.transferGold(heroId, settlementId, direction);
      if (result.ok) {
        gameState = turnController.getState();
        rebuildHeroesFromState();
        syncHeroVisualsToState();
        refreshAll();
      }
      return result;
    },
  });
  settlementPanel = new SettlementPanel({
    parent: document.body,
    onSelect: (id) => {
      turnController.selectSettlement(id);
      gameState = turnController.getState();
      refreshAll();
    },
  });

  cityView = new CityView({
    onClose: () => {
      const closedId = cityView.close();
      if (closedId) {
        turnController.selectSettlement(closedId);
        gameState = turnController.getState();
        if (settlements[closedId]) {
          const s = settlements[closedId];
          view.centerOn(s.tile.q, s.tile.r);
        }
        refreshAll();
      }
    },
  });

  canvas.addEventListener("dblclick", (e) => {
    if (cityView.isOpen()) return;
    if (gameState.phase.kind !== "PLAYER_TURN" || gameState.activePlayerId !== 0) return;
    const t = renderer.hoverFromScreen(e.clientX, e.clientY);
    if (!t) return;
    const castle = getCastlesArray().find((c) => c.tile.q === t.q && c.tile.r === t.r);
    if (!castle || castle.ownerId !== 0) return;
    cityView.open(castle.id, castle.name, cityViewSizeFor(castle.level), colorForOwner(castle.ownerId));
  });

  canvas.addEventListener("mousemove", (e) => {
    if (cityView && cityView.isOpen()) {
      cityView.updateMouse(e.clientX, e.clientY);
    }
  });

  toolbar = new Toolbar({
    parent: toolbarEl,
    state: {
      backendOk: () => backendOk,
      hasActiveGame: () => activeGameId !== null,
      canEndTurnNow: () => canEndTurn(gameState),
      getCalendar: () => buildCalendarSnapshot(gameState),
    },
    callbacks: {
      onNew: async ({ name, seed, castleSeed, castleCount }) => {
        const effectiveCastleSeed =
          typeof castleSeed === "number" && Number.isFinite(castleSeed)
            ? castleSeed
            : defaultCastleSeedFromMapSeed(seed);
        const effectiveCastleCount = castleCount ?? CASTLE_COUNT_DEFAULT;
        const playerCount = 3;
        const castles = generateCastles(gameMap, {
          castleSeed: effectiveCastleSeed,
          playerCount,
          castleCount: Math.max(effectiveCastleCount, playerCount),
        });
        const playerCastle = castles.find((c) => c.ownerId === 0);
        const aiCastles = castles.filter((c) => c.ownerId !== null && c.ownerId !== 0);
        const heroQ = playerCastle?.tile.q ?? 6;
        const heroR = playerCastle?.tile.r ?? 5;
        const enemyPositions = aiCastles.length
          ? aiCastles.map((c) => ({ q: c.tile.q, r: c.tile.r }))
          : [{ q: 14, r: 8 }, { q: 17, r: 9 }];
        const created = await api.createGame(name, seed, heroQ, heroR, enemyPositions);
        const tiles = await api.getTiles(created.name);
        await loadGameIntoState(created, tiles, {
          castleSeed: effectiveCastleSeed,
          castleCount: effectiveCastleCount,
        });
        await api.logEvent(created.name, "new_game", {
          seed,
          castleSeed: effectiveCastleSeed,
          castleCount: effectiveCastleCount,
        });
      },
      onLoad: async (loaded, tiles) => {
        await loadGameIntoState(loaded, tiles);
        await api.logEvent(loaded.name, "load_game", {});
      },
      onSave: () => manualSave(),
      onEndTurn: () => endHumanTurn(),
      onForget: (id) => {
        if (activeGameId === id) {
          activeGameId = null;
          activeGameName = null;
          toolbar?.refresh();
        }
      },
    },
  });

  const center = heroes[playerHeroId()]?.tile ?? { q: 6, r: 5 };
  view.centerOn(center.q, center.r);

  (window as unknown as { __gameDebug: unknown }).__gameDebug = {
    getState: () => turnController?.getState() ?? gameState,
    getGameState: () => gameState,
    getTurnController: () => turnController,
    endTurn: () => void endHumanTurn(),
    setSelectedHero: (id: HeroId) => turnController.selectHero(id),
    requestMove: (id: HeroId, q: number, r: number) => {
      const state = turnController.getState();
      const hero = state.heroes[id];
      if (!hero) return false;
      const goal = { q, r };
      const newPath = findPath(gameMap, { q: hero.q, r: hero.r }, goal);
      if (newPath.length === 0) return false;
      let cumulative = 0;
      let reachableIdx = 0;
      let actualCost = 0;
      for (let i = 0; i < newPath.length; i++) {
        const t = gameMap.get(newPath[i].q, newPath[i].r);
        const stepCost = t ? TERRAIN_COST[t] : 1;
        if (!Number.isFinite(stepCost) || stepCost <= 0) break;
        if (cumulative + stepCost > hero.movementRemaining) break;
        cumulative += stepCost;
        reachableIdx = i + 1;
        actualCost = cumulative;
      }
      if (reachableIdx === 0) return false;
      const dest = newPath[reachableIdx - 1];
      const ok = turnController.requestMove(id, dest, actualCost);
      if (ok) syncStateFromController();
      return ok;
    },
    enterBattle: (attackerId: HeroId, defenderId: HeroId) => {
      turnController.enterBattle(attackerId, defenderId);
      syncStateFromController();
      maybeAutoResolveBattle();
    },
    captureSettlement: (heroId: HeroId, settlementId: string) => {
      const ok = turnController.captureSettlement(heroId, settlementId);
      syncStateFromController();
      refreshAll();
      return ok;
    },
    teleportHero: (id: HeroId, q: number, r: number) => {
      const state = turnController.getState();
      const existing = state.heroes[id];
      if (!existing) return false;
      replaceTurnControllerState({
        ...state,
        heroes: {
          ...state.heroes,
          [id]: {
            ...existing,
            q,
            r,
            previousQ: null,
            previousR: null,
            previousMovementRemaining: null,
          },
        },
        dirty: true,
      });
      const hero = heroes[id];
      if (hero) {
        hero.tile = { q, r };
        hero.fromTile = { q, r };
        hero.toTile = { q, r };
        hero.moving = false;
        hero.pixelOffset = { x: 0, y: 0 };
      }
      rebuildHeroesFromState();
      refreshAll();
      return true;
    },
    getHeroes: () =>
      getHeroesArray().map((h) => ({
        id: h.id,
        q: h.tile.q,
        r: h.tile.r,
        ownerId: h.ownerId,
        movementRemaining: h.movementRemaining,
        trail: h.trail.map((p) => ({ q: p.q, r: p.r })),
        gold: h.gold,
      })),
    getSettlements: () =>
      getCastlesArray().map((c) => ({
        id: c.id,
        q: c.tile.q,
        r: c.tile.r,
        level: c.level,
        ownerId: c.ownerId,
      })),
    get hover() {
      return view ? view.hover : null;
    },
    get lastClick() {
      return view ? view.lastClickDebug : null;
    },
    get phase() {
      return gameState.phase;
    },
    get round() {
      return gameState.round;
    },
    get activeGameId() {
      return activeGameId;
    },
    get activeGameName() {
      return activeGameName;
    },
    get screenFor() {
      return (q: number, r: number) => {
        const { x: wx, y: wy } = axialToPixel(q, r);
        return { x: wx * camera.zoom + camera.x, y: wy * camera.zoom + camera.y };
      };
    },
    isPassable: (q: number, r: number) => gameMap.isPassable(q, r),
    getMoveDurationMs: () => {
      const hero = Object.values(heroes)[0];
      return hero ? hero.moveDurationMs : 0;
    },
  };
}

window.addEventListener("resize", resize);

let lastTime = performance.now();
function loop(now: number): void {
  const dt = now - lastTime;
  lastTime = now;
  for (const hero of getHeroesArray()) {
    hero.update(dt);
  }
  if (turnController) {
    turnController.tick(dt);
    const nextState = turnController.getState();
    if (nextState !== gameState) {
      gameState = nextState;
      syncHeroVisualsToState();
      maybeAutoResolveBattle();
    }
  }
  drawGame();
  refreshHud();
  requestAnimationFrame(loop);
}

initialize();
resize();
void initBackend().then(() => {
  refreshHud();
  draw();
});
requestAnimationFrame(loop);

export {};
