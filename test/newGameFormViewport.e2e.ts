// The Create Game form on a SHORT viewport: the button is reachable, and its
// click really creates the game the player asked for.
//
// Measured at the turnover tip (playthrough finding 20, harness default
// 1258x566): the home overlay was a centred fixed flex container with no
// overflow of its own, so the 669px-tall form card simply hung over both edges
// of a 566px viewport. `Create Game` sat 43px BELOW the fold,
// `document.elementFromPoint()` at its centre returned null, and assigning the
// overlay's `scrollTop = scrollHeight` left it at 0 -- there was no scroll to
// do. A real pointer click there was therefore a silent no-op: no toast, no
// error, no request. The player was left in the client's boot-created
// `starter-*` CLASSIC game while believing they had submitted a settlers form.
//
// So this spec pins the whole gesture at that viewport, on the real client:
//
//   1. the overlay that holds the form is SCROLLABLE (the finding's own
//      measurement: the container must be able to move);
//   2. once scrolled to, `Create Game` is inside the viewport and a hit test at
//      its centre lands ON the button -- the exact test that returned null;
//   3. clicking it POSTs exactly ONE new game, with the name and the game mode
//      the form was filled in with (not a starter classic), and the client
//      opens THAT game.
//
// Run directly (its own api+vite, kernel-picked ports) with this worktree's own DB:
//   PGDATABASE=game_poc_<slug> npx tsx test/newGameFormViewport.e2e.ts

import { chromium, Browser, Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
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

/** The harness default the finding was measured at. */
const VIEWPORT = { width: 1258, height: 566 };

/** A free port picked by the kernel (see test/cityGridTurnover.e2e.ts). */
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

const API_PORT = getApiPort(0) || (await pickFreePort());
const WEB_PORT = getClientPort(0) || (await pickFreePort());
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// This spec creates real games. A shared or neighbouring database is not a
// target (test/smoke.ts wipes the shared one; the turnover instance owns its
// own) -- refuse before the first side effect rather than write into it.
const DATABASE = process.env.PGDATABASE ?? "";
if (!DATABASE || DATABASE === "game_poc" || DATABASE.includes("turnover")) {
  console.error(
    `newGameFormViewport: REFUSING TO RUN -- PGDATABASE=${JSON.stringify(DATABASE)} is unset or shared.\n` +
      "Pass this worktree's own database, e.g. PGDATABASE=game_poc_<slug>.",
  );
  process.exit(2);
}

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

interface OverlayRead {
  found: boolean;
  scrollable: boolean;
  scrollHeight: number;
  clientHeight: number;
  scrolledTo: number;
}

/**
 * The form's own scroll container -- the nearest ancestor that can actually
 * scroll -- plus the finding's own measurement: setting its scrollTop to the
 * bottom must MOVE it.
 */
async function scrollOverlayToBottom(page: Page): Promise<OverlayRead> {
  return page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Create Game");
    if (!btn) throw new Error("Create Game button not found");
    let el: HTMLElement | null = btn.parentElement;
    while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)) {
      el = el.parentElement;
    }
    if (!el) return { found: false, scrollable: false, scrollHeight: 0, clientHeight: 0, scrolledTo: 0 };
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    return {
      found: true,
      scrollable: el.scrollTop > before,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrolledTo: el.scrollTop,
    };
  });
}

/** Where the button is, and what a hit test at its centre lands on. */
async function hitTestCreateGame(page: Page): Promise<{ top: number; bottom: number; hitText: string | null; innerHeight: number }> {
  return page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Create Game");
    if (!btn) throw new Error("Create Game button not found");
    btn.scrollIntoView({ block: "center" });
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      top: r.top,
      bottom: r.bottom,
      hitText: hit ? `${hit.tagName}: ${(hit.textContent ?? "").trim().slice(0, 40)}` : null,
      innerHeight: window.innerHeight,
    };
  });
}

async function run(): Promise<void> {
  console.log(`>> Starting infrastructure on API=${API_PORT} WEB=${WEB_PORT} (db ${DATABASE}) ...`);
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
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on("pageerror", (e) => console.log("[page exception]", e.message));

    // Every POST /games this page makes, in order: the client's own boot-time
    // starter plus whatever the form's Create Game sends.
    const creates: Array<{ name?: string; gameMode?: string }> = [];
    page.on("request", (req) => {
      if (req.method() !== "POST" || !req.url().endsWith("/games")) return;
      try { creates.push(req.postDataJSON() as { name?: string; gameMode?: string }); }
      catch { creates.push({}); }
    });

    await page.goto(WEB_URL);
    await wait(1500);

    // Guard: the web we are driving must be THIS worktree's Vite. The deployed
    // Docker web (`game_web`, 5173) answers /src/*.ts with text/html.
    const moduleType = await page.evaluate(async () => {
      const r = await fetch("/src/core/eventBus.ts");
      return r.headers.get("content-type") ?? "";
    });
    assert.match(
      moduleType,
      /javascript/,
      `the web under test must serve source modules (got "${moduleType}") -- another server owns ${WEB_PORT}`,
    );

    await page.waitForFunction(() => !!(window as unknown as { __gameDebug?: unknown }).__gameDebug, { timeout: 60000 });
    await wait(500);

    // ── 1. open the form at 1258x566 ────────────────────────────────────
    console.log(`>> Opening New Game at ${VIEWPORT.width}x${VIEWPORT.height}`);
    await page.locator("button").filter({ hasText: /^New Game$/ }).first().click();
    await page.locator("button").filter({ hasText: /^Create Game$/ }).first().waitFor({ state: "attached", timeout: 10000 });
    await wait(400);

    // ── 2. the overlay that holds the form is SCROLLABLE ────────────────
    const overlay = await scrollOverlayToBottom(page);
    assert.equal(
      overlay.found,
      true,
      "the form must sit in a container that can scroll: on a 566px-tall viewport the overlay overflows with no scroll of its own (the finding's own measurement)",
    );
    assert.equal(
      overlay.scrollable,
      true,
      `the container must scroll while it overflows: scrollHeight ${overlay.scrollHeight} vs clientHeight ${overlay.clientHeight}, scrollTop stuck at ${overlay.scrolledTo}`,
    );
    console.log(`>> Form container scrolls (${overlay.clientHeight} -> ${overlay.scrollHeight}, scrolled to ${overlay.scrolledTo}) ✓`);

    // ── 3. Create Game is inside the viewport and hit-testable ──────────
    const hit = await hitTestCreateGame(page);
    assert.ok(
      hit.top >= 0 && hit.bottom <= hit.innerHeight,
      `Create Game must be inside the viewport (top ${hit.top}, bottom ${hit.bottom}, innerHeight ${hit.innerHeight})`,
    );
    assert.ok(
      hit.hitText?.includes("Create Game"),
      `a hit test at the button's centre must land on it, got ${JSON.stringify(hit.hitText)}`,
    );
    console.log(`>> Create Game reachable: y ${hit.top.toFixed(1)}..${hit.bottom.toFixed(1)} of ${hit.innerHeight}; hit test -> ${hit.hitText} ✓`);

    // ── 4. the click really creates the game the form asked for ─────────
    const gameName = `newgame-viewport-${Date.now().toString(36)}`;
    const beforeClick = creates.length;
    await page.locator('input[type="text"]').first().fill(gameName);
    await clickChip(page, "Game mode", "Settlers (wagon founding)");
    await clickChip(page, "Number of AI enemies", "0");
    await page.locator('input[type="checkbox"]').first().uncheck({ force: true }).catch(() => {});
    await page.locator("button").filter({ hasText: /^Create Game$/ }).first().click();

    await page.waitForFunction(
      (want: string) => (window as unknown as { __gameDebug?: { activeGameName?: string } }).__gameDebug?.activeGameName === want,
      gameName,
      { timeout: 30000 },
    );
    await wait(600);

    const submitted = creates.slice(beforeClick);
    assert.equal(
      submitted.length,
      1,
      `Create Game must submit exactly one game (a silent no-op sent none, the starter path sends a classic); saw ${JSON.stringify(submitted)}`,
    );
    assert.equal(submitted[0].name, gameName, "the submitted game must be the one the form was filled in with");
    assert.equal(submitted[0].gameMode, "settlers", "the submitted game must carry the mode the form picked");
    assert.equal(
      await page.evaluate(() => (window as unknown as { __gameDebug?: { getState: () => { gameMode?: string } } }).__gameDebug?.getState().gameMode),
      "settlers",
      "the client must open the settlers game it just created",
    );
    console.log(`>> Create Game submitted ${submitted[0].name} (gameMode ${submitted[0].gameMode}) and opened it ✓`);

    console.log("\n>> All new-game-form viewport tests passed ✓");
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
