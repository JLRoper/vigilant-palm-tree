// Visual-regression gate for plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §9's "canvas-render screenshot diffs vs. previous render path" requirement
// (issue #149). Captures a fixed replay set from deterministic game states and
// diffs each screenshot against a committed baseline in
// test/visual-baselines/. Run standalone with `npm run test:visual`, or
// `npm run test:visual:update-baselines` to (re)write the baselines -- baseline
// churn must be justified in the PR description, per the issue's own ask.
// Set VISUAL_GAME_NAME_TAG to suffix the suite's game name and avoid clashing
// with concurrent runs on the shared game DB (default: unsuffixed).

import { chromium, Browser, Page, BrowserContext, request as pwRequest } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { resolve } from "node:path";
import {
  getApiPort,
  getClientPort,
  shouldUpdateBaselines,
  spawnLogged,
  waitForApiHealth,
  waitForPortReleased,
  waitForUrl,
  treeKill,
  reapPreviousRunPids,
  clearRegisteredPids,
} from "./_request";
import { comparePng, diffPngBuffers, MISMATCH_RATIO_THRESHOLD } from "./render/pixelDiff";
import type { GameDebugApi } from "../src/io/debugCommands";

const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const BASELINE_DIR = resolve(process.cwd(), "test", "visual-baselines");
const UPDATE_BASELINES = shouldUpdateBaselines();

// Seed 13 (not 90210): its map puts a wide river along the spawn's north edge
// and a small river just south-east, both inside the initial hero vision, so
// the adventure/charter baselines actually pin the river overlay art.
const SEED = 13;
const RNG_SEED = 424242;
const GAME_NAME = process.env.VISUAL_GAME_NAME_TAG
  ? `visual-regression-149-${process.env.VISUAL_GAME_NAME_TAG}`
  : "visual-regression-149";

const VIEWPORT = { width: 1280, height: 800 };

const children: ChildProcess[] = [];
let cleaned = false;

function startApi(): ChildProcess {
  const c = spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT),
    CLIENT_PORT: String(WEB_PORT),
  });
  children.push(c);
  return c;
}

function startWeb(): ChildProcess {
  const c = spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {});
  children.push(c);
  return c;
}

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  console.log(">> Cleaning up subprocesses...");
  for (const c of children) {
    if (c.pid != null) treeKill(c.pid);
  }
  clearRegisteredPids();
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });

reapPreviousRunPids();

// Deterministic Math.random() (mulberry32) so anything client-side that isn't
// driven by the game's own seeded RNG -- e.g. the Test Battle sandbox's AI
// roster -- still produces identical output across pages/runs.
function seededRandomInitScript(seed: number): (s: number) => void {
  return (s: number) => {
    let state = s >>> 0;
    Math.random = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
}

async function newPage(context: BrowserContext, urlSuffix = ""): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") console.log(`[browser ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser pageerror] ${e.message}`));
  await page.addInitScript(seededRandomInitScript(RNG_SEED), RNG_SEED);
  // Clear storage before any app code runs instead of goto+reload: the app
  // fires its boot fetches at module evaluation, so a reload right after the
  // load event aborts an in-flight createGame and surfaces as a benign
  // "Failed to fetch" console warning (and can kill the page's own New Game
  // round-trip when it lands later). One load, no in-flight aborts.
  await page.addInitScript(() => {
    try {
      // Clear the boot cache ONCE per tab. The load-path scene reloads the page
      // mid-scene, and the landing Load list is built from the userGames cache
      // in localStorage (homeView's readLoadEntries) -- wiping it on the reload
      // would leave the modal empty and the scene could not reach the Load path
      // at all. sessionStorage survives a reload but not a new tab, so every
      // fresh page still boots clean, exactly as the unconditional clear did.
      if (!sessionStorage.getItem("__visualStorageCleared")) {
        localStorage.clear();
        sessionStorage.setItem("__visualStorageCleared", "1");
      }
    } catch {}
  });
  await waitForApiHealth(API_URL);
  // waitUntil "load", not "networkidle": once a session boots, its SSE event stream (/events/stream) holds a pending request forever, so networkidle can never fire.
  await page.goto(`${WEB_URL}${urlSuffix}`, { waitUntil: "load" });
  // Boot no longer starts a game on its own: since #307 it reads GET /api/games
  // FIRST and creates a starter game ONLY when the server says the account has
  // none, so with games on the server (every run on the shared dev DB) an empty
  // browser profile lands on the home overlay with activeGameName still null.
  // Waiting on activeGameName therefore spun to its timeout and no scene could
  // run at all. Wait on the app instead -- the debug API attached, and home's
  // own interactive surface (its New Game button, the same one
  // dismissHomeAndCreateGame clicks) on screen -- which is true exactly when the
  // page is ready to drive, whether or not a game is open.
  await page.waitForFunction(
    () => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug != null,
    null,
    { timeout: 20_000 },
  );
  await page.locator("button", { hasText: "New Game" }).last().waitFor({ state: "visible", timeout: 20_000 });
  return page;
}

// The app always boots into a full-screen home overlay (src/main.ts's
// `home.show()` is unconditional) -- the in-game toolbar isn't reachable
// until home's own "New Game" flow calls onEnterGame(). Used for every page
// this suite creates, not just the main game-scenes page.
async function dismissHomeAndCreateGame(page: Page, name: string, seed: number): Promise<void> {
  const ctx = await pwRequest.newContext();
  await ctx.delete(`${API_URL}/api/games/${name}`).catch(() => {});
  await ctx.dispose();

  // The toolbar's own "New Game" menu item (also literally titled "New
  // Game") is already in the DOM behind the home overlay, so scope to
  // home's copy specifically -- home's root is appended to <body> after
  // the toolbar is built (see src/main.ts), so it's reliably the last
  // "New Game" button in document order.
  await page.locator("button", { hasText: "New Game" }).last().click();
  await wait(150);
  const nameInput = page.locator("input[type=text]").first();
  await nameInput.fill(name);
  const seedInput = page.locator("input[type=number]").first();
  await seedInput.fill(String(seed));
  // Pin the fixture's own choices instead of inheriting whatever the form's
  // defaults are today: these screenshots need a fully visible small map with
  // no AI turn interleaved, so a change to the player-facing defaults (map
  // size, enemies, hidden map) must not silently rewrite every baseline.
  await page.locator("select").first().selectOption("small");
  await page.locator('button:text-is("0")').first().click();
  const unchartedBox = page.locator('input[type="checkbox"]').first();
  if ((await unchartedBox.count()) > 0 && (await unchartedBox.isChecked())) await unchartedBox.uncheck();
  await page.locator("button", { hasText: "Create Game" }).click();
  await wait(1000);

  const active = await page.evaluate(() => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName);
  if (active !== name) throw new Error(`New Game failed: activeGameName=${active}`);
}

interface SceneResult {
  name: string;
  ok: boolean;
  reason?: string;
  mismatchRatio?: number;
}

const results: SceneResult[] = [];

function marginDetail(diff: { mismatchRatio?: number; mismatchedPixels?: number; totalPixels?: number }): string {
  const { mismatchRatio, mismatchedPixels, totalPixels } = diff;
  if (mismatchRatio == null || mismatchedPixels == null || totalPixels == null) return "";
  const headroom = 1 - mismatchRatio / MISMATCH_RATIO_THRESHOLD;
  return ` -- mismatch ${(mismatchRatio * 100).toFixed(3)}% (${mismatchedPixels}/${totalPixels} px, headroom ${(headroom * 100).toFixed(1)}% of the ${(MISMATCH_RATIO_THRESHOLD * 100).toFixed(1)}% budget)`;
}

async function captureAndCompare(name: string, page: Page): Promise<Buffer> {
  const png = await page.locator("canvas").last().screenshot();
  const baselinePath = resolve(BASELINE_DIR, `${name}.png`);
  const diff = comparePng(baselinePath, png, { updateBaseline: UPDATE_BASELINES });
  results.push({ name, ok: diff.ok, reason: diff.reason, mismatchRatio: diff.mismatchRatio });
  console.log(`>> [${diff.ok ? "OK" : "FAIL"}] ${name}${marginDetail(diff)}${diff.reason ? ` -- ${diff.reason}` : ""}`);
  return png;
}

function isReloadRace(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Execution context was destroyed|detached frame|Target crashed|has been closed/i.test(msg);
}

async function withPageRetry<T>(
  context: BrowserContext,
  label: string,
  body: (page: Page) => Promise<T>,
  urlSuffix = "",
): Promise<T> {
  const page = await newPage(context, urlSuffix);
  try {
    const result = await body(page);
    await page.close().catch(() => {});
    return result;
  } catch (e) {
    await page.close().catch(() => {});
    if (!isReloadRace(e)) throw e;
    console.log(`>> ${label}: page reloaded mid-run; re-booting and re-running the scene`);
    const fresh = await newPage(context, urlSuffix);
    try {
      return await body(fresh);
    } finally {
      await fresh.close().catch(() => {});
    }
  }
}

// ── Adventure overview + charter phases + city view (one scene per page) ──

async function selectHero(page: Page): Promise<{ id: string; q: number; r: number }> {
  const heroes = await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getHeroes());
  const playerHero = heroes.find((h: any) => h.ownerId === 0);
  if (!playerHero) throw new Error("no player hero in fixed game");

  await page.evaluate((id) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero(id), playerHero.id);
  await wait(300);
  return playerHero;
}

async function selectHeroAndHover(page: Page): Promise<void> {
  await selectHero(page);

  // Hover a distant tile to draw the path overlay + trail (same technique as
  // test/proposedPath.test.ts), then screenshot: terrain, fog, decorations,
  // resource icons, castles, hero + trail + path overlay, territory outlines.
  const targetPx = await page.evaluate(() => {
    const cv = document.querySelector("canvas") as HTMLCanvasElement;
    const rect = cv.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 + 220, y: rect.top + rect.height / 2 + 110 };
  });
  await page.mouse.move(targetPx.x, targetPx.y);
  await wait(300);
}

async function injectCharter(page: Page, phase: "traveling" | "constructing"): Promise<void> {
  const heroes = await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getHeroes());
  const playerHero = heroes.find((h: any) => h.ownerId === 0);
  if (!playerHero) throw new Error("no player hero in fixed game");

  const settlements = await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getSettlements());
  const homeSettlement = settlements.find((s: any) => s.ownerId === 0);
  if (!homeSettlement) throw new Error("no player-owned settlement in fixed game");

  const charterTarget = await page.evaluate(({ q, r }) => {
    const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (let radius = 4; radius <= 10; radius++) {
      for (const [dq, dr] of dirs) {
        const tq = q + dq * radius, tr = r + dr * radius;
        if (d.isPassable(tq, tr)) return { q: tq, r: tr };
      }
    }
    return null;
  }, { q: homeSettlement.q, r: homeSettlement.r });
  if (!charterTarget) throw new Error("no passable charter target found near home settlement");

  // Injected directly via debugInjectCharter rather than driven through the
  // real startCharter command: that command's server-side persistence is
  // gated on the game's storage having been migrated to granular entity
  // tables (server/app/commandHandler.ts's StartCharter case, "Source gate
  // FIRST" comment) -- a fresh game here is JSONB-backed, so a real
  // StartCharter round-trip always fails with charters_persist_unavailable.
  // The charter overlay only ever reads targetQ/targetR/phase to render
  // (adventureScene.ts / paint2d's paintCharterOverlay), so the injected object is
  // exactly as good a fixture as a persisted one for this screenshot.
  await page.evaluate(
    ({ heroId, q, r, phase }) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.debugInjectCharter(heroId, q, r, phase, "Outpost"),
    { heroId: playerHero.id, q: charterTarget.q, r: charterTarget.r, phase },
  );
  await wait(300);
}

async function openCityAtHomeSettlement(page: Page): Promise<void> {
  const settlements = await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getSettlements());
  const homeSettlement = settlements.find((s: any) => s.ownerId === 0);
  if (!homeSettlement) throw new Error("no player-owned settlement in fixed game");

  const coords = await page.evaluate(
    ({ q, r }) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(q, r),
    { q: homeSettlement.q, r: homeSettlement.r },
  );
  await page.mouse.click(coords.x, coords.y);
  await wait(150);
  await page.mouse.dblclick(coords.x, coords.y);
  await wait(600);
}

// ── Districts: the map surface (district sprite + settlement road network)
// and the district's own 5x5 City Design grid ───────────────────────────────
// Every settlement city-view capture above opens a FRESH, un-districted
// settlement, so none of them can notice a change to a district's map sprite
// (adventureScene's DistrictNode -> districtSpriteKey/variant/tier), the
// settlement road network (buildSettlementRoadNode -> paintSettlementRoad,
// which only emits when a settlement HAS districts), or the district grid's
// building sprites. These scenes place a real district through the real
// command path and capture the surfaces it lands on.

const DIRS: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

interface SettlementSnap { id: string; q: number; r: number; level: number; ownerId: number | null; }

async function playerHomeSettlement(page: Page): Promise<SettlementSnap> {
  const settlements = await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getSettlements());
  const home = settlements.find((s: any) => s.ownerId === 0);
  if (!home) throw new Error("no player-owned settlement in fixed game");
  return home as SettlementSnap;
}

/** The controlled, passable, non-settlement hex a district opens on. */
async function districtHex(page: Page, q: number, r: number): Promise<{ q: number; r: number }> {
  const hex = await page.evaluate(({ q, r, dirs }) => {
    const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
    const centers = new Set(d.getSettlements().map((s) => `${s.q},${s.r}`));
    for (const [dq, dr] of dirs) {
      const tq = q + dq, tr = r + dr;
      if (centers.has(`${tq},${tr}`) || !d.isPassable(tq, tr)) continue;
      return { q: tq, r: tr };
    }
    return null;
  }, { q, r, dirs: DIRS });
  if (!hex) throw new Error(`no controlled passable hex adjacent to (${q},${r})`);
  return hex;
}

async function screenForHex(page: Page, q: number, r: number): Promise<{ x: number; y: number }> {
  const px = await page.evaluate(({ q, r }) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.screenFor(q, r), { q, r });
  const rect = await page.evaluate(() => {
    const cv = document.querySelector("canvas") as HTMLCanvasElement;
    const b = cv.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  // Refuse rather than click chrome: a hex that maps off the canvas means the
  // camera is not framing the fixture, and the scene would mis-measure silently.
  if (px.x < rect.left || px.x > rect.left + rect.width || px.y < rect.top || px.y > rect.top + rect.height) {
    throw new Error(`hex (${q},${r}) maps to (${px.x.toFixed(1)},${px.y.toFixed(1)}), outside the canvas ${JSON.stringify(rect)}`);
  }
  return px;
}

/** Double-click a controlled hex to open its district in the City Design view. */
async function openDistrict(page: Page, q: number, r: number): Promise<void> {
  const px = await screenForHex(page, q, r);
  await page.mouse.move(px.x, px.y);
  await wait(150);
  await page.mouse.click(px.x, px.y);
  await wait(150);
  await page.mouse.dblclick(px.x, px.y);
  await wait(900);
  const open = await page.evaluate(() => document.body.textContent!.includes("City Design"));
  if (!open) throw new Error(`double-click on (${q},${r}) did not open a district City Design view`);
  await wait(300);
}

async function closeCityView(page: Page): Promise<void> {
  await page.locator("button", { hasText: "Back" }).first().click();
  await wait(600);
}

/** Cell centre in CLIENT coordinates -- the space handleBuildingClick reads. */
async function districtCellScreen(page: Page, gx: number, gy: number, size = 5): Promise<{ x: number; y: number }> {
  return page.evaluate(async ({ gx, gy, size }) => {
    // Non-literal specifiers on purpose: these are Vite dev-server module URLs
    // resolved in the page at runtime, not modules TS can resolve from here.
    const gridPath = "/src/core/cityGrid.ts";
    const railPath = "/src/screens/shared/panelRail.ts";
    const grid: any = await import(/* @vite-ignore */ gridPath);
    const rail: any = await import(/* @vite-ignore */ railPath);
    const layout = grid.cityLayout(size, window.innerWidth, window.innerHeight, rail.toolbarHeight());
    const c = grid.cellToScreen(gx, gy, layout.gridOrigin);
    return { x: layout.screenOrigin.x + c.x * layout.tileScale, y: layout.screenOrigin.y + c.y * layout.tileScale };
  }, { gx, gy, size });
}

/** Every controlled, passable, non-settlement hex adjacent to a settlement. */
async function districtHexes(page: Page, q: number, r: number): Promise<Array<{ q: number; r: number }>> {
  return page.evaluate(({ q, r, dirs }) => {
    const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
    const centers = new Set(d.getSettlements().map((s) => `${s.q},${s.r}`));
    const out: Array<{ q: number; r: number }> = [];
    for (const [dq, dr] of dirs) {
      const tq = q + dq, tr = r + dr;
      if (centers.has(`${tq},${tr}`) || !d.isPassable(tq, tr)) continue;
      out.push({ q: tq, r: tr });
    }
    return out;
  }, { q, r, dirs: DIRS });
}

/** How many of a settlement's districts actually hold a building (a road anchor). */
async function districtsWithBuildings(page: Page, settlementId: string): Promise<number> {
  return page.evaluate((sid) => {
    const gs = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.getState() as any;
    const list = Array.isArray(gs.settlements) ? gs.settlements : Object.values(gs.settlements);
    const s = list.find((x: any) => x.id === sid) as any;
    const districts = s?.districts ?? {};
    return Object.values(districts).filter((d: any) => (d.buildings?.length ?? 0) > 0).length;
  }, settlementId);
}

/** Zoom the adventure camera in on a hex (wheel up; the camera clamps zoom at 3). */
async function zoomInAt(page: Page, q: number, r: number, notches = 20): Promise<void> {
  const px = await screenForHex(page, q, r);
  await page.mouse.move(px.x, px.y);
  await wait(150);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -120);
    await wait(50);
  }
  await wait(400);
}

/** Open the district build palette (the 'b' toggle); it stays open across placements. */
async function openDistrictPalette(page: Page): Promise<void> {
  await page.keyboard.press("b");
  await wait(600);
}

/**
 * Toasts are transient (a 6 s auto-dismiss, src/screens/shared/toast.ts) and
 * overlap the canvas region an element screenshot paints, so a leftover one
 * makes a capture depend on the clock between the last click and the grab.
 * They are not part of the surface under test -- clear them before a capture.
 */
async function clearToasts(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById("toast-container")?.remove());
  await wait(200);
}

/** Pick a district palette row by its text suffix, then click a grid cell. Returns false when the row is unaffordable. */
async function placeDistrictBuilding(page: Page, label: string, gx: number, gy: number): Promise<boolean> {
  const status = await page.evaluate((lbl) => {
    const rows = [...document.querySelectorAll("button")].filter((b) => b.title && b.title.length > 0);
    const btn = rows.find((b) => (b.textContent || "").trim().endsWith(lbl));
    if (!btn) return "missing";
    if ((btn as HTMLButtonElement).disabled) return "disabled";
    btn.setAttribute("data-visual-palette", "1");
    return "ok";
  }, label);
  if (status === "missing") throw new Error(`district palette row ending with "${label}" not found`);
  if (status === "disabled") return false;
  await page.locator('[data-visual-palette="1"]').click();
  await wait(400);
  const cell = await districtCellScreen(page, gx, gy);
  await page.mouse.move(cell.x, cell.y);
  await wait(200);
  await page.mouse.click(cell.x, cell.y);
  await wait(1000);
  return true;
}

/** The app boots to the home overlay and never auto-rejoins, so this is the only reload path. */
async function loadGameFromHome(page: Page, name: string): Promise<void> {
  await page.locator("button", { hasText: "Load Game" }).last().click();
  await wait(700);
  const tagged = await page.evaluate((gameName) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => {
      const t = (d.textContent || "").trim();
      // The row's progress line reads the ROUND (games.turn is frozen at
      // creation), and only a row the server still owns has an Open button.
      return t.startsWith(gameName) && /round \d+/.test(t) && d.querySelector("button");
    });
    const row = rows[rows.length - 1];
    if (!row) return false;
    const open = [...row.querySelectorAll("button")].find((b) => /Open/.test(b.textContent || ""));
    if (!open) return false;
    open.setAttribute("data-visual-load-open", "1");
    return true;
  }, name);
  if (!tagged) throw new Error(`no Load Game row for "${name}"`);
  await page.locator('[data-visual-load-open="1"]').click();
  await wait(2500);
}

// ── Battle arena: three captures per plan/2026-09-29-arena-unit-sprites.md ──
// The scene path is the arena DEFAULT now (plan decision #4), so the arena
// scenes pin all three states:
//   - battle-arena-legacy       `?paint=legacy`   → the circle escape hatch
//   - battle-arena-scenebuilder `?paint=scenebuilder` → scene path (accepted no-op)
//   - battle-arena-default      no flag            → must equal scenebuilder
// The default-vs-scenebuilder cross-diff (identical pixels) is what actually
// pins the flip — it replaces #143's legacy-vs-scenebuilder equality check,
// whose premise ("both paths render identically") is obsolete now that the
// scene path draws unit art and legacy intentionally stays circles.

async function runBattleArenaScene(
  context: BrowserContext,
  name: string,
  urlSuffix: string,
): Promise<Buffer> {
  return withPageRetry(
    context,
    name,
    async (page) => {
      await dismissHomeAndCreateGame(page, `${GAME_NAME}-${name}`, SEED);

      await page.locator('#toolbar button[title="Menu"]').click();
      const testBattleBtn = page.locator("#toolbar button", { hasText: "Test Battle" });
      await testBattleBtn.click();
      await page.locator("button", { hasText: "Start Battle" }).click({ timeout: 15_000 });
      await wait(500);

      return captureAndCompare(name, page);
    },
    urlSuffix,
  );
}

// ── The FIRST scene's own precondition: a boot account that owns a game ─────
//
// adventure-overview's frame contains the one-time first-turn hint
// (src/screens/shared/firstTurnHint.ts -- the 4,438-px panel at the bottom
// centre), and the committed baseline records it there. Whether it is PRESENT,
// though, is a property of the DATABASE rather than of the scene: the client's
// boot reads GET /api/games and, when the account owns NO game at all, starts a
// `starter-*` game of its own (GameSessionManager.initBackend's
// `if (serverGames.length === 0) await this.createFreshStarter()`). That
// throwaway game is an ACTIVE game, so firstTurnHint's `maybeShow` runs for it:
// the hint is displayed, `markFirstTurnHintSeen()` writes
// heroesJs.firstTurnHint.v1 into localStorage, and the page's next click (this
// scene's own "New Game" click) dismisses it -- by the time the scene's game is
// loaded the flag is already set, so the panel never appears and the capture is
// missing 4,438 px of the baseline.
//
// Measured 2026-11-03 on github/main d70adae (0.44.0), this scene alone:
//   * four EMPTY databases: 4,438 / 4,438 / 4,438 / 4,438 px (0.433%), every
//     page booting into activeGameName `starter-*` with the hint already marked
//     seen and hidden at capture time;
//   * four REUSED databases: 0 / 0 / 0 / 8 px, every page booting with
//     activeGameName null;
//   * an empty database handed ONE game row before boot: 0 px, hint on screen.
// With the pin below in place, four fresh and four reused databases all measure
// 0 px. Never re-cut the baseline to absorb this: the difference is the
// presence of a UI panel, not drift.
async function pinBootAccountHasAGame(anchorName: string): Promise<void> {
  const ctx = await pwRequest.newContext();
  try {
    const listed = await ctx.get(`${API_URL}/api/games`);
    if (!listed.ok()) throw new Error(`GET /api/games -> ${listed.status()}`);
    const games = (await listed.json()) as unknown[];
    if (games.length > 0) return;
    const created = await ctx.post(`${API_URL}/api/games`, {
      data: { name: anchorName, seed: SEED, humanSlots: 1, enemySlots: 0 },
    });
    if (!created.ok()) throw new Error(`POST /api/games (${anchorName}) -> ${created.status()}`);
    // Assert the postcondition against the AUTHORITY, not the create response:
    // an anchor that silently failed to land would leave this scene in exactly
    // the first-run state the pin exists to remove.
    const after = await ctx.get(`${API_URL}/api/games`);
    const afterGames = after.ok() ? ((await after.json()) as unknown[]) : [];
    if (afterGames.length === 0) throw new Error(`boot anchor ${anchorName} did not land: GET /api/games is still empty`);
  } finally {
    await ctx.dispose();
  }
}

async function run(): Promise<void> {
  let exitCode = 1;
  let browser: Browser | undefined;
  try {
    // Belt-and-suspenders for direct (non-wrapper) invocations: chained runs
    // reuse this suite's ports for the previous entry's force-killed
    // api/web, which can still answer boot probes while dying. Spawn only
    // once both ports refuse connections, so every probe below can only be
    // answered by THIS suite's servers.
    await waitForPortReleased(API_PORT);
    await waitForPortReleased(WEB_PORT);
    startApi();
    startWeb();
    await waitForApiHealth(API_URL);
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });

    // The boot account is pinned BEFORE this scene's first page exists -- the
    // client decides whether to start a game of its own at boot, so the state
    // has to be right before the page loads (see pinBootAccountHasAGame).
    await pinBootAccountHasAGame(`${GAME_NAME}-boot-anchor`);

    await withPageRetry(context, "adventure-overview", async (page) => {
      // The pin above is only worth anything if it actually held. A page that
      // booted into a game this scene did not create is a page that has already
      // consumed the one-time first-turn hint the baseline records, and it
      // would otherwise be captured as a 4,438-px "diff" that is neither drift
      // nor a regression. Assert the documented boot contract instead (#307:
      // with games on the server, an empty profile lands on the home overlay
      // with activeGameName still null).
      const bootedInto = await page.evaluate(() => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName ?? null);
      if (bootedInto != null) {
        throw new Error(
          `the page booted into "${bootedInto}" before this scene created anything: the boot account was empty, so the client started its own game and consumed the one-time first-turn hint this capture pins`,
        );
      }
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await captureAndCompare("adventure-overview", page);
    });

    await withPageRetry(context, "charter-traveling", async (page) => {
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await injectCharter(page, "traveling");
      await captureAndCompare("charter-traveling", page);
    });

    await withPageRetry(context, "charter-constructing", async (page) => {
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await injectCharter(page, "constructing");
      await captureAndCompare("charter-constructing", page);
    });

    // ── The three settlement city-view scenes ────────────────────────────
    // RE-CUT 2026-11-07 (github/main be2d030, 0.53.13). All three had gone
    // STALE-AND-GREEN: parallax-on 2,610 px, parallax-off 2,611 px, diorama
    // 2,610 px, each 0.255% against the 5,120 px a 0.5% budget allows, so the
    // suite read OK and nobody decomposed them. Their baselines were written on
    // 2026-11-03 at 0.43.0 (290f8e7 / f5c83ee / 493739a) by the f15a912 re-cut.
    //
    // Measured by REGION first (suite tolerance 24, so the region sum equals the
    // failure count with 0 px uncovered), off the live DOM at capture time:
    //
    //   toolbar                0 px   left gutter            0 px
    //   left settlement panel  2,610  panel bottom margin    0 px
    //   right panel rail       0 px   below rail             0 px
    //   City Design box        0 px
    //   SUBJECT city scene     0 px   (all four quadrants)
    //
    // CHROME IS 100% OF THE FAILURE AND THE SUBJECT IS 0 px: the city scene these
    // scenes exist to pin is byte-identical to the committed baseline, and the
    // whole 2,610 px is the left settlement panel DOM overlay. The clusters, each
    // named as a mover with the commit that moved it:
    //
    //   * 2,505 px [27,722 -> 246,776] -- the tier-upgrade row now reads
    //     "Upgrade to L2 / Needs: TH L2, Gold 300/5000" where the baseline
    //     recorded the panel's own bottom (COMMANDER'S ARMY). 0.53.10: F-5
    //     15b057b pins the control to the panel ROOT outside the scrolling body,
    //     F-3 11f8272 makes the refusal name each missing amount.
    //   * 75 px [208,325 -> 222,333] -- the Treasury row "300 / 1,500g" ->
    //     "300 / 5,000g". 0.51.3 149add3: BASE_TREASURY[1] 1500 -> 5000 so a
    //     level-1 vault can hold its own tier upgrade's price.
    //   * 28 px [217,449 -> 223,455] -- the Wood row "-4/day" -> "-6/day".
    //     762b325 (CITY P6): house upkeepPerLevel.wood 1 -> 2, and the starter set
    //     carries two houses, so the settlement's wood bill is +2/day.
    //   * 1-2 px at y=776 -- the panel's own bottom border, a sub-pixel edge of
    //     the same panel.
    //
    // The three movers are NOT ancestors of any of the three baselines
    // (`git merge-base --is-ancestor <mover> <baseline-commit>` -> 1 for all nine
    // pairs), i.e. each baseline encodes a panel state no revision at HEAD prints.
    // Proven stale by RESTORING THE PRE-CHANGE LINE, as the district re-cut did:
    // put the upgrade container back in the panel body (settlementInfoMenu.ts at
    // 290f8e7), BASE_TREASURY[1] back to 1500, and the house's wood upkeep back to
    // 1 -- each scene's panel region then reads 0 px (2,610 / 2,611 / 2,610 ->
    // 6 / 6 / 0 px, the 6 px being the documented toolbar glyph residual at
    // [666,16 -> 673,19] that rewrites adventure-overview roughly one run in
    // three; that baseline was restored, never absorbed).
    //
    // The scenes still catch their subject after the re-cut: dropping every
    // building from the city scene (a `continue` at the top of buildCityScene's
    // cityBuilding loop) reads 52,041 px = 5.082% FAIL on parallax-on and
    // 51,536 px = 5.033% FAIL on diorama -- 99.99% and 100% of it inside the
    // SUBJECT city scene. Restored, 0 px. A re-cut that could no longer go red
    // would be worthless; this one goes red on exactly what the scene pins.
    //
    // RE-MEASURED AND RE-CUT AGAIN 2026-11-07, because main moved under this
    // branch (github/main 4e38cd5 -> 7933049, 0.53.14 -> 0.53.15). 0.53.15's
    // f7a84e1 ("the tier-upgrade control and the town hall's own upgrade each
    // name their subject") relabels this panel's control "Upgrade to L2" ->
    // "Upgrade settlement to L2", which moves all three city-view scenes by
    // 599 px at [70,734 -> 204,745] -- ONE cluster, entirely inside the left
    // settlement panel, subject still 0 px. Re-cut again on the merged tree. The
    // update run's only other rewrite was adventure-overview, 8 px at
    // [666,15 -> 1259,19], the same toolbar glyph residual as above: restored,
    // never absorbed.
    await withPageRetry(context, "city-view-parallax-on", async (page) => {
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await openCityAtHomeSettlement(page);
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ parallaxEnabled: true }));
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ cityBackdrop: "skybox" }));
      await wait(300);
      await captureAndCompare("city-view-parallax-on", page);
    });

    await withPageRetry(context, "city-view-parallax-off", async (page) => {
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await openCityAtHomeSettlement(page);
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ parallaxEnabled: false }));
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ cityBackdrop: "skybox" }));
      await wait(300);
      await captureAndCompare("city-view-parallax-off", page);
    });

    // The default backdrop: the biome diorama derived from the settlement tile
    // and its six neighbors (no skybox, no parallax layers). A separate scene
    // from the two skybox captures so both modes stay pinned.
    await withPageRetry(context, "city-view-diorama", async (page) => {
      await dismissHomeAndCreateGame(page, GAME_NAME, SEED);
      await selectHeroAndHover(page);
      await openCityAtHomeSettlement(page);
      await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ cityBackdrop: "diorama" }));
      await wait(300);
      await captureAndCompare("city-view-diorama", page);
    });

    // ── District surfaces ────────────────────────────────────────────────
    // The map surface: a settlement that HAS a district, so the district
    // sprite AND the settlement road network both render. Placed through the
    // real City Design flow (double-click the conquered hex -> build palette ->
    // click a cell), the same path test/districts.e2e.ts drives, so the sprite
    // and the road layout are the real ones, not an injected fixture.
    //
    // WHAT THIS SCENE SEES, AND WHAT IT ONLY RECORDS (measured, not assumed --
    // github/main c4d8ed3, 0.40.2, 2026-11-03).
    //  * The district sprite is a real test: `districtTierForCount` reading 2
    //    for a 1-building district moves this capture 18,158 px = 1.773%, FAIL.
    //  * The road host fails too -- but only through the tile-info panel's
    //    move-cost line. Deleting the whole network (`settlementRoadNetwork`
    //    returning no routes and no segments) moves the capture 5,510 px =
    //    0.538%, FAIL; 4,669 px of that is the panel's cost text (a roaded hex
    //    is cheaper to enter, so the number changes) and only 841 px = 0.082%
    //    is the road artwork itself. At ROAD_WIDTH_BASE 0.55 px ..
    //    ROAD_WIDTH_MAX 1.5 px the band is under one screen pixel per segment
    //    even at maximum zoom (docs/settlements.md "Map visualisation"), so a
    //    pure road-art change -- colour, width, a re-route at the same cost --
    //    is 6x short of the 5,120 px a 0.5% budget over 1,024,000 px needs and
    //    CANNOT turn this red. The road needs a scoped capture over the band,
    //    or the engine-level road-network tests, to be measured on its own.
    //
    // MEASURED AS OF 2026-11-03 (the road study, stage B+C) -- and with the
    // number in, the note above stops being a guess. The band is no longer
    // 0.55-1.5 px: it is now a 1.55-2.50 px body under a 1.0 px-per-side
    // casing, i.e. 3.55-4.50 px total, painted per tile from the tile's edge
    // mask rather than as one bowed curve per segment -- and the geometry is a
    // different shape, not just a wider one. This scene at the OLD width
    // measures 0.000% (0/1,024,000 px) on the merge base, and at the NEW width
    // measures 0.237% (2,426/1,024,000 px): so the whole road landing moves
    // 2,426 px, which is 47.4% of the 5,120 px a 0.5% budget allows, with 52.6%
    // of the budget still free. The old note's "841 px, 6x short, CANNOT turn
    // this red" is therefore now wrong in both directions: the art no longer
    // CANNOT move this scene, but it still does not turn it red. The baseline
    // was deliberately NOT re-cut -- both runs below 0.5% -- and the two-sided
    // measurement is the proof. (Both runs used this worktree's private DB
    // `game_poc_roadgraph`; the only red scene in either run is
    // `district-city-view`, at an identical 35,368 px on both sides, i.e.
    // pre-existing drift that this landing neither causes nor fixes.)
    //
    // So DO NOT treat a district-map diff as drift if this scene goes red on a
    // road change; measure the road's own contribution (delete the network and
    // diff, as the note above did) before deciding whether to re-cut the
    // baseline, and justify the churn in the PR description if you do. The
    // lesson the old note records still stands, and now has the arithmetic to
    // back it: 2,426 px of a 1,024,000 px whole-canvas capture is 0.24%, which
    // is a weak instrument for a ground layer -- road work still wants the
    // engine-level tests plus a scoped capture.
    //
    // RE-CUT 2026-11-07 (github/main ff9927e, 0.53.12). The baseline above had
    // gone stale on main and read RED: 10,387 px = 1.014% against the 5,120 px
    // a 0.5% budget allows over 1,024,000 px, and it was the suite's ONLY red
    // scene. Measured by REGION before the re-cut (suite tolerance 24, so the
    // region sum equals the failure count with 0 px uncovered): toolbar 0, GRID
    // 190, right rail 0, build palette 0, City Design box 0, left settlement
    // panel 10,197. Chrome was 98.2% of the failure and the movers are named:
    // 9,778 px is 0.53.10's tier-upgrade row (F-5 15b057b pins it outside the
    // scrolling body, F-3 11f8272 names each amount -- it reads "Upgrade to L2 /
    // Needs: TH L2, Gold 100/5000"); 342 px is the workforce line "12 bldgs
    // (26 slots)" -> "11 bldgs (26 slots), pool 1 - 1 site stalled"; 75 px is
    // the Treasury row "100 / 1,500g" -> "100 / 5,000g" (0.51.3 149add3, the L1
    // cap is now its own tier cost); 2 px the panel's bottom border.
    //
    // The GRID's 190 px is NOT the subject moving -- it is ONE mover, the 0.50.0
    // construction build crews (da5c600, released by b76c8ba), which deleted the
    // `if (b.construction) continue;` skip so buildersOnSite(b) draws 4 builder
    // people on a site being built. da5c600 is not an ancestor of this baseline's
    // own commit b7177d2 -- `git show b7177d2:src/render/scene/sceneBuilder/
    // cityScene.ts` still carries the skip and HEAD does not -- so the old capture
    // encodes a state no revision on main can reproduce. Restoring just that line
    // measures GRID 0 px (left panel 10,197, total 10,197): the Farmhouse at (2,2)
    // and the 2x2 Farm Field at (0,0) are exactly where this fixture puts them.
    // The crew wave had already moved this scene 607 px -- UNDER the budget, so
    // it read OK and nobody looked -- and 0.53.10 pushed it over.
    //
    // Proven still to catch its subject, after the re-cut: dropping the 2x2
    // producer from a district's city scene (`if (input.district && b.kind ===
    // "farmField") continue;` in buildCityScene) reads 8,470 px = 0.827%, FAIL;
    // restored, 0. The four baselines the update run also rewrote were restored
    // and left stale-and-green (city-view-* 2,610 px, district-map 1,455 px --
    // under budget, other cards' movers).
    //
    // DECOMPOSED 2026-11-07 (the decompose-and-settle card), and the follow-up
    // note above guessed this scene's mover WRONG. Measured by region against the
    // suite's own tolerance 24, off the live DOM at capture time, this scene
    // reads 1,455 px = 0.142% and NOT ONE PIXEL OF IT IS CHROME:
    //
    //   toolbar 0 px · tile-info panel 0 px · left hero panel 0 px ·
    //   right panel rail 0 px · SUBJECT map surface 1,455 px (sum 1,455,
    //   uncovered 0)
    //
    // The guessed mover -- "the panel's cost line" -- is untouched. All four
    // clusters (1,017 px [541,227 -> 604,310], 253 px [539,391 -> 572,445],
    // 171 px [486,360 -> 524,367], 14 px [534,362 -> 537,365]) are the settlement
    // ROAD NETWORK's own art, which is half of what this scene exists to pin
    // ("the district sprite AND the settlement road network both render"): the
    // band went from the old sub-pixel hairline (ROAD_WIDTH_BASE 0.55 ..
    // ROAD_WIDTH_MAX 1.5, a curve per tile-centre pair) to a cased 3.55-4.50 px
    // body stroked per tile from its own edge mask. One mover, and it is 0.49.0
    // -- d9e741a "District roads: a per-tile road graph with welded junctions, at
    // a legible width (#351)", released by the same commit's chore(release). It is
    // NOT an ancestor of this baseline's commit 681c9ec
    // (`git merge-base --is-ancestor d9e741a 681c9ec` -> 1), and that landing's own
    // note recorded this scene moving 2,426 px on its merge base and deliberately
    // not re-cutting.
    //
    // So the SUBJECT has moved and the baseline is NOT re-cut here: a green
    // baseline whose subject moved is a regression hiding behind a budget, and
    // re-cutting it would bless the drift this card exists to refuse. It is
    // reported instead (the settle-and-decompose report's district-map section).
    // The district sprite half of the subject is unmoved; every mismatching pixel
    // is the road layer.
    await withPageRetry(context, "district-map", async (page) => {
      await dismissHomeAndCreateGame(page, `${GAME_NAME}-district-map`, SEED);
      await selectHero(page);
      const home = await playerHomeSettlement(page);
      // A district can only be founded touching the settlement (an L1
      // settlement's control range is 1), so the six adjacent passable hexes
      // are the whole of the network's first ring. Settle every one of them so
      // the map really has a district road NETWORK to draw, not one edge.
      const hexes = await districtHexes(page, home.q, home.r);
      let settled = 0;
      for (const hex of hexes) {
        await openDistrict(page, hex.q, hex.r);
        await openDistrictPalette(page);
        const placed = await placeDistrictBuilding(page, "Farmhouse", 2, 2);
        await closeCityView(page);
        // A district the settlement cannot afford to settle is not a district
        // (nothing is persisted until the first building lands), so stop rather
        // than open-and-abandon the rest.
        if (!placed) break;
        settled += 1;
      }
      if (settled !== (await districtsWithBuildings(page, home.id)) || settled < 2) {
        throw new Error(`district-map fixture settled ${settled} district(s); the scene needs a settlement that HAS districts`);
      }
      // Zoom the camera to its maximum on the settled tile: at gameplay zoom
      // the district art and especially its hairline road network are far too
      // small to measure through a whole-canvas diff (the road is under one
      // screen pixel, see docs/settlements.md "Map visualisation"). Do NOT
      // hover: a path overlay is drawn after the district layer and could
      // cover the very surface this scene exists to pin.
      await selectHero(page);
      await zoomInAt(page, home.q, home.r);
      await clearToasts(page);
      await captureAndCompare("district-map", page);
    });

    // The city surface for a district: its own 5x5 City Design grid with real
    // buildings placed, distinct from the settlement city-view captures above
    // (which open a fresh, un-districted settlement).
    // Proven to fail (2026-11-03, github/main c4d8ed3): `buildCityScene`
    // dropping a district's buildings moves this capture 10,633 px = 1.038%,
    // FAIL; restored, 0.000%.
    //
    // The first building is a Farmhouse, not a House, since 2026-11-03: CITY P6
    // (#344) tripled the House's placementCost.gold to 300, exactly the 300 a
    // classic settlement founds with (packages/engine/src/init.ts), so the
    // Farm Field below could not be placed any more -- measured on
    // github/main 17fd1ca, the Farm Field row came back disabled ("need 120,
    // have 0"), `placeDistrictBuilding` returned false, and the capture quietly
    // lost the 2x2 producer this scene exists to pin (35,368 px = 3.454%,
    // budget 0.5%). Both placements are asserted now so the next price move
    // fails loudly at the scene instead of moving the baseline.
    //
    // RE-CUT 2026-11-07 (the decompose-and-settle card, second pass). This scene
    // is NOT one of that card's four, but it moved while that card was re-cutting
    // them: github/main advanced to 7933049 (0.53.15) and f7a84e1's
    // "Upgrade to L2" -> "Upgrade settlement to L2" moves this capture by 599 px
    // at [70,734 -> 204,745]. Decomposed by region (tolerance 24, off the live
    // DOM): toolbar 0, left settlement panel 599, left gutter 0, panel bottom
    // margin 0, right panel rail 0, below rail 0, City Design box 0, and the
    // SUBJECT district grid 0 px in all four quadrants (sum 599, uncovered 0).
    // Chrome drifted, the subject did not -> the same rule re-cuts it, so it does
    // not sit stale-and-green the way the four did.
    await withPageRetry(context, "district-city-view", async (page) => {
      await dismissHomeAndCreateGame(page, `${GAME_NAME}-district-city-view`, SEED);
      await selectHero(page);
      const home = await playerHomeSettlement(page);
      const hex = await districtHex(page, home.q, home.r);
      await openDistrict(page, hex.q, hex.r);
      await openDistrictPalette(page);
      if (!(await placeDistrictBuilding(page, "Farmhouse", 2, 2))) {
        throw new Error("district-city-view: the centre Farmhouse row was unaffordable -- the fixture no longer builds what this capture pins");
      }
      if (!(await placeDistrictBuilding(page, "Farm Field (2×2)", 0, 0))) {
        throw new Error("district-city-view: the 2x2 Farm Field row was unaffordable -- the fixture no longer builds what this capture pins");
      }
      await wait(300);
      await clearToasts(page);
      await captureAndCompare("district-city-view", page);
    });

    // ── The Load path ────────────────────────────────────────────────────
    // Nothing else in the suite ever reloads the page, so the whole load chain
    // (landing Load list -> Open -> GameSessionManager.loadGame ->
    // resolveLoadCameraCenter -> re-render) is uncovered by the ten existing
    // scenes. This scene drives it and pins the loaded view.
    await withPageRetry(context, "load-path-adventure", async (page) => {
      const name = `${GAME_NAME}-load-path`;
      await dismissHomeAndCreateGame(page, name, SEED);
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(
        () => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug != null,
        null,
        { timeout: 20_000 },
      );
      await page.locator("button", { hasText: "New Game" }).last().waitFor({ state: "visible", timeout: 20_000 });
      await wait(300);
      await loadGameFromHome(page, name);
      const loaded = await page.evaluate(() => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName ?? null);
      if (loaded !== name) throw new Error(`Load path did not open the game: activeGameName=${loaded}`);
      // The load camera's contract (src/game/loadCamera.ts): a loaded game opens
      // framed on the seat's hero. Assert it so a camera regression cannot pass
      // as a mere pixel difference. The tolerance is not slack: `centerOn`
      // clamps the camera so the map's edge stays flush with the viewport, so on
      // a map only a little larger than the 1280x800 viewport the hero cannot
      // land exactly on the centre (measured 0,32 on the small map, whose own
      // clamp slack is half the map-extent minus viewport difference -- under
      // 64 px per axis). A regression that frames something else instead is
      // hundreds of px out, as the map-centre perturbation below shows.
      // Proven to fail (2026-11-03, github/main c4d8ed3), tolerance in place:
      // `resolveLoadCameraCenter` -> `mapCentre(map)` reads off by 180.1,72.0;
      // -> the classic spawn constant {q:6,r:5} reads off by 80.5,32.0. Both
      // RED, both restored. The x axis is what discriminates on this fixture:
      // the clamp and a wrong target both read 32.0 on y.
      const LOAD_CENTRE_TOLERANCE_PX = 64;
      const centred = await page.evaluate(() => {
        const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
        const hero = d.getHeroes().find((h) => h.ownerId === 0);
        if (!hero) return null;
        const p = d.screenFor(hero.q, hero.r);
        return { q: hero.q, r: hero.r, dx: Math.abs(p.x - window.innerWidth / 2), dy: Math.abs(p.y - window.innerHeight / 2) };
      });
      if (!centred) throw new Error("no player hero after the Load path");
      if (centred.dx > LOAD_CENTRE_TOLERANCE_PX || centred.dy > LOAD_CENTRE_TOLERANCE_PX) {
        throw new Error(`Load path did not frame the seat hero (${centred.q},${centred.r}): off by ${centred.dx.toFixed(1)},${centred.dy.toFixed(1)} (tolerance ${LOAD_CENTRE_TOLERANCE_PX}px)`);
      }
      await selectHeroAndHover(page);
      await clearToasts(page);
      await captureAndCompare("load-path-adventure", page);
    });

    await runBattleArenaScene(context, "battle-arena-legacy", "/?paint=legacy");
    const scenebuilderPng = await runBattleArenaScene(context, "battle-arena-scenebuilder", "/?paint=scenebuilder");
    const defaultPng = await runBattleArenaScene(context, "battle-arena-default", "");
    const crossDiff = diffPngBuffers(defaultPng, scenebuilderPng);
    results.push({ name: "battle-arena-default-vs-scenebuilder", ok: crossDiff.ok, reason: crossDiff.reason, mismatchRatio: crossDiff.mismatchRatio });
    console.log(`>> [${crossDiff.ok ? "OK" : "FAIL"}] battle-arena-default-vs-scenebuilder${marginDetail(crossDiff)}${crossDiff.reason ? ` -- ${crossDiff.reason}` : ""}`);

    const marginScenes = results.filter((r): r is SceneResult & { mismatchRatio: number } => r.mismatchRatio != null);
    if (marginScenes.length > 0) {
      const tightest = marginScenes.reduce((a, b) => (b.mismatchRatio < a.mismatchRatio ? b : a));
      const headroom = 1 - tightest.mismatchRatio / MISMATCH_RATIO_THRESHOLD;
      console.log(`>> least headroom: ${tightest.name} -- mismatch ${(tightest.mismatchRatio * 100).toFixed(3)}% (headroom ${(headroom * 100).toFixed(1)}% of the ${(MISMATCH_RATIO_THRESHOLD * 100).toFixed(1)}% budget)`);
    }

    const failed = results.filter((r) => !r.ok);
    if (UPDATE_BASELINES) {
      console.log(`>> baselines written for ${results.length} scene(s) -- justify this churn in the PR description`);
      exitCode = 0;
    } else if (failed.length > 0) {
      console.error(`>> ${failed.length}/${results.length} scene(s) failed: ${failed.map((f) => f.name).join(", ")}`);
      exitCode = 2;
    } else {
      console.log(`>> all ${results.length} scene(s) matched their baselines`);
      exitCode = 0;
    }
  } catch (e) {
    console.error(">> threw:", e);
    exitCode = 3;
  } finally {
    if (browser) await browser.close();
    cleanup();
    process.exit(exitCode);
  }
}

run();
