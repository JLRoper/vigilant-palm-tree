import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  waitForPortReleased, treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// ADJUDICATION PROBE 2:
//  (a) after a resolved battle + reload the client hydrates BATTLE while the
//      server row has no lobby.pendingBattle -- is that a phantom battle?
//      Click Quick Resolve on it and record what the server answers.
//  (b) does hovering a hex open the Tile info panel at all? (adjudicates the
//      two "panel did not show Unexplored / terrain" minor findings -- NB the
//      panel is CLICK-driven: hover updates debug.hover only, so this check
//      alone cannot distinguish "no panel" from "wrong gesture")
//
// Opt-in, run by hand (nothing registers this file):
//   cd <worktree> && PLAYTHROUGH=1 PGDATABASE=game_play_<hex> \
//     API_PORT=57601 CLIENT_PORT=57602 npx tsx test/probeCombatPhantom.ts
//
// Pass the ports (or --env-file=.env): without them they fall back to
// 3001/5173, which on a shared box is the Docker stack -- the probe would
// drive the DEPLOYED api against game_poc while reading the worktree DB.

const API_PORT = Number(process.env.API_PORT) || getApiPort(3001);
const WEB_PORT = Number(process.env.CLIENT_PORT) || getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 424242;
const DB_NAME = process.env.PGDATABASE ?? "game_play_bf69b3";
const NAME = "probe-combat-phantom";

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

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function serverTruth(): Promise<string> {
  const r = await db.query(`SELECT active_player_id, round, day, lobby->'pendingBattle' AS pending FROM games WHERE name = $1`, [NAME]);
  const row = r.rows[0] ?? {};
  return JSON.stringify({ active: row.active_player_id, round: row.round, day: row.day, pending: row.pending ?? null });
}

async function clientBattle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
    const st = d?.getState?.();
    if (!st) return "(no state)";
    return JSON.stringify(st.phase);
  });
}

async function modalBtns(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("button"))
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.textContent ?? "").trim());
    return [...new Set(texts)].filter((t) => ["Quick Resolve", "Fight", "Flee", "Carry On", "Surrender", "Auto-resolve"].includes(t));
  });
}

async function openGame(page: Page, gameId: unknown): Promise<void> {
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
  if (process.env.PLAYTHROUGH !== "1") {
    console.log("probeCombatPhantom: skipped (opt-in probe) — set PLAYTHROUGH=1 to run it.");
    return;
  }
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
  await wait(500);
  await seedHeroPos("p0-hero", 6, 7);
  await seedHeroPos("p1-hero", 6, 5);

  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  const posts: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/commands") && r.request().method() === "POST") {
      posts.push(`${r.status()} ${r.request().postData()?.slice(0, 160) ?? ""}`);
    }
  });

  try {
    await openGame(page, created.json.id);

    // (b) hover adjudication, before any AI turn: hover a plain visible tile.
    const hoverInfo = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
      return d ? JSON.stringify(d.hover) : "(no debug api)";
    });
    const pt = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
      return JSON.stringify(d?.screenFor(8, 7));
    });
    console.log(`HOVER screenFor(8,7)=${pt} debug.hover(before)=${hoverInfo}`);
    await page.mouse.move(700, 450);
    await wait(400);
    await page.mouse.move(760, 470);
    await wait(600);
    const hoverAfter = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
      const panelTitles = Array.from(document.querySelectorAll("div"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => (el.textContent ?? "").trim())
        .filter((t) => t.startsWith("Tile") && t.length < 40);
      return JSON.stringify({ hover: d?.hover ?? null, tilePanels: [...new Set(panelTitles)] });
    });
    console.log(`HOVER after mousemove: ${hoverAfter}`);
    await page.screenshot({ path: `${SHOTS}/probe-hover-tile.png` });
    console.log(`HOVER bodyHasUnexplored=${await page.evaluate(() => /Unexplored/.test(document.body.innerText))}`);

    // (a) end turn, wait for the AI's offer, resolve, then reload.
    await page.evaluate(() => void (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.endTurn());
    let offered = false;
    for (let i = 0; i < 240 && !offered; i++) {
      offered = (await modalBtns(page)).includes("Quick Resolve");
      if (!offered) await wait(250);
    }
    console.log(`OFFER modal=${offered} client=${await clientBattle(page)} server=${await serverTruth()}`);
    await page.locator("button", { hasText: /^Quick Resolve$/ }).first().click();
    await wait(8000);
    console.log(`RESOLVED client=${await clientBattle(page)} server=${await serverTruth()}`);
    const save = page.locator("button").filter({ hasText: /Save/ }).first();
    if ((await save.count()) > 0) { await save.click().catch(() => {}); await wait(1500); }
    console.log(`SAVED client=${await clientBattle(page)} server=${await serverTruth()}`);

    for (let attempt = 1; attempt <= 2; attempt++) {
      posts.length = 0;
      await page.reload({ waitUntil: "load" });
      await openGame(page, created.json.id);
      await wait(1500);
      const btns = await modalBtns(page);
      console.log(`RELOAD#${attempt} client=${await clientBattle(page)} modal=${JSON.stringify(btns)} server=${await serverTruth()}`);
      if (attempt === 1) await page.screenshot({ path: `${SHOTS}/probe-phantom-battle.png` });

      // Click Quick Resolve on the (possibly phantom) battle; record the answer.
      if (btns.includes("Quick Resolve")) {
        await page.locator("button", { hasText: /^Quick Resolve$/ }).first().click();
        await wait(6000);
        console.log(`PHANTOM-RESOLVE#${attempt} client=${await clientBattle(page)} server=${await serverTruth()} posts=${JSON.stringify(posts)}`);
        const body = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\s+/g, " "));
        console.log(`PHANTOM-RESOLVE#${attempt} visible text: ${body}`);
        await page.screenshot({ path: `${SHOTS}/probe-phantom-resolve-${attempt}.png` });
      }
    }
    console.log(`CONSOLE ERRORS: ${errors.length ? JSON.stringify(errors) : "none"}`);
  } finally {
    await browser.close().catch(() => {});
    await api("DELETE", `/api/games/${NAME}`).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(() => process.exit(0), (err) => { console.error("PROBE FAILED:", err); cleanup(); process.exit(1); });
