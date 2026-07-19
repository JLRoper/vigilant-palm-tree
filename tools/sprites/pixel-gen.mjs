import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "pixel-art.html");
// Output straight into the game's resource dir.
const outDir = path.resolve(__dirname, "..", "..", "src", "resources");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto("file://" + htmlPath.replace(/\\/g, "/"));
await page.waitForFunction(() => document.querySelectorAll("canvas").length === 8);

// canvas id -> output filename
const sprites = [
  { id: "l1",            file: "castle-l1.png" },
  { id: "l2",            file: "castle-l2.png" },
  { id: "l3",            file: "castle-l3.png" },
  { id: "resource-gold",   file: "resource-gold.png" },
  { id: "resource-wood",   file: "resource-wood.png" },
  { id: "resource-stone",  file: "resource-stone.png" },
  { id: "resource-iron",   file: "resource-iron.png" },
  { id: "resource-arcane", file: "resource-arcane.png" },
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
