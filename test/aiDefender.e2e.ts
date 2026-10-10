import { chromium, type Browser, type Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";

// AI-defender battle offer e2e regressions (Playwright + real API + real DB),
// against a server-driven AI game (lobby.aiDriver === "server"):
//
// (A) headline regression gate -- an AI hero attacks the human; the defender's
//     client MUST auto-open the Fight / Quick-Resolve modal with NO user
//     interaction (F1: state:committed -> maybeAutoResolveBattle), and Quick
//     Resolve must persist a BattleResolved event, clear the offer marker, and
//     let the AI turn complete (no stall until the 300s force-resolve).
//     This scenario fails on the pre-fix code: the phase flips to BATTLE but
//     the modal never opens.
//
// (B) F2 -- reloading mid-offer must re-derive the BATTLE phase from the
//     persisted lobby.pendingBattle marker (hydrateClientGame) so the modal
//     re-opens from hydration alone, with no further End Turn click.
//
// (C) the "Fight" path -- clicking Fight must open the tactical arena with
//     the ATTACKER on the grid's LEFT column even though the human is the
//     DEFENDER (arena convention, src/screens/combat/arena/sides.ts:
//     planArenaSides.leftColumnSide is always "attacker"). Pre-fix code
//     passed the human's role as the engine's sideChoice, so a defending
//     human deployed on the left column and the attacker on the right --
//     both armies faced away from each other and the attacker's owner dots
//     sat on the RIGHT. Placement is asserted from real canvas pixels (the
//     per-combatant owner dots carry the fixed role accents), not from
//     state, so the assertion fails on the pre-fix wiring.
//
// Seeding recipe live-verified by local/probe/aiDefenderRepro.mjs: game seed
// 424242, humanSlots 1 / enemySlots 1, p0-hero (human) at (6,7), p1-hero (AI)
// at (6,5); (6,6) is passable on this seed, so the AI's first move lands
// adjacent and the driver dispatches EnterBattle.

// Env-first ports: tools/run-test.mjs exports API_PORT/CLIENT_PORT to the
// child, and the prescribed direct command loads .env (fresh after
// allocate-ports). The shared .test-request.json contract is only a fallback
// here: a stale file from a crashed run points this suite at dead ports while
// the Vite child (inheriting .env) still proxies /api to the .env API port --
// the proxy then answers with an empty body and Load Game shows "(missing)".
const API_PORT = Number(process.env.API_PORT) || getApiPort(3001);
const WEB_PORT = Number(process.env.CLIENT_PORT) || getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_SEED = 424242;
const HUMAN_TILE = { q: 6, r: 7 };
const AI_TILE = { q: 6, r: 5 };

interface GameRow {
  players: Array<{ id: number }>;
  heroes: Record<string, { ownerId: number; q: number; r: number }>;
}

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
setTimeout(() => { console.error(">> aiDefender.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

// Defaults pin the LOCAL docker db -- never .env's possible gameserver host.
const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function serverRow(name: string): Promise<GameRow> {
  const r = await db.query(`SELECT players, heroes FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0];
}

async function pendingBattleMarker(name: string): Promise<unknown> {
  const r = await db.query(`SELECT lobby->'pendingBattle' AS pending FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0].pending ?? null;
}

async function battleResolvedSeen(name: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM game_events e JOIN games g ON g.id = e.game_id WHERE g.name = $1 AND e.kind = 'BattleResolved'`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

async function freshGame(name: string): Promise<{ id: string }> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 1 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status} ${JSON.stringify(res.json)}`);
  const got = await api("GET", `/api/games/${name}`);
  assert.equal(got.status, 200, `GET ${name} -> ${got.status}`);
  assert.equal(got.json?.lobby?.aiDriver, "server", `lobby.aiDriver=${JSON.stringify(got.json?.lobby?.aiDriver)}, expected "server"`);
  return res.json;
}

// SQL-side seeding on the games JSONB (matches debugCommands.teleportHero
// semantics: previous* nulled so the client's move hook sends fromTile = the
// seeded tile).
async function seedHeroPos(name: string, heroId: string, q: number, r: number): Promise<void> {
  const heroes = (await serverRow(name)).heroes as Record<string, any>;
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  Object.assign(heroes[heroId], { q, r, previousQ: null, previousR: null, previousMovementRemaining: null, movementRemaining: 7, trail: [{ q, r }] });
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

async function seedAdjacentHeroes(name: string): Promise<void> {
  await seedHeroPos(name, "p0-hero", HUMAN_TILE.q, HUMAN_TILE.r);
  await seedHeroPos(name, "p1-hero", AI_TILE.q, AI_TILE.r);
  const row = await serverRow(name);
  assert.equal(row.heroes["p0-hero"].q, HUMAN_TILE.q, "p0-hero seed did not persist");
  assert.equal(row.heroes["p0-hero"].r, HUMAN_TILE.r, "p0-hero seed did not persist");
  assert.equal(row.heroes["p1-hero"].q, AI_TILE.q, "p1-hero seed did not persist");
  assert.equal(row.heroes["p1-hero"].r, AI_TILE.r, "p1-hero seed did not persist");
}

async function deleteGame(name: string): Promise<void> {
  await api("DELETE", `/api/games/${name}`);
}

async function openGame(page: Page, name: string, gameId: string): Promise<void> {
  // waitUntil "load", never "networkidle": the SSE stream holds a request open forever.
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
    try {
      await page.locator("button", { hasText: "Open" }).first().waitFor({ timeout: 10000 });
    } catch (err) {
      // No named arrow bindings inside page.evaluate bodies: tsx/esbuild's
      // keepNames transform injects a __name() helper that does not exist in
      // the browser page and would throw a ReferenceError.
      const dump = await page.evaluate(async (n) => {
        let apiProbe: unknown;
        try {
          const res = await fetch("/api/games");
          const text = await res.text();
          let list: any = null;
          try { list = JSON.parse(text); } catch { /* empty body */ }
          const mine = Array.isArray(list) ? list.find((g: any) => g.name === n) : null;
          apiProbe = {
            status: res.status, count: Array.isArray(list) ? list.length : -1,
            mineId: mine?.id, mineIdType: typeof mine?.id, text: text.slice(0, 300),
          };
        } catch (e) {
          apiProbe = { error: String(e) };
        }
        return {
          buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim()).filter(Boolean),
          body: document.body.innerText.slice(0, 800),
          stored: localStorage.getItem("heroesJs.userGames"),
          apiProbe,
        };
      }, name);
      console.error(`>> openGame diagnostic for ${name}: ${JSON.stringify(dump)}`);
      throw err;
    }
    const clicked = await page.evaluate((n) => {
      const rows = Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Open")
        .map((b) => {
          let row = b.parentElement;
          for (let i = 0; i < 3 && row && row.textContent.length < 40; i++) row = row.parentElement;
          return { btn: b, text: row?.textContent ?? "" };
        });
      const hit = rows.find((r) => r.text.includes(n));
      if (!hit) return false;
      hit.btn.click();
      return true;
    }, name);
    assert(clicked, `no Open row matched ${name}`);
  }
  await page.waitForFunction((n) => (window as any).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

async function clientPhase(page: Page): Promise<{ kind: string; activePlayerId: number } | null> {
  return page.evaluate(() => {
    const st = (window as any).__gameDebug?.getState?.();
    if (!st) return null;
    return { kind: st.phase?.kind ?? "(none)", activePlayerId: st.activePlayerId };
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

// Scenario A: the headline gate. On pre-fix code the phase reaches BATTLE but
// no modal ever opens and Quick Resolve is unreachable without interaction.
async function aiAttacksHumanModalAutoOpens(browser: Browser): Promise<void> {
  console.log(">> [A] AI attacks human: defender modal auto-opens; Quick Resolve completes");
  const name = "ai-defender-e2e-a";
  const game = await freshGame(name);
  await seedAdjacentHeroes(name);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = attachErrorCollectors(page);
  const t0 = Date.now();
  try {
    await openGame(page, name, game.id);
    const pre = await clientPhase(page);
    assert.equal(pre?.kind, "PLAYER_TURN", `pre-state phase=${pre?.kind}, expected PLAYER_TURN`);
    assert.equal(pre?.activePlayerId, 0, `pre-state activePlayerId=${pre?.activePlayerId}, expected 0`);

    await page.evaluate(() => void (window as any).__gameDebug.endTurn());

    // (a) The modal must appear with NO user interaction.
    let snap: ModalSnapshot | null = null;
    let modalOpened = false;
    const modalDeadline = Date.now() + 45_000;
    while (Date.now() < modalDeadline) {
      snap = await modalSnapshot(page);
      if (snap.hasQuickResolve && snap.hasFight && !snap.hasFlee) { modalOpened = true; break; }
      await wait(250);
    }
    if (!modalOpened) {
      const phase = await clientPhase(page);
      const pending = await pendingBattleMarker(name);
      console.error(`>> [A] DIAGNOSTIC: visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
      assert.fail(`battle modal did not auto-open within 45s (BattleOffered-stall regression): visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
    }
    assert.ok(snap?.hasBattleTitle, `"Battle!" title missing; visibleButtons=${JSON.stringify(snap?.visibleButtons)}`);
    console.log(`>> [A] modal auto-opened at t+${Date.now() - t0}ms (Quick Resolve + Fight, no Flee, "Battle!" title); buttons=${JSON.stringify(snap?.visibleButtons)}`);

    // Click Quick Resolve and prove the resolve completes without stalling.
    const resolveAt = Date.now();
    await page.locator("button", { hasText: /^Quick Resolve$/ }).first().click();

    let battleEvent = false, markerCleared = false, backToPlayer = false;
    const resolveDeadline = Date.now() + 45_000;
    while (Date.now() < resolveDeadline) {
      battleEvent = battleEvent || (await battleResolvedSeen(name));
      markerCleared = (await pendingBattleMarker(name)) == null;
      const st = await clientPhase(page);
      backToPlayer = st?.kind === "PLAYER_TURN" && st.activePlayerId === 0;
      if (battleEvent && markerCleared && backToPlayer) break;
      await wait(500);
    }
    const phaseAfter = await clientPhase(page);
    assert(battleEvent, "no BattleResolved event persisted server-side after Quick Resolve");
    assert(markerCleared, `lobby.pendingBattle not cleared after Quick Resolve (${JSON.stringify(await pendingBattleMarker(name))})`);
    assert(backToPlayer, `AI turn did not complete after Quick Resolve (stall): phase=${JSON.stringify(phaseAfter)} (result card showing is fine; the phase must leave BATTLE)`);
    console.log(`>> [A] Quick Resolve resolved in ${((Date.now() - resolveAt) / 1000).toFixed(1)}s: BattleResolved persisted, pendingBattle cleared, phase=${phaseAfter?.kind}/player ${phaseAfter?.activePlayerId}`);
    assert.equal(consoleErrors.length, 0, `console/page errors during scenario A:\n${consoleErrors.join("\n")}`);
    console.log(`>> [A] pass (t+${((Date.now() - t0) / 1000).toFixed(1)}s total), console errors: 0`);
  } finally {
    await page.close().catch(() => {});
    await deleteGame(name);
  }
}

// Scenario B: reload mid-offer must re-open the modal from hydration (F2).
// Pre-fix, the reload hydrates the faction-derived AI_TURN phase and nothing
// ever re-opens the modal -- the offer sits until the 300s force-resolve.
async function reloadMidOfferReopensModal(browser: Browser): Promise<void> {
  console.log(">> [B] reload mid-offer re-opens the modal from hydration (F2)");
  const name = "ai-defender-e2e-b";
  const game = await freshGame(name);
  await seedAdjacentHeroes(name);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = attachErrorCollectors(page);
  const t0 = Date.now();
  try {
    await openGame(page, name, game.id);
    await page.evaluate(() => void (window as any).__gameDebug.endTurn());

    // Wait for the offer to land server-side (AI offered and is waiting).
    let offered = false;
    const offerDeadline = Date.now() + 45_000;
    while (Date.now() < offerDeadline) {
      if ((await pendingBattleMarker(name)) != null) { offered = true; break; }
      await wait(500);
    }
    assert(offered, `AI battle offer never landed within 45s (pendingBattle marker never stamped)`);
    const phaseAtOffer = await clientPhase(page);
    const builtAt = Date.now();
    console.log(`>> [B] offer registered at t+${builtAt - t0}ms; phase=${phaseAtOffer?.kind}`);

    // Reload WITHOUT resolving, then reopen the same game.
    await page.reload({ waitUntil: "load" });
    await openGame(page, name, game.id);

    // The modal must re-appear from hydration alone -- no End Turn click.
    let snap: ModalSnapshot | null = null;
    let modalReopened = false;
    const modalDeadline = Date.now() + 30_000;
    while (Date.now() < modalDeadline) {
      snap = await modalSnapshot(page);
      if (snap.hasQuickResolve && !snap.hasFlee) { modalReopened = true; break; }
      await wait(250);
    }
    if (!modalReopened) {
      const phase = await clientPhase(page);
      const pending = await pendingBattleMarker(name);
      console.error(`>> [B] DIAGNOSTIC: visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
      assert.fail(`modal did not re-open after reload (F2 hydration gap): visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
    }
    assert.ok(snap?.hasBattleTitle, `"Battle!" title missing after reload; visibleButtons=${JSON.stringify(snap?.visibleButtons)}`);
    console.log(`>> [B] modal re-opened after reload at t+${Date.now() - t0}ms (Quick Resolve, no Flee, "Battle!" title); buttons=${JSON.stringify(snap?.visibleButtons)}`);
    assert.equal(consoleErrors.length, 0, `console/page errors during scenario B:\n${consoleErrors.join("\n")}`);
    console.log(`>> [B] pass (t+${((Date.now() - t0) / 1000).toFixed(1)}s total), console errors: 0`);
  } finally {
    await page.close().catch(() => {});
    await deleteGame(name);
  }
}

// Scenario C: the "Fight" path must open the tactical arena with the ATTACKER
// on the grid's LEFT column even though the human is the DEFENDER here (the
// arena's sides.ts convention -- planArenaSides.leftColumnSide is always
// "attacker", and openManualBattleArena passes it as the engine's sideChoice).
// Pre-fix code passed the human's role instead, deploying the defender on the
// left and leaving both armies facing away from each other. Placement is
// asserted from real canvas pixels: paintBattleCombatant paints each
// combatant's owner dot with battleAccent(side, "ring"), which the arena's
// buildArenaPaint2dDeps resolves to the fixed role accents ATTACKER_ACCENT
// "#3070c0" / DEFENDER_ACCENT "#c04040" (openManualBattleArena.ts), and the
// circle fallback fills whole combatants with those same two colors
// (paint2d/colors.ts BATTLE_COMBATANT_ATTACKER/DEFENDER) -- so
// attacker-colored pixels must sit strictly left of defender-colored pixels
// whatever the art path, and the reverse (the pre-fix wiring) fails.
async function fightAsDefenderDeploysAttackerLeft(browser: Browser): Promise<void> {
  console.log(">> [C] Fight as defender: arena keeps the attacker on the left");
  const name = "ai-defender-e2e-c";
  const game = await freshGame(name);
  await seedAdjacentHeroes(name);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = attachErrorCollectors(page);
  const t0 = Date.now();
  try {
    await openGame(page, name, game.id);
    const pre = await clientPhase(page);
    assert.equal(pre?.kind, "PLAYER_TURN", `pre-state phase=${pre?.kind}, expected PLAYER_TURN`);
    assert.equal(pre?.activePlayerId, 0, `pre-state activePlayerId=${pre?.activePlayerId}, expected 0`);

    await page.evaluate(() => void (window as any).__gameDebug.endTurn());

    // Same recipe as A: the offer modal must auto-open (Quick Resolve +
    // Fight, no Flee -- the human is the defender).
    let snap: ModalSnapshot | null = null;
    let modalOpened = false;
    const modalDeadline = Date.now() + 45_000;
    while (Date.now() < modalDeadline) {
      snap = await modalSnapshot(page);
      if (snap.hasQuickResolve && snap.hasFight && !snap.hasFlee) { modalOpened = true; break; }
      await wait(250);
    }
    if (!modalOpened) {
      const phase = await clientPhase(page);
      const pending = await pendingBattleMarker(name);
      console.error(`>> [C] DIAGNOSTIC: visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
      assert.fail(`battle modal did not auto-open within 45s: visibleButtons=${JSON.stringify(snap?.visibleButtons)} phase=${JSON.stringify(phase)} pendingBattle=${JSON.stringify(pending)}`);
    }
    assert.ok(snap?.hasBattleTitle, `"Battle!" title missing; visibleButtons=${JSON.stringify(snap?.visibleButtons)}`);
    console.log(`>> [C] modal auto-opened at t+${Date.now() - t0}ms (Quick Resolve + Fight, no Flee); buttons=${JSON.stringify(snap?.visibleButtons)}`);

    // Enter the tactical arena as the defender.
    await page.locator("button", { hasText: /^Fight$/ }).first().click();

    // Wait for the arena overlay: its canvas carries the fixed "#14161a" CSS
    // background (openManualBattleArena), which no other canvas in the app
    // sets -- the main game canvas paints its background as content.
    let arenaReady = false;
    let arenaProbe: { canvasFound: boolean; chip: string; width: number; height: number } | null = null;
    const arenaDeadline = Date.now() + 30_000;
    while (Date.now() < arenaDeadline) {
      arenaProbe = await page.evaluate(() => {
        let found: HTMLCanvasElement | null = null;
        const list = document.querySelectorAll("canvas");
        for (let i = 0; i < list.length; i++) {
          const el = list[i] as HTMLCanvasElement;
          if (getComputedStyle(el).backgroundColor === "rgb(20, 22, 26)") { found = el; break; }
        }
        const chips = Array.from(document.querySelectorAll("span"))
          .filter((el) => ((el as HTMLElement).textContent ?? "").trim().startsWith("You: "));
        return {
          canvasFound: found != null && found.width > 0 && found.height > 0,
          chip: chips.length > 0 ? ((chips[0] as HTMLElement).textContent ?? "").trim() : "",
          width: found ? found.width : 0,
          height: found ? found.height : 0,
        };
      });
      if (arenaProbe.canvasFound) { arenaReady = true; break; }
      await wait(250);
    }
    if (!arenaReady) {
      console.error(`>> [C] DIAGNOSTIC: arenaProbe=${JSON.stringify(arenaProbe)}`);
      assert.fail(`arena overlay did not appear within 30s after Fight: probe=${JSON.stringify(arenaProbe)}`);
    }
    console.log(`>> [C] arena up at t+${Date.now() - t0}ms (${arenaProbe?.width}x${arenaProbe?.height} canvas), side chip="${arenaProbe?.chip}"`);

    // (a) Role wiring: the human is the DEFENDER in this flow, so the top-bar
    // side chip must read "You: Red" (defender accent), never "You: Blue".
    assert.equal(arenaProbe?.chip, "You: Red", `side chip read ${JSON.stringify(arenaProbe?.chip)}, expected "You: Red" (human is the defender)`);
    await wait(400);

    // (b) Placement (the regression pin): count pixels of each role accent on
    // the arena canvas (tolerance <= 4 per channel -- exact circle-interior
    // fills; antialiased edges fall outside it) and compare centroids.
    const pixels = await page.evaluate(() => {
      let canvas: HTMLCanvasElement | null = null;
      const list = document.querySelectorAll("canvas");
      for (let i = 0; i < list.length; i++) {
        const el = list[i] as HTMLCanvasElement;
        if (getComputedStyle(el).backgroundColor === "rgb(20, 22, 26)") { canvas = el; break; }
      }
      if (!canvas) return { error: "arena canvas not found" };
      const ctx = canvas.getContext("2d");
      if (!ctx) return { error: "arena canvas has no 2d context" };
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      let attackerCount = 0, attackerSumX = 0;
      let defenderCount = 0, defenderSumX = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (d[i + 3] === 0) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (Math.abs(r - 48) <= 4 && Math.abs(g - 112) <= 4 && Math.abs(b - 192) <= 4) {
            attackerCount++; attackerSumX += x;
          } else if (Math.abs(r - 192) <= 4 && Math.abs(g - 64) <= 4 && Math.abs(b - 64) <= 4) {
            defenderCount++; defenderSumX += x;
          }
        }
      }
      return {
        width: img.width,
        height: img.height,
        attackerCount,
        defenderCount,
        attackerMeanX: attackerCount > 0 ? attackerSumX / attackerCount : null,
        defenderMeanX: defenderCount > 0 ? defenderSumX / defenderCount : null,
      };
    });
    assert.ok(!("error" in pixels), `pixel grab failed: ${JSON.stringify(pixels)}`);
    const px = pixels as { width: number; height: number; attackerCount: number; defenderCount: number; attackerMeanX: number | null; defenderMeanX: number | null };
    assert.ok(px.attackerCount >= 20, `attacker accent #3070c0 matched only ${px.attackerCount} pixels (need >= 20) on ${px.width}x${px.height} arena canvas`);
    assert.ok(px.defenderCount >= 20, `defender accent #c04040 matched only ${px.defenderCount} pixels (need >= 20) on ${px.width}x${px.height} arena canvas`);
    assert.ok(
      px.attackerMeanX != null && px.defenderMeanX != null && px.attackerMeanX < px.defenderMeanX,
      `placement regression: attacker-blue centroid x=${px.attackerMeanX} must be strictly left of defender-red centroid x=${px.defenderMeanX} (attackerCount=${px.attackerCount}, defenderCount=${px.defenderCount})`,
    );
    console.log(`>> [C] placement OK: attacker #3070c0 x~${px.attackerMeanX?.toFixed(1)} (${px.attackerCount}px) LEFT of defender #c04040 x~${px.defenderMeanX?.toFixed(1)} (${px.defenderCount}px)`);

    assert.equal(consoleErrors.length, 0, `console/page errors during scenario C:\n${consoleErrors.join("\n")}`);
    console.log(`>> [C] pass (t+${((Date.now() - t0) / 1000).toFixed(1)}s total), console errors: 0`);
  } finally {
    // Closing mid-battle is deliberate: the assertions above are the scenario,
    // and deleting the game row lets the server AI driver evict its waiting
    // pass (game_gone) -- nothing left to stall a later scenario, since every
    // scenario owns its own game name.
    await page.close().catch(() => {});
    await deleteGame(name);
  }
}

async function main(): Promise<void> {
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);
    console.log(">> api + web up");
    const browser = await chromium.launch({ headless: true });
    try {
      await aiAttacksHumanModalAutoOpens(browser);
      await reloadMidOfferReopensModal(browser);
      await fightAsDefenderDeploysAttackerLeft(browser);
    } finally {
      await browser.close().catch(() => {});
    }
    console.log(">> aiDefender.e2e: ALL TESTS PASSED");
  } finally {
    await db.end().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error("TEST FAILED:", err); cleanup(); process.exit(1); },
);
