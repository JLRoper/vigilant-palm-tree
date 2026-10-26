import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  spawnLogged, waitForApiHealth, waitForUrl,
  waitForPortReleased, treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import { requireRunTargets } from "./_envGuard";
import type { GameDebugApi } from "../src/io/debugCommands";

// FOCUSED PROBE (not a suite): is a BATTLE phase after a resolved combat a
// genuine persistence/stuck defect, or a legitimate NEW offer from the AI?
// Records the server truth (game_events timeline + lobby.pendingBattle marker
// + active_player_id) at every step, with no reload in between.
//
// Opt-in, run by hand (nothing registers this file):
//   cd <worktree> && PLAYTHROUGH=1 PGDATABASE=game_play_<hex> \
//     API_PORT=57601 CLIENT_PORT=57602 npx tsx test/probeCombatAdjudicate.ts
//
// Pass the ports explicitly (or --env-file=.env): the guard below refuses to
// guess them. Unset, it exits 2 before the first HTTP request -- 3001/5173 on
// a shared box is the Docker stack, so a guess would drive the DEPLOYED api
// against whatever database this worktree happens to read.

const ENTRY = "probeCombatAdjudicate";

// Opt-in first (a probe that is not asked for must never fail anything), then
// fail closed: PLAYTHROUGH=1 arms the run, and the guard accepts the target
// only if it was given explicitly. Both gates sit above the first side effect.
if (process.env.PLAYTHROUGH !== "1") {
  console.log(
    `${ENTRY}: skipped (opt-in probe) — set PLAYTHROUGH=1 to run it. It then requires ` +
    "API_PORT, CLIENT_PORT and PGDATABASE explicitly; unset values are refused, not guessed.",
  );
  process.exit(0);
}
const TARGETS = requireRunTargets(ENTRY);
const API_PORT = TARGETS.apiPort;
const WEB_PORT = TARGETS.clientPort;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 424242;
const DB_NAME = TARGETS.database;
const NAME = "probe-combat-adjudicate";

// Screenshots land beside the report, under the CALLER's checkout (a worktree
// shares the panel's report directory with its parent checkout).
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKOUT_ROOT = resolve(SCRIPT_DIR, "..");
function sharedRepoRoot(checkout: string): string {
  const parts = checkout.replace(/\\/g, "/").split("/");
  const i = parts.lastIndexOf(".worktrees");
  return i > 0 ? parts.slice(0, i).join("/") : checkout.replace(/\\/g, "/");
}
const REPORT_DIR = process.env.PLAYTHROUGH_REPORT_DIR ?? resolve(sharedRepoRoot(CHECKOUT_ROOT), ".agentboard", "playthrough-reports");
const SLUG = process.env.PLAYTHROUGH_REPORT_SLUG ?? "wtgui-playthrough-movement-combat-f5f95b";
const SHOTS = process.env.PLAYTHROUGH_SHOTS_DIR ?? `${REPORT_DIR}/${SLUG}-shots`;

const children: ChildProcess[] = [];
let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) if (c.pid != null) treeKill(c.pid);
  clearRegisteredPids();
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: DB_NAME,
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function serverTruth(): Promise<string> {
  const r = await db.query(
    `SELECT active_player_id, round, day, lobby->'pendingBattle' AS pending FROM games WHERE name = $1`, [NAME],
  );
  const ev = await db.query(
    `SELECT e.kind, e.created_at FROM game_events e JOIN games g ON g.id = e.game_id
     WHERE g.name = $1 ORDER BY e.id DESC LIMIT 8`, [NAME],
  );
  const row = r.rows[0] ?? {};
  return JSON.stringify({
    active: row.active_player_id, round: row.round, day: row.day,
    pending: row.pending ?? null,
    lastEvents: ev.rows.map((x: any) => x.kind).reverse(),
  });
}

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
    const st = d?.getState?.();
    if (!st) return "(no state)";
    return `${st.phase?.kind}/${st.activePlayerId}`;
  });
}

async function modalButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("button"))
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => t.length > 0);
    return [...new Set(texts)].filter((t) => ["Quick Resolve", "Fight", "Flee", "Carry On", "Surrender", "Auto-resolve"].includes(t));
  });
}

async function openGame(page: Page, gameId: string): Promise<void> {
  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.evaluate((g) => {
    localStorage.setItem("heroesJs.userGames", JSON.stringify({
      version: 1, games: [{ id: g.id, name: g.name, lastSeenAt: new Date().toISOString() }],
    }));
  }, { id: gameId, name: NAME });
  await page.reload({ waitUntil: "load" });
  await wait(1200);
  const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ }).first();
  if ((await loadBtn.count()) > 0) {
    await loadBtn.click();
    await page.locator("button", { hasText: "Open" }).first().waitFor({ timeout: 10000 });
    await page.evaluate((n) => {
      const rows = Array.from(document.body.querySelectorAll("button"))
        .filter((b) => b.textContent?.trim() === "Open")
        .map((b) => {
          let row: HTMLElement | null = b.parentElement;
          for (let i = 0; i < 3 && row && (row.textContent ?? "").length < 40; i++) row = row.parentElement;
          return { btn: b, text: row?.textContent ?? "" };
        });
      rows.find((r) => r.text.includes(n))?.btn.click();
    }, NAME);
  }
  await page.waitForFunction(
    (n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n,
    NAME, { timeout: 30_000 },
  );
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

async function seedHeroPos(heroId: string, q: number, r: number): Promise<void> {
  const r0 = await db.query(`SELECT heroes FROM games WHERE name = $1`, [NAME]);
  const row = r0.rows[0];
  if (!row) {
    throw new Error(
      `game ${NAME} is not in ${DB_NAME}: the api at ${API_URL} is serving a different database ` +
      `(pass API_PORT/CLIENT_PORT or --env-file=.env so it writes to the DB this probe reads)`,
    );
  }
  const heroes = row.heroes;
  Object.assign(heroes[heroId], {
    q, r, previousQ: null, previousR: null, previousMovementRemaining: null,
    movementRemaining: 7, trail: [{ q, r }],
  });
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), NAME]);
}

async function main(): Promise<void> {
  reapPreviousRunPids();
  await waitForPortReleased(API_PORT).catch(() => {});
  await waitForPortReleased(WEB_PORT).catch(() => {});
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT), PGDATABASE: DB_NAME,
    PGHOST: process.env.PGHOST ?? "127.0.0.1", PGPORT: String(process.env.PGPORT ?? 5432),
    PGUSER: process.env.PGUSER ?? "gameuser", PGPASSWORD: process.env.PGPASSWORD ?? "gamepass",
    NODE_ENV: "development",
  }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  await waitForUrl(`${API_URL}/api/health`, 60_000);
  await waitForUrl(WEB_URL, 60_000);
  await waitForApiHealth(API_URL);
  console.log(`>> api + web up (db=${DB_NAME})`);

  await api("DELETE", `/api/games/${NAME}`);
  const created = await api("POST", "/api/games", { name: NAME, seed: GAME_SEED, humanSlots: 1, enemySlots: 1 });
  console.log(`>> create -> ${created.status}`);
  await wait(500);
  await seedHeroPos("p0-hero", 6, 7);
  await seedHeroPos("p1-hero", 6, 5);

  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  try {
    await openGame(page, created.json.id);
    console.log(`STEP open              phase=${await phase(page)} server=${await serverTruth()}`);

    await page.evaluate(() => void (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.endTurn());
    console.log("STEP endTurn issued");

    // Wait for the AI to offer the battle.
    let offered = false;
    for (let i = 0; i < 200 && !offered; i++) {
      const btns = await modalButtons(page);
      offered = btns.includes("Quick Resolve");
      if (!offered) await wait(250);
    }
    console.log(`STEP offer             modal=${offered} phase=${await phase(page)} server=${await serverTruth()}`);
    await page.screenshot({ path: `${SHOTS}/probe-1-offer.png` });

    // Resolve it and record everything for 30s without reloading.
    await page.locator("button", { hasText: /^Quick Resolve$/ }).first().click();
    const t0 = Date.now();
    let lastLine = "";
    while (Date.now() - t0 < 30_000) {
      const line = `t+${((Date.now() - t0) / 1000).toFixed(1)}s phase=${await phase(page)} modal=${JSON.stringify(await modalButtons(page))} server=${await serverTruth()}`;
      if (line.slice(6) !== lastLine) { console.log(`STEP post-resolve      ${line}`); lastLine = line.slice(6); }
      await wait(1000);
    }
    await page.screenshot({ path: `${SHOTS}/probe-2-after-resolve.png` });

    // Now the save + reload the suite performs.
    const save = page.locator("button").filter({ hasText: /Save/ }).first();
    if ((await save.count()) > 0) { await save.click().catch(() => {}); await wait(1500); }
    console.log(`STEP after save        phase=${await phase(page)} server=${await serverTruth()}`);
    await page.reload({ waitUntil: "load" });
    await openGame(page, created.json.id);
    await wait(1500);
    console.log(`STEP after reload      phase=${await phase(page)} modal=${JSON.stringify(await modalButtons(page))} server=${await serverTruth()}`);
    await page.screenshot({ path: `${SHOTS}/probe-3-after-reload.png` });

    console.log(`CONSOLE ERRORS: ${consoleErrors.length ? JSON.stringify(consoleErrors) : "none"}`);
  } finally {
    await browser.close().catch(() => {});
    await api("DELETE", `/api/games/${NAME}`).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(() => process.exit(0), (err) => { console.error("PROBE FAILED:", err); cleanup(); process.exit(1); });
