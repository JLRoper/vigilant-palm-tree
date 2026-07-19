import { chromium, Browser, Page, request as pwRequest } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync } from "node:fs";

const WEB_PORT = 4173;
const API_PORT = 3001;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const GAME_NAME = "default";

async function ensureBuilt() {
  if (!existsSync("dist/index.html")) {
    console.log(">> building dist");
    await runOnce("npm", ["run", "build"]);
  }
}

function runOnce(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function startApi(): ChildProcess {
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[api] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[api] ${d}`));
  return child;
}

function startWeb(): ChildProcess {
  return spawn("npx", ["vite", "preview", "--port", String(WEB_PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}

async function waitForUrl(url: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`server at ${url} did not respond`);
}

async function sampleNonBlackPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById("game") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;
    let nonBlack = 0;
    const step = 32;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (img[i] > 8 || img[i + 1] > 8 || img[i + 2] > 8) nonBlack++;
      }
    }
    return nonBlack;
  });
}

async function heroTile(page: Page): Promise<{ q: number; r: number }> {
  return page.evaluate(() => {
    const hud = document.getElementById("hud")!;
    const m = hud.textContent!.match(/Hero \((\d+), (\d+)\)/);
    return m ? { q: Number(m[1]), r: Number(m[2]) } : { q: -1, r: -1 };
  });
}

async function run() {
  await ensureBuilt();
  const api = startApi();
  const web = startWeb();
  let browser: Browser | undefined;
  let failed = false;
  try {
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    console.log(">> api + web up");

    const ctx = await pwRequest.newContext();
    const health = await ctx.get(`${API_URL}/api/health`);
    const healthBody = await health.json();
    console.log(`>> api health: ${JSON.stringify(healthBody)}`);
    if (!healthBody.ok) throw new Error("api health not ok");

    await ctx.delete(`${API_URL}/api/games/${GAME_NAME}`);
    console.log(`>> reset game '${GAME_NAME}'`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[browser error]", msg.text());
    });

    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await wait(400);

    const before = await sampleNonBlackPixels(page);
    const heroStart = await heroTile(page);
    console.log(`>> canvas non-black pixels: ${before}`);
    console.log(`>> hero start: ${JSON.stringify(heroStart)}`);

    if (before < 50) throw new Error(`Canvas appears blank (${before} non-black samples)`);
    if (heroStart.q !== 2 || heroStart.r !== 2) throw new Error(`Hero did not start at (2,2)`);

    const box = await page.locator("#game").boundingBox();
    if (!box) throw new Error("No canvas bbox");

    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60);
    await wait(100);
    const beforeClick = await page.evaluate(() => (window as any).__gameDebug?.click);
    console.log(`>> debug before click: ${JSON.stringify(beforeClick)}`);
    await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60);
    await wait(1200);

    const heroAfter = await heroTile(page);
    const debug = await page.evaluate(() => (window as any).__gameDebug);
    console.log(`>> hero after click: ${JSON.stringify(heroAfter)}`);
    console.log(`>> debug: ${JSON.stringify(debug)}`);
    if (heroAfter.q === heroStart.q && heroAfter.r === heroStart.r) {
      throw new Error(`Hero did not move after click. Debug: ${JSON.stringify(debug)}`);
    }

    await wait(500);
    const game = await ctx.get(`${API_URL}/api/games/${GAME_NAME}`);
    const gameBody = await game.json();
    console.log(`>> api game: ${JSON.stringify(gameBody)}`);
    if (gameBody.hero_q !== heroAfter.q || gameBody.hero_r !== heroAfter.r) {
      throw new Error(
        `DB hero (${gameBody.hero_q},${gameBody.hero_r}) != canvas hero (${heroAfter.q},${heroAfter.r})`
      );
    }

    const events = await ctx.get(`${API_URL}/api/games/${GAME_NAME}/events`);
    const eventsBody = await events.json();
    console.log(`>> events: ${eventsBody.length}`);
    if (eventsBody.length < 1) throw new Error("No events logged");

    await page.screenshot({ path: "test/screenshot.png" });
    console.log(">> screenshot saved");

    const dprPage = await browser.newPage({
      viewport: { width: 1024, height: 720 },
      deviceScaleFactor: 2,
    });
    await dprPage.goto(WEB_URL, { waitUntil: "networkidle" });
    await wait(300);
    const dprInfo = await dprPage.evaluate(() => ({
      dpr: window.devicePixelRatio,
      cssW: window.innerWidth,
      cssH: window.innerHeight,
      canvasW: (document.getElementById("game") as HTMLCanvasElement).width,
      canvasH: (document.getElementById("game") as HTMLCanvasElement).height,
    }));
    console.log(`>> dpr info: ${JSON.stringify(dprInfo)}`);
    if (dprInfo.dpr !== 2) throw new Error(`expected dpr 2, got ${dprInfo.dpr}`);
    if (dprInfo.canvasW !== dprInfo.cssW * 2) throw new Error("canvas not dpr-scaled");

    const targetX = 200;
    const targetY = 200;
    await dprPage.mouse.move(targetX, targetY);
    await wait(50);
    const hover = await dprPage.evaluate(
      ({ tx, ty }) => {
        const dbg = (window as any).__gameDebug;
        return { hover: dbg?.hover, tx, ty };
      },
      { tx: targetX, ty: targetY }
    );
    console.log(`>> dpr hover at (${targetX},${targetY}): ${JSON.stringify(hover)}`);
    if (!hover.hover) throw new Error("no hover computed on high-DPR page");
    await dprPage.screenshot({ path: "test/screenshot-dpr2.png" });
    console.log(">> dpr2 screenshot saved");
    await dprPage.close();

    console.log(">> ALL TESTS PASSED");
  } catch (err) {
    failed = true;
    console.error("TEST FAILED:", err);
  } finally {
    if (browser) await browser.close();
    web.kill();
    api.kill();
  }
  process.exit(failed ? 1 : 0);
}

run();
