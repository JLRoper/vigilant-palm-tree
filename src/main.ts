import { Camera } from "./camera";
import { Hero } from "./hero";
import { findPath } from "./pathfinding";
import { GameMap, Renderer } from "./renderer";
import { api, type Game } from "./api";
import { hexDistance } from "./hex";
import { pickWanderTarget } from "./ai";
import { preloadCastleSprites } from "./sprites";

preloadCastleSprites();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hud = document.getElementById("hud")!;

const GAME_NAME = "default";
const MAP_SEED = 42;
const ENEMY_START: { q: number; r: number }[] = [
  { q: 18, r: 4 },
  { q: 20, r: 10 },
];

const camera = new Camera();
let map = new GameMap(MAP_SEED);
const player = new Hero("player", 2, 2, "player");
const enemies: Hero[] = ENEMY_START.map((p, i) => new Hero(`enemy_${i}`, p.q, p.r, "enemy"));
const heroes: Hero[] = [player, ...enemies];
const renderer = new Renderer(ctx, map, camera);

let hover: { q: number; r: number } | null = null;
let path: { q: number; r: number }[] = [];
let dragging = false;
let movedDuringDrag = false;
let dragStartX = 0;
let dragStartY = 0;
let lastX = 0;
let lastY = 0;
let lastTime = performance.now();
let saveStatus: "idle" | "saving" | "saved" | "error" = "idle";
let backendOk = false;
let game: Game | null = null;
let turn = 1;
let gold = 0;
let combat = false;
let combatTile: { q: number; r: number } | null = null;
let enemyWanderTimer = 0;
let enemyWanderCooldownMs = 1800;
let rngState = 0x12345678;

const lastClickDebug: {
  hover: { q: number; r: number } | null;
  path: { q: number; r: number }[];
  reason: string;
  moved: boolean;
} = { hover: null, path: [], reason: "", moved: false };
(window as unknown as { __gameDebug: unknown }).__gameDebug = {
  get player() { return { q: player.tile.q, r: player.tile.r }; },
  get moving() { return player.moving; },
  get hover() { return hover; },
  get click() { return lastClickDebug; },
  get turn() { return turn; },
  get gold() { return gold; },
  get enemies() { return enemies.map((e) => ({ q: e.tile.q, r: e.tile.r })); },
  get combat() { return combat; },
};

function rng() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

function checkCombat(): boolean {
  for (const e of enemies) {
    if (hexDistance(player.tile, e.tile) <= 1) {
      combatTile = { ...e.tile };
      return true;
    }
  }
  combatTile = null;
  return false;
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

function centerCameraOnMap() {
  const cx = (map.width - 1) / 2;
  const cy = (map.height - 1) / 2;
  const SQRT3 = Math.sqrt(3);
  const size = 32;
  const wx = size * (SQRT3 * cx + (SQRT3 / 2) * cy);
  const wy = size * (1.5 * cy);
  camera.x = window.innerWidth / 2 - wx * camera.zoom;
  camera.y = window.innerHeight / 2 - wy * camera.zoom;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.setDpr(dpr);
  centerCameraOnMap();
  draw();
}

window.addEventListener("resize", resize);

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  movedDuringDrag = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mouseup", () => (dragging = false));

window.addEventListener("mousemove", (e) => {
  if (dragging) {
    camera.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    if (Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > 4) {
      movedDuringDrag = true;
    }
  }
  hover = renderer.hoverFromScreen(e.clientX, e.clientY);
  if (!dragging && hover) {
    path = findPath(map, player.tile, hover);
  }
  updateHud();
  draw();
});

canvas.addEventListener("click", (e) => {
  lastClickDebug.reason = "";
  if (movedDuringDrag) {
    lastClickDebug.reason = "movedDuringDrag";
    return;
  }
  if (combat) {
    lastClickDebug.reason = "combat";
    return;
  }
  const t = renderer.hoverFromScreen(e.clientX, e.clientY);
  lastClickDebug.hover = t;
  if (!t) {
    lastClickDebug.reason = "no hover";
    return;
  }
  const newPath = findPath(map, player.tile, t);
  lastClickDebug.path = newPath;
  if (newPath.length === 0) {
    lastClickDebug.reason = "empty path";
    return;
  }
  path = newPath;
  player.startMoveTo(newPath[newPath.length - 1]);
  lastClickDebug.moved = true;
  if (backendOk) {
    void api.logEvent(GAME_NAME, "move_started", {
      from: { q: player.tile.q, r: player.tile.r },
      to: newPath[newPath.length - 1],
      steps: newPath.length,
    });
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.zoomAt(e.clientX, e.clientY, factor);
    draw();
  },
  { passive: false }
);

async function onPlayerArrived() {
  const steps = path.length;
  const earned = Math.max(1, steps);
  gold += earned;
  turn += 1;
  combat = checkCombat();
  if (combat) {
    gold += 50;
    const idx = enemies.findIndex(
      (e) => combatTile && e.tile.q === combatTile.q && e.tile.r === combatTile.r
    );
    if (idx >= 0) {
      enemies.splice(idx, 1);
    }
  }
  updateHud();
  if (!backendOk) return;
  saveStatus = "saving";
  updateHud();
  try {
    await api.patchGame(GAME_NAME, {
      hero_q: player.tile.q,
      hero_r: player.tile.r,
      turn,
      gold,
      enemy_positions: enemies.map((e) => ({ q: e.tile.q, r: e.tile.r })),
    });
    await api.logEvent(GAME_NAME, combat ? "combat_won" : "move_completed", {
      to: { q: player.tile.q, r: player.tile.r },
      steps,
      earned,
      turn,
      gold,
    });
    saveStatus = "saved";
  } catch (e) {
    console.warn("save failed:", e);
    saveStatus = "error";
  }
  setTimeout(() => {
    if (saveStatus === "saved" || saveStatus === "error") saveStatus = "idle";
    updateHud();
  }, 1500);
}

function updateEnemies(dtMs: number) {
  for (const enemy of enemies) {
    enemy.update(dtMs);
  }
  enemyWanderTimer += dtMs;
  if (enemyWanderTimer < enemyWanderCooldownMs) return;
  enemyWanderTimer = 0;
  for (const enemy of enemies) {
    if (enemy.moving) continue;
    const target = pickWanderTarget(map, enemy, rng);
    const newPath = findPath(map, enemy.tile, target);
    if (newPath.length >= 2) {
      enemy.startMoveTo(newPath[Math.min(1, newPath.length - 1)]);
    }
  }
}

function updateHud() {
  const base = `Drag to pan · Wheel to zoom · Zoom ${camera.zoom.toFixed(2)}x`;
  const heroInfo = `Hero (${player.tile.q}, ${player.tile.r})${player.moving ? " moving" : ""}`;
  const enemiesLeft = `${enemies.length} enemy${enemies.length === 1 ? "" : "s"}`;
  const status = combat
    ? `COMBAT!`
    : `${turn} turn${turn === 1 ? "" : "s"} · ${gold}g · ${enemiesLeft}`;
  const dbInfo = backendOk ? `DB ${saveStatus}` : "DB offline";
  if (!hover) {
    hud.textContent = `${heroInfo} · ${status} · ${dbInfo} · ${base}`;
    return;
  }
  const t = map.get(hover.q, hover.r);
  const tile = `Tile (${hover.q}, ${hover.r}) · ${t ?? "void"}`;
  hud.textContent = `${tile} · ${heroInfo} · ${status} · ${dbInfo} · ${base}`;
}

function draw() {
  renderer.draw(hover, heroes, path);
}

let wasMoving = false;
function loop(now: number) {
  const dt = now - lastTime;
  lastTime = now;
  player.update(dt);
  updateEnemies(dt);
  if (wasMoving && !player.moving) {
    void onPlayerArrived();
  }
  wasMoving = player.moving;
  draw();
  requestAnimationFrame(loop);
}

resize();
void initBackend().then(() => {
  updateHud();
  draw();
});
requestAnimationFrame(loop);
