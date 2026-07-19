import { Hero } from "./entities/hero";
import { GameMap } from "./map/gameMap";
import { Renderer } from "./render/renderer";
import { Camera } from "./render/camera";
import { api, type Game } from "./io/api";
import { preloadCastleSprites } from "./render/sprites";
import { rng } from "./core/rng";
import { AdventureView, ENEMY_START, GAME_NAME, MAP_SEED } from "./views/adventureView";
import { updateHud } from "./views/hud";
import { onHeroArrived, type ArrivalState } from "./systems/movement";
import { tickEnemyWander } from "./systems/enemyWander";

preloadCastleSprites();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;

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
let game: Game | null = null;
let turn = 1;
let gold = 0;
let combat = false;
let combatTile: { q: number; r: number } | null = null;
const wanderState = { timer: 0, cooldownMs: 1800 };

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
    if (backendOk) {
      void api.logEvent(GAME_NAME, "move_started", {
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
};

function refreshHud() {
  updateHud(hud, player, enemies, view.hover, map, camera, turn, gold, combat, backendOk, saveStatus);
}

function draw() {
  renderer.draw(view.hover, heroes, view.path);
}

async function initBackend() {
  try {
    await api.health();
    backendOk = true;
  } catch (e) {
    backendOk = false;
    console.warn("backend offline:", e);
    return;
  }
  try {
    const fresh = await api.createGame(
      GAME_NAME,
      MAP_SEED,
      player.tile.q,
      player.tile.r,
      ENEMY_START
    );
    game = fresh;
    map = new GameMap(game.seed);
    (renderer as unknown as { map: GameMap }).map = map;
    player.tile = { q: game.hero_q, r: game.hero_r };
    turn = game.turn;
    gold = game.gold;
    for (let i = 0; i < enemies.length; i++) {
      const pos = game.enemy_positions[i] ?? ENEMY_START[i] ?? { q: 0, r: 0 };
      enemies[i].tile = { q: pos.q, r: pos.r };
      enemies[i].fromTile = { ...enemies[i].tile };
      enemies[i].toTile = { ...enemies[i].tile };
    }
    await api.logEvent(GAME_NAME, "session_start", {
      seed: game.seed,
      turn,
      gold,
    });
  } catch (e) {
    console.warn("failed to load game:", e);
    saveStatus = "error";
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
