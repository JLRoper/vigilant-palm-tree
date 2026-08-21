// Visual-regression gate for plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §9's "canvas-render screenshot diffs vs. previous render path" requirement
// (issue #149). Captures a fixed replay set from deterministic game states and
// diffs each screenshot against a committed baseline in
// test/visual-baselines/. Run standalone with `npm run test:visual`, or
// `npm run test:visual:update-baselines` to (re)write the baselines -- baseline
// churn must be justified in the PR description, per the issue's own ask.

import { chromium, Browser, Page, BrowserContext, request as pwRequest } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { resolve } from "node:path";
import {
  getApiPort,
  getClientPort,
  shouldUpdateBaselines,
  spawnLogged,
  waitForUrl,
  treeKill,
  reapPreviousRunPids,
  clearRegisteredPids,
} from "./_request";
import { comparePng, diffPngBuffers } from "./render/pixelDiff";

const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const BASELINE_DIR = resolve(process.cwd(), "test", "visual-baselines");
const UPDATE_BASELINES = shouldUpdateBaselines();

const SEED = 90210;
const RNG_SEED = 424242;
const GAME_NAME = "visual-regression-149";

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
  await page.goto(`${WEB_URL}${urlSuffix}`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => (window as unknown as { __gameDebug?: { activeGameName?: string } }).__gameDebug?.activeGameName != null,
    null,
    { timeout: 20_000 },
  );
  return page;
}

interface Dbg {
  getGameState: () => any;
  getHeroes: () => any[];
  getSettlements: () => any[];
  setSelectedHero: (id: string) => void;
  isPassable: (q: number, r: number) => boolean;
  screenFor: (q: number, r: number) => { x: number; y: number };
  debugInjectCharter: (heroId: string, targetQ: number, targetR: number, phase: "traveling" | "constructing", name: string) => boolean;
  settings: { update: (patch: Record<string, unknown>) => void };
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
  await page.locator("button", { hasText: "Create Game" }).click();
  await wait(1000);

  const active = await page.evaluate(() => (window as unknown as { __gameDebug?: { activeGameName?: string } }).__gameDebug?.activeGameName);
  if (active !== name) throw new Error(`New Game failed: activeGameName=${active}`);
}

interface SceneResult {
  name: string;
  ok: boolean;
  reason?: string;
}

const results: SceneResult[] = [];

async function captureAndCompare(name: string, page: Page): Promise<Buffer> {
  const png = await page.locator("canvas").last().screenshot();
  const baselinePath = resolve(BASELINE_DIR, `${name}.png`);
  const diff = comparePng(baselinePath, png, { updateBaseline: UPDATE_BASELINES });
  results.push({ name, ok: diff.ok, reason: diff.reason });
  console.log(`>> [${diff.ok ? "OK" : "FAIL"}] ${name}${diff.reason ? ` -- ${diff.reason}` : ""}`);
  return png;
}

// ── Adventure overview + charter phases + city view (one continuous game) ──

async function runGameScenes(context: BrowserContext): Promise<void> {
  const page = await newPage(context);
  await dismissHomeAndCreateGame(page, GAME_NAME, SEED);

  const heroes = await page.evaluate(() => (window as unknown as { __gameDebug: Dbg }).__gameDebug.getHeroes());
  const playerHero = heroes.find((h: any) => h.ownerId === 0);
  if (!playerHero) throw new Error("no player hero in fixed game");

  await page.evaluate((id) => (window as unknown as { __gameDebug: Dbg }).__gameDebug.setSelectedHero(id), playerHero.id);
  await wait(300);

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
  await captureAndCompare("adventure-overview", page);

  // ── Charter: traveling / constructing ──
  // Injected directly via debugInjectCharter rather than driven through the
  // real startCharter command: that command's server-side persistence is
  // gated on the game's storage having been migrated to granular entity
  // tables (server/app/commandHandler.ts's StartCharter case, "Source gate
  // FIRST" comment) -- a fresh game here is JSONB-backed, so a real
  // StartCharter round-trip always fails with charters_persist_unavailable.
  // The charter overlay only ever reads targetQ/targetR/phase to render
  // (CharterPainter.ts / adventureScene.ts), so the injected object is
  // exactly as good a fixture as a persisted one for this screenshot.
  const settlements = await page.evaluate(() => (window as unknown as { __gameDebug: Dbg }).__gameDebug.getSettlements());
  const homeSettlement = settlements.find((s: any) => s.ownerId === 0);
  if (!homeSettlement) throw new Error("no player-owned settlement in fixed game");

  const charterTarget = await page.evaluate(({ q, r }) => {
    const d = (window as unknown as { __gameDebug: Dbg }).__gameDebug;
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

  await page.evaluate(
    ({ heroId, q, r }) => (window as unknown as { __gameDebug: Dbg }).__gameDebug.debugInjectCharter(heroId, q, r, "traveling", "Outpost"),
    { heroId: playerHero.id, q: charterTarget.q, r: charterTarget.r },
  );
  await wait(300);
  await captureAndCompare("charter-traveling", page);

  await page.evaluate(
    ({ heroId, q, r }) => (window as unknown as { __gameDebug: Dbg }).__gameDebug.debugInjectCharter(heroId, q, r, "constructing", "Outpost"),
    { heroId: playerHero.id, q: charterTarget.q, r: charterTarget.r },
  );
  await wait(300);
  await captureAndCompare("charter-constructing", page);

  // ── City view: parallax on/off ──
  const coords = await page.evaluate(
    ({ q, r }) => (window as unknown as { __gameDebug: Dbg }).__gameDebug.screenFor(q, r),
    { q: homeSettlement.q, r: homeSettlement.r },
  );
  await page.mouse.click(coords.x, coords.y);
  await wait(150);
  await page.mouse.dblclick(coords.x, coords.y);
  await wait(600);

  await page.evaluate(() => (window as unknown as { __gameDebug: Dbg }).__gameDebug.settings.update({ parallaxEnabled: true }));
  await wait(300);
  await captureAndCompare("city-view-parallax-on", page);

  await page.evaluate(() => (window as unknown as { __gameDebug: Dbg }).__gameDebug.settings.update({ parallaxEnabled: false }));
  await wait(300);
  await captureAndCompare("city-view-parallax-off", page);

  await page.close();
}

// ── Battle arena: legacy paint path vs. the ?paint=scenebuilder path ──
// First real regression check for #143's double-paint bug -- the two
// screenshots below are diffed against each other, not just their own
// baselines.

async function runBattleArenaScene(
  context: BrowserContext,
  name: string,
  urlSuffix: string,
): Promise<Buffer> {
  const page = await newPage(context, urlSuffix);
  await dismissHomeAndCreateGame(page, `${GAME_NAME}-${name}`, SEED);

  const testBattleBtn = page.locator("#toolbar button", { hasText: "Test Battle" });
  await testBattleBtn.click();
  await page.locator("button", { hasText: "Start Battle" }).click({ timeout: 15_000 });
  await wait(500);

  const png = await captureAndCompare(name, page);
  await page.close();
  return png;
}

async function run(): Promise<void> {
  let exitCode = 1;
  let browser: Browser | undefined;
  try {
    startApi();
    startWeb();
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });

    await runGameScenes(context);

    const legacyPng = await runBattleArenaScene(context, "battle-arena-legacy", "");
    const scenebuilderPng = await runBattleArenaScene(context, "battle-arena-scenebuilder", "/?paint=scenebuilder");
    const crossDiff = diffPngBuffers(legacyPng, scenebuilderPng);
    results.push({ name: "battle-arena-legacy-vs-scenebuilder", ok: crossDiff.ok, reason: crossDiff.reason });
    console.log(`>> [${crossDiff.ok ? "OK" : "FAIL"}] battle-arena-legacy-vs-scenebuilder${crossDiff.reason ? ` -- ${crossDiff.reason}` : ""}`);

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
