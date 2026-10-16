// Documentation screenshots for docs/README.md.
// Captures five views of the running game (Docker stack: web on 5173, api on
// 3001) and writes them to docs/screenshots/. Re-run from the repo root with
// `node tools/doc-screenshots.mjs` while that stack is up; the script also
// deletes the temporary game it creates.

import { chromium } from "playwright";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const WEB_URL = "http://localhost:5173";
const API_URL = "http://127.0.0.1:3001";
const GAME_NAME = "doc-screenshots";
const GAME_SEED = "90210";
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = resolve(process.cwd(), "docs", "screenshots");
const MIN_PNG_BYTES = 20 * 1024;

const results = [];
const consoleErrors = [];

// Deterministic Math.random() (mulberry32) so client-side rolls that aren't
// driven by the game's own seeded RNG (e.g. the Test Battle sandbox's roster)
// still produce identical output across runs -- the visual-regression suite
// seeds with the same helper.
function seededRandomInitScript(seed) {
  return (s) => {
    let state = s >>> 0;
    Math.random = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(context) {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.addInitScript(seededRandomInitScript(424242), 424242);
  // Clear storage before any app code runs instead of goto+reload: the app fires
  // its boot fetches at module evaluation, so a reload right after load aborts an
  // in-flight request and surfaces as a benign console warning.
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch {}
  });
  // "load", not "networkidle": once a session boots, its SSE event stream holds a
  // pending request forever, so networkidle can never fire.
  await page.goto(WEB_URL, { waitUntil: "load" });
  return page;
}

async function shoot(page, name, note = "") {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  const size = (await stat(path)).size;
  const ok = size > MIN_PNG_BYTES;
  results.push({ name, ok, size, note });
  console.log(`>> [${ok ? "OK" : "TOO SMALL"}] ${name} -- ${(size / 1024).toFixed(1)} KB${note ? ` -- ${note}` : ""}`);
  return ok;
}

async function bodyText(page) {
  try {
    return (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim().slice(0, 900);
  } catch {
    return "(no body)";
  }
}

// A failing step must not abort the remaining shots: log it, keep going.
async function attempt(name, fn) {
  try {
    await fn();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`!! ${name} failed: ${msg}`);
    console.error(`!! body: ${await bodyText(page)}`);
    results.push({ name, ok: false, size: 0, note: `FAILED: ${msg}` });
  }
}

// The home overlay is only appended once main.ts's async initBackend() resolves,
// so "load" can land before it exists.
async function waitForHomeOverlay(page) {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("h1")).some((h) => (h.textContent || "").trim() === "Heroes JS"),
    null,
    { timeout: 30_000 },
  );
}

async function dismissHomeAndCreateGame(page) {
  // The toolbar's own "New Game" item is already in the DOM behind the home
  // overlay, so scope to home's copy -- home's root is appended to <body> after
  // the toolbar is built, making it reliably the last "New Game" button.
  await page.locator("button", { hasText: "New Game" }).last().click();
  await wait(150);
  await page.locator("input[type=text]").first().fill(GAME_NAME);
  await page.locator("input[type=number]").first().fill(GAME_SEED);
  await page.locator("button", { hasText: "Create Game" }).click();
  await page.waitForFunction(
    (name) => !!(window.__gameDebug && window.__gameDebug.activeGameName === name),
    GAME_NAME,
    { timeout: 30_000 },
  );
  // The create screen tears itself down right after the name lands.
  await page.locator("button", { hasText: "Create Game" }).first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  await wait(400);
}

const playerHero = (page) =>
  page.evaluate(() => {
    const list = window.__gameDebug.getHeroes() || [];
    return list.find((h) => h.ownerId === 0) || null;
  });

const playerSettlement = (page) =>
  page.evaluate(() => {
    const list = window.__gameDebug.getSettlements() || [];
    return list.find((s) => s.ownerId === 0) || null;
  });

const cityViewOpen = () =>
  Array.from(document.body.children).some((el) => (el.textContent || "").includes("City Design"));

let page;

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: VIEWPORT });
  page = await newPage(context);

  // 1. Home screen
  await attempt("home-screen", async () => {
    await waitForHomeOverlay(page);
    const body = await bodyText(page);
    for (const needle of ["New Game", "Settings"]) {
      if (!body.includes(needle)) throw new Error("home body missing: " + needle);
    }
    await shoot(page, "home-screen", "body has New Game + Settings");
  });

  // 2. Adventure map
  await attempt("adventure-map", async () => {
    await dismissHomeAndCreateGame(page);
    const hero = await playerHero(page);
    if (!hero) throw new Error("no player hero (ownerId 0) in created game");
    await page.evaluate((id) => window.__gameDebug.setSelectedHero(id), hero.id);
    await wait(300);
    const target = await page.evaluate(() => {
      const rect = document.querySelector("canvas").getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + 220, y: rect.top + rect.height / 2 + 110 };
    });
    await page.mouse.move(target.x, target.y);
    await wait(300);
    await shoot(page, "adventure-map", `hero ${hero.id} selected, path overlay hovered`);
  });

  // 3. Hero info panel
  await attempt("hero-info-panel", async () => {
    const hero = await playerHero(page);
    if (!hero) throw new Error("no player hero (ownerId 0)");
    const coords = await page.evaluate((h) => window.__gameDebug.screenFor(h.q, h.r), hero);
    await page.mouse.click(coords.x, coords.y);
    await wait(400);
    const right = await page.evaluate(() => {
      const rect = document.querySelector("canvas").getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + 200, y: rect.top + rect.height / 2 + 60 };
    });
    await page.mouse.move(right.x, right.y);
    await wait(200);
    const body = await bodyText(page);
    const hasPanel = body.toLowerCase().includes("army");
    if (!hasPanel) console.error(`?? hero panel check: body has no "Army" -- ${body}`);
    await shoot(page, "hero-info-panel", hasPanel ? "hero panel present (Army section)" : "hero panel UNVERIFIED");
  });

  // 4. City view
  await attempt("city-view", async () => {
    const settlement = await playerSettlement(page);
    if (!settlement) throw new Error("no player-owned settlement (ownerId 0)");
    const coords = await page.evaluate((s) => window.__gameDebug.screenFor(s.q, s.r), settlement);
    await page.mouse.click(coords.x, coords.y);
    await wait(150);
    await page.mouse.dblclick(coords.x, coords.y);
    await wait(600);
    const body = await bodyText(page);
    const hasWarehouse = body.toLowerCase().includes("warehouse");
    if (!hasWarehouse) console.error(`?? city view check: body has no "Warehouse" -- ${body}`);
    await shoot(page, "city-view", hasWarehouse ? "city view open, Warehouse accordion expanded" : "city view Warehouse UNVERIFIED");
  });

  // 5. Battle arena
  await attempt("battle-arena", async () => {
    // The Menu button lives in the toolbar, so leave the city view first.
    for (let i = 0; i < 3; i++) {
      if (!(await page.evaluate(cityViewOpen))) break;
      await page.keyboard.press("Escape");
      await wait(300);
    }
    await page.locator('#toolbar button[title="Menu"]').click();
    await page.locator("#toolbar button", { hasText: "Test Battle" }).click();
    await page.locator("button", { hasText: "Start Battle" }).click({ timeout: 15_000 });
    await wait(800);
    const counts = await page.evaluate(() => {
      const sample = (c) => {
        const img = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let y = 0; y < c.height; y += 16)
          for (let x = 0; x < c.width; x += 16) {
            const i = (y * c.width + x) * 4;
            if (img[i] > 15 || img[i + 1] > 15 || img[i + 2] > 15) n++;
          }
        return n;
      };
      return Array.from(document.querySelectorAll("canvas")).map(sample);
    });
    const first = counts.length > 0 ? counts[0] : 0;
    const best = counts.length > 0 ? Math.max(...counts) : 0;
    if (best <= 20) throw new Error(`non-trivial render check failed: counts=${counts.join(",")}`);
    const body = await bodyText(page);
    if (!body.includes("Test Battle")) console.error(`?? arena check: body has no "Test Battle" -- ${body}`);
    await shoot(page, "battle-arena", `${counts.length} canvases, non-black samples=${counts.join("/")} (first=${first}, max=${best})`);
  });
} finally {
  await browser.close().catch(() => {});
}

// Tidy up the shared DB.
try {
  const res = await fetch(`${API_URL}/api/games/${GAME_NAME}`, { method: "DELETE" });
  const text = await res.text().catch(() => "");
  console.log(`>> DELETE /api/games/${GAME_NAME} -> ${res.status} ${text}`.trim());
} catch (err) {
  console.error(`!! game delete failed: ${err && err.message ? err.message : err}`);
}

console.log("\n== summary ==");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${(r.size / 1024).toFixed(1)} KB  ${r.note}`);
}
if (consoleErrors.length > 0) {
  console.log("\n== browser console errors ==");
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log(` - ${e}`);
}
