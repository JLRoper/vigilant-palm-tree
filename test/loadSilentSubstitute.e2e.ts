// A LOAD THAT FAILS SILENTLY HANDS THE PLAYER A STRANGER'S GAME.
//
// Two playthrough cards reported the same moment from two directions:
//
//   (a) classic-core-loop: a Load with an EMPTY OR LOST PROFILE silently
//       quick-started a `starter-*` classic game -- twice in one session;
//   (b) city-view: a page reload silently dropped the player's OWN game from
//       Load Game, so their save was simply absent from the list, unsaid.
//
// Re-measured on f2f8299 / 0.39.3, both are real and one root cause: the client
// treated its localStorage cache (`heroesJs.userGames`) as the list of games
// that exist. Boot read the cache, and on an empty cache created a starter game
// -- on the real server -- that nobody asked for. The cache is per browser
// profile AND per origin, so a cleared profile, a private window, or a dev
// vite restart on a new port lost it and the account looked empty. Measured
// before the fix, in a foregrounded browser: boot made ZERO `GET /api/games`
// calls, POSTed `starter-mw08syvw`, claimed seat 0 and loaded it, while the
// player's own game sat on the server; Load Game listed only the starter. A
// reload with the cache lost created a SECOND starter (`starter-mw08tbre`).
// 257 of 298 games in the shared dev DB were `starter-*` -- this was the
// cheapest thing the client did.
//
// What this spec pins, on the real client:
//
//   1. boot against a profile that remembers NOTHING, with games on the server,
//      creates NO starter-* game -- the server's list is read first;
//   2. the player is not dropped into any game (nothing was loaded, so nothing
//      is substituted);
//   3. Load Game LISTS the player's own game and its Open really opens it;
//   4. a reload with the storage wiped again keeps all of that true.
//
// Run with this worktree's own database (never the shared `game_poc`):
//   PGDATABASE=game_poc_<slug> npx tsx test/loadSilentSubstitute.e2e.ts

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

// This spec creates a real game. A shared database is not a target: refuse
// before the first side effect rather than write into it.
const DATABASE = process.env.PGDATABASE ?? "";
if (!DATABASE || DATABASE === "game_poc") {
  console.error(
    `loadSilentSubstitute: REFUSING TO RUN -- PGDATABASE=${JSON.stringify(DATABASE)} is unset or shared.\n` +
      "Pass this worktree's own database, e.g. PGDATABASE=game_poc_<slug>.",
  );
  process.exit(2);
}

/** The game that belongs to the player, chosen to share no prefix with `starter-`. */
const OWN_GAME = "load-silent-own";

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
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });

reapPreviousRunPids();

async function tailLog(label: string): Promise<string> {
  try { return readFileSync(`test/${label}.log`, "utf8").slice(-1200); }
  catch { return "(no log)"; }
}

async function serverGames(): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(`${API_URL}/api/games`);
  assert.ok(res.ok, `GET /api/games must answer (${res.status})`);
  return (await res.json()) as Array<{ id: number; name: string }>;
}

interface LoadRow {
  text: string;
  openable: boolean;
}

/**
 * Open a Load Game dialog and read its rows: the text of each row, and whether
 * it offers Open (which only a game the server still has can).
 *
 * `surface` matters -- the two Load lists are separate UI over shared code
 * (both build from src/io/userGames.ts mergeLoadList): the landing page's
 * `Load Game` button, and the in-game toolbar's `📂 Load`.
 */
async function readLoadRows(page: Page, surface: "landing" | "toolbar"): Promise<{ panel: string; rows: LoadRow[] }> {
  await page
    .locator("button")
    .filter({ hasText: surface === "landing" ? /^Load Game$/ : /Load$/ })
    .last()
    .click();
  // The dialog is a FloatingPanel inside a z-index-300 wrapper (openDialog).
  await page.waitForFunction(
    () => [...document.querySelectorAll("div")].some((d) => (d.textContent ?? "").includes("Load Game") && (d.textContent ?? "").includes("Close")),
    null,
    { timeout: 15000 },
  );
  await wait(500);
  const read = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.textContent ?? "";
      return t.includes("Load Game") && t.includes("Close");
    });
    const owner = wrappers[wrappers.length - 1] as HTMLElement | undefined;
    if (!owner) return { panel: "", rows: [] as LoadRow[] };
    const rows: LoadRow[] = [];
    for (const open of [...owner.querySelectorAll("button")].filter((b) => ["Open", "Delete", "Forget"].includes(b.textContent?.trim() ?? ""))) {
      const row = open.closest("div")?.parentElement as HTMLElement | null;
      const text = (row?.innerText ?? "").replace(/\n+/g, " / ");
      if (rows.some((r) => r.text === text)) continue;
      rows.push({ text, openable: !!row?.querySelector("button") && /Open/.test(row?.innerText ?? "") });
    }
    return { panel: owner.innerText.replace(/\n+/g, " / "), rows };
  });
  await page.keyboard.press("Escape");
  await wait(300);
  return read;
}

function activeGameName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const name = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName;
    return typeof name === "string" ? name : null;
  });
}

async function run(): Promise<void> {
  console.log(`>> Starting infrastructure on API=${API_PORT} WEB=${WEB_PORT} (db ${DATABASE}) ...`);
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT),
    CLIENT_PORT: String(WEB_PORT),
  }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {
    API_PORT: String(API_PORT),
  }));

  let browser: Browser | undefined;
  let failed = false;

  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    await waitForApiHealth(API_URL);
    console.log(">> API + Web ready");

    // The player's own game, already on the server before the browser exists.
    const created = await fetch(`${API_URL}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: OWN_GAME,
        seed: 12345,
        hero_q: 6,
        hero_r: 5,
        enemy_positions: [{ q: 14, r: 8 }],
        mapSize: "small",
        humanSlots: 1,
        enemySlots: 0,
        gameMode: "settlers",
      }),
    });
    assert.ok(created.ok, `seeding ${OWN_GAME} must succeed (${created.status})`);
    const before = await serverGames();
    console.log(`>> server holds ${before.length} game(s): ${before.map((g) => g.name).join(", ")}`);

    browser = await chromium.launch({ headless: true });
    // A fresh context is an EMPTY PROFILE: no `heroesJs.userGames`, exactly the
    // state a cleared profile / private window / new dev port starts in.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[page exception]", e.message));

    const creates: Array<{ name?: string }> = [];
    page.on("request", (req) => {
      if (req.method() !== "POST" || !req.url().endsWith("/games")) return;
      try { creates.push(req.postDataJSON() as { name?: string }); } catch { creates.push({}); }
    });

    await page.goto(WEB_URL);
    await page.waitForFunction(() => !!(window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug, { timeout: 60000 });
    await wait(3000); // let boot's list read and any (wrong) starter creation land

    // ── 1. NO starter game was created on an empty profile ───────────────
    const starters = creates.filter((c) => c.name?.startsWith("starter-"));
    assert.deepEqual(
      starters.map((c) => c.name),
      [],
      `boot on an empty profile must NOT create a starter game: it POSTed ${JSON.stringify(starters.map((c) => c.name))}. ` +
        "The server's list is the source of truth; the cache is only a memory of it.",
    );
    const after = await serverGames();
    assert.equal(
      after.length,
      before.length,
      `boot must not add games to the server: before ${JSON.stringify(before.map((g) => g.name))}, after ${JSON.stringify(after.map((g) => g.name))}`,
    );
    console.log(">> empty profile: no starter game created ✓");

    // ── 2. the player was not dropped into a game ────────────────────────
    const active = await activeGameName(page);
    assert.equal(
      active,
      null,
      `nothing was loaded, so nothing may be substituted -- the client opened ${JSON.stringify(active)}`,
    );
    console.log(">> empty profile: no game loaded on the player's behalf ✓");

    // ── 3. the player's OWN game is in Load Game, and it opens ───────────
    let read = await readLoadRows(page, "landing");
    assert.ok(
      !read.panel.includes("No saved games yet"),
      `the list must not claim the account is empty while the server holds ${JSON.stringify(before.map((g) => g.name))}`,
    );
    const ownRow = read.rows.find((r) => r.text.includes(OWN_GAME));
    assert.ok(
      ownRow,
      `Load Game must list the player's own game ${OWN_GAME}; it showed ${JSON.stringify(read.rows.map((r) => r.text))}`,
    );
    assert.ok(
      ownRow.openable && !ownRow.text.includes("(missing)"),
      `the player's own game must be openable, not a missing row: ${JSON.stringify(ownRow.text)}`,
    );
    console.log(`>> empty profile: Load Game lists ${OWN_GAME} and offers Open ✓`);

    // Open it for real: the row must actually load the game it names.
    await page.locator("button").filter({ hasText: /^Load Game$/ }).last().click();
    await page.waitForFunction(
      () => [...document.querySelectorAll("div")].some((d) => (d.textContent ?? "").includes("Close")),
      null,
      { timeout: 15000 },
    );
    await wait(400);
    await page.evaluate((want: string) => {
      const wrappers = [...document.querySelectorAll("div")].filter((d) => {
        const t = d.textContent ?? "";
        return t.includes("Load Game") && t.includes("Close");
      });
      const owner = wrappers[wrappers.length - 1] as HTMLElement;
      const row = [...owner.querySelectorAll("div")].find((d) => (d.innerText ?? "").includes(want) && d.querySelector("button"));
      const open = row?.querySelector("button");
      if (!open) throw new Error(`no Open button in the row naming ${want}`);
      (open as HTMLButtonElement).click();
    }, OWN_GAME);
    await page.waitForFunction(
      (want: string) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === want,
      OWN_GAME,
      { timeout: 30000 },
    );
    console.log(`>> ${OWN_GAME} opened from the list ✓`);

    // ── 3b. the IN-GAME toolbar list is the city-view card's surface ─────
    // Same code (mergeLoadList), separate UI. Wiping the cache while a game is
    // open is the state the city-view card reported: the player's own game
    // dropped out of the list they were playing from.
    await page.evaluate(() => localStorage.removeItem("heroesJs.userGames"));
    const toolbarRead = await readLoadRows(page, "toolbar");
    assert.ok(
      !toolbarRead.panel.includes("No saved games yet"),
      `the in-game Load list must not claim the account is empty while a game is open: ${JSON.stringify(toolbarRead.panel)}`,
    );
    assert.ok(
      toolbarRead.rows.some((r) => r.text.includes(OWN_GAME) && r.openable),
      `the in-game Load list must still list ${OWN_GAME} with the cache wiped: ${JSON.stringify(toolbarRead.rows.map((r) => r.text))}`,
    );
    console.log(">> in-game toolbar list: own game still listed with the cache wiped ✓");

    // ── 4. same thing after a reload whose storage is gone ───────────────
    await page.evaluate(() => localStorage.removeItem("heroesJs.userGames"));
    const createsBeforeReload = creates.length;
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug, { timeout: 60000 });
    await wait(3000);

    const reloadCreates = creates.slice(createsBeforeReload).filter((c) => c.name?.startsWith("starter-"));
    assert.deepEqual(
      reloadCreates.map((c) => c.name),
      [],
      `a reload with the storage gone must not create a SECOND starter game (the card reports exactly that): ${JSON.stringify(reloadCreates.map((c) => c.name))}`,
    );
    read = await readLoadRows(page, "landing");
    assert.ok(
      read.rows.some((r) => r.text.includes(OWN_GAME) && r.openable),
      `after a reload with no cache, Load Game must still list ${OWN_GAME}: ${JSON.stringify(read.rows.map((r) => r.text))}`,
    );
    console.log(">> reload with lost storage: no starter, own game still listed and openable ✓");

    console.log("\n>> All load-silent-substitute tests passed ✓");
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
