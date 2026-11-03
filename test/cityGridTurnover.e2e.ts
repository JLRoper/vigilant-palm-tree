// The city-view build palette's affordability feedback, driven END-TO-END
// through the real client (0.37.2, the turnover tip).
//
// The unit specs in test/screens/settlements/ drive the REAL BuildingPlacer
// directly, so they pin the placer's half of this behaviour (a bare click
// places from its own coordinates; a cart refusal states the shortfall; an open
// palette re-renders from a new snapshot). What they cannot reach is the WIRING
// between the treasury and the open palette: cityView subscribes to the bus
// (`turn:ended` / `state:committed` -> syncAffordability -> refreshAffordability
// -> placer.setAffordability, which re-renders the rows). Drop that
// subscription and every unit spec still passes while a player watching the
// palette sees every row stay dimmed at "Not enough gold (need 300, have 0)"
// until they leave the city and re-enter it.
//
// Update 2026-11-03 (CITY P6, #344): the House's placementCost.gold moved
// 100 -> 300 (packages/engine/src/buildingRegistry.ts), so the figure this
// fixture pins is the registry's, not a constant of the day. The assertion
// below is unchanged in shape -- it still demands the row state the shortfall
// in the palette's own words -- and the expected number follows the registry.
//
// So this spec asserts against the browser, on a fresh settlers town whose
// treasury really is 0 (settlers founds with `gold: 0`):
//
//   1. the palette opens broke, and the House row reads "have 0" dimmed;
//   2. End Turn WITH THE PALETTE OPEN flips that same panel's rows to
//      affordable -- no close, no reopen, asserted by node identity;
//   3. a bare canvas click (no preceding mousemove) places on the clicked cell
//      and a PlaceBuildings command reaches the server;
//   4. a placement the treasury cannot cover states the shortfall in the
//      palette, sends nothing, and that line retires on the next End Turn.
//
// Determinism: measured on the round-3 playthrough that a `▶ End Turn` click is
// dropped now and then, so every turn here polls `getState().day` and re-clicks
// until it moves. Everything else is read back from the page, never assumed.
//
// Run directly (its own api+vite, fresh ports) with this worktree's own DB:
//   export PGDATABASE=game_play_<hex>   # the bare shared `game_poc` is not a test DB
//   npx tsx test/cityGridTurnover.e2e.ts

import { chromium, Browser, Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { GameDebugApi } from "../src/io/debugCommands";
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

/**
 * A free port picked by the kernel. NOT a fixed fallback: port 5173 is the
 * DEPLOYED Docker web (`game_web`, published 0.0.0.0:5173->80) on this box, and
 * a `vite --strictPort` that cannot bind there leaves the browser talking to
 * whatever already answers -- a built bundle from some earlier deploy, which
 * serves `index.html` for every module path. A suite that ran green against it
 * would be measuring the deployed app, not this worktree.
 */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || addr === null) {
        srv.close(() => reject(new Error("could not allocate a port")));
        return;
      }
      srv.close(() => resolve(addr.port));
    });
  });
}

// A wrapper (tools/run-test.mjs) or an explicit API_PORT/CLIENT_PORT wins; with
// neither, pick our own rather than inherit a port this box already serves.
const API_PORT = getApiPort(0) || (await pickFreePort());
const WEB_PORT = getClientPort(0) || (await pickFreePort());
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const children: ChildProcess[] = [];
let cleaned = false;

function startApi(): void {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT),
    CLIENT_PORT: String(WEB_PORT),
  }));
}

function startWeb(): void {
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {
    API_PORT: String(API_PORT),
  }));
}

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  console.log(">> Cleaning up subprocesses...");
  for (const c of children) if (c.pid != null) treeKill(c.pid);
  clearRegisteredPids();
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });

reapPreviousRunPids();

async function tailLog(label: string): Promise<string> {
  try { return readFileSync(`test/${label}.log`, "utf8").slice(-800); }
  catch { return "(no log)"; }
}

// ── page helpers ──────────────────────────────────────────────────────

type Db = GameDebugApi & { getHeroes?: () => Array<{ id: string; ownerId: number | null }> };

declare global {
  /**
   * The debug API, installed into the PAGE by installRecorder(). Every
   * `page.evaluate` callback here closes over this global rather than a
   * module-scope helper: Playwright serialises a callback's source into the
   * page, so a Node-side function is simply not there when it runs.
   */
  // eslint-disable-next-line no-var
  var dbg: () => Db;
}

async function day(page: Page): Promise<number> {
  return page.evaluate(() => dbg().getState().day);
}

/**
 * One `▶ End Turn`, retried until the game's own day counter moves. The button
 * is a real pointer click on a DOM node, so the drop is real; a dropped click
 * leaves the day where it was and we simply click again.
 */
async function endTurn(page: Page): Promise<number> {
  const before = await day(page);
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.locator("button").filter({ hasText: "End Turn" }).first().click();
    await wait(900);
    const now = await day(page);
    if (now !== before) return now;
  }
  throw new Error(`End Turn never advanced the day past ${before}`);
}

/** Click a chip button by the label of the form row it sits in. */
async function clickChip(page: Page, rowLabel: string, chipText: string): Promise<void> {
  const point = await page.evaluate(([labelText, wanted]) => {
    const label = Array.from(document.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && (el.textContent ?? "").trim().toLowerCase().startsWith(labelText.toLowerCase()),
    );
    if (!label) return null;
    let node: Element | null = label;
    while (node && !Array.from(node.querySelectorAll("button")).some((b) => b.textContent?.trim() === wanted)) {
      node = node.parentElement;
    }
    if (!node) return null;
    const btn = Array.from(node.querySelectorAll("button")).find((b) => b.textContent?.trim() === wanted)!;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [rowLabel, chipText]);
  if (!point) throw new Error(`chip "${chipText}" in row "${rowLabel}" not found`);
  await page.mouse.click(point.x, point.y);
  await wait(200);
}

/** The palette's root element (a body child), or null. */
function paletteRoot(): Element | null {
  return Array.from(document.body.children).find((el) => el.textContent?.includes("Building Palette")) ?? null;
}

interface RowRead {
  title: string;
  opacity: string;
}

/** The House row's title + dim state, read straight off the palette DOM. */
async function houseRow(page: Page): Promise<RowRead | null> {
  return page.evaluate(() => {
    const palette = Array.from(document.body.children).find((el) => el.textContent?.includes("Building Palette"));
    if (!palette) return null;
    const rows = Array.from(palette.querySelectorAll("button")).filter((b) => (b.title ?? "").length > 0);
    const house = rows.find((b) => (b.textContent ?? "").includes("House"));
    if (!house) return null;
    return { title: house.title, opacity: getComputedStyle(house).opacity };
  });
}

/** The palette's own refusal line, or null when nothing is being refused. */
async function notice(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('[data-testid="palette-notice"]')?.textContent ?? null);
}

/** Arm a build row: scroll the build list to it, then a real pointer click. */
async function armRow(page: Page, label: string): Promise<void> {
  const point = await page.evaluate((wanted: string) => {
    const palette = Array.from(document.body.children).find((el) => el.textContent?.includes("Building Palette"));
    if (!palette) return null;
    const rows = Array.from(palette.querySelectorAll("button")).filter((b) => (b.title ?? "").length > 0);
    const row = rows.find((b) => (b.textContent ?? "").includes(wanted));
    if (!row) return null;
    const scroller = row.parentElement as HTMLElement | null;
    if (scroller) {
      // Scroll in the SCROLLER's own space, from the live rects: the rows'
      // offsetTop is measured against the palette root (the scroller is not
      // positioned), so `offsetTop - 60` aimed at a row that only stayed
      // clickable while the write clamped at the list's end. A row near the
      // top (the 80g Farmhouse, step 3) was scrolled clean out of view and the
      // click then armed nothing.
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60;
    }
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!point) throw new Error(`palette row "${label}" not found`);
  await page.mouse.click(point.x, point.y);
  await wait(250);
}

/**
 * A free grid cell, and the canvas point at its centre, from the APP'S OWN
 * geometry (`/src/core/cityGrid.ts` + the live toolbar height) rather than a
 * copy of the maths here.
 */
async function freeCell(page: Page, settlementId: string): Promise<{ gx: number; gy: number; x: number; y: number }> {
  const cell = await page.evaluate((sid: string) => {
    const s = (dbg().getGameState() as { settlements: Record<string, { level: number; buildings?: Array<{ gx: number; gy: number; w?: number; h?: number }> }> }).settlements[sid];
    const size = s.level === 1 ? 5 : s.level === 2 ? 10 : 15;
    const taken = s.buildings ?? [];
    const centre = Math.floor(size / 2);
    for (let gx = 0; gx < size; gx++) {
      for (let gy = 0; gy < size; gy++) {
        if (gx === centre && gy === centre) continue; // reserved
        const covered = taken.some((b) => {
          const w = b.w ?? 1;
          const h = b.h ?? 1;
          return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
        });
        if (!covered) return { gx, gy, size };
      }
    }
    return null;
  }, settlementId);
  if (!cell) throw new Error("no free cell on the city grid");

  const point = await page.evaluate(async (c: { gx: number; gy: number; size: number }) => {
    const gridPath = "/src/core/cityGrid.ts";
    const railPath = "/src/screens/shared/panelRail.ts";
    const grid = await import(gridPath) as { cityLayout: Function; cellToScreen: Function };
    const rail = await import(railPath) as { toolbarHeight: () => number };
    const layout = grid.cityLayout(c.size, window.innerWidth, window.innerHeight, rail.toolbarHeight());
    const local = grid.cellToScreen(c.gx, c.gy, layout.gridOrigin);
    return {
      x: layout.screenOrigin.x + local.x * layout.tileScale,
      y: layout.screenOrigin.y + local.y * layout.tileScale,
    };
  }, cell);

  return { gx: cell.gx, gy: cell.gy, x: point.x, y: point.y };
}

/** Buildings of a settlement, from the page's own state. */
async function buildings(page: Page, settlementId: string): Promise<Array<{ gx: number; gy: number; kind: string }>> {
  return page.evaluate((sid: string) => {
    const s = (dbg().getGameState() as { settlements: Record<string, { buildings?: Array<{ gx: number; gy: number; kind: string }> }> }).settlements[sid];
    return (s?.buildings ?? []).map((b) => ({ gx: b.gx, gy: b.gy, kind: b.kind }));
  }, settlementId);
}

/** The kinds of command the client POSTed to /commands, in order. */
async function commandKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const log = (window as unknown as { __reqLog?: Array<{ url: string; body: string }> }).__reqLog;
    if (!log) return [];
    return log
      .filter((r) => r.url.includes("/commands"))
      .map((r) => { try { return JSON.parse(r.body).kind as string; } catch { return "unparsed"; } });
  });
}

/** The bus events the page has seen, in order (see installRecorder). */
async function busEvents(page: Page): Promise<Array<{ t: string; day: number }>> {
  return page.evaluate(() => (window as unknown as { __busLog?: Array<{ t: string; day: number }> }).__busLog ?? []);
}

/** Record every non-GET request, and the two bus events the palette rides on. */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Hand the debug API to the page's global scope so later evaluate()
    // callbacks can reach it by a name they share with this module.
    (window as unknown as { dbg: () => Db }).dbg = () =>
      (window as unknown as { __gameDebug: Db }).__gameDebug;
    // Subscribe to the SAME bus module instance the app uses (Vite serves one
    // URL, so the dynamic import here and the app's static import resolve to
    // one module), to see whether the events the palette refresh rides on
    // actually fire.
    const evPath = "/src/core/eventBus.ts";
    const ev = await import(evPath) as { bus: { on: (t: string, fn: () => void) => void } };
    const log: Array<{ t: string; day: number }> = [];
    (window as unknown as { __busLog: typeof log }).__busLog = log;
    for (const t of ["turn:ended", "state:committed"]) {
      ev.bus.on(t, () => {
        const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
        log.push({ t, day: d ? d.getState().day : -1 });
      });
    }
    const w = window as unknown as { __reqLog?: unknown[]; __origFetch?: typeof fetch };
    if (w.__origFetch) return;
    w.__reqLog = [];
    w.__origFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      const init = (args[1] ?? {}) as RequestInit;
      const r = await w.__origFetch!(...args);
      let body = "";
      try { body = await r.clone().text(); } catch { /* body already consumed */ }
      w.__reqLog!.push({ url, method: init.method ?? "GET", body: (init.body as string) ?? "", status: r.status, resp: body.slice(0, 300) });
      return r;
    };
  });
}

// ── the pass ──────────────────────────────────────────────────────────

async function createSettlersGame(page: Page, name: string): Promise<void> {
  console.log(">> Creating a settlers game through the New Game form");
  await page.locator("button").filter({ hasText: /^New Game$/ }).first().click();
  await wait(500);
  await page.locator('input[type="text"]').first().fill(name);
  await clickChip(page, "Game mode", "Settlers (wagon founding)");
  await clickChip(page, "Number of AI enemies", "0");
  await page.locator('input[type="checkbox"]').first().uncheck({ force: true }).catch(() => {});
  await page.locator("button").filter({ hasText: /^Create Game$/ }).first().click();
  await page.waitForFunction(
    (want: string) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === want,
    name,
    { timeout: 30000 },
  );
  await wait(600);
  assert.equal(await page.evaluate(() => (dbg().getState() as { gameMode?: string }).gameMode), "settlers");
}

async function foundSettlement(page: Page): Promise<string> {
  console.log(">> Selecting the seat wagon and founding");
  const wagon = await page.evaluate(() => {
    const heroes = dbg().getHeroes?.() ?? [];
    return (heroes.find((h) => h.ownerId === 0) ?? heroes[0])?.id ?? null;
  });
  assert.ok(wagon, "the settlers seat wagon must exist");
  await page.evaluate((id: string) => dbg().setSelectedHero(id), wagon!);

  // The toolbar's Found Settlement stays disabled until a dirty-keyed refresh
  // (an End Turn) repaints it, so found in a bounded retry loop.
  for (let attempt = 0; attempt < 4; attempt++) {
    await endTurn(page);
    const found = page.locator("button").filter({ hasText: "Found Settlement" }).first();
    if (await found.isEnabled()) {
      await found.click();
      await wait(1200);
    }
    const owned = await page.evaluate(() =>
      (dbg().getSettlements() as Array<{ id: string; ownerId: number | null }>).find((s) => s.ownerId === 0),
    );
    if (owned) {
      console.log(`>> Founded ${owned.id}`);
      return owned.id;
    }
  }
  throw new Error("Found Settlement never produced an owned settlement");
}

async function openCityView(page: Page, settlementId: string): Promise<void> {
  // The camera does NOT follow the selection, so `screenFor` can land off the
  // viewport; dispatch the DOM dblclick the engine listens for instead of a
  // synthetic pointer move that cannot leave it.
  await page.evaluate((sid: string) => {
    const s = (dbg().getGameState() as { settlements: Record<string, { q: number; r: number }> }).settlements[sid];
    const p = dbg().screenFor(s.q, s.r);
    const canvas = document.getElementById("game")!;
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window }));
  }, settlementId);
  await page.waitForFunction(() =>
    Array.from(document.body.children).some((el) => el.textContent?.includes("City Design")),
    null,
    { timeout: 10000 },
  );
  await wait(500);
}

async function run() {
  console.log(`>> Starting infrastructure on API=${API_PORT} WEB=${WEB_PORT} ...`);
  startApi();
  startWeb();

  let browser: Browser | undefined;
  let failed = false;

  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    await waitForApiHealth(API_URL);
    console.log(">> API + Web ready");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => console.log("[page exception]", e.message));
    await page.goto(WEB_URL);
    await wait(1500);

    // Guard: the web we are driving must be THIS worktree's Vite. The deployed
    // Docker web (`game_web`) answers /src/*.ts with text/html, so a suite that
    // lost the port race would silently measure an older build.
    const moduleType = await page.evaluate(async () => {
      const r = await fetch("/src/core/eventBus.ts");
      return r.headers.get("content-type") ?? "";
    });
    assert.match(
      moduleType,
      /javascript/,
      `the web under test must serve source modules (got "${moduleType}") -- another server owns ${WEB_PORT}`,
    );

    await page.waitForFunction(() => !!(window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug, { timeout: 60000 });
    await wait(500);
    await installRecorder(page);

    const gameName = `citygrid-turnover-${Date.now().toString(36)}`;
    await createSettlersGame(page, gameName);
    const settlementId = await foundSettlement(page);
    await openCityView(page, settlementId);

    // ── 1. the palette opens on a treasury of exactly 0 ────────────────
    console.log(">> Opening the build palette with the treasury at 0");
    await page.keyboard.press("b");
    await wait(400);
    assert.ok(await page.evaluate(paletteRoot), "the build palette must open on B");

    const goldAtOpen = await page.evaluate((sid: string) =>
      (dbg().getState() as { settlements: Record<string, { gold: number }> }).settlements[sid].gold, settlementId);
    assert.equal(goldAtOpen, 0, "a settlers town founds with a treasury of exactly 0");

    const brokeRow = await houseRow(page);
    assert.ok(brokeRow, "the House row must be listed");
    assert.match(brokeRow!.title, /Not enough gold \(need 300, have 0\)/, `House row should state the shortfall, got "${brokeRow!.title}"`);
    assert.equal(brokeRow!.opacity, "0.5", "an unaffordable row is dimmed");
    console.log(`>> House row broke: "${brokeRow!.title.split("\n")[0]}" (opacity ${brokeRow!.opacity}) ✓`);

    // Pin the palette ROOT so a close-and-reopen cannot pass as "in place".
    await page.evaluate(() => {
      const palette = Array.from(document.body.children).find((el) => el.textContent?.includes("Building Palette"));
      (window as unknown as { __paletteRoot?: Element }).__paletteRoot = palette ?? undefined;
    });

    // ── 2. End Turn with the palette open: the rows recover IN PLACE ────
    const dayBefore = await day(page);
    const goldBeforeTurn = await page.evaluate((sid: string) =>
      (dbg().getState() as { settlements: Record<string, { gold: number }> }).settlements[sid].gold, settlementId);
    const busBefore = (await busEvents(page)).length;
    console.log(`>> End Turn (day ${dayBefore}) with the palette open`);
    const dayAfter = await endTurn(page);
    const goldAfterTurn = await page.evaluate((sid: string) =>
      (dbg().getState() as { settlements: Record<string, { gold: number }> }).settlements[sid].gold, settlementId);

    // The refresh rides on the bus: assert the event the wiring needs actually
    // fired, or a "recovered" row could just as well have come from a remount.
    const fired = (await busEvents(page)).slice(busBefore);
    assert.ok(
      fired.some((e) => e.t === "turn:ended"),
      `the End Turn must emit turn:ended -- the event the open palette's refresh rides on (saw ${JSON.stringify(fired)})`,
    );
    assert.ok(
      dayAfter > dayBefore && goldAfterTurn > goldBeforeTurn,
      `the treasury must move under the palette: day ${dayBefore} -> ${dayAfter}, gold ${goldBeforeTurn} -> ${goldAfterTurn}`,
    );

    const stillOpen = await page.evaluate(() => {
      const root = (window as unknown as { __paletteRoot?: Element }).__paletteRoot;
      return !!root && document.body.contains(root) && !!root.textContent?.includes("Building Palette");
    });
    assert.ok(stillOpen, "the SAME palette node must still be open -- no close and reopen");

    const recovered = await houseRow(page);
    assert.ok(recovered, "the House row must survive the refresh");
    assert.doesNotMatch(recovered!.title, /Not enough/, `the row must recover in place, still reads "${recovered!.title}"`);
    assert.equal(recovered!.opacity, "1", "the row is clickable again without a reopen");
    console.log(`>> Day ${dayBefore} -> ${dayAfter}, gold ${goldBeforeTurn} -> ${goldAfterTurn}; House row now "${recovered!.title.split("\n")[0]}" (opacity ${recovered!.opacity}) ✓`);

    // ── 3. a BARE canvas click places from its own coordinates ──────────
    // A Farmhouse, not the House this fixture armed before 2026-11-03: CITY P6
    // (#344) tripled the House's placementCost.gold to 300, and the End Turn
    // above brings 500 gold. A House would leave 200 in the treasury, and step 4
    // places a Tower (300) before asserting an unaffordable click stages
    // nothing -- so the Tower could never be placed and step 4's
    // `before.length + 2` count failed (measured on github/main 17fd1ca:
    // "an unaffordable click stages nothing", 1 !== 2). The Farmhouse (80g, 1x1,
    // the building the district fixtures place) leaves 420, which keeps the
    // Tower's placement affordable and step 4's refusal arithmetic unchanged.
    // This case pins the BARE CLICK, not the House; the House row's own
    // shortfall and in-place recovery stay covered by steps 1-2 above.
    console.log(">> Arming Farmhouse, then a bare canvas click with no mousemove");
    await armRow(page, "Farmhouse");
    const before = await buildings(page, settlementId);
    const target = await freeCell(page, settlementId);
    const cmdsBefore = (await commandKinds(page)).length;

    await page.evaluate((p: { x: number; y: number }) => {
      // ONLY a click -- no mousemove has set the placer's hover cell.
      document.getElementById("game")!.dispatchEvent(
        new MouseEvent("click", { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window, button: 0 }),
      );
    }, { x: target.x, y: target.y });
    await wait(1500);

    const after = await buildings(page, settlementId);
    assert.equal(after.length, before.length + 1, "a bare click must place exactly one building");
    const placed = after.find((b) => b.gx === target.gx && b.gy === target.gy);
    assert.ok(placed, `the bare click must land on the cell it was dispatched at (${target.gx},${target.gy}), got ${JSON.stringify(after)}`);
    assert.equal(placed!.kind, "farmhouse");

    const cmds = await commandKinds(page);
    assert.ok(cmds.length > cmdsBefore, "the placement must POST a command");
    assert.equal(cmds[cmds.length - 1], "PlaceBuildings", `the placement's own command must reach the server, got ${cmds.slice(-3).join(" -> ")}`);
    console.log(`>> Farmhouse placed at (${target.gx},${target.gy}) from a bare click; ${cmds[cmds.length - 1]} sent ✓`);

    // ── 4. a placement the treasury cannot cover ───────────────────────
    console.log(">> Driving the treasury below a Tower's price, then clicking again");
    await armRow(page, "Tower"); // 300g
    const towerCell = await freeCell(page, settlementId);
    await page.evaluate((p: { x: number; y: number }) => {
      document.getElementById("game")!.dispatchEvent(
        new MouseEvent("click", { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window, button: 0 }),
      );
    }, { x: towerCell.x, y: towerCell.y });
    await wait(1500);

    const goldAfterTower = await page.evaluate((sid: string) =>
      (dbg().getState() as { settlements: Record<string, { gold: number }> }).settlements[sid].gold, settlementId);
    assert.ok(goldAfterTower < 300, `the Tower must have left less than its price in the treasury, got ${goldAfterTower}`);

    const cmdsBeforeRefusal = (await commandKinds(page)).length;
    const refusedCell = await freeCell(page, settlementId);
    await page.evaluate((p: { x: number; y: number }) => {
      document.getElementById("game")!.dispatchEvent(
        new MouseEvent("click", { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window, button: 0 }),
      );
    }, { x: refusedCell.x, y: refusedCell.y });
    await wait(1200);

    const refusal = await notice(page);
    assert.equal(
      refusal,
      `Not enough gold (need 300, have ${goldAfterTower})`,
      "the refusal must be stated in words, in the palette, reusing its own vocabulary",
    );
    const buildingsAfterRefusal = await buildings(page, settlementId);
    assert.equal(buildingsAfterRefusal.length, before.length + 2, "an unaffordable click stages nothing");
    assert.equal((await commandKinds(page)).length, cmdsBeforeRefusal, "an unaffordable click sends nothing");
    console.log(`>> Refusal stated in the palette: "${refusal}" (no command sent) ✓`);

    // ... and that line retires by itself on the next End Turn.
    console.log(">> End Turn: the refusal line must retire with its snapshot");
    await endTurn(page);
    const retired = await notice(page);
    assert.equal(retired, null, `the cart's refusal line must retire on the next reading, still reads "${retired}"`);
    assert.ok(await page.evaluate(paletteRoot), "the palette must still be open after the retire");
    console.log(">> Refusal line retired by itself, palette still open ✓");

    console.log("\n>> All city-grid turnover tests passed ✓");
  } catch (err) {
    failed = true;
    console.error("\n>> TEST FAILED:", (err as Error).message);
    console.error(">> API log:", await tailLog("api"));
    console.error(">> Web log:", await tailLog("web"));
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup();
    if (failed) process.exit(1);
  }
}

run();
