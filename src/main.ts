import { Hero } from "./entities/hero";
import { GameMap } from "./map/gameMap";
import { Renderer } from "./render/renderer";
import { Camera } from "./render/camera";
import { api, type Game, type TileRow } from "./io/api";
import { preloadCastleSprites, preloadResourceSprites } from "./render/sprites";
import { rng } from "./core/rng";
import { AdventureView, ENEMY_START, MAP_SEED } from "./views/adventureView";
import { updateHud } from "./views/hud";
import { onHeroArrived, type ArrivalState } from "./systems/movement";
import { tickEnemyWander } from "./systems/enemyWander";
import { Toolbar } from "./views/toolbar";
import { listUserGames, rememberGame, forgetGame } from "./io/userGames";
import { axialToPixel } from "./core/hex";

preloadCastleSprites();
preloadResourceSprites();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;
const toolbarEl = document.getElementById("toolbar")!;

const camera = new Camera();
let map = new GameMap(MAP_SEED);
const player = new Hero("player", 2, 2, "player");
const enemies: Hero[] = ENEMY_START.map(
  (p, i) => new Hero(`enemy_${i}`, p.q, p.r, "enemy")
);
const heroes: Hero[] = [player, ...enemies];
const renderer = new Renderer(ctx, map, camera);

let path: { q: number; r: number }[] = [];
let saveStatus: "idle" | "saving" | "saved" | "error" = "idle";
let backendOk = false;
let activeGameId: number | null = null;
let activeGameName: string | null = null;
let lastSavedAt: string | null = null;
let turn = 1;
let gold = 0;
let combat = false;
let combatTile: { q: number; r: number } | null = null;
const wanderState = { timer: 0, cooldownMs: 1800 };

function refreshHud() {
  updateHud(hud, player, enemies, view.hover, map, camera, turn, gold, combat, backendOk, saveStatus, lastSavedAt);
}

function draw() {
  renderer.draw(view.hover, heroes, view.path);
}

const view = new AdventureView({
  canvas,
  hud,
  renderer,
  map,
  camera,
  player,
  isInCombat: () => combat,
  onPathChanged: (p) => {
    path = p;
  },
  onHudUpdate: refreshHud,
  onRedraw: draw,
  onMoveStarted: (newPath) => {
    if (backendOk && activeGameName) {
      void api.logEvent(activeGameName, "move_started", {
        from: { q: player.tile.q, r: player.tile.r },
        to: newPath[newPath.length - 1],
        steps: newPath.length,
      });
    }
  },
});

(window as unknown as { __gameDebug: unknown }).__gameDebug = {
  get player() { return { q: player.tile.q, r: player.tile.r }; },
  get moving() { return player.moving; },
  get hover() { return view.hover; },
  get click() { return view.lastClickDebug; },
  get turn() { return turn; },
  get gold() { return gold; },
  get enemies() { return enemies.map((e) => ({ q: e.tile.q, r: e.tile.r })); },
  get combat() { return combat; },
  get activeGameId() { return activeGameId; },
  get activeGameName() { return activeGameName; },
  get screenFor() {
    return (q: number, r: number) => {
      const { x: wx, y: wy } = axialToPixel(q, r);
      return { x: wx * camera.zoom + camera.x, y: wy * camera.zoom + camera.y };
    };
  },
};

function resetTransientState() {
  path = [];
  combat = false;
  combatTile = null;
  wanderState.timer = 0;
  lastSavedAt = null;
}

function loadGameIntoState(loaded: Game, tiles: TileRow[]) {
  activeGameId = loaded.id;
  activeGameName = loaded.name;
  rememberGame(loaded.id, loaded.name);
  map = GameMap.fromTiles(tiles);
  (renderer as unknown as { map: GameMap }).map = map;
  player.tile = { q: loaded.hero_q, r: loaded.hero_r };
  player.fromTile = { ...player.tile };
  player.toTile = { ...player.tile };
  for (let i = 0; i < enemies.length; i++) {
    const pos = loaded.enemy_positions[i] ?? ENEMY_START[i] ?? { q: 0, r: 0 };
    enemies[i].tile = { q: pos.q, r: pos.r };
    enemies[i].fromTile = { ...enemies[i].tile };
    enemies[i].toTile = { ...enemies[i].tile };
  }
  turn = loaded.turn;
  gold = loaded.gold;
  resetTransientState();
  view.centerOn(player.tile.q, player.tile.r);
  toolbar.refresh();
  refreshHud();
  draw();
}

async function startFreshStarter() {
  const name = `starter-${Date.now().toString(36)}`;
  try {
    const created = await api.createGame(name, MAP_SEED, player.tile.q, player.tile.r, ENEMY_START);
    const tiles = await api.getTiles(created.name);
    loadGameIntoState(created, tiles);
    await api.logEvent(created.name, "session_start", { seed: created.seed, turn: 1, gold: 0 });
  } catch (e) {
    console.warn("failed to start starter game:", e);
    saveStatus = "error";
  }
}

const toolbar = new Toolbar({
  container: toolbarEl,
  backendOk: () => backendOk,
  hasActiveGame: () => activeGameId !== null,
  onNew: async ({ name, seed }) => {
    const created = await api.createGame(name, seed, player.tile.q, player.tile.r, ENEMY_START);
    const tiles = await api.getTiles(created.name);
    loadGameIntoState(created, tiles);
    await api.logEvent(created.name, "new_game", { seed });
  },
  onLoad: async (loaded, tiles) => {
    loadGameIntoState(loaded, tiles);
    await api.logEvent(loaded.name, "load_game", {});
  },
  onSave: async () => {
    if (!backendOk || !activeGameName) return;
    saveStatus = "saving";
    refreshHud();
    try {
      const updated = await api.patchGame(activeGameName, {
        hero_q: player.tile.q,
        hero_r: player.tile.r,
        turn,
        gold,
        enemy_positions: enemies.map((e) => ({ q: e.tile.q, r: e.tile.r })),
      });
      lastSavedAt = updated.updated_at;
      saveStatus = "saved";
      setTimeout(() => {
        if (saveStatus === "saved" || saveStatus === "error") saveStatus = "idle";
        refreshHud();
      }, 1500);
    } catch (e) {
      console.warn("manual save failed:", e);
      saveStatus = "error";
    }
    refreshHud();
  },
  onForget: (id) => {
    forgetGame(id);
    if (activeGameId === id) {
      activeGameId = null;
      activeGameName = null;
      toolbar.refresh();
      refreshHud();
    }
  },
});

async function initBackend() {
  try {
    await api.health();
    backendOk = true;
  } catch (e) {
    backendOk = false;
    console.warn("backend offline:", e);
    toolbar.refresh();
    return;
  }
  toolbar.refresh();
  const cached = listUserGames();
  if (cached.length === 0) {
    await startFreshStarter();
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  view.resize(dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

window.addEventListener("resize", resize);

let lastTime = performance.now();
let wasMoving = false;
function loop(now: number) {
  const dt = now - lastTime;
  lastTime = now;
  player.update(dt);
  tickEnemyWander(map, enemies, rng, dt, wanderState);
  if (wasMoving && !player.moving) {
    const arrivalState: ArrivalState = {
      player,
      enemies,
      path,
      gold,
      turn,
      combat,
      combatTile,
      saveStatus,
      backendOk,
      activeGameName,
      onSaved: (updatedAt) => {
        lastSavedAt = updatedAt;
      },
    };
    void onHeroArrived(arrivalState, { onHudUpdate: refreshHud }).then(() => {
      gold = arrivalState.gold;
      turn = arrivalState.turn;
      combat = arrivalState.combat;
      combatTile = arrivalState.combatTile;
      saveStatus = arrivalState.saveStatus;
    });
  }
  wasMoving = player.moving;
  draw();
  requestAnimationFrame(loop);
}

resize();
void initBackend().then(() => {
  refreshHud();
  draw();
});
requestAnimationFrame(loop);
