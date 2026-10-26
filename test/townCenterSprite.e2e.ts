import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Pool } from "pg";
import { BUILDING_SPRITE_FILES, pickStyleForBuilding } from "@heroes/engine";
import { coveredWagonIdFor } from "@heroes/contracts";
import { BUILDING_ANCHOR_OVERRIDES } from "../src/render/generated/buildingAnchorOverrides";
import { buildingFootprint, cellToScreen, cityLayout, TILE_W } from "../src/core/cityGrid";
import type { GameDebugApi } from "../src/io/debugCommands";
import {
  clearRegisteredPids,
  getApiPort,
  getClientPort,
  reapPreviousRunPids,
  spawnLogged,
  treeKill,
  waitForApiHealth,
  waitForUrl,
} from "./_request";

// The town center sprite's grid alignment, proved end to end.
//
// WHAT THIS SUITE ASSERTS (and why it is a test, not a screenshot gallery):
// a settlement's town center is the town hall -- the 2x2 building that owns the
// city grid's reserved centre cell (docs/settlements.md, "Town Hall at center").
// Its art is resolved through the engine's own chain:
//
//   kind "townHall" (packages/contracts/src/buildings.ts)
//     -> pickStyleForBuilding("townHall", 1, "pixel")   [packages/engine/src/styleResolver.ts]
//     -> "pixel" -> BUILDING_SPRITE_FILES["pixel.townHall.1"]
//     -> src/resources/buildings/building-pixel-townHall-1.png
//     -> BUILDING_DESCRIPTORS["building.pixel.townHall.1"]  [src/render/assetDescriptors.ts]
//
// ...and that art must sit ON the iso grid: its ground diamond projected 2:1,
// authored flush to the sprite's own base, covering the 2x2 footprint it stands
// on, with nothing hanging below the ground plane (a soil plinth) and nothing
// floating above the cell's south vertex.
//
// The reference for "grid-exact" is the repo's own five farm-plot styles
// (`building-pixel-farm<Style>-1.png`, see docs/farm-review/farm-options.md and
// the GRID_EXACT_FARM_STYLES note in assetDescriptors.ts). Their measured
// numbers calibrate every tolerance below, so the thresholds are the repo's
// standard rather than a number invented here.
//
// The suite reports EVERY check (pass or fail) before it throws, because the
// point of the audit run is the full defect list, not the first failure.

const ROOT = process.cwd();
const ART_DIR = resolve(ROOT, "src/resources/buildings");

const KIND = "townHall";
const LEVEL = 1;
const PREFERRED_STYLE = "pixel";
const SPRITE_KEY = `${PREFERRED_STYLE}.${KIND}.${LEVEL}`;
const ART_FILE = BUILDING_SPRITE_FILES[SPRITE_KEY];
const ART_PATH = ART_FILE ? resolve(ART_DIR, ART_FILE) : "";
/** The grid-exact calibration sprite (2x2 ground plot, the farm family's shape). */
const REFERENCE_PATH = resolve(ART_DIR, "building-pixel-farmWheat-1.png");

// ── Thresholds ────────────────────────────────────────────────────────────
// Calibrated on building-pixel-farmWheat-1.png (measured: edge slope 0.522,
// bottom pad 0, ground diamond 98.4% of the canvas width, 11px of silhouette
// below a 2:1 diamond of its own width). A sprite that meets these sits on the
// iso grid the way the farm plots do.
const ISO_SLOPE = 0.5; // the grid's own projection (TILE_D / TILE_W / 2)
const MAX_SLOPE_DEV = 0.06; // ref 0.522 -> 0.022 off
const MAX_BOTTOM_PAD_ROWS = 2; // ref 0
const MIN_GROUND_WIDTH_RATIO = 0.95; // ref 0.984
const MAX_BELOW_GROUND_PX = 16; // ref 11 (of a 1024 canvas)
// Rendered tolerances (city view, tileScale 1).
const MAX_BASE_OFFSET_PX = 2; // "floating"/"cut off" is measured against this
const MAX_RENDERED_SLOPE_DEV = 0.08;
const MIN_RENDERED_FOOTPRINT_COVERAGE = 0.95;

const ARTIFACT_DIR = resolve(ROOT, "local/audit-town-center");

// ── Check collector ───────────────────────────────────────────────────────
interface Check {
  id: string;
  what: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(id: string, what: string, pass: boolean, detail: string): boolean {
  checks.push({ id, what, pass, detail });
  console.log(`>> ${pass ? "PASS" : "FAIL"} ${id}  ${what}\n     ${detail}`);
  return pass;
}

// ── PNG measurement ───────────────────────────────────────────────────────
interface RowSpan {
  lo: number;
  hi: number;
  w: number;
}

/** A decoded image as straight RGBA bytes (one row per `width * 4`). */
interface Raster {
  width: number;
  height: number;
  data: Buffer;
}

/** Decode a PNG file or an in-memory screenshot buffer to RGBA. */
async function decodePng(source: string | Buffer): Promise<Raster> {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/** Per-row alpha extents of a sprite: the silhouette, alpha > `alphaMin`. */
function alphaRows(raster: Raster, alphaMin = 10): Array<RowSpan | null> {
  const { width, height, data } = raster;
  const rows: Array<RowSpan | null> = [];
  for (let y = 0; y < height; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > alphaMin) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    rows.push(lo < 0 ? null : { lo, hi, w: hi - lo + 1 });
  }
  return rows;
}

interface Silhouette {
  width: number;
  height: number;
  minY: number;
  maxY: number;
  bottomPadRows: number;
  widest: RowSpan & { y: number };
  bottomVertexX: number;
  /** dy/dx of the lower-left silhouette edge -- the art's ground-diamond projection. */
  edgeSlope: number;
  /** Ground diamond width as a fraction of the canvas width. */
  widthRatio: number;
  /** Rows of silhouette below where a 2:1 ground diamond of this width would end. */
  belowGroundPx: number;
}

function silhouetteOf(raster: Raster): Silhouette {
  const rows = alphaRows(raster);
  let minY = 1e9;
  let maxY = -1;
  for (let y = 0; y < rows.length; y++) {
    if (rows[y]) {
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  let widest: (RowSpan & { y: number }) | null = null;
  for (let y = minY; y <= maxY; y++) {
    const r = rows[y];
    if (r && (!widest || r.w > widest.w)) widest = { y, ...r };
  }
  assert(widest, "sprite has no opaque pixels");
  const bottomVertexX = Math.round((widest.lo + widest.hi) / 2);
  const run = bottomVertexX - widest.lo;
  const edgeSlope = run > 0 ? (maxY - widest.y) / run : 0;
  return {
    width: raster.width,
    height: raster.height,
    minY,
    maxY,
    bottomPadRows: raster.height - 1 - maxY,
    widest,
    bottomVertexX,
    edgeSlope,
    widthRatio: widest.w / raster.width,
    belowGroundPx: maxY - (widest.y + widest.w / 4),
  };
}

interface Mask {
  rows: Array<RowSpan | null>;
  minY: number;
  maxY: number;
  widest: RowSpan & { y: number };
  area: number;
}

/** The pixels that changed between two frames of the same crop, as a silhouette. */
function diffMask(a: Raster, b: Raster, threshold = 12): Mask {
  assert.equal(a.width, b.width, "crop widths must match");
  assert.equal(a.height, b.height, "crop heights must match");
  const { width, height } = a;
  const rows: Array<RowSpan | null> = [];
  let minY = 1e9;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < height; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d =
        Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]) +
        Math.abs(a.data[i + 3] - b.data[i + 3]);
      if (d > threshold) {
        if (lo < 0) lo = x;
        hi = x;
        area++;
      }
    }
    rows.push(lo < 0 ? null : { lo, hi, w: hi - lo + 1 });
    if (lo >= 0) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  let widest: (RowSpan & { y: number }) | null = null;
  for (let y = minY; y <= maxY; y++) {
    const r = rows[y];
    if (r && (!widest || r.w > widest.w)) widest = { y, ...r };
  }
  assert(widest, "no pixels changed between the two frames -- the town center never rendered");
  return { rows, minY, maxY, widest, area };
}

// ── Browser harness (the sibling suites' shape) ───────────────────────────
const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const GAME_NAME = "town-center-sprite-e2e";
const GAME_SEED = 9137;
const WAGON_ID = coveredWagonIdFor(0);
const FOUND_BUTTON_LABEL = "Found Settlement";

const children: ChildProcess[] = [];
let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  console.log(">> Cleaning up subprocesses...");
  for (const c of children) if (c.pid != null) treeKill(c.pid);
  clearRegisteredPids();
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
reapPreviousRunPids();
setTimeout(() => {
  console.error(">> townCenterSprite.e2e exceeded 300s, forcing exit");
  cleanup();
  process.exit(2);
}, 300_000).unref();

const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser",
  password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

interface GameRowShape {
  id: number;
  heroes: Record<string, { id: string; ownerId: number; q: number; r: number }>;
}

interface ClientSettlement {
  id: string;
  ownerId: number | null;
  q: number;
  r: number;
  level: number;
  buildings?: Array<{ kind: string; level: number; gx: number; gy: number }>;
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

async function createSettlersGame(name: string, seed: number): Promise<GameRowShape> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", {
    name,
    seed,
    humanSlots: 1,
    enemySlots: 0,
    gameMode: "settlers",
  });
  assert.equal(res.status, 201, `create ${name} -> ${res.status} ${JSON.stringify(res.json)}`);
  const row = await db.query(`SELECT id, heroes FROM games WHERE name = $1`, [name]);
  assert(row.rows[0], `game ${name} missing from the db`);
  return row.rows[0] as GameRowShape;
}

async function openGame(page: Page, name: string, gameId: number): Promise<void> {
  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.evaluate(
    (g) => {
      localStorage.setItem(
        "heroesJs.userGames",
        JSON.stringify({
          version: 1,
          games: [{ id: g.id, name: g.name, lastSeenAt: new Date().toISOString() }],
        }),
      );
    },
    { id: gameId, name },
  );
  await page.reload({ waitUntil: "load" });
  await wait(1500);
  const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ }).first();
  if ((await loadBtn.count()) > 0) {
    await loadBtn.click();
    // `button:visible` (not `.first()`): a hidden Open button can precede the
    // modal's own row in DOM order, and waiting on that one never resolves.
    const openBtn = page.locator("button:visible").filter({ hasText: /^Open$/ }).first();
    try {
      await openBtn.waitFor({ timeout: 15000 });
    } catch (err) {
      const dump = await page.evaluate(() => document.body.innerText.slice(0, 800));
      throw new Error(
        `the Load Game modal never offered an Open row for ${name} (the modal's text follows)\n---\n${dump}\n---\n${String(err)}`,
      );
    }
    const clicked = await page.evaluate((n) => {
      const rows = Array.from(document.body.querySelectorAll("button"))
        .filter((b) => b.textContent?.trim() === "Open")
        .map((b) => {
          let row = b.parentElement;
          for (let i = 0; i < 3 && row && (row.textContent ?? "").length < 40; i++) row = row.parentElement;
          return { btn: b, text: row?.textContent ?? "" };
        });
      const hit = rows.find((r) => r.text.includes(n));
      if (!hit) return false;
      hit.btn.click();
      return true;
    }, name);
    assert(clicked, `no Open row matched ${name}`);
  }
  await page.waitForFunction(
    (n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n,
    name,
    { timeout: 30000 },
  );
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

function clientSettlements(page: Page): Promise<ClientSettlement[]> {
  return page.evaluate(() => {
    const gs = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.() as
      | { settlements?: Record<string, ClientSettlement> }
      | undefined;
    return Object.values(gs?.settlements ?? {});
  });
}

function screenOf(page: Page, tile: { q: number; r: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (t) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(t.q, t.r),
    tile,
  );
}

async function clickHex(page: Page, tile: { q: number; r: number }): Promise<void> {
  const pt = await screenOf(page, tile);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await wait(80);
  await page.mouse.click(pt.x, pt.y);
  await wait(350);
}

function paletteOpen(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.body.children).some((el) => el.textContent?.includes("Building Palette")),
  );
}

async function clickPaletteButton(page: Page, text: string): Promise<void> {
  const found = await page.evaluate((t: string) => {
    const palette = Array.from(document.body.children).find((el) =>
      el.textContent?.includes("Building Palette"),
    );
    if (!palette) return false;
    for (const btn of Array.from(palette.querySelectorAll("button"))) {
      if (btn.textContent === t || btn.textContent?.includes(t)) {
        (btn as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, text);
  if (!found) {
    const body = await page.evaluate(() => {
      const p = Array.from(document.body.children).find((el) =>
        el.textContent?.includes("Building Palette"),
      );
      if (!p) return "NO PALETTE";
      return Array.from(p.querySelectorAll("button"))
        .map((b) => b.textContent)
        .join(", ");
    });
    throw new Error(`Button "${text}" not found in palette. Buttons: ${body}`);
  }
  await wait(250);
}

async function openCityView(page: Page, tile: { q: number; r: number }): Promise<boolean> {
  const pt = await screenOf(page, tile);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.mouse.click(pt.x, pt.y);
  await wait(150);
  await page.mouse.dblclick(pt.x, pt.y);
  await wait(900);
  return page.evaluate(() => document.body.innerText.includes("City Design"));
}

/** Park the pointer off the grid so neither frame carries a cell hover tint. */
async function parkPointer(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.mouse.move(viewport.width - 10, viewport.height - 10);
  await wait(400);
}

function cityViewOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.body.innerText.includes("City Design"));
}

/** Escape unwinds the palette first, then the city view; the view owns the order. */
async function closeCityView(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await cityViewOpen(page))) return;
    await page.keyboard.press("Escape");
    await wait(350);
  }
}

/** The settlement's town hall as the client sees it right now. */
function townHallState(page: Page, settlementId: string): Promise<{ kind: string; level: number; gx: number; gy: number; construction?: { daysRemaining: number } } | undefined> {
  return page.evaluate((sid) => {
    const gs = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.() as
      | { settlements?: Record<string, { buildings?: Array<{ kind: string; level: number; gx: number; gy: number; construction?: { daysRemaining: number } }> }> }
      | undefined;
    return gs?.settlements?.[sid]?.buildings?.find((b) => b.kind === "townHall");
  }, settlementId);
}

// ── Part 1: the asset the town center resolves to ─────────────────────────
async function auditResolvedArt(): Promise<{ art: Silhouette; committedOffsetY: number }> {
  console.log("\n== Part 1: the resolved town-center asset (offline) ==");

  // The resolver returns GenerationStyle, a union that predates the pixel
  // family ("classic" | "blocky" | ...); "pixel" rides it as a cast on the
  // engine side, so compare it as the plain string carrier it is.
  const style = pickStyleForBuilding(KIND, LEVEL, PREFERRED_STYLE) as string;
  check(
    "A0",
    "the town center resolves through styleResolver to a real file",
    style === PREFERRED_STYLE && Boolean(ART_FILE) && existsSync(ART_PATH),
    `pickStyleForBuilding("${KIND}", ${LEVEL}, "${PREFERRED_STYLE}") -> "${style}"; key "${SPRITE_KEY}" -> ${ART_FILE ?? "(none)"}; exists=${ART_FILE ? existsSync(ART_PATH) : false}`,
  );
  assert(ART_FILE && existsSync(ART_PATH), `resolved art missing: ${ART_PATH}`);
  // The fall-through (no preferred style) must reach the same art: it is the
  // only style the family ships for this kind.
  const fallthrough = pickStyleForBuilding(KIND, LEVEL, undefined) as string;
  check(
    "A0b",
    "the fall-through style agrees (no preferred style -> same art)",
    fallthrough === PREFERRED_STYLE,
    `pickStyleForBuilding("${KIND}", ${LEVEL}, undefined) -> "${fallthrough}"`,
  );

  const art = silhouetteOf(await decodePng(ART_PATH));
  const reference = silhouetteOf(await decodePng(REFERENCE_PATH));

  check(
    "A1",
    "the ground diamond is projected 2:1, like the iso grid",
    Math.abs(art.edgeSlope - ISO_SLOPE) <= MAX_SLOPE_DEV,
    `edge slope ${art.edgeSlope.toFixed(3)} (grid ${ISO_SLOPE.toFixed(3)}, tolerance ±${MAX_SLOPE_DEV}); grid-exact reference ${REFERENCE_PATH.split(/[\\/]/).pop()} measures ${reference.edgeSlope.toFixed(3)}`,
  );
  check(
    "A2",
    "the art is authored flush to its own base (no transparent pad under the ground)",
    art.bottomPadRows <= MAX_BOTTOM_PAD_ROWS,
    `${art.bottomPadRows} transparent rows below the lowest opaque pixel of ${art.height} (max ${MAX_BOTTOM_PAD_ROWS}); reference ${reference.bottomPadRows}`,
  );
  check(
    "A3",
    "the ground diamond fills the sprite canvas (the family's grid-exact convention)",
    art.widthRatio >= MIN_GROUND_WIDTH_RATIO,
    `ground diamond ${(art.widthRatio * 100).toFixed(1)}% of the ${art.width}px canvas (min ${(MIN_GROUND_WIDTH_RATIO * 100).toFixed(0)}%); reference ${(reference.widthRatio * 100).toFixed(1)}%`,
  );
  check(
    "A4",
    "nothing hangs below the ground plane (no soil plinth)",
    art.belowGroundPx <= MAX_BELOW_GROUND_PX,
    `${art.belowGroundPx.toFixed(1)}px of silhouette below a 2:1 diamond of its own ${art.widest.w}px width (max ${MAX_BELOW_GROUND_PX}); reference ${reference.belowGroundPx.toFixed(1)}px`,
  );

  // The anchor table is what places that base on the cell. Its documented
  // convention (src/render/assetDescriptors.ts, "Other 2x2 buildings (e.g.
  // townHall) deliberately keep 86.4") sizes the compensation with the 1x1
  // draw height even for a 2x2 building, so a padded 2x2 sprite is only
  // half-corrected and its visible base floats above the footprint vertex.
  const committedOffsetY = BUILDING_ANCHOR_OVERRIDES[SPRITE_KEY];
  const drawnHeight1x1 = TILE_W * 0.9; // the divisor the table used for this key
  const drawnHeight2x2 = 2 * TILE_W * 0.9; // fitWidth hexSizeMul 0.9 over a 2x2 footprint
  const requiredOffsetY = (art.bottomPadRows * drawnHeight2x2) / art.height;
  const offsetFrom1x1Divisor = (art.bottomPadRows * drawnHeight1x1) / art.height;
  check(
    "A5",
    "the anchor offset cancels the art's own bottom pad at its real draw height",
    Math.abs(committedOffsetY - requiredOffsetY) <= 1,
    `committed anchorOffsetY ${committedOffsetY} (generated from the 86.4 1x1 divisor: ${offsetFrom1x1Divisor.toFixed(2)}), required ${requiredOffsetY.toFixed(2)} for the 2x2 draw height ${drawnHeight2x2}`,
  );

  return { art, committedOffsetY };
}

// ── Part 2: the rendered town center on the iso grid ──────────────────────
async function auditRendered(page: Page, viewport: { width: number; height: number }): Promise<void> {
  console.log("\n== Part 2: the town center rendered in a settlers city view ==");

  const founded = (await clientSettlements(page)).find((s) => s.ownerId === 0);
  assert(founded, "the founding must produce the seat's own settlement");
  check(
    "B0",
    "a settlers game founds a town with no free starter city (the mode's own rule)",
    (founded.buildings ?? []).length === 0,
    `settlement ${founded.id} level ${founded.level} at ${founded.q},${founded.r} carries ${(founded.buildings ?? []).length} buildings`,
  );

  const opened = await openCityView(page, { q: founded.q, r: founded.r });
  assert(opened, "the city view must open on the founded town");

  const size = (founded.level === 1 ? 5 : founded.level === 2 ? 10 : 15) as 5 | 10 | 15;
  const layout = cityLayout(size, viewport.width, viewport.height);
  // The placer reserves the centre cell for the town hall but refuses to place
  // ANYTHING over it (buildingPlacer.canPlaceAt), so the town center is placed
  // on the corner cell (0,0): a legal 2x2 that leaves the reserved cell empty.
  const cell = { gx: 0, gy: 0 };
  const cellCentre = cellToScreen(cell.gx, cell.gy, layout.gridOrigin);
  const clickPt = {
    x: layout.screenOrigin.x + cellCentre.x * layout.tileScale,
    y: layout.screenOrigin.y + cellCentre.y * layout.tileScale,
  };
  const fp = buildingFootprint(cell.gx, cell.gy, layout.gridOrigin, layout.screenOrigin, layout.tileScale, 2, 2);
  const footprintWidth = fp.hw * 2;
  const southVertexY = fp.cy + fp.hh;

  const crop = {
    x: Math.round(fp.cx - 160),
    y: Math.round(fp.cy - 190),
    width: 320,
    height: 320,
  };
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  await parkPointer(page, viewport);
  const beforeBuf = await page.screenshot({ clip: crop });
  writeFileSync(resolve(ARTIFACT_DIR, "city-view-before.png"), beforeBuf);

  await page.keyboard.press("b");
  await wait(400);
  assert(await paletteOpen(page), "the build palette must open with B");
  await clickPaletteButton(page, "Town Hall");
  await page.mouse.click(clickPt.x, clickPt.y);
  await wait(900);

  const placed = (await clientSettlements(page)).find((s) => s.id === founded.id);
  const hall = (placed?.buildings ?? []).find((b) => b.kind === "townHall");
  check(
    "B1",
    "the town center is placed and committed in the settlers town",
    hall?.gx === cell.gx && hall?.gy === cell.gy && hall?.level === 1,
    `townHall in state: ${hall ? `(${hall.gx},${hall.gy}) level ${hall.level}` : "absent"}; clicked the cell centre at (${Math.round(clickPt.x)},${Math.round(clickPt.y)})`,
  );
  assert(hall, "the town center must be in the settlement's buildings before the sprite can be measured");

  // The town center's OWN sprite only exists once the build stamp clears. A
  // freshly placed town hall is stamped `{ daysRemaining: 0 }` (buildDays 0),
  // which is still a truthy `construction`, so the city view paints
  // `building.pixel.underConstruction.<stage>` for it -- the placeholder, not
  // the town center (and `buildingConstructionProgress` divides by that 0-day
  // total, so the stage is NaN -> 1). `advanceBuildingConstructions` drops the
  // stamp on the first day that passes, which is the state a player sees a
  // moment later, so the suite passes one turn before measuring.
  await closeCityView(page);
  assert(!(await cityViewOpen(page)), "the city view must close before the turn is advanced");
  await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.endTurn());
  let completed: { construction?: { daysRemaining: number } } | undefined;
  for (let i = 0; i < 60; i++) {
    completed = await townHallState(page, founded.id);
    if (completed && !completed.construction) break;
    await wait(250);
  }
  assert(
    completed && !completed.construction,
    `the town center must finish building before its sprite can be measured (state: ${JSON.stringify(completed)}) -- otherwise the render under test is the underConstruction placeholder`,
  );
  check(
    "B1b",
    "the placed town center renders its own sprite (no build stamp, so no construction placeholder)",
    !completed.construction,
    `town hall construction stamp after one turn: ${completed.construction ? JSON.stringify(completed.construction) : "cleared"}`,
  );

  const reopened = await openCityView(page, { q: founded.q, r: founded.r });
  assert(reopened, "the city view must reopen on the town for the render measurement");

  // Park so the second frame differs from the first ONLY by the town center
  // itself (no cell-hover tint, no buildable-cell tint).
  await parkPointer(page, viewport);
  const afterBuf = await page.screenshot({ clip: crop });
  writeFileSync(resolve(ARTIFACT_DIR, "city-view-town-center.png"), afterBuf);

  const mask = diffMask(await decodePng(beforeBuf), await decodePng(afterBuf));
  const cropArea = crop.width * crop.height;
  const share = mask.area / cropArea;
  check(
    "B2",
    "the diff frame isolates the sprite (a clean before/after, not a shifted backdrop)",
    share > 0.02 && share < 0.5,
    `changed pixels ${(share * 100).toFixed(1)}% of the ${crop.width}x${crop.height} crop (expected the sprite's own 2-30%)`,
  );

  // Everything below is measured off the rendered pixels, against the grid
  // geometry the city view itself uses (src/core/cityGrid).
  const baseY = crop.y + mask.maxY;
  const widestY = crop.y + mask.widest.y;
  const widestX = crop.x + Math.round((mask.widest.lo + mask.widest.hi) / 2);
  const groundWidth = mask.widest.w;
  const renderedSlope = (baseY - widestY) / (widestX - (crop.x + mask.widest.lo));

  check(
    "B3",
    "the sprite's visible base sits on the footprint's south vertex (no float, no sink)",
    Math.abs(baseY - southVertexY) <= MAX_BASE_OFFSET_PX,
    `base y=${baseY} vs 2x2 footprint south vertex y=${southVertexY.toFixed(1)} -> ${(baseY - southVertexY).toFixed(1)}px off (tolerance ±${MAX_BASE_OFFSET_PX}px)`,
  );
  check(
    "B4",
    "the ground diamond covers the 2x2 footprint it stands on",
    groundWidth >= MIN_RENDERED_FOOTPRINT_COVERAGE * footprintWidth,
    `ground diamond ${groundWidth}px vs footprint ${footprintWidth}px -> ${((groundWidth / footprintWidth) * 100).toFixed(1)}% (min ${(MIN_RENDERED_FOOTPRINT_COVERAGE * 100).toFixed(0)}%)`,
  );
  check(
    "B5",
    "the rendered ground diamond is projected 2:1",
    Math.abs(renderedSlope - ISO_SLOPE) <= MAX_RENDERED_SLOPE_DEV,
    `rendered edge slope ${renderedSlope.toFixed(3)} (grid ${ISO_SLOPE.toFixed(3)}, tolerance ±${MAX_RENDERED_SLOPE_DEV})`,
  );

  console.log(`>> screenshots: ${resolve(ARTIFACT_DIR, "city-view-before.png")}`);
  console.log(`>> screenshots: ${resolve(ARTIFACT_DIR, "city-view-town-center.png")}`);
}

async function main(): Promise<void> {
  const { art } = await auditResolvedArt();
  console.log(
    `>> resolved asset: ${ART_FILE} (${art.width}x${art.height}); alpha bbox y[${art.minY}..${art.maxY}]; widest row y=${art.widest.y} width=${art.widest.w}`,
  );

  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  let browser: Browser | null = null;
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");

    const game = await createSettlersGame(GAME_NAME, GAME_SEED);
    const wagon = game.heroes[WAGON_ID];
    assert(wagon, `the settlers seat must own its wagon (${WAGON_ID})`);
    const wagonHex = { q: wagon.q, r: wagon.r };

    browser = await chromium.launch({ headless: true });
    const viewport = { width: 1280, height: 800 };
    const page = await browser.newPage({ viewport });
    await openGame(page, GAME_NAME, game.id);

    await clickHex(page, wagonHex);
    const foundBtn = page.locator("button").filter({ hasText: FOUND_BUTTON_LABEL }).first();
    await foundBtn.waitFor({ state: "visible", timeout: 15000 });
    await foundBtn.click();
    await wait(1500);

    await auditRendered(page, viewport);
    await browser.close();
    browser = null;
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n== ${checks.length - failed.length}/${checks.length} checks passed ==` +
      (failed.length ? `\nFAILED: ${failed.map((f) => `${f.id} (${f.what})`).join("; ")}` : ""),
  );
  assert.equal(
    failed.length,
    0,
    `the town center sprite does not align to the iso grid: ${failed.map((f) => f.id).join(", ")} failed`,
  );
  console.log(">> townCenterSprite.e2e: ALL CHECKS PASSED");
}

await main().catch((err) => {
  cleanup();
  throw err;
});
