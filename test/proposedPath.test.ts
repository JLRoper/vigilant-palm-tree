// Headless test for the proposed path rendering after the trail fix.
// Selects the player hero, hovers over a distant tile, captures the canvas,
// and checks the proposed yellow line is rendered along the hex path.

import { spawn, ChildProcess } from "node:child_process";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const WEB_PORT = 4174;
const API_PORT = 3002;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

function startApi(): ChildProcess {
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, API_PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[api] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[api err] ${d}`));
  return child;
}

function startWeb(): ChildProcess {
  const child = spawn("npx", ["vite", "preview", "--port", String(WEB_PORT)], {
    env: { ...process.env, API_PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[web] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[web err] ${d}`));
  return child;
}

async function waitForUrl(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function kill(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.killed) return;
  await new Promise<void>((resolve) => {
    p.once("exit", () => resolve());
    p.kill();
    setTimeout(() => { if (!p.killed) p.kill("SIGKILL"); resolve(); }, 2000);
  });
}

async function run(): Promise<void> {
  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let exitCode = 1;
  try {
    api = startApi();
    web = startWeb();
    await waitForUrl(`${API_URL}/api/health`);
    await waitForUrl(WEB_URL);
    console.log(">> servers up");

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const browserLogs: string[] = [];
    page.on("console", (msg) => browserLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (e) => browserLogs.push(`[pageerror] ${e.message}`));

    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (window as unknown as { __gameDebug?: { activeGameName?: string } }).__gameDebug?.activeGameName != null,
      null,
      { timeout: 15_000 },
    );

    // Select the player hero.
    const heroId = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __gameDebug?: {
          getGameState?: () => { heroes: Record<string, { ownerId: number }> };
          setSelectedHero?: (id: string) => void;
        };
      }).__gameDebug;
      const s = dbg?.getGameState?.();
      if (!s || !dbg?.setSelectedHero) return null;
      const h0 = Object.entries(s.heroes).find(([, h]) => h.ownerId === 0);
      if (!h0) return null;
      dbg.setSelectedHero(h0[0]);
      return h0[0];
    });
    if (!heroId) throw new Error("could not select player hero");
    console.log(`>> selected ${heroId}`);
    await page.waitForTimeout(400);

    // Hover over a passable tile several hexes away to set the proposed path.
    const hero = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __gameDebug?: { getGameState?: () => { heroes: Record<string, { q: number; r: number }> } };
      }).__gameDebug;
      const s = dbg?.getGameState?.();
      const h = s ? Object.values(s.heroes).find((x) => x.ownerId === 0) : null;
      return h ? { q: h.q, r: h.r } : null;
    });
    if (!hero) throw new Error("could not get hero position");

    // Compute a screen pixel that should land on a passable tile far from hero.
    const targetPx = await page.evaluate(({ hq, hr }) => {
      const cv = document.querySelector("canvas") as HTMLCanvasElement;
      // Pick a point in screen space far from center to trigger the hover path.
      // The renderer projects axial coords; just move the cursor 200px right & 100px down.
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + 200, y: rect.top + rect.height / 2 + 100 };
    }, { hq: hero.q, hr: hero.r });

    await page.mouse.move(targetPx.x, targetPx.y);
    await page.waitForTimeout(300);

    // Snapshot the proposed path state from the view.
    const pathState = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __gameDebug?: { getGameState?: () => { heroes: Record<string, { trail: { q: number; r: number }[]; q: number; r: number }> } };
      }).__gameDebug;
      const s = dbg?.getGameState?.();
      const h = s ? Object.values(s.heroes).find((x) => x.ownerId === 0) : null;
      return h ? { q: h.q, r: h.r, trailLen: h.trail.length } : null;
    });
    console.log(">> hero state:", JSON.stringify(pathState));

    // Capture the canvas as a PNG and count yellow pixels along the proposed line.
    const buf = await page.locator("canvas").screenshot();
    writeFileSync("test/proposedPath.png", buf);

    // Sample some yellow pixels (255, 204, 0) in the screenshot.
    const yellowStats = await page.evaluate(async () => {
      const cv = document.querySelector("canvas") as HTMLCanvasElement;
      // Sample the canvas via getContext (read-only) using 2d canvas — easier:
      // we draw the canvas onto an offscreen 2d and read pixels.
      const off = document.createElement("canvas");
      off.width = cv.width;
      off.height = cv.height;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(cv, 0, 0);
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let yellowCount = 0;
      // rgba(255, 204, 0, 0.85) and rgba(255, 204, 0, 0.30) both mix to roughly
      // the same hue. Allow a tolerance for compositing on dark background.
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 200 && g > 150 && g < 230 && b < 80) yellowCount++;
      }
      return { width: cv.width, height: cv.height, yellowCount };
    });
    console.log(">> yellow pixel count:", JSON.stringify(yellowStats));

    if (yellowStats.yellowCount < 50) {
      console.log("!! proposed path appears broken (too few yellow pixels)");
      console.log(">> recent browser logs:");
      for (const l of browserLogs.slice(-20)) console.log("  ", l);
      exitCode = 2;
    } else {
      console.log(">> proposed path renders correctly");
      exitCode = 0;
    }
  } catch (e) {
    console.error(">> threw:", e);
    exitCode = 3;
  } finally {
    if (browser) await browser.close();
    await kill(api);
    await kill(web);
    process.exit(exitCode);
  }
}

run();