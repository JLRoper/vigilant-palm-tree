// One-off measurement helper for the Ironmark Holds building sprites: prints
// the transparent bottom-pad row count of each 1024px canvas, the input the
// BUILDING_ANCHOR_OVERRIDES table needs (anchorOffsetY = bottomPad * sh/dh,
// sh = tw*0.9 = 86.4, dh = the PNG's actual canvas height).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const FILES = [
  "src/resources/buildings/building-pixel-forgeHall-1.png",
  "src/resources/buildings/building-pixel-gunnersRedoubt-1.png",
  "src/resources/buildings/building-pixel-golemFoundry-1.png",
  "src/resources/buildings/building-pixel-deepAnvil-1.png",
];

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.measure = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const rowOpaque = (y) => {
    for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] !== 0) return true;
    return false;
  };
  let bottomPad = 0;
  for (let y = c.height - 1; y >= 0 && !rowOpaque(y); y--) bottomPad++;
  return { w: c.width, h: c.height, bottomPad };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
for (const f of FILES) {
  const r = await page.evaluate(
    async (b64) => window.measure(b64),
    [readFileSync(join(REPO, f)).toString("base64")],
  );
  const sh = 86.4;
  const offsetY = Math.round((r.bottomPad * sh) / r.h);
  console.log(`${f} ${r.w}x${r.h} bottomPad=${r.bottomPad} anchorOffsetY=${offsetY}`);
}
await browser.close();
