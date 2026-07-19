import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "pixel-art.html");
// Output straight into the game's resource dir.
const outDir = path.resolve(__dirname, "..", "..", "src", "resources");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto("file://" + htmlPath.replace(/\\/g, "/"));
await page.waitForFunction(() => document.querySelectorAll("canvas").length === 3);

for (const lvl of [1, 2, 3]) {
  const dataUrl = await page.evaluate((id) => {
    const c = document.getElementById(id);
    return c.toDataURL("image/png");
  }, "l" + lvl);
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const out = path.join(outDir, "castle-l" + lvl + ".png");
  writeFileSync(out, Buffer.from(base64, "base64"));
  console.log("wrote", out);
}

await browser.close();
