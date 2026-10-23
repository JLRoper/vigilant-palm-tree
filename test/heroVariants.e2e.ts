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

// Mounted-hero variant e2e (Playwright + real API + real DB): every generated
// variant in VARIANTS must be wired end to end, not just typecheck.
//
//  (A) the persisted `horseVariant` reaches the client for a game row seeded
//      with that variant, and the variant it was repainted from (its "base")
//      still resolves its own descriptor set;
//  (B) every `horse.<variant>.<dir>` descriptor and its `HERO_BANNERS` banner
//      resolve to real, servable PNGs — all eight directions, no fallback;
//  (C) the sprite actually paints and is visually distinct from its base: the
//      same tile is sampled twice, once with the base variant and once with the
//      new one, and the A/B diff must show the palette shift the art was
//      generated for (reddened capes, darkened undead horses, cooled frost
//      palettes) and nothing terrain-driven.
//
// The game is created and deleted by exact name (never a table sweep).

const API_PORT = getApiPort(3001);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const GAME_NAME = "hero-variant-e2e";
const GAME_SEED = 424242;
const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

/** How a variant's generated palette must differ from its base sprite set. */
type PaletteSignal = "reddened" | "corrupted" | "cooled" | "darkened" | "gilded" | "regeared";

interface VariantSpec {
  id: string;
  label: string;
  base: string;
  signal: PaletteSignal;
}

const VARIANTS: VariantSpec[] = [
  { id: "paladin2", label: "Paladin 2", base: "paladin", signal: "reddened" },
  { id: "frostwarden", label: "Frost Warden", base: "paladin", signal: "cooled" },
  { id: "gravewarden", label: "Grave Warden", base: "shadow", signal: "corrupted" },
  { id: "stormrider", label: "Storm Rider", base: "ranger", signal: "cooled" },
  { id: "blackdragon", label: "Black Dragon Rider", base: "drake", signal: "darkened" },
  { id: "reddragon", label: "Red Dragon Rider", base: "drake", signal: "reddened" },
  { id: "griffin", label: "Griffin Rider", base: "drake", signal: "gilded" },
  { id: "nomad", label: "Desert Nomad Rider", base: "ranger", signal: "regeared" },
];

// The paladin predates the generated waves; its descriptor set is the control
// that a new variant never perturbs an existing one (4 directions x base + -2,
// with the diagonal→cardinal fallbacks).
const PALADIN_KEYS = [
  "horse.paladin.e", "horse.paladin.e.2",
  "horse.paladin.n", "horse.paladin.n.2", "horse.paladin.ne", "horse.paladin.ne.2",
  "horse.paladin.nw", "horse.paladin.nw.2", "horse.paladin.s", "horse.paladin.s.2",
  "horse.paladin.se", "horse.paladin.se.2", "horse.paladin.sw", "horse.paladin.sw.2",
  "horse.paladin.w", "horse.paladin.w.2",
];

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
interface Crop { width: number; height: number; data: number[]; }

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
function sampleHeroTile(page: Page, tile: Axial): Promise<Crop> {
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
  cooled: number;
  greened: number;
  gilded: number;
}

// Same tile, same camera, only the hero's variant differs between the two
// loads, so every changed pixel IS the sprite. That keeps terrain out of the
// assertion (a raw colour count on a forest/dirt tile is mostly terrain), and
// lets each variant declare the palette shift its art was generated for.
function diffCrops(before: Crop, after: Crop): CropDiff {
  assert.equal(after.width, before.width, "crop width changed between loads");
  assert.equal(after.height, before.height, "crop height changed between loads");
  let changed = 0, reddened = 0, darkened = 0, cooled = 0, greened = 0, gilded = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const r1 = before.data[i], g1 = before.data[i + 1], b1 = before.data[i + 2];
    const r2 = after.data[i], g2 = after.data[i + 1], b2 = after.data[i + 2];
    const delta = Math.abs(r2 - r1) + Math.abs(g2 - g1) + Math.abs(b2 - b1);
    if (delta < 30) continue;
    changed++;
    if (r2 - r1 > 40 && g2 - g1 < 20 && b2 - b1 < 20) reddened++;
    if ((r1 + g1 + b1) - (r2 + g2 + b2) > 90) darkened++;
    if (b2 - b1 > 25 && b2 > r2 + 8) cooled++;
    if (g2 - g1 > 20 && g2 > r2 + 10 && g2 > b2 + 10) greened++;
    // A gilded pixel is one the repaint turned from a cool/green hue into warm
    // gold: the red channel gained and now dominates both other channels.
    if (r2 - r1 > 30 && r2 > g2 + 20 && r2 > b2 + 50) gilded++;
  }
  return { pixels: before.data.length / 4, changed, reddened, darkened, cooled, greened, gilded };
}

interface VariantReport {
  urls: Record<string, string>;
  keys: string[];
  bannerUrl: string | null;
  bannerLoaded: { ok: boolean; bytes: number };
  images: Array<{ dir: string; ok: boolean; bytes: number }>;
  registry: string[];
  paladinKeys: string[];
}

async function descriptorReport(page: Page, variant: string): Promise<VariantReport> {
  return page.evaluate(async (args) => {
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
    const set = variants[args.variant] ?? {};
    const urls: Record<string, string> = {};
    for (const dir of args.dirs) {
      urls[dir] = set[`horse.${args.variant}.${dir}`]?.url ?? "";
    }
    const images: Array<{ dir: string; ok: boolean; bytes: number }> = [];
    for (const dir of args.dirs) {
      const url = urls[dir];
      if (!url) { images.push({ dir, ok: false, bytes: 0 }); continue; }
      const res = await fetch(url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      images.push({ dir, ok: res.ok && png && buf.length > 10_000, bytes: buf.length });
    }
    const bannerUrl = banners[args.variant] ?? null;
    let bannerLoaded = { ok: false, bytes: 0 };
    if (bannerUrl) {
      const res = await fetch(bannerUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      bannerLoaded = { ok: res.ok && png && buf.length > 5_000, bytes: buf.length };
    }
    return {
      urls,
      keys: Object.keys(set).sort(),
      bannerUrl,
      bannerLoaded,
      images,
      registry,
      paladinKeys: Object.keys(variants.paladin ?? {}).sort(),
    };
  }, { variant, dirs: [...DIRECTIONS] });
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

function assertSignal(variant: VariantSpec, diff: CropDiff): void {
  assert(diff.changed > 250, `${variant.id} barely changed the tile (${diff.changed} px) — new sprite is not on screen`);
  if (variant.signal === "reddened") {
    assert(
      diff.reddened > diff.changed * 0.08,
      `${variant.id}: expected crimson cape/tabard pixels (${diff.reddened}/${diff.changed} reddened)`,
    );
  } else if (variant.signal === "corrupted") {
    // The Grave Warden is a repaint of an already-dark base, so "darker" alone
    // is a weak signal; the necrotic palette shows up as darker AND greener.
    assert(
      diff.darkened + diff.greened > diff.changed * 0.3,
      `${variant.id}: expected a darker, green-tinged undead horse ` +
      `(${diff.darkened} darkened + ${diff.greened} greened of ${diff.changed})`,
    );
  } else if (variant.signal === "darkened") {
    // The Black Dragon Rider is obsidian with an indigo sheen, so the palette
    // shift lands in BOTH the darkened and cooled buckets.
    assert(
      diff.darkened + diff.cooled > diff.changed * 0.35,
      `${variant.id}: expected the green drake's scales to go black/indigo ` +
      `(${diff.darkened} darkened + ${diff.cooled} cooled of ${diff.changed})`,
    );
  } else if (variant.signal === "gilded") {
    // The Griffin Rider turns the same green drake's scales and the rider's
    // gold armour into tawny gold, so the shift lands in the gilded bucket
    // (450/1293 changed pixels measured).
    assert(
      diff.gilded > diff.changed * 0.1,
      `${variant.id}: expected the green drake to turn warm gold ` +
      `(${diff.gilded} gilded of ${diff.changed})`,
    );
  } else if (variant.signal === "regeared") {
    // The Desert Nomad Rider re-gears the ranger rather than recolouring one
    // palette: the indigo robes and head wrap land in the cooled bucket and
    // the darker horse legs/hooves in the darkened one, with the pale sand
    // coat taking the rest of the change (291/842 changed pixels measured).
    assert(
      diff.cooled + diff.darkened > diff.changed * 0.3,
      `${variant.id}: expected indigo robes over a sand horse ` +
      `(${diff.cooled} cooled + ${diff.darkened} darkened of ${diff.changed})`,
    );
  } else {
    assert(
      diff.cooled > diff.changed * 0.12,
      `${variant.id}: expected a cooler palette (${diff.cooled}/${diff.changed} cooled)`,
    );
  }
}

async function variantsAreWired(browser: Browser): Promise<void> {
  console.log(`>> [A] ${VARIANTS.length} generated variants reach the client over their base sprite sets`);
  const game = await freshGame(GAME_NAME);
  const heroes = await serverHeroes(GAME_NAME);
  const heroId = Object.keys(heroes).find((id) => heroes[id].ownerId === 0);
  assert(heroId, "no human hero in the fresh game");

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseCrops = new Map<string, Crop>();
  const tileByBase = new Map<string, Axial>();
  let paladinKeysChecked = false;

  for (const variant of VARIANTS) {
    if (!baseCrops.has(variant.base)) {
      await setHorseVariant(GAME_NAME, heroId!, variant.base);
      await openGame(page, GAME_NAME, game.id);
      const hero = await clientHero(page, heroId!);
      assert.equal(hero?.horseVariant, variant.base, `seeded base variant ${variant.base} did not reach the client`);
      const tile: Axial = { q: hero!.q, r: hero!.r };
      const crop = await sampleHeroTile(page, tile);
      assert(crop.width > 60 && crop.height > 80, `hero tile sample too small (${crop.width}x${crop.height})`);
      baseCrops.set(variant.base, crop);
      tileByBase.set(variant.base, tile);
      await screenshotTile(page, tile, `local/hero-variant-e2e/${variant.base}-tile.png`);
    }

    const tile = tileByBase.get(variant.base)!;
    await setHorseVariant(GAME_NAME, heroId!, variant.id);
    await openGame(page, GAME_NAME, game.id);
    const hero = await clientHero(page, heroId!);
    assert.equal(hero?.horseVariant, variant.id, `${variant.id} did not reach the client`);

    const crop = await sampleHeroTile(page, tile);
    const diff = diffCrops(baseCrops.get(variant.base)!, crop);
    console.log(
      `>> [A] ${variant.id} vs ${variant.base}: ${diff.changed}/${diff.pixels} px changed, ` +
      `${diff.reddened} reddened, ${diff.darkened} darkened, ${diff.cooled} cooled, ` +
      `${diff.greened} greened, ${diff.gilded} gilded`,
    );
    assertSignal(variant, diff);

    console.log(`>> [B] ${variant.id}: eight descriptors + banner + recruit-picker entry`);
    const report = await descriptorReport(page, variant.id);
    assert.equal(report.keys.length, DIRECTIONS.length, `${variant.id} descriptor keys: ${report.keys.join(",")}`);
    for (const img of report.images) {
      assert(img.ok, `horse.${variant.id}.${img.dir} -> ${img.bytes} bytes (url ${report.urls[img.dir] || "missing"})`);
    }
    assert(report.bannerUrl, `HERO_BANNERS.${variant.id} is missing`);
    assert(report.bannerLoaded.ok, `hero-banner-${variant.id}.png -> ${report.bannerLoaded.bytes} bytes`);
    assert(
      report.registry.includes(`${variant.id}:${variant.label}`),
      `the recruit picker's registry is missing ${variant.id}: ${report.registry.join(", ")}`,
    );
    if (!paladinKeysChecked) {
      assert.deepEqual(
        report.paladinKeys,
        PALADIN_KEYS,
        `the original paladin's descriptor set changed: ${report.paladinKeys.join(",")}`,
      );
      assert(
        report.registry.includes("paladin:Paladin"),
        `the original paladin left the recruit picker's registry: ${report.registry.join(", ")}`,
      );
      paladinKeysChecked = true;
    }

    await screenshotTile(page, tile, `local/hero-variant-e2e/${variant.id}-tile.png`);
    writeFileSync(`local/hero-variant-e2e/${variant.id}-descriptors.json`, JSON.stringify(report, null, 2));
  }

  console.log(">> screenshots + descriptor dumps in local/hero-variant-e2e/");
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
      await variantsAreWired(browser);
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
