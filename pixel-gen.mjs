import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = __dirname;
const resourcesDir = path.join(root, "src", "resources");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });

// --- Step 1: render each canvas to its own PNG ---
await page.goto("file://" + path.join(root, "pixel-art.html"));
await page.waitForFunction(() => !!window.drawL1);

for (const [level, fn] of [["l1", "drawL1"], ["l2", "drawL2"], ["l3", "drawL3"]]) {
  await page.evaluate((f) => window[f](), fn);
  const canvas = await page.$("#c");
  const out = path.join(resourcesDir, `castle-${level}.png`);
  await canvas.screenshot({ path: out, omitBackground: true });
  console.log(`Wrote ${out}`);
}

// --- Step 2: build & screenshot the contact sheet (sprite-preview.png) ---
await page.goto("file://" + path.join(root, "sprite-preview.html"));
await page.waitForLoadState("networkidle");
await page.screenshot({ path: path.join(root, "sprite-preview.png"), fullPage: true });
console.log("Wrote sprite-preview.png");

await browser.close();
