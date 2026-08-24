import { chromium, Browser, Page } from "playwright";
import { ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  getApiPort,
  getClientPort,
  spawnLogged,
  waitForUrl,
  treeKill,
  reapPreviousRunPids,
  clearRegisteredPids,
} from "./_request";

const API_PORT = getApiPort(4000);
const WEB_PORT = getClientPort(5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const children: ChildProcess[] = [];
let cleaned = false;

function startApi(): ChildProcess {
  const c = spawnLogged("api", "npx", ["tsx", "server/index.ts"], {
    API_PORT: String(API_PORT),
    CLIENT_PORT: String(WEB_PORT),
  });
  children.push(c);
  return c;
}

function startWeb(): ChildProcess {
  const c = spawnLogged("web", "npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {});
  children.push(c);
  return c;
}

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  console.log(">> Cleaning up subprocesses...");
  for (const c of children) {
    if (c.pid != null) treeKill(c.pid);
  }
  clearRegisteredPids();
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });

reapPreviousRunPids();

async function tailLog(label: string): Promise<string> {
  try { return readFileSync(`test/${label}.log`, "utf8").slice(-500); }
  catch { return "(no log)"; }
}

// ── Helpers ───────────────────────────────────────────────────────────

async function setupTestGame(page: Page): Promise<string> {
  console.log(">> Setting up game: capture a player-owned settlement");

  let owned = await page.evaluate(() => {
    return ((window as any).__gameDebug?.getSettlements?.() ?? []).find(
      (s: any) => s.ownerId === 0
    );
  });

  if (!owned) {
    const target = await page.evaluate(() => {
      return ((window as any).__gameDebug?.getSettlements?.() ?? []).find(
        (s: any) => s.ownerId === null || s.ownerId !== 0
      );
    });
    if (!target) throw new Error("No settlements to capture");

    await page.evaluate(
      ({ q, r }) => (window as any).__gameDebug.teleportHero?.("p0-hero", q, r),
      { q: target.q, r: target.r }
    );
    await wait(200);
    await page.evaluate(
      ({ sid }) => (window as any).__gameDebug.captureSettlement?.("p0-hero", sid),
      { sid: target.id }
    );
    await wait(300);
    owned = await page.evaluate(() =>
      ((window as any).__gameDebug?.getSettlements?.() ?? []).find(
        (s: any) => s.ownerId === 0
      )
    );
    if (!owned) throw new Error("Capture failed");
  }

  console.log(`>> Using settlement: ${owned.id}`);
  return owned.id;
}

async function openCityView(page: Page, settlementId: string): Promise<void> {
  const coords = await page.evaluate((sid: string) => {
    const dbg = (window as any).__gameDebug;
    const s = dbg?.getGameState?.()?.settlements?.[sid];
    if (!s) return null;
    return (dbg as any).screenFor(s.q, s.r);
  }, settlementId);
  if (!coords) throw new Error("Could not get screen coords");

  await page.mouse.click(coords.x, coords.y);
  await wait(150);
  await page.mouse.dblclick(coords.x, coords.y);
  await wait(500);
}

function paletteQuery() {
  return `Array.from(document.body.children).some(el => el.textContent?.includes("Building Palette"))`;
}

async function clickPaletteButton(page: Page, text: string): Promise<void> {
  const found = await page.evaluate((t: string) => {
    const palette = Array.from(document.body.children).find(
      (el) => el.textContent?.includes("Building Palette")
    );
    if (!palette) return false;
    for (const btn of Array.from(palette.querySelectorAll("button"))) {
      if (btn.textContent === t || btn.textContent?.includes(t)) {
        (btn as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, text);

  if (!found) {
    const body = await page.evaluate(() => {
      const p = Array.from(document.body.children).find(
        (el) => el.textContent?.includes("Building Palette")
      );
      if (!p) return "NO PALETTE";
      return Array.from(p.querySelectorAll("button")).map((b) => b.textContent).join(", ");
    });
    throw new Error(`Button "${text}" not found in palette. Buttons: ${body}`);
  }
  await wait(200);
}

// ── Tests ─────────────────────────────────────────────────────────────

async function testCityViewCanvas(page: Page): Promise<void> {
  console.log(">> Test: city view renders content");
  const nonBlack = await page.evaluate(() => {
    const c = document.getElementById("game") as HTMLCanvasElement;
    const img = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let y = 0; y < c.height; y += 16)
      for (let x = 0; x < c.width; x += 16) {
        const i = (y * c.width + x) * 4;
        if (img[i] > 15 || img[i + 1] > 15 || img[i + 2] > 15) n++;
      }
    return n;
  });
  assert(nonBlack > 20, `Expected >20 non-black sample pixels, got ${nonBlack}`);
  console.log(`>> ${nonBlack} non-black sample pixels ✓`);
}

async function testPaletteToggle(page: Page): Promise<void> {
  console.log(">> Test: palette toggle with B key");
  assert(!(await page.evaluate(paletteQuery())), "Palette should not be visible");

  await page.keyboard.press("b"); await wait(300);
  assert(await page.evaluate(paletteQuery()), "Palette should open with B");
  console.log(">> Palette opens ✓");

  await page.keyboard.press("b"); await wait(300);
  assert(!(await page.evaluate(paletteQuery())), "Palette should close with B");
  console.log(">> Palette closes ✓");
}

async function testPlacement(page: Page): Promise<void> {
  console.log(">> Test: building placement + confirm");

  await page.keyboard.press("b"); await wait(300);

  const hasHouse = await page.evaluate(() => {
    const palette = Array.from(document.body.children).find(
      (el) => el.textContent?.includes("Building Palette")
    );
    return palette?.textContent?.includes("House") ?? false;
  });
  assert(hasHouse, "Palette should list House");
  console.log(">> House in palette ✓");

  await clickPaletteButton(page, "House");
  await clickPaletteButton(page, "Confirm");

  assert(!(await page.evaluate(paletteQuery())), "Palette should close after confirm");
  console.log(">> Confirm closes palette ✓");
}

async function testDestroyMode(page: Page): Promise<void> {
  console.log(">> Test: destroy mode UI");

  await page.keyboard.press("b"); await wait(300);
  await clickPaletteButton(page, "Destroy");

  const hasInstructions = await page.evaluate(() => {
    const palette = Array.from(document.body.children).find(
      (el) => el.textContent?.includes("Building Palette")
    );
    return palette?.textContent?.includes("Click any building") ?? false;
  });
  assert(hasInstructions, "Destroy mode should show instructions");
  console.log(">> Destroy instructions visible ✓");

  await clickPaletteButton(page, "Confirm");
  console.log(">> Destroy mode complete ✓");
}

async function testEscapeHandling(page: Page): Promise<void> {
  console.log(">> Test: Escape key hierarchy");

  await page.keyboard.press("b"); await wait(300);
  await clickPaletteButton(page, "House");

  // 1st Escape: cancel placement, palette stays
  await page.keyboard.press("Escape"); await wait(200);
  assert(await page.evaluate(paletteQuery()), "First Escape should keep palette");
  console.log(">> 1st Escape keeps palette ✓");

  // 2nd Escape: close palette
  await page.keyboard.press("Escape"); await wait(200);
  assert(!(await page.evaluate(paletteQuery())), "Second Escape should close palette");
  console.log(">> 2nd Escape closes palette ✓");

  // 3rd Escape: close city view
  await page.keyboard.press("Escape"); await wait(400);
  const closed = await page.evaluate(() => {
    const c = document.getElementById("game") as HTMLCanvasElement;
    const img = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    return img[3] > 200 || (img[0] > 50 && img[1] > 50 && img[2] > 50);
  });
  assert(closed, "Third Escape should close city view");
  console.log(">> 3rd Escape closes city view ✓");
}

async function testPersistence(page: Page, settlementId: string): Promise<void> {
  console.log(">> Test: buildings persist in state");

  await openCityView(page, settlementId);
  await page.keyboard.press("b"); await wait(300);
  await clickPaletteButton(page, "House");
  await clickPaletteButton(page, "Confirm");

  // Close city view
  await page.keyboard.press("Escape"); await wait(200);
  if (await page.evaluate(paletteQuery())) { await page.keyboard.press("Escape"); await wait(200); }
  await page.keyboard.press("Escape"); await wait(400);

  // Reopen and verify
  await openCityView(page, settlementId);

  const hasBuildings = await page.evaluate((sid: string) => {
    const s = (window as any).__gameDebug?.getGameState?.()?.settlements?.[sid];
    return (s?.buildings?.length ?? 0) > 0;
  }, settlementId);
  assert(hasBuildings, "Buildings should persist in settlement state");
  console.log(">> Buildings persisted ✓");

  await page.keyboard.press("Escape"); await wait(200);
  if (await page.evaluate(paletteQuery())) { await page.keyboard.press("Escape"); await wait(200); }
  await page.keyboard.press("Escape"); await wait(400);
}

async function sampleSkyRegion(page: Page): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(() => {
    const c = document.getElementById("game") as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const data = ctx.getImageData(0, 0, c.width, Math.min(200, c.height)).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let y = 0; y < Math.min(200, c.height); y += 8) {
      for (let x = 0; x < c.width; x += 8) {
        const i = (y * c.width + x) * 4;
        if (data[i + 3] > 0) {
          rSum += data[i];
          gSum += data[i + 1];
          bSum += data[i + 2];
          count++;
        }
      }
    }
    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  });
}

async function testSkyboxVariantSwitch(page: Page): Promise<void> {
  console.log(">> Test: skybox variant switching");

  const baseline = await sampleSkyRegion(page);
  assert(baseline.r > 0 || baseline.g > 0 || baseline.b > 0, "Sky region should not be pure black on variant 1");
  console.log(`>> Variant 1 sky avg: rgb(${baseline.r},${baseline.g},${baseline.b}) ✓`);

  for (const v of [2, 3, 4]) {
    await page.evaluate((variant) => {
      (window as any).__gameDebug.settings.update({ spriteVariant: variant });
    }, v);
    await wait(1200);

    const sk = await sampleSkyRegion(page);
    assert(sk.r > 0 || sk.g > 0 || sk.b > 0, `Sky region should not be black on variant ${v}`);
    const changed = Math.abs(sk.r - baseline.r) > 5 || Math.abs(sk.g - baseline.g) > 5 || Math.abs(sk.b - baseline.b) > 5;
    assert(changed, `Sky color on variant ${v} should differ from variant 1 baseline (got rgb(${sk.r},${sk.g},${sk.b}) vs baseline rgb(${baseline.r},${baseline.g},${baseline.b}))`);
    console.log(`>> Variant ${v} sky avg: rgb(${sk.r},${sk.g},${sk.b}) ✓`);
  }

  // Reset to variant 1
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ spriteVariant: 1 });
  });
  await wait(1200);
}

async function testParallaxMode(page: Page): Promise<void> {
  console.log(">> Test: parallax mode");

  const baseline = await sampleSkyRegion(page);

  // Enable parallax with 4 layers
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ parallaxEnabled: true, parallaxLayerCount: 4 });
  });
  await wait(800);

  const para4 = await sampleSkyRegion(page);
  assert(para4.r > 0 || para4.g > 0 || para4.b > 0, "Sky should not be black with parallax 4");
  console.log(`>> Parallax 4-layer sky avg: rgb(${para4.r},${para4.g},${para4.b}) ✓`);

  // 2 layers
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ parallaxLayerCount: 2 });
  });
  await wait(500);
  const para2 = await sampleSkyRegion(page);
  assert(para2.r > 0 || para2.g > 0 || para2.b > 0, "Sky should not be black with parallax 2");
  console.log(`>> Parallax 2-layer sky avg: rgb(${para2.r},${para2.g},${para2.b}) ✓`);

  // Disable parallax
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ parallaxEnabled: false });
  });
  await wait(500);

  const afterDisable = await sampleSkyRegion(page);
  assert(afterDisable.r > 0 || afterDisable.g > 0 || afterDisable.b > 0, "Sky should not be black after disabling parallax");
  console.log(`>> Parallax disabled sky avg: rgb(${afterDisable.r},${afterDisable.g},${afterDisable.b}) ✓`);
}

async function testBgOffset(page: Page): Promise<void> {
  console.log(">> Test: background offset panning");

  const baseline = await sampleSkyRegion(page);

  // Pan right/down
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ cityBgOffsetX: 200, cityBgOffsetY: -100 });
  });
  await wait(500);

  const panned = await sampleSkyRegion(page);
  assert(panned.r > 0 || panned.g > 0 || panned.b > 0, "Sky should not be black after panning");
  console.log(`>> Panned sky avg: rgb(${panned.r},${panned.g},${panned.b}) ✓`);

  // Reset
  await page.evaluate(() => {
    (window as any).__gameDebug.settings.update({ cityBgOffsetX: 0, cityBgOffsetY: 0 });
  });
  await wait(500);
}

// ── Main ──────────────────────────────────────────────────────────────

async function run() {
  console.log(`>> Starting infrastructure on API=${API_PORT} WEB=${WEB_PORT} ...`);
  startApi();
  startWeb();

  let browser: Browser | undefined;
  let failed = false;

  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    console.log(">> API + Web ready");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(WEB_URL);
    await wait(1500);

    // Handle load/splash screen if present
    const body = (await page.textContent("body")) ?? "";
    if (body.includes("New Game") || body.includes("Load Game")) {
      const loadBtn = page.locator("button").filter({ hasText: /^Load Game$/ });
      if (await loadBtn.count() > 0) {
        await loadBtn.first().click({ trial: false, force: false });
        await wait(300);
        const openBtn = page.locator("button:visible").filter({ hasText: "Open" });
        if (await openBtn.count() > 0) {
          await openBtn.first().click();
          await wait(1000);
        }
      }
    }

    await page.waitForFunction(() => !!(window as any).__gameDebug, { timeout: 20000 });
    await wait(500);

    const settlementId = await setupTestGame(page);
    await openCityView(page, settlementId);

    await testCityViewCanvas(page);
    await testPaletteToggle(page);
    await testPlacement(page);
    await testDestroyMode(page);
    await testEscapeHandling(page);
    await testPersistence(page, settlementId);

    await openCityView(page, settlementId);
    await testSkyboxVariantSwitch(page);
    await testParallaxMode(page);
    await testBgOffset(page);

    console.log("\n>> All city view tests passed ✓");
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
