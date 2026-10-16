// Automated browser checks for the Log Message Panel
// (plan/2026-09-28-sse-event-push.md, use case 1) -- retires the last manual
// SSE checklist item. Boots its own API + vite client (same contract as
// cityView.test.ts: ports from local/.test-request.json, written by
// tools/run-test.mjs), then drives a real chromium page end to end:
// live SSE -> mp:logRow -> ring buffer -> DOM, settings persistence across
// reload, the 500-row ring cap, and Pause/Resume/Clear.
//
// Run standalone with `npm run test:logpanel`.

import { chromium, Browser, Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pool } from "../server/persistence/db";
import { LOG_PANEL_CAPACITY } from "../src/screens/shared/logPanel";
import {
  getApiPort,
  getClientPort,
  spawnLogged,
  waitForApiHealth,
  waitForUrl,
  treeKill,
  reapPreviousRunPids,
  clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

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

async function tailLog(label: string): Promise<string> {
  try { return readFileSync(`test/${label}.log`, "utf8").slice(-500); }
  catch { return "(no log)"; }
}

// ── Helpers ───────────────────────────────────────────────────────────

interface PanelStats {
  inDom: boolean;
  visible: boolean;
  rows: number;
  panelTestRows: number;
  hasNewest: boolean;
  hasPaused: boolean;
}

// Serialized into the page by page.evaluate -- must not close over node
// state. The panel root carries id="game-log-panel" (createLogPanel); its
// children are [header, list], and each buffered row is one div in the list.
function readPanelStats(): PanelStats {
  const root = document.getElementById("game-log-panel");
  if (!root) {
    return { inDom: false, visible: false, rows: 0, panelTestRows: 0, hasNewest: false, hasPaused: false };
  }
  const list = root.children[1] as HTMLElement | undefined;
  const rowTexts = list ? Array.from(list.children).map((c) => c.textContent ?? "") : [];
  return {
    inDom: true,
    visible: getComputedStyle(root).display !== "none",
    rows: rowTexts.length,
    panelTestRows: rowTexts.filter((t) => t.includes("panel_test")).length,
    hasNewest: rowTexts.some((t) => t.includes("panel_test_newest")),
    hasPaused: rowTexts.some((t) => t.includes("panel_test_paused")),
  };
}

async function waitForPanel(
  page: Page,
  pred: (s: PanelStats) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<PanelStats> {
  const deadline = Date.now() + timeoutMs;
  let last: PanelStats | null = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(readPanelStats);
    if (pred(last)) return last;
    await wait(250);
  }
  throw new Error(`log panel never ${what}; last stats: ${JSON.stringify(last)}`);
}

async function postEvent(gameName: string, kind: string, payload: Record<string, unknown>): Promise<number> {
  const res = await fetch(`${API_URL}/api/games/${encodeURIComponent(gameName)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });
  if (res.status !== 201) throw new Error(`POST events ${kind} -> ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { id: number };
  return body.id;
}

// One statement => one commit => one NOTIFY batch, so the SSE stream replays
// all of these in a single frame. Same pg env interpretation as the API
// (both import server/persistence/db).
async function bulkInsertEvents(gameName: string, count: number): Promise<number> {
  const g = await pool.query<{ id: number }>("SELECT id FROM games WHERE name = $1", [gameName]);
  if (g.rowCount !== 1) throw new Error(`game '${gameName}' not found in DB for bulk insert`);
  const r = await pool.query(
    `INSERT INTO game_events (game_id, kind, payload)
     SELECT $1, 'panel_bulk', jsonb_build_object('n', gs)
     FROM generate_series(1, $2) AS gs`,
    [g.rows[0].id, count],
  );
  return r.rowCount ?? 0;
}

// Home's own "Load Game" button, not the toolbar's hidden copy behind the
// overlay: home's root is appended to <body> after the toolbar, so it's the
// last match in document order (same reasoning as visualRegression's
// New Game click). Home's Load Game modal lists the localStorage game cache
// merged with the server list; the fresh browser context caches exactly one
// game (the starter auto-created in step 1), so the top "Open" is ours.
async function loadGameFromHome(page: Page): Promise<void> {
  await page.locator("button", { hasText: /^Load Game$/ }).last().click();
  await page.locator("button:visible", { hasText: /^Open$/ }).first().click({ timeout: 10_000 });
}

// Returns just the name: page.evaluate results are structured-cloned, so a
// DebugApi handle (with its function properties) can't cross the boundary.
function activeGameName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
    if (!d || d.activeGameName == null) throw new Error("__gameDebug.activeGameName is null");
    return d.activeGameName;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

async function run() {
  console.log(`>> Starting infrastructure on API=${API_PORT} WEB=${WEB_PORT} ...`);
  startApi();
  startWeb();

  let browser: Browser | undefined;
  let failed = false;
  let gameName: string | null = null;

  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    await waitForApiHealth(API_URL);
    console.log(">> API + Web ready");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") console.log(`[browser ${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (e) => console.log(`[browser pageerror] ${e.message}`));

    // Step 1: fresh boot. localStorage.clear() + reload makes the game cache
    // empty, so initBackend auto-creates a starter game (that's what turns
    // __gameDebug.activeGameName non-null -- there is no cached-game
    // auto-resume).
    // waitUntil "load", not "networkidle": once a session boots, its SSE event stream (/events/stream) holds a pending request forever, so networkidle can never fire.
    await page.goto(WEB_URL, { waitUntil: "load" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      () => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName != null,
      null,
      { timeout: 30_000 },
    );
    gameName = await activeGameName(page);
    console.log(`>> Step 1: session booted, active game '${gameName}' ✓`);

    // Step 2: enable the panel via the debug settings API (routes through
    // updateSettings -> localStorage["heroesJs.settings"]).
    await page.evaluate(() => {
      (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.settings.update({ showLogPanel: true });
    });
    const s2 = await waitForPanel(page, (s) => s.inDom && s.visible, "become visible after settings.update");
    assert.ok(s2.visible, "panel root must be visible once showLogPanel is on");
    console.log(">> Step 2: panel visible after settings.update({ showLogPanel: true }) ✓");

    // Step 3: seed 3 events from the node side; each must reach the DOM via
    // live SSE -> multiplayerSync.applyRows -> mp:logRow -> buffer -> render.
    for (let n = 1; n <= 3; n++) {
      const id = await postEvent(gameName, "panel_test", { n });
      console.log(`>> Step 3: inserted panel_test#${id} (n=${n})`);
    }
    const s3 = await waitForPanel(page, (s) => s.panelTestRows >= 3, "render the 3 seeded live rows");
    console.log(`>> Step 3: ${s3.panelTestRows} panel_test row(s) rendered live ✓`);

    // Step 4: settings persistence + backlog hydrate across a reload. A
    // reload with localStorage intact does NOT auto-load a game (initBackend
    // only auto-creates when the cache is empty), so re-enter through home's
    // Load Game flow; the panel must already be visible BEFORE that, purely
    // from the persisted setting.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      () => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug != null,
      null,
      { timeout: 30_000 },
    );
    const persisted = await page.evaluate(readPanelStats);
    assert.ok(persisted.inDom && persisted.visible, "panel must be visible right after reload without touching settings");
    console.log(">> Step 4a: panel visible after reload, setting persisted via localStorage ✓");

    await loadGameFromHome(page);
    await page.waitForFunction(
      (expected) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === expected,
      gameName,
      { timeout: 30_000 },
    );
    const s4 = await waitForPanel(page, (s) => s.panelTestRows >= 3, "hydrate the backlog after game reload");
    console.log(`>> Step 4b: game '${gameName}' reloaded, ${s4.panelTestRows} panel_test row(s) via backlog hydrate ✓`);

    // Step 5: capacity. 520 direct-SQL rows + 1 API row = 521 new events;
    // the ring must cap at LOG_PANEL_CAPACITY and keep the newest.
    const inserted = await bulkInsertEvents(gameName, 520);
    assert.strictEqual(inserted, 520, `bulk insert should add 520 rows, got ${inserted}`);
    const newestId = await postEvent(gameName, "panel_test_newest", { n: 521 });
    console.log(`>> Step 5: inserted 520 bulk rows + panel_test_newest#${newestId}`);
    const s5 = await waitForPanel(
      page,
      (s) => s.hasNewest && s.rows <= LOG_PANEL_CAPACITY,
      "cap at capacity while keeping the newest event",
      30_000,
    );
    assert.ok(s5.rows <= LOG_PANEL_CAPACITY, `panel must render at most ${LOG_PANEL_CAPACITY} rows, got ${s5.rows}`);
    assert.ok(s5.hasNewest, "newest event's kind must be present after the ring overflow");
    console.log(`>> Step 5: 521 events inserted, panel renders ${s5.rows}/${LOG_PANEL_CAPACITY} rows, newest kept ✓`);

    // Step 6: Pause / Resume / Clear.
    const beforePause = await page.evaluate(readPanelStats);
    await page.locator("#game-log-panel button", { hasText: /^Pause$/ }).click();
    assert.strictEqual(
      await page.locator("#game-log-panel button", { hasText: /^Resume$/ }).count(),
      1,
      "Pause button should now read Resume",
    );
    const pausedId = await postEvent(gameName, "panel_test_paused", { n: 522 });
    // Longer than SSE delivery + one 2s poll backstop, so the row is
    // genuinely delivered (and dropped by the frozen buffer) before we judge
    // the freeze.
    await wait(4000);
    const frozen = await page.evaluate(readPanelStats);
    assert.strictEqual(frozen.rows, beforePause.rows, "row count must not change while paused");
    assert.ok(!frozen.hasPaused, `panel_test_paused#${pausedId} must not render while paused`);
    console.log(`>> Step 6a: pause froze the buffer at ${frozen.rows} rows ✓`);

    await page.locator("#game-log-panel button", { hasText: /^Resume$/ }).click();
    const resumed = await waitForPanel(page, (s) => s.hasPaused, "surface the held event after resume");
    assert.ok(resumed.rows <= LOG_PANEL_CAPACITY, "resume's backlog refetch must respect capacity");
    console.log(`>> Step 6b: resume surfaced the held event via backlog refetch (${resumed.rows} rows) ✓`);

    await page.locator("#game-log-panel button", { hasText: /^Clear$/ }).click();
    await waitForPanel(page, (s) => s.rows === 0, "empty after Clear");
    await wait(3000);
    const stillCleared = await page.evaluate(readPanelStats);
    assert.strictEqual(stillCleared.rows, 0, "panel must stay empty after Clear (no stray re-hydration)");
    console.log(">> Step 6c: Clear emptied the panel and it stays empty ✓");

    console.log("\n>> All log panel tests passed ✓");
  } catch (err) {
    failed = true;
    console.error("\n>> TEST FAILED:", (err as Error).message);
    console.error(">> API log:", await tailLog("api"));
    console.error(">> Web log:", await tailLog("web"));
  } finally {
    // Step 7: cleanup -- delete this run's game via the API, then close
    // browser + spawned processes (cityView/smoke autoClose pattern).
    if (gameName) {
      try {
        const res = await fetch(`${API_URL}/api/games/${encodeURIComponent(gameName)}`, { method: "DELETE" });
        console.log(`>> Step 7: DELETE game '${gameName}' -> ${res.status}`);
      } catch (e) {
        console.error(`>> Step 7: cleanup DELETE failed: ${String(e)}`);
      }
    }
    if (browser) await browser.close().catch(() => {});
    try { await pool.end(); } catch { /* already ended */ }
    cleanup();
    if (failed) process.exit(1);
  }
}

run();
