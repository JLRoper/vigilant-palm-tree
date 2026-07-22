// Headless drag-and-drop test for the Hero Info menu army reorder feature.
// Launches the api + web servers, drives a real Chromium via Playwright,
// selects the player hero, performs a drag from army slot 0 to slot 1, and
// reports whether the on-screen tile contents actually changed.
//
// Run with:  npx tsx test/dragDrop.test.ts

import { spawn, ChildProcess } from "node:child_process";
import { chromium } from "playwright";

const WEB_PORT = 4173;
const API_PORT = 3001;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const GAME_NAME = "dragdrop-test";

const browserLogs: string[] = [];

function startApi(): ChildProcess {
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[api] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[api err] ${d}`));
  return child;
}

function startWeb(): ChildProcess {
  const child = spawn("npx", ["vite", "preview", "--port", String(WEB_PORT)], {
    env: process.env,
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
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function kill(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.killed) return;
  await new Promise<void>((resolve) => {
    p.once("exit", () => resolve());
    p.kill();
    setTimeout(() => {
      if (!p.killed) p.kill("SIGKILL");
      resolve();
    }, 2000);
  });
}

// Returns the src basename (or "" for empty slots) for each of the 8 collapsed
// army tiles, in slot order.
async function readArmyTiles(page: import("playwright").Page): Promise<string[]> {
  return page.evaluate(() => {
    const tiles = Array.from(
      document.querySelectorAll<HTMLImageElement>("img[alt=''][src]"),
    );
    // Filter to only the in-menu army tiles (not resource icons on the map).
    // The collapsed army tiles live inside the hero info popup body.
    const popup = document.querySelector(".popup-body") ?? document.body;
    const inPopup = Array.from(popup.querySelectorAll<HTMLDivElement>("div"))
      .filter((d) => d.style.aspectRatio === "1");
    return inPopup.map((d) => {
      const img = d.querySelector<HTMLImageElement>("img");
      const src = img?.getAttribute("src") ?? "";
      // Decode the URL path's last segment ("archer-XYZ.png") -> "archer"
      const m = src.match(/\/([^/?]+?)(?:-[A-Za-z0-9_-]+)?\.png(?:$|\?)/);
      return m ? m[1] : src ? "?" : "";
    });
  });
}

// Synthesises a full HTML5 drag from `fromIdx` to `toIdx` via dispatched
// events that carry a shared DataTransfer, so our `dataTransfer.setData`
// "text/plain" payload survives into the drop handler.
async function performDrag(page: import("playwright").Page, fromIdx: number, toIdx: number): Promise<void> {
  await page.evaluate(
    ({ fromIdx, toIdx }) => {
      const tiles = Array.from(document.querySelectorAll<HTMLDivElement>("div"))
        .filter((d) => d.style.aspectRatio === "1");
      const src = tiles[fromIdx];
      const dst = tiles[toIdx];
      if (!src || !dst) throw new Error(`tiles not found: ${fromIdx} -> ${toIdx}`);
      const dt = new DataTransfer();
      const rect = dst.getBoundingClientRect();
      const dropX = rect.left + rect.width / 2;
      const dropY = rect.top + rect.height / 2;
      const fire = (el: Element, type: string, x: number, y: number) => {
        const ev = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt,
          clientX: x,
          clientY: y,
        });
        el.dispatchEvent(ev);
        return ev;
      };
      fire(src, "dragstart", 0, 0);
      fire(dst, "dragenter", dropX, dropY);
      fire(dst, "dragover", dropX, dropY);
      fire(dst, "drop", dropX, dropY);
      fire(src, "dragend", dropX, dropY);
    },
    { fromIdx, toIdx },
  );
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

    // Reset the test game so we know the starting state.
    await fetch(`${API_URL}/api/games/${GAME_NAME}`, { method: "DELETE" }).catch(() => {});

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => {
      const text = msg.text();
      browserLogs.push(`[${msg.type()}] ${text}`);
    });
    page.on("pageerror", (e) => browserLogs.push(`[pageerror] ${e.message}`));

    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (window as unknown as { __gameDebug?: { activeGameName?: string } }).__gameDebug?.activeGameName != null,
      null,
      { timeout: 15_000 },
    );

    // Find the player hero's id via the game state, then select it
    // programmatically via __gameDebug.setSelectedHero (avoids dealing with
    // canvas pixel coords and the camera).
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
    if (!heroId) throw new Error("could not find player hero or setSelectedHero");
    console.log(`>> selected hero ${heroId} programmatically`);
    await page.waitForTimeout(400);

    // Wait for the hero info menu to be visible.
    await page.waitForSelector("text=Hero", { timeout: 5_000 });
    await page.waitForTimeout(200);

    const before = await readArmyTiles(page);
    console.log(">> BEFORE reorder, tiles:", JSON.stringify(before));

    if (before.length !== 8) {
      throw new Error(`expected 8 army tiles, found ${before.length}: ${JSON.stringify(before)}`);
    }

    // Drag from slot 0 to slot 1.
    await performDrag(page, 0, 1);
    await page.waitForTimeout(400);

    const after = await readArmyTiles(page);
    console.log(">> AFTER reorder,  tiles:", JSON.stringify(after));

    const same = before.every((v, i) => v === after[i]);
    if (same) {
      console.log("\n!! REORDER FAILED — tile contents did not change.\n");
      console.log(">> Browser console (last 60 messages):");
      for (const line of browserLogs.slice(-60)) console.log("   ", line);
      exitCode = 2;
    } else {
      console.log("\n>> REORDER SUCCEEDED — tiles swapped as expected.\n");
      // Print just our debug lines for sanity.
      const debug = browserLogs.filter((l) => l.includes("[army]") || l.includes("[main]") || l.includes("[reorderStack]"));
      console.log(">> Debug logs from the drag:");
      for (const line of debug) console.log("   ", line);
      exitCode = 0;
    }
  } catch (e) {
    console.error(">> test threw:", e instanceof Error ? e.message : String(e));
    console.log(">> Browser console:");
    for (const line of browserLogs.slice(-60)) console.log("   ", line);
    exitCode = 3;
  } finally {
    if (browser) await browser.close();
    await kill(api);
    await kill(web);
    process.exit(exitCode);
  }
}

run();