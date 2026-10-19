import { chromium, type Browser, type Page } from "playwright";
import type { ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { Pool } from "pg";
import "../server/persistence/pgTypes";
import {
  getApiPort, getClientPort, spawnLogged, waitForApiHealth, waitForUrl,
  treeKill, reapPreviousRunPids, clearRegisteredPids,
} from "./_request";
import type { GameDebugApi } from "../src/io/debugCommands";

// Mounted-hero variant e2e (Playwright + real API + real DB): the `paladin2`
// registry entry must be wired end to end, not just typecheck.
//
//  (A) the persisted `horseVariant` reaches the client for a game row seeded
//      with `paladin2` and the existing `paladin` still resolves its own set;
//  (B) every `horse.paladin2.<dir>` descriptor and the `HERO_BANNERS.paladin2`
//      banner resolve to real, servable PNGs — all eight directions, no
//      diagonal→cardinal fallback;
//  (C) the sprite actually paints: the same tile is sampled twice, once with
//      the original paladin and once with paladin2, and the crops must differ
//      while the paladin2 crop carries the new crimson cape/charcoal horse
//      pixels the original does not have.
//
// The game is created and deleted by exact name (never a table sweep).

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_NAME = "hero-variant-e2e";
const GAME_SEED = 424242;
const VARIANT = "paladin2";
const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

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
setTimeout(() => { console.error(">> heroVariants.e2e exceeded 300s, forcing exit"); cleanup(); process.exit(2); }, 300_000).unref();

const db = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "gameuser", password: process.env.PGPASSWORD ?? "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

interface GameRow {
  heroes: Record<string, { ownerId: number; q: number; r: number; horseVariant?: string }>;
}

interface Axial { q: number; r: number; }

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function serverHeroes(name: string): Promise<GameRow["heroes"]> {
  const r = await db.query(`SELECT heroes FROM games WHERE name = $1`, [name]);
  assert(r.rows[0], `game ${name} missing from db`);
  return r.rows[0].heroes as GameRow["heroes"];
}

async function freshGame(name: string): Promise<{ id: string }> {
  await api("DELETE", `/api/games/${name}`);
  const res = await api("POST", "/api/games", { name, seed: GAME_SEED, humanSlots: 1, enemySlots: 0 });
  assert.equal(res.status, 201, `create ${name} -> ${res.status}`);
  return res.json;
}

async function setHorseVariant(name: string, heroId: string, variant: string): Promise<void> {
  const heroes = await serverHeroes(name);
  assert(heroes[heroId], `hero ${heroId} not in ${name}`);
  heroes[heroId].horseVariant = variant;
  await db.query(`UPDATE games SET heroes = $1::jsonb, updated_at = now() WHERE name = $2`, [JSON.stringify(heroes), name]);
}

async function openGame(page: Page, name: string, gameId: string): Promise<void> {
  page.on("pageerror", (e) => console.error(`>> [pageerror] ${e.message}`));
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
  try {
    await page.waitForFunction((n) => (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName === n, name, { timeout: 30000 });
  } catch (err) {
    const dump = await page.evaluate(() => ({
      text: (document.body.innerText ?? "").slice(0, 1200),
      buttons: Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent?.trim()).slice(0, 40),
      debug: Boolean((window as unknown as { __gameDebug?: unknown }).__gameDebug),
      name: (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.activeGameName ?? null,
    }));
    console.error(">> openGame failed:", JSON.stringify(dump, null, 1));
    throw err;
  }
  await wait(700);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}

function clientHero(page: Page, heroId: string): Promise<{ horseVariant: string; q: number; r: number } | null> {
  return page.evaluate((id) => {
    const st = (window as unknown as { __gameDebug?: GameDebugApi }).__gameDebug?.getState?.();
    const h = st?.heroes?.[id];
    return h ? { horseVariant: h.horseVariant, q: h.q, r: h.r } : null;
  }, heroId);
}

/** Samples the game canvas around a hero's tile as raw RGBA (A/B diffing). */
function sampleHeroTile(page: Page, tile: Axial): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate((t) => {
    const dbg = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
    const c = document.getElementById("game") as HTMLCanvasElement;
    const cssW = c.getBoundingClientRect().width;
    const scale = c.width / cssW;
    const p = dbg.screenFor(t.q, t.r);
    const cx = Math.round(p.x * scale);
    const cy = Math.round(p.y * scale);
    const half = Math.round(50 * scale);
    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half * 2);
    const x1 = Math.min(c.width, cx + half);
    const y1 = Math.min(c.height, cy + Math.round(half * 0.4));
    const img = c.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0);
    return { width: img.width, height: img.height, data: Array.from(img.data) };
  }, tile);
}

interface CropDiff {
  pixels: number;
  changed: number;
  reddened: number;
  darkened: number;
}

// Same tile, same camera, only the hero's variant differs between the two
// loads, so every changed pixel IS the sprite. That keeps terrain out of the
// assertion (a raw crimson count on a forest/dirt tile is mostly terrain).
function diffCrops(before: { width: number; height: number; data: number[] }, after: typeof before): CropDiff {
  assert.equal(after.width, before.width, "crop width changed between loads");
  assert.equal(after.height, before.height, "crop height changed between loads");
  let changed = 0, reddened = 0, darkened = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const r1 = before.data[i], g1 = before.data[i + 1], b1 = before.data[i + 2];
    const r2 = after.data[i], g2 = after.data[i + 1], b2 = after.data[i + 2];
    const delta = Math.abs(r2 - r1) + Math.abs(g2 - g1) + Math.abs(b2 - b1);
    if (delta < 30) continue;
    changed++;
    if (r2 - r1 > 40 && g2 - g1 < 20 && b2 - b1 < 20) reddened++;
    if ((r1 + g1 + b1) - (r2 + g2 + b2) > 90) darkened++;
  }
  return { pixels: before.data.length / 4, changed, reddened, darkened };
}

async function descriptorReport(page: Page): Promise<{
  paladin2Urls: Record<string, string>;
  paladinKeys: string[];
  paladin2Keys: string[];
  bannerUrl: string | null;
  bannerLoaded: { ok: boolean; bytes: number };
  images: Array<{ dir: string; ok: boolean; bytes: number }>;
  registry: string[];
}> {
  return page.evaluate(async (dirs) => {
    const spec = "/src/render/assetDescriptors.ts";
    const mod = await import(/* @vite-ignore */ spec);
    // The recruit picker (settlementInfoMenu) iterates this same registry
    // array, so asserting the entry here asserts the in-game option exists.
    const settingsSpec = "/src/state/settings.ts";
    const settingsMod = await import(/* @vite-ignore */ settingsSpec);
    const registry = (settingsMod.HORSE_VARIANT_REGISTRY as ReadonlyArray<{ id: string; label: string }>)
      .map((v) => `${v.id}:${v.label}`);
    const variants = mod.HORSE_VARIANT_DESCRIPTORS as Record<string, Record<string, { url: string }>>;
    const banners = mod.HERO_BANNERS as Record<string, string>;
    const paladin2 = variants.paladin2 ?? {};
    const urls: Record<string, string> = {};
    for (const dir of dirs) {
      const key = `horse.paladin2.${dir}`;
      urls[dir] = paladin2[key]?.url ?? "";
    }
    const images: Array<{ dir: string; ok: boolean; bytes: number }> = [];
    for (const dir of dirs) {
      const url = urls[dir];
      if (!url) { images.push({ dir, ok: false, bytes: 0 }); continue; }
      const res = await fetch(url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      images.push({ dir, ok: res.ok && png && buf.length > 10_000, bytes: buf.length });
    }
    const bannerUrl = banners.paladin2 ?? null;
    let bannerLoaded = { ok: false, bytes: 0 };
    if (bannerUrl) {
      const res = await fetch(bannerUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      bannerLoaded = { ok: res.ok && png && buf.length > 5_000, bytes: buf.length };
    }
    return {
      paladin2Urls: urls,
      paladinKeys: Object.keys(variants.paladin ?? {}).sort(),
      paladin2Keys: Object.keys(paladin2).sort(),
      bannerUrl,
      bannerLoaded,
      images,
      registry,
    };
  }, [...DIRECTIONS]);
}

async function screenshotTile(page: Page, tile: Axial, file: string): Promise<void> {
  mkdirSync("local/hero-variant-e2e", { recursive: true });
  // screenFor() is canvas-space CSS px; the screenshot clips the PAGE, so add
  // the canvas's viewport offset (the toolbar sits above it). The mounted
  // sprite is bottom-anchored below the hex centre, hence the taller box.
  const shot = await page.evaluate((t) => {
    const dbg = (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug;
    const c = document.getElementById("game") as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const p = dbg.screenFor(t.q, t.r);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, tile);
  await page.screenshot({
    path: file,
    clip: { x: Math.max(0, shot.x - 80), y: Math.max(0, shot.y - 120), width: 160, height: 200 },
  });
}

async function variantIsWired(browser: Browser): Promise<void> {
  console.log(">> [A] paladin2 reaches the client, paladin keeps its own descriptor set");
  const game = await freshGame(GAME_NAME);
  const heroes = await serverHeroes(GAME_NAME);
  const heroId = Object.keys(heroes).find((id) => heroes[id].ownerId === 0);
  assert(heroId, "no human hero in the fresh game");

  await setHorseVariant(GAME_NAME, heroId!, "paladin");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openGame(page, GAME_NAME, game.id);
  const asPaladin = await clientHero(page, heroId!);
  assert.equal(asPaladin?.horseVariant, "paladin", "seeded paladin variant did not reach the client");
  const tile = { q: asPaladin!.q, r: asPaladin!.r };
  const paladinCrop = await sampleHeroTile(page, tile);
  await screenshotTile(page, tile, "local/hero-variant-e2e/paladin-tile.png");
  assert(
    paladinCrop.width > 60 && paladinCrop.height > 80,
    `hero tile sample too small (${paladinCrop.width}x${paladinCrop.height})`,
  );

  await setHorseVariant(GAME_NAME, heroId!, VARIANT);
  await openGame(page, GAME_NAME, game.id);
  const asPaladin2 = await clientHero(page, heroId!);
  assert.equal(asPaladin2?.horseVariant, VARIANT, `${VARIANT} did not reach the client`);
  const paladin2Crop = await sampleHeroTile(page, tile);

  const diff = diffCrops(paladinCrop, paladin2Crop);
  console.log(
    `>> [A] same-tile diff: ${diff.changed}/${diff.pixels} px changed, ` +
    `${diff.reddened} reddened, ${diff.darkened} darkened`,
  );
  assert(diff.changed > 250, `paladin2 barely changed the tile (${diff.changed} px) — new sprite is not on screen`);
  assert(
    diff.reddened > diff.changed * 0.1,
    `expected the crimson cape/tabard to replace non-red pixels (${diff.reddened}/${diff.changed} reddened)`,
  );
  assert(
    diff.darkened > diff.changed * 0.35,
    `expected the charcoal horse to darken the tile (${diff.darkened}/${diff.changed} darkened)`,
  );

  console.log(">> [B] all eight horse.paladin2.* descriptors and the banner resolve to real PNGs");
  const report = await descriptorReport(page);
  assert.equal(report.paladin2Keys.length, DIRECTIONS.length, `paladin2 descriptor keys: ${report.paladin2Keys.join(",")}`);
  for (const img of report.images) {
    assert(img.ok, `horse.paladin2.${img.dir} -> ${img.bytes} bytes (url ${report.paladin2Urls[img.dir] || "missing"})`);
  }
  assert(report.bannerUrl, "HERO_BANNERS.paladin2 is missing");
  assert(report.bannerLoaded.ok, `hero-banner-paladin2.png -> ${report.bannerLoaded.bytes} bytes`);
  assert(
    report.registry.includes("paladin2:Paladin 2"),
    `the recruit picker's registry is missing paladin2: ${report.registry.join(", ")}`,
  );
  assert(
    report.registry.includes("paladin:Paladin"),
    `the original paladin left the recruit picker's registry: ${report.registry.join(", ")}`,
  );
  assert.deepEqual(
    report.paladinKeys,
    [
      "horse.paladin.e", "horse.paladin.e.2",
      "horse.paladin.n", "horse.paladin.n.2", "horse.paladin.ne", "horse.paladin.ne.2",
      "horse.paladin.nw", "horse.paladin.nw.2", "horse.paladin.s", "horse.paladin.s.2",
      "horse.paladin.se", "horse.paladin.se.2", "horse.paladin.sw", "horse.paladin.sw.2",
      "horse.paladin.w", "horse.paladin.w.2",
    ],
    `the original paladin's descriptor set changed: ${report.paladinKeys.join(",")}`,
  );

  const shotDir = "local/hero-variant-e2e";
  await screenshotTile(page, tile, `${shotDir}/paladin2-tile.png`);
  writeFileSync(`${shotDir}/paladin2-descriptors.json`, JSON.stringify(report, null, 2));
  console.log(`>> [B] screenshots + descriptor dump in ${shotDir}/`);

  await page.close();
}

async function main(): Promise<void> {
  console.log(`>> heroVariants e2e on api=${API_PORT} web=${WEB_PORT}`);
  children.push(spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) }));
  children.push(spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {}));
  try {
    await waitForUrl(`${API_URL}/api/health`, 45000);
    await waitForUrl(WEB_URL, 45000);
    await waitForApiHealth(API_URL);

    const browser = await chromium.launch({ headless: true });
    try {
      await variantIsWired(browser);
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    await api("DELETE", `/api/games/${GAME_NAME}`).catch(() => {});
    await db.end().catch(() => {});
    cleanup();
  }
  console.log(">> heroVariants e2e passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
