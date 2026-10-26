import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess, execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  spawnLogged, waitForApiHealth, waitForUrl,
  waitForPortReleased, treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import { requireRunTargets } from "./_envGuard";
import type { GameDebugApi } from "../src/io/debugCommands";

// PLAYTHROUGH driver: movement + fog reveal, resource-tile interaction,
// guardian/neutral encounter to completion, AI turn handback, and
// save/reload persistence -- in a real browser against this worktree's own
// dev server. Inventory only: defects are recorded, never fixed.
//
// OPT-IN, run by hand: the driver ends in exit 1 on the known blockers it
// records, so it must never run as part of the default suite or the
// "Build + smoke test" gate -- it does nothing unless PLAYTHROUGH=1.
//
//   cd <worktree> && PLAYTHROUGH=1 PGDATABASE=game_poc_<branch-slug> \
//     API_PORT=57601 CLIENT_PORT=57602 npx tsx test/playthroughMovementCombat.e2e.ts
//
// The target must be explicit: with API_PORT / CLIENT_PORT / PGDATABASE unset
// (and no fresh local/.test-request.json from tools/run-test.mjs) the driver
// exits 2 before its first side effect, instead of falling back to 3001/5173 --
// on a shared box the Docker stack -- and to game_play_bf69b3, which is
// another worktree's playthrough database. See test/_envGuard.ts.
//
// Report paths are env-overridable (PLAYTHROUGH_REPORT_DIR, -REPORT_SLUG,
// -SHOTS_DIR) and otherwise derived from this file's own checkout, never
// hardcoded to one machine's directory.

const ENTRY = "playthroughMovementCombat.e2e";

// Opt-in gate FIRST, environment guard second. A driver nobody asked for exits
// 0 so an accidental registration can never fail a suite; only PLAYTHROUGH=1
// reaches the guard, which then refuses to guess a target. Both sit above the
// first side effect -- no server is spawned, no report is written.
if (process.env.PLAYTHROUGH !== "1") {
  console.log(
    `${ENTRY}: skipped (opt-in driver) — set PLAYTHROUGH=1 to run it. It then requires ` +
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

// The report belongs beside the CALLER's checkout: a worktree
// (<repo>/.worktrees/<branch>) shares the panel's report directory with its
// parent checkout, so the worktree segment is stripped back off.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKOUT_ROOT = resolve(SCRIPT_DIR, "..");
function sharedRepoRoot(checkout: string): string {
  const parts = checkout.replace(/\\/g, "/").split("/");
  const i = parts.lastIndexOf(".worktrees");
  return i > 0 ? parts.slice(0, i).join("/") : checkout.replace(/\\/g, "/");
}
const REPO_ROOT = sharedRepoRoot(CHECKOUT_ROOT);
const REPORT_DIR = process.env.PLAYTHROUGH_REPORT_DIR ?? resolve(REPO_ROOT, ".agentboard", "playthrough-reports");
const SLUG = process.env.PLAYTHROUGH_REPORT_SLUG ?? "wtgui-playthrough-movement-combat-f5f95b";
const SHOTS_DIR = process.env.PLAYTHROUGH_SHOTS_DIR ?? `${REPORT_DIR}/${SLUG}-shots`;

interface Axial { q: number; r: number; }
interface Tile extends Axial { terrain: string; resource?: string | null; river?: string | null; bridge?: boolean; }
interface PlayerRow { id: number; revealedTiles?: string[]; [key: string]: unknown; }
interface HeroRow { ownerId: number; q: number; r: number; movementRemaining: number; gold?: number; [key: string]: unknown; }
interface GameRow {
  players: PlayerRow[];
  heroes: Record<string, HeroRow>;
  settlements: Record<string, any>;
  lobby: Record<string, any>;
  active_player_id: number;
  round: number;
  day: number;
  updated_at: string;
}

interface Finding {
  severity: "blocker" | "major" | "minor" | "polish";
  title: string;
  repro: string;
  screenshot: string | null;
  consoleErrors: string[];
}

const findings: Finding[] = [];
const createdGames: string[] = [];
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
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser",
  password: process.env.PGPASSWORD ?? "gamepass",
  database: DB_NAME,
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function serverRow(name: string): Promise<GameRow> {
  const r = await db.query(
    `SELECT players, heroes, settlements, lobby, active_player_id, round, day, updated_at FROM games WHERE name = $1`,
    [name],
  );
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`).catch(() => {});
}

async function freshGame(name: string, uncharted = true): Promise<{ id: string }> {
  await deleteGame(name);
  createdGames.push(name);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1, uncharted });
  assert.equal(res.status, 201, `create ${name} -> ${res.status} ${res.text.slice(0, 300)}`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await api("GET", `/api/games/${name}`);
    if (got.status === 200) return got.json;
    await wait(300);
  }
  assert.fail(`game ${name} never appeared via API GET`);
}

async function seedHeroMovement(name: string, heroId: string, movement: number): Promise<void> {
  const heroes = (await serverRow(name)).heroes;
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  heroes[heroId] = { ...heroes[heroId], movementRemaining: movement };
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

async function seedHeroPos(name: string, heroId: string, q: number, r: number): Promise<void> {
  const heroes = (await serverRow(name)).heroes;
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  Object.assign(heroes[heroId], {
    q, r, previousQ: null, previousR: null, previousMovementRemaining: null,
    movementRemaining: 7, trail: [{ q, r }],
  });
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

const hexDist = (a: Axial, b: Axial) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;

const DIRS = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
const IMPASSABLE = new Set(["water", "mountain"]);

function straightPassableRuns(tiles: Tile[], origin: Axial): Array<{ dir: Axial; run: number }> {
  return DIRS.map((dir) => {
    let run = 0;
    for (let s = 1; ; s++) {
      const t = tiles.find((x) => x.q === origin.q + dir.q * s && x.r === origin.r + dir.r * s);
      if (!t || IMPASSABLE.has(t.terrain)) break;
      run = s;
    }
    return { dir, run };
  });
}

async function openGame(page: Page, name: string, gameId: string): Promise<void> {
  await page.goto(WEB_URL, { waitUntil: "load" });
  await page.evaluate((g) => {
    localStorage.setItem("heroesJs.userGames", JSON.stringify({
      version: 1, games: [{ id: g.id, name: g.name, lastSeenAt: new Date().toISOString() }],
    }));
  }, { id: gameId, name });
  await page.reload({ waitUntil: "load" });
  await wait(1200);
  const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ }).first();
  if ((await loadBtn.count()) > 0) {
    await loadBtn.click();
    await page.locator("button", { hasText: "Open" }).first().waitFor({ timeout: 10000 });
    const clicked = await page.evaluate((n) => {
      const rows = Array.from(document.body.querySelectorAll("button"))
        .filter((b) => b.textContent?.trim() === "Open")
        .map((b) => {
          let row: HTMLElement | null = b.parentElement;
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
    name, { timeout: 30_000 },
  );
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

async function clientPhase(page: Page): Promise<{ kind: string; activePlayerId: number; round: number; day: number } | null> {
  return page.evaluate(() => {
    const st = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.();
    if (!st) return null;
    return { kind: st.phase?.kind ?? "(none)", activePlayerId: st.activePlayerId, round: st.round, day: st.day };
  });
}

interface ModalSnapshot {
  visibleButtons: string[];
  hasQuickResolve: boolean;
  hasFight: boolean;
  hasFlee: boolean;
  hasBattleTitle: boolean;
}

async function modalSnapshot(page: Page): Promise<ModalSnapshot> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("button"))
      .filter((b) => (b as HTMLElement).offsetParent !== null && (b.textContent ?? "").trim().length > 0)
      .map((b) => (b.textContent ?? "").trim());
    const unique = [...new Set(texts)];
    const hasBattleTitle = Array.from(document.querySelectorAll("div, span, h1, h2, h3"))
      .some((el) => (el as HTMLElement).offsetParent !== null && (el.textContent ?? "").trim() === "Battle!");
    return {
      visibleButtons: unique,
      hasQuickResolve: unique.includes("Quick Resolve"),
      hasFight: unique.includes("Fight"),
      hasFlee: unique.includes("Flee"),
      hasBattleTitle,
    };
  });
}

function attachErrorCollectors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function shot(page: Page, label: string): Promise<string> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const path = `${SHOTS_DIR}/${label}.png`;
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  return path;
}

async function hoverTile(page: Page, q: number, r: number): Promise<{ x: number; y: number } | null> {
  const pt = await page.evaluate((t: Axial) => {
    const d = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug;
    if (!d) return null;
    const p = d.screenFor(t.q, t.r);
    return { x: p.x, y: p.y };
  }, { q, r });
  if (!pt) return null;
  await page.mouse.move(pt.x, pt.y);
  await wait(350);
  return pt;
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function waitForLanding(name: string, heroId: string, dest: Axial, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await serverRow(name);
    const h = row.heroes[heroId];
    if (h && h.q === dest.q && h.r === dest.r) return true;
    await wait(400);
  }
  return false;
}

async function waitForReveal(name: string, playerId: number, key: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await serverRow(name);
    const p = row.players.find((x) => x.id === playerId);
    if (p?.revealedTiles?.includes(key)) return true;
    await wait(400);
  }
  return false;
}

async function gameEventKinds(name: string, sinceIso: string): Promise<Array<{ kind: string; actor: number | null }>> {
  const r = await db.query(
    `SELECT e.kind, (e.payload->>'actor')::int AS actor FROM game_events e JOIN games g ON g.id = e.game_id
     WHERE g.name = $1 AND e.created_at >= $2::timestamptz ORDER BY e.id ASC`,
    [name, sinceIso],
  ).catch(() => ({ rows: [] as any[] }));
  return (r as any).rows ?? [];
}

// ---------------------------------------------------------------- phase 1
// Movement across the map + fog reveal + resource-tile interaction, then
// Save -> reload -> confirm hero position, resources and reveal survive.
async function movementFogResource(browser: Browser): Promise<void> {
  console.log(">> [1] movement / fog reveal / resource tile / save+reload");
  const name = "playthrough-move-f5f95b";
  const game = await freshGame(name, true);
  const row0 = await serverRow(name);
  const hero = row0.heroes["p0-hero"];
  assert(hero, `p0-hero missing in ${name}`);
  const origin = { q: hero.q, r: hero.r };
  const goldBefore = hero.gold ?? 0;
  const settlementsBefore = JSON.stringify(row0.settlements);
  await seedHeroMovement(name, "p0-hero", 80);

  const tilesRes = await api("GET", `/api/games/${name}/tiles`);
  assert.equal(tilesRes.status, 200, `tiles ${name} -> ${tilesRes.status}`);
  const tiles: Tile[] = tilesRes.json;
  assert(Array.isArray(tiles) && tiles.length > 0, "tiles payload empty");

  const runs = straightPassableRuns(tiles, origin).filter((x) => x.run >= 8).sort((a, b) => b.run - a.run);
  assert(runs.length > 0, `no straight passable run of >=8 from ${origin.q},${origin.r}`);
  const { dir, run } = runs[0];
  const dest = { q: origin.q + dir.q * run, r: origin.r + dir.r * run };
  const farProbe = { q: origin.q + dir.q * Math.min(run, 7), r: origin.r + dir.r * Math.min(run, 7) };

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = attachErrorCollectors(page);
  try {
    await openGame(page, name, game.id);

    // Fog before: a tile 7 hexes out should read "Unexplored" in the tile panel.
    await hoverTile(page, farProbe.q, farProbe.r);
    const beforeText = await bodyText(page);
    const beforeShot = await shot(page, "01-fog-before-move");
    const beforeUnexplored = /Unexplored/i.test(beforeText);
    console.log(`>> [1] pre-move probe ${farProbe.q},${farProbe.r}: "Unexplored" in panel = ${beforeUnexplored}`);

    await page.evaluate(() => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.setSelectedHero("p0-hero"));
    const moved = await page.evaluate(
      (t: Axial) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove("p0-hero", t.q, t.r),
      dest,
    );
    assert(moved, `requestMove to ${dest.q},${dest.r} rejected client-side`);

    const landed = await waitForLanding(name, "p0-hero", dest);
    assert(landed, `hero did not land on ${dest.q},${dest.r}`);
    const destRevealed = await waitForReveal(name, 0, `${dest.q},${dest.r}`);
    const rowAfterMove = await serverRow(name);
    const reveal = rowAfterMove.players.find((p) => p.id === 0)?.revealedTiles ?? [];
    const corridorKey = reveal.find((k) => {
      const [q, r] = k.split(",").map(Number);
      return hexDist(origin, { q, r }) === 5 && hexDist(dest, { q, r }) >= 5;
    });
    console.log(`>> [1] landed ${dest.q},${dest.r}; reveal keys=${reveal.length}; corridor=${corridorKey ?? "(none)"}`);
    const afterShot = await shot(page, "02-after-move");

    // Fog after: the destination tile should now read terrain, not "Unexplored".
    await hoverTile(page, dest.q, dest.r);
    const afterText = await bodyText(page);
    const afterRevealed = /move cost/i.test(afterText) && !/Unexplored/i.test(afterText);
    console.log(`>> [1] post-move probe ${dest.q},${dest.r}: terrain shown = ${afterRevealed}`);

    if (!beforeUnexplored) {
      findings.push({
        severity: "minor",
        title: "Unrevealed tile did not read \"Unexplored\" in the tile info panel before moving",
        repro: `1. Create uncharted game seed ${GAME_SEED}. 2. Hover tile ${farProbe.q},${farProbe.r} (7 hexes from start). 3. Read tile panel.`,
        screenshot: beforeShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!destRevealed) {
      findings.push({
        severity: "major",
        title: "Fog reveal did not reach the move destination server-side",
        repro: `1. Move p0-hero to ${dest.q},${dest.r} in uncharted game. 2. Poll players[0].revealedTiles.`,
        screenshot: afterShot,
        consoleErrors: errors.slice(),
      });
    }
    if (corridorKey == null) {
      findings.push({
        severity: "minor",
        title: "No corridor tile at hex-distance 5 from origin was revealed by a multi-hex move",
        repro: `1. Move p0-hero ${run} hexes in one order from ${origin.q},${origin.r}. 2. Inspect revealedTiles for a hex-distance-5 corridor key.`,
        screenshot: afterShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!afterRevealed) {
      findings.push({
        severity: "minor",
        title: "Destination tile panel still did not show terrain after the move",
        repro: `1. Hover ${dest.q},${dest.r} after landing. 2. Read tile panel for terrain/move cost.`,
        screenshot: afterShot,
        consoleErrors: errors.slice(),
      });
    }

    // Resource tile: find a deposit near the destination and move onto it.
    const deposit = tiles
      .filter((t) => t.resource && !IMPASSABLE.has(t.terrain))
      .map((t) => ({ t, d: hexDist(origin, t) }))
      .filter((x) => x.d <= 12)
      .sort((a, b) => a.d - b.d)[0];
    let resourceShot: string | null = null;
    if (!deposit) {
      findings.push({
        severity: "minor",
        title: `No resource deposit found within 12 hexes of start (seed ${GAME_SEED})`,
        repro: "GET /api/games/:name/tiles and filter rows with a non-null resource within 12 hexes.",
        screenshot: null,
        consoleErrors: errors.slice(),
      });
    } else {
      const rq = deposit.t.q;
      const rr = deposit.t.r;
      const moved2 = await page.evaluate(
        (t: Axial) => (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.requestMove("p0-hero", t.q, t.r),
        { q: rq, r: rr },
      );
      console.log(`>> [1] deposit tile ${rq},${rr} (${deposit.t.resource}, ${deposit.t.terrain}) move accepted=${moved2}`);
      if (moved2) {
        const landed2 = await waitForLanding(name, "p0-hero", { q: rq, r: rr });
        assert(landed2, `hero did not land on deposit tile ${rq},${rr}`);
        await hoverTile(page, rq, rr);
        const depText = await bodyText(page);
        resourceShot = await shot(page, "03-resource-tile-panel");
        const depositLine = depText.split("\n").find((l) => /deposit/i.test(l)) ?? "(no deposit line)";
        console.log(`>> [1] tile panel deposit line: "${depositLine.trim()}"`);
        const rowAfterDeposit = await serverRow(name);
        const goldAfter = rowAfterDeposit.heroes["p0-hero"]?.gold ?? 0;
        if (goldAfter !== goldBefore) {
          findings.push({
            severity: "minor",
            title: "Hero gold changed on entering a resource deposit tile",
            repro: `Move p0-hero onto deposit ${rq},${rr}; gold ${goldBefore} -> ${goldAfter}.`,
            screenshot: resourceShot,
            consoleErrors: errors.slice(),
          });
        }
        if (!/deposit/i.test(depText)) {
          findings.push({
            severity: "major",
            title: "Tile info panel did not surface the resource deposit for a hero standing on it",
            repro: `1. Move p0-hero onto deposit tile ${rq},${rr}. 2. Read tile info panel. Expected a "deposit" line.`,
            screenshot: resourceShot,
            consoleErrors: errors.slice(),
          });
        }
        // The acceptance asks for "pick up a resource". The engine has no hero
        // pickup verb: deposits are settlement-worked only. Record the gap.
        findings.push({
          severity: "major",
          title: "No hero resource-pickup mechanic exists: landing on a deposit collects nothing",
          repro: `1. Move p0-hero onto a ${deposit.t.resource} deposit at ${rq},${rr}. 2. Observe hero gold/resources and the tile panel. The panel reports the deposit as "unclaimed" and no resource is credited to the hero; deposits are only worked by settlements within their rate radius.`,
          screenshot: resourceShot,
          consoleErrors: errors.slice(),
        });
      } else {
        findings.push({
          severity: "minor",
          title: "Pathfinding refused a move to a visible resource deposit",
          repro: `requestMove(p0-hero -> ${rq},${rr}) returned false; deposit terrain ${deposit.t.terrain}.`,
          screenshot: await shot(page, "03-resource-move-rejected"),
          consoleErrors: errors.slice(),
        });
      }
    }

    // Save -> reload -> confirm position, resources and reveal survive.
    const saveBtn = page.locator("button").filter({ hasText: /Save/ }).first();
    let saveClicked = false;
    if ((await saveBtn.count()) > 0) {
      await saveBtn.click().catch(() => {});
      saveClicked = true;
      await wait(1500);
      console.log(">> [1] clicked Save");
    } else {
      findings.push({
        severity: "minor",
        title: "Toolbar Save button not found on the adventure screen",
        repro: "Look for a button whose text contains \"Save\" in the in-game toolbar.",
        screenshot: await shot(page, "04-save-button-missing"),
        consoleErrors: errors.slice(),
      });
    }

    const rowPreReload = await serverRow(name);
    const heroPreReload = rowPreReload.heroes["p0-hero"];
    const revealPreReload = rowPreReload.players.find((p) => p.id === 0)?.revealedTiles ?? [];

    await page.reload({ waitUntil: "load" });
    await openGame(page, name, game.id);
    await wait(800);

    const hydrated = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
      const st = d.getState();
      const p = st.players.find((x: any) => x.id === 0);
      const hero = Object.values(st.heroes).find((h: any) => h.ownerId === 0) as any;
      return {
        heroQ: hero?.q, heroR: hero?.r, gold: hero?.gold,
        revealed: (p?.revealedTiles ?? []) as string[],
        settlements: Object.keys(st.settlements ?? {}).length,
        phase: st.phase?.kind, activePlayerId: st.activePlayerId,
      };
    });
    const reloadShot = await shot(page, "05-after-save-reload");
    const rowPostReload = await serverRow(name);
    console.log(`>> [1] after reload: hero ${hydrated.heroQ},${hydrated.heroR} gold=${hydrated.gold} reveal=${hydrated.revealed.length} phase=${hydrated.phase}/${hydrated.activePlayerId}`);

    const positionSurvived = hydrated.heroQ === heroPreReload?.q && hydrated.heroR === heroPreReload?.r;
    const revealSurvived = revealPreReload.every((k) => hydrated.revealed.includes(k));
    const resourcesSurvived = JSON.stringify(rowPostReload.settlements) === settlementsBefore;
    const goldSurvived = (hydrated.gold ?? 0) === (heroPreReload?.gold ?? 0);

    if (!positionSurvived) {
      findings.push({
        severity: "blocker",
        title: "Hero position did not survive save + reload",
        repro: `Hero was at ${heroPreReload?.q},${heroPreReload?.r} before reload; client hydrated ${hydrated.heroQ},${hydrated.heroR}.`,
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!revealSurvived) {
      findings.push({
        severity: "major",
        title: "Revealed fog keys did not survive save + reload",
        repro: `Before reload revealedTiles had ${revealPreReload.length} keys; after reload ${hydrated.revealed.length}. Missing: ${revealPreReload.filter((k) => !hydrated.revealed.includes(k)).slice(0, 5).join(" ")}`,
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!resourcesSurvived) {
      findings.push({
        severity: "major",
        title: "Settlement resources/state changed across a plain save + reload",
        repro: "Compare games.settlements JSONB before and after clicking Save and reloading.",
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!goldSurvived) {
      findings.push({
        severity: "major",
        title: "Hero gold did not survive save + reload",
        repro: `Hero gold ${heroPreReload?.gold} before reload; hydrated ${hydrated.gold}.`,
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
    }

    if (errors.length > 0) {
      findings.push({
        severity: "minor",
        title: `Console/page errors during movement + save/reload phase (${errors.length})`,
        repro: "Open the uncharted game, move, hover tiles, click Save, reload; collect console.error/pageerror.",
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
    }
    console.log(`>> [1] position=${positionSurvived} reveal=${revealSurvived} settlements=${resourcesSurvived} gold=${goldSurvived} saveClicked=${saveClicked}`);
  } catch (err) {
    const s = await shot(page, "99-phase1-failure").catch(() => null);
    findings.push({
      severity: "blocker",
      title: "Movement/fog/resource phase threw",
      repro: String(err).slice(0, 800),
      screenshot: s,
      consoleErrors: errors.slice(),
    });
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- phase 2
// Guardian/neutral encounter to completion + AI turn handback + reload
// persistence of in-flight combat.
async function combatAiPersistence(browser: Browser): Promise<void> {
  console.log(">> [2] encounter to completion / AI turn handback / reload persistence");
  const name = "playthrough-combat-f5f95b";
  const game = await freshGame(name, false);
  await seedHeroPos(name, "p0-hero", 6, 7);
  await seedHeroPos(name, "p1-hero", 6, 5);

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = attachErrorCollectors(page);
  try {
    await openGame(page, name, game.id);
    const pre = await clientPhase(page);
    console.log(`>> [2] pre phase=${pre?.kind}/${pre?.activePlayerId} round=${pre?.round} day=${pre?.day}`);
    assert.equal(pre?.kind, "PLAYER_TURN", `pre-state phase=${pre?.kind}`);
    assert.equal(pre?.activePlayerId, 0, `pre-state activePlayerId=${pre?.activePlayerId}`);

    const rowPre = await serverRow(name);
    const settlementsBefore = JSON.stringify(rowPre.settlements);
    const startedAt = new Date(Date.now() - 2000).toISOString();

    // Human ends turn -> server AI plays -> offers battle to the human defender.
    await page.evaluate(() => void (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug.endTurn());

    let snap: ModalSnapshot | null = null;
    let modalOpened = false;
    let stuckForMs = 0;
    let lastPhaseKind = "(none)";
    const modalDeadline = Date.now() + 60_000;
    while (Date.now() < modalDeadline) {
      snap = await modalSnapshot(page);
      if (snap.hasQuickResolve && snap.hasFight) { modalOpened = true; break; }
      const phase = await clientPhase(page);
      lastPhaseKind = phase?.kind ?? "(none)";
      // The phase flips to BATTLE slightly before the modal paints; only call
      // it stuck after 20s of a BATTLE phase with no modal on screen.
      stuckForMs = lastPhaseKind === "BATTLE" ? stuckForMs + 250 : 0;
      await wait(250);
    }
    const stuck = !modalOpened && stuckForMs >= 20_000;
    const aiEvents = await gameEventKinds(name, startedAt);
    console.log(`>> [2] AI events during turn: ${aiEvents.map((e) => e.kind).join(", ") || "(none)"}`);
    if (!modalOpened) {
      const s = await shot(page, "10-no-battle-modal");
      findings.push({
        severity: "blocker",
        title: stuck ? "Stuck in BATTLE phase with no battle modal" : "AI turn produced no battle offer/modal",
        repro: `1. Seed p0-hero at 6,7 and p1-hero at 6,5 (seed ${GAME_SEED}). 2. End Turn. 3. Wait 60s for the AI attack modal. Last client phase=${lastPhaseKind}; stuck for ${(stuckForMs / 1000).toFixed(0)}s; AI events=${aiEvents.map((e) => e.kind).join(",") || "(none)"}.`,
        screenshot: s,
        consoleErrors: errors.slice(),
      });
      throw new Error("battle modal did not open");
    }
    assert.ok(snap?.hasBattleTitle, `"Battle!" title missing; buttons=${JSON.stringify(snap?.visibleButtons)}`);
    const modalShot = await shot(page, "11-battle-modal");
    console.log(`>> [2] battle modal opened; buttons=${JSON.stringify(snap?.visibleButtons)}`);

    const aiMoved = aiEvents.some((e) => e.kind === "HeroMoved" && e.actor === 1);
    const battleOffered = aiEvents.some((e) => e.kind === "BattleOffered");
    if (!aiMoved) {
      findings.push({
        severity: "major",
        title: "AI turn produced no HeroMoved event (AI did not visibly play before the battle offer)",
        repro: "Inspect game_events for actor 1 HeroMoved after End Turn.",
        screenshot: modalShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!battleOffered) {
      findings.push({
        severity: "minor",
        title: "No BattleOffered event recorded when the AI attacked",
        repro: "Inspect game_events kinds after End Turn.",
        screenshot: modalShot,
        consoleErrors: errors.slice(),
      });
    }

    // In-flight combat must survive a reload: reload mid-offer, reopen, modal
    // must re-appear from hydration with no further End Turn click.
    const pendingBefore = await db.query(`SELECT lobby->'pendingBattle' AS p FROM games WHERE name=$1`, [name]);
    console.log(`>> [2] pendingBattle before reload: ${JSON.stringify(pendingBefore.rows[0]?.p)}`);
    await page.reload({ waitUntil: "load" });
    await openGame(page, name, game.id);

    let reopened = false;
    const reopenDeadline = Date.now() + 40_000;
    while (Date.now() < reopenDeadline) {
      const s2 = await modalSnapshot(page);
      if (s2.hasQuickResolve && s2.hasFight) { reopened = true; break; }
      await wait(250);
    }
    const reloadShot = await shot(page, "12-reload-mid-offer");
    if (!reopened) {
      const phase = await clientPhase(page);
      findings.push({
        severity: "blocker",
        title: "In-flight combat did not survive a reload: battle modal did not re-open from hydration",
        repro: `1. End Turn; AI offers battle. 2. Reload the page and reopen the game. 3. Wait 40s for the modal. phase=${JSON.stringify(phase)}`,
        screenshot: reloadShot,
        consoleErrors: errors.slice(),
      });
      throw new Error("battle modal did not re-open after reload");
    }
    console.log(">> [2] modal re-opened after reload mid-offer");

    // Resolve to completion.
    const resolveAt = Date.now();
    await page.locator("button", { hasText: /^Quick Resolve$/ }).first().click();
    let battleEvent = false, markerCleared = false, backToPlayer = false;
    const resolveDeadline = Date.now() + 60_000;
    while (Date.now() < resolveDeadline) {
      battleEvent = battleEvent || (await db.query(
        `SELECT 1 FROM game_events e JOIN games g ON g.id=e.game_id WHERE g.name=$1 AND e.kind='BattleResolved'`, [name],
      ).then((r) => (r.rowCount ?? 0) > 0).catch(() => false));
      const marker = await db.query(`SELECT lobby->'pendingBattle' AS p FROM games WHERE name=$1`, [name]);
      markerCleared = marker.rows[0]?.p == null;
      const st = await clientPhase(page);
      backToPlayer = st?.kind === "PLAYER_TURN" && st.activePlayerId === 0;
      if (battleEvent && markerCleared && backToPlayer) break;
      await wait(500);
    }
    const phaseAfter = await clientPhase(page);
    const resolvedShot = await shot(page, "13-after-quick-resolve");
    console.log(`>> [2] resolve: battleEvent=${battleEvent} markerCleared=${markerCleared} backToPlayer=${backToPlayer} phase=${phaseAfter?.kind}/${phaseAfter?.activePlayerId} (${((Date.now() - resolveAt) / 1000).toFixed(1)}s)`);
    if (!battleEvent) {
      findings.push({
        severity: "major",
        title: "Quick Resolve did not persist a BattleResolved event",
        repro: "Quick Resolve the offered battle; poll game_events for BattleResolved.",
        screenshot: resolvedShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!backToPlayer) {
      findings.push({
        severity: "blocker",
        title: "AI turn did not hand the turn back after combat resolution",
        repro: `Quick Resolve the battle; wait 60s for phase PLAYER_TURN/activePlayerId 0. Observed ${JSON.stringify(phaseAfter)}`,
        screenshot: resolvedShot,
        consoleErrors: errors.slice(),
      });
    }

    // Save -> reload -> verify position/resources/phase survive.
    const rowPostCombat = await serverRow(name);
    const heroPostCombat = rowPostCombat.heroes["p0-hero"];
    const aiPostCombat = rowPostCombat.heroes["p1-hero"];
    const saveBtn = page.locator("button").filter({ hasText: /Save/ }).first();
    if ((await saveBtn.count()) > 0) { await saveBtn.click().catch(() => {}); await wait(1200); }
    await page.reload({ waitUntil: "load" });
    await openGame(page, name, game.id);
    await wait(800);
    const hydrated = await page.evaluate(() => {
      const d = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
      const st = d.getState();
      const heroes = Object.values(st.heroes) as any[];
      const p0 = heroes.find((h) => h.ownerId === 0);
      const p1 = heroes.find((h) => h.ownerId === 1);
      return {
        p0: p0 ? { q: p0.q, r: p0.r, gold: p0.gold } : null,
        p1: p1 ? { q: p1.q, r: p1.r } : null,
        phase: st.phase?.kind, activePlayerId: st.activePlayerId,
        settlements: Object.keys(st.settlements ?? {}).length,
      };
    });
    const finalShot = await shot(page, "14-after-combat-save-reload");
    const rowFinal = await serverRow(name);
    console.log(`>> [2] post-combat heroes: p0=${JSON.stringify(heroPostCombat && { q: heroPostCombat.q, r: heroPostCombat.r, gold: heroPostCombat.gold })} p1=${JSON.stringify(aiPostCombat && { q: aiPostCombat.q, r: aiPostCombat.r })}`);
    console.log(`>> [2] after reload: p0=${JSON.stringify(hydrated.p0)} p1=${JSON.stringify(hydrated.p1)} phase=${hydrated.phase}/${hydrated.activePlayerId} settlements=${hydrated.settlements}`);

    const sameHeroPos = heroPostCombat
      ? hydrated.p0?.q === heroPostCombat.q && hydrated.p0?.r === heroPostCombat.r
      : hydrated.p0 == null;
    const sameAiPos = aiPostCombat
      ? hydrated.p1?.q === aiPostCombat.q && hydrated.p1?.r === aiPostCombat.r
      : hydrated.p1 == null;
    const samePhase = hydrated.phase === "PLAYER_TURN" && hydrated.activePlayerId === 0;
    const sameSettlements = JSON.stringify(rowFinal.settlements) === settlementsBefore;

    if (!sameHeroPos) {
      findings.push({
        severity: "blocker",
        title: "Hero position did not survive combat save + reload",
        repro: `Server had p0 at ${heroPostCombat?.q},${heroPostCombat?.r} after combat; client hydrated ${JSON.stringify(hydrated.p0)}.`,
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!sameAiPos) {
      findings.push({
        severity: "major",
        title: "AI hero position did not survive combat save + reload",
        repro: `Server had p1 at ${aiPostCombat?.q},${aiPostCombat?.r}; client hydrated ${JSON.stringify(hydrated.p1)}.`,
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!samePhase) {
      findings.push({
        severity: "blocker",
        title: "Turn/phase state did not survive combat save + reload",
        repro: `Expected PLAYER_TURN/activePlayerId 0; hydrated ${hydrated.phase}/${hydrated.activePlayerId}.`,
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }
    if (!sameSettlements) {
      findings.push({
        severity: "major",
        title: "Settlement state changed across a combat save + reload",
        repro: "Compare games.settlements JSONB before combat and after reload.",
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }

    // Stuck-state watch: the phase must not sit in BATTLE after resolution.
    const finalPhase = await clientPhase(page);
    if (finalPhase?.kind === "BATTLE") {
      findings.push({
        severity: "blocker",
        title: "Stuck in BATTLE phase after combat resolution + reload",
        repro: "Quick Resolve, reload, reopen; phase remains BATTLE.",
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }

    if (errors.length > 0) {
      findings.push({
        severity: "minor",
        title: `Console/page errors during combat/AI/persistence phase (${errors.length})`,
        repro: "End Turn, observe AI attack, Quick Resolve, Save, reload; collect console.error/pageerror.",
        screenshot: finalShot,
        consoleErrors: errors.slice(),
      });
    }
    console.log(`>> [2] position=${sameHeroPos} ai=${sameAiPos} phase=${samePhase} settlements=${sameSettlements}`);
  } catch (err) {
    const s = await shot(page, "98-phase2-failure").catch(() => null);
    if (findings.every((f) => f.title !== "Movement/fog/resource phase threw")) {
      findings.push({
        severity: "blocker",
        title: "Combat/AI/persistence phase threw",
        repro: String(err).slice(0, 800),
        screenshot: s,
        consoleErrors: errors.slice(),
      });
    }
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

// The report's own header is derived, not hardcoded: whoever runs this driver
// from another worktree gets that worktree's path and branch.
function gitBranchLine(): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: CHECKOUT_ROOT, encoding: "utf8", windowsHide: true }).trim();
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: CHECKOUT_ROOT, encoding: "utf8", windowsHide: true }).trim();
    return `${branch} @ ${sha}`;
  } catch {
    return "(unknown — git unavailable)";
  }
}

// A report is APPENDED now, so a second call within one process would append a
// duplicate block rather than harmlessly overwrite: main()'s finally and the
// rejection handler below both reach writeReport when a run fails before the
// phases (a failed api boot), so the first write wins and the second is a no-op.
let reportWritten = false;

function writeReport(ok: boolean): void {
  if (reportWritten) return;
  reportWritten = true;
  mkdirSync(REPORT_DIR, { recursive: true });
  const lines: string[] = [];
  lines.push("# Playthrough — movement, combat, AI, persistence");
  lines.push("");
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Worktree: ${CHECKOUT_ROOT}`);
  lines.push(`- Branch: ${gitBranchLine()}`);
  lines.push(`- Database: ${DB_NAME} (isolated)`);
  lines.push(`- Server: this worktree's own dev stack on API ${API_PORT} / web ${WEB_PORT} (${TARGETS.portsFrom === "request" ? "from the run-test wrapper's request file" : "from API_PORT/CLIENT_PORT in the environment"})`);
  lines.push(`- Seed: ${GAME_SEED}`);
  lines.push(`- Result: ${ok ? "run completed" : "run FAILED"} — ${findings.length} finding(s)`);
  lines.push("");
  lines.push("## What was exercised");
  lines.push("");
  lines.push("1. Uncharted game, multi-hex hero move: server-side `players[].revealedTiles` destination + corridor reveal; tile info panel before/after (Unexplored → terrain).");
  lines.push("2. Resource deposit tile: hero moved onto it; tile panel deposit line read; hero purse checked for a pickup credit.");
  lines.push("3. Classic game with adjacent heroes: End Turn → server AI plays → battle offered → Quick Resolve to completion.");
  lines.push("4. AI turn handback: phase/activePlayerId must return to PLAYER_TURN/0.");
  lines.push("5. Save → reload → position, gold, settlement state and reveal persistence; reload mid-offer for in-flight combat.");
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (findings.length === 0) {
    lines.push("None. All checks passed.");
  } else {
    const order = { blocker: 0, major: 1, minor: 2, polish: 3 } as const;
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push("");
      lines.push(`- **Repro:** ${f.repro}`);
      lines.push(`- **Screenshot:** ${f.screenshot ?? "(none)"}`);
      lines.push(`- **Console errors:** ${f.consoleErrors.length ? "```\n" + f.consoleErrors.join("\n") + "\n```" : "none"}`);
      lines.push("");
    });
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- Inventory only: no code was changed.");
  lines.push("- Screenshots live beside this file under `" + SLUG + "-shots/`.");
  lines.push("");
  const block = lines.join("\n");
  const targets = [
    `${REPORT_DIR}/${SLUG}.md`,
    // Second copy keyed to this checkout's directory name, for the panel's lookup.
    `${REPORT_DIR}/${basename(CHECKOUT_ROOT)}.md`,
  ];
  for (const target of targets) console.log(`>> report ${appendReport(target, block)}: ${target}`);
}

/**
 * APPENDS to a report that is already there. With PLAYTHROUGH_REPORT_DIR unset
 * every run in every worktree derives the same `<slug>.md` under the shared
 * <repo>/.agentboard/playthrough-reports, so a plain writeFileSync replaced the
 * previous run's report -- and the panel's checkout-keyed copy -- every single
 * time. Each block carries its own Date / Worktree / Branch / Database header,
 * so appending keeps the earlier runs readable instead of losing them.
 */
function appendReport(target: string, block: string): "written" | "appended" {
  if (existsSync(target)) {
    appendFileSync(target, `\n\n---\n\n${block}`, "utf8");
    return "appended";
  }
  writeFileSync(target, block, "utf8");
  return "written";
}

async function main(): Promise<void> {
  reapPreviousRunPids();
  mkdirSync(SHOTS_DIR, { recursive: true });
  await waitForPortReleased(API_PORT).catch(() => {});
  await waitForPortReleased(WEB_PORT).catch(() => {});
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT),
    PGDATABASE: DB_NAME,
    PGHOST: process.env.PGHOST ?? "127.0.0.1",
    PGPORT: String(process.env.PGPORT ?? 5432),
    PGUSER: process.env.PGUSER ?? "gameuser",
    PGPASSWORD: process.env.PGPASSWORD ?? "gamepass",
    NODE_ENV: "development",
  }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  await waitForUrl(`${API_URL}/api/health`, 60_000);
  await waitForUrl(WEB_URL, 60_000);
  await waitForApiHealth(API_URL);
  console.log(`>> api + web up (db=${DB_NAME})`);

  const browser = await chromium.launch({ headless: true });
  let ok = false;
  try {
    await movementFogResource(browser);
    await combatAiPersistence(browser);
    ok = true;
    console.log(">> playthrough: ALL PHASES COMPLETED");
  } finally {
    await browser.close().catch(() => {});
    for (const n of createdGames) await deleteGame(n);
    writeReport(ok);
    await db.end().catch(() => {});
    cleanup();
  }
  if (findings.some((f) => f.severity === "blocker")) {
    console.error(`>> BLOCKER findings: ${findings.filter((f) => f.severity === "blocker").length}`);
    process.exit(1);
  }
}

// The opt-in gate and the environment guard already ran at the top of this
// module (see the header): reaching this call means PLAYTHROUGH=1 was set and
// API_PORT / CLIENT_PORT / PGDATABASE were given explicitly.
main().then(
  () => process.exit(0),
  (err) => {
    console.error("PLAYTHROUGH FAILED:", err);
    try { writeReport(false); } catch { /* best effort */ }
    for (const n of createdGames) void deleteGame(n);
    cleanup();
    process.exit(1);
  },
);
