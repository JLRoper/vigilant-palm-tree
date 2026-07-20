import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { ASSETS_DIR, CASTLE_SPRITES, RESOURCE_SPRITES } from "./manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "pixel-art.html");
const outDir = path.resolve(__dirname, "..", "..", ASSETS_DIR);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto("file://" + htmlPath.replace(/\\/g, "/"));
await page.waitForFunction(() => document.querySelectorAll("canvas").length === 8);

const sprites = [
  { id: "l1", file: CASTLE_SPRITES[1] },
  { id: "l2", file: CASTLE_SPRITES[2] },
  { id: "l3", file: CASTLE_SPRITES[3] },
  { id: "resource-gold",   file: RESOURCE_SPRITES.gold },
  { id: "resource-wood",   file: RESOURCE_SPRITES.wood },
  { id: "resource-stone",  file: RESOURCE_SPRITES.stone },
  { id: "resource-iron",   file: RESOURCE_SPRITES.iron },
  { id: "resource-arcane", file: RESOURCE_SPRITES.arcane },
];

for (const { id, file } of sprites) {
  const dataUrl = await page.evaluate((cid) => {
    const c = document.getElementById(cid);
    return c.toDataURL("image/png");
  }, id);
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const out = path.join(outDir, file);
  writeFileSync(out, Buffer.from(base64, "base64"));
  console.log("wrote", out);
}

await browser.close();
