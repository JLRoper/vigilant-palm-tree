// Downscale the 1024px arena unit icon masters to 128px game icons, with a
// hard pixel gate on every output: exactly 128x128 and a fully transparent
// 2px border ring. Writes src/resources/units/icons/<unitTypeId>.png.
//
//   node downscale-icons.mjs            downscale + gate
//   node downscale-icons.mjs --sheet    also build the review contact sheet
//                                       (design/arena-unit-sprites/icon-contact-sheet.png)
//
// Plain Node + bundled Chromium (playwright devDependency). No network, no API.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SRC_DIR = join(HERE, "icon-1024");
const OUT_DIR = join(REPO, "src", "resources", "units", "icons");
const SHEET_PATH = join(HERE, "icon-contact-sheet.png");

const CATALOG = [
  "peasant", "archer", "crossbowman", "swordsman", "pikeman", "cavalry",
  "monk", "crusader", "griffin", "hydra", "wisp", "black_dragon",
];

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.downscale = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, 128, 128);
  return c.toDataURL("image/png");
};
window.gate = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const sizeOk = img.width === 128 && img.height === 128;
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const W = img.width, H = img.height;
  let ringBad = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) {
      if (px[(y * W + x) * 4 + 3] !== 0) ringBad++;
    }
  }
  return { sizeOk, w: img.width, h: img.height, ringBad };
};
window.sheet = async (icons, order) => {
  const imgs = await Promise.all(order.map(id => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = "data:image/png;base64," + icons[id];
  })));
  const MARGIN = 16, TILE = 60, GAP = 12, LABEL = 16;
  const COLS = 4, ROWS = Math.ceil(order.length / COLS);
  const c = document.getElementById("c");
  c.width = MARGIN * 2 + COLS * TILE + (COLS - 1) * GAP;
  c.height = MARGIN * 2 + ROWS * (TILE + LABEL) + (ROWS - 1) * GAP;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14171e";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#9aa4b2";
  order.forEach((id, i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    const x = MARGIN + col * (TILE + GAP), y = MARGIN + row * (TILE + LABEL + GAP);
    ctx.fillStyle = "#14171e";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.drawImage(imgs[i], x, y, TILE, TILE);
    ctx.fillStyle = "#9aa4b2";
    ctx.fillText(id, x + TILE / 2, y + TILE + 12);
  });
  return c.toDataURL("image/png");
};
</script></body></html>`;

const wantSheet = process.argv.includes("--sheet");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

const icons = {};
let failures = 0;
for (const id of CATALOG) {
  const src = join(SRC_DIR, `icon-${id}.png`);
  const out = join(OUT_DIR, `${id}.png`);
  const url = await page.evaluate(async (b64) => window.downscale(b64), readFileSync(src).toString("base64"));
  writeFileSync(out, Buffer.from(url.split("base64,")[1], "base64"));
  const g = await page.evaluate(async (b64) => window.gate(b64), readFileSync(out).toString("base64"));
  const ok = g.sizeOk && g.ringBad === 0;
  if (!ok) failures++;
  console.log(`${id}.png  ${g.w}x${g.h}  ring-bad-px=${g.ringBad}  ${ok ? "GATE PASS" : "GATE FAIL"}`);
  icons[id] = readFileSync(out).toString("base64");
}

if (wantSheet) {
  const url = await page.evaluate(async ([icons, order]) => window.sheet(icons, order), [icons, CATALOG]);
  writeFileSync(SHEET_PATH, Buffer.from(url.split("base64,")[1], "base64"));
  console.log(`contact sheet -> ${SHEET_PATH}`);
}

console.log(failures === 0 ? "ALL GATES PASS" : `${failures} GATE FAILURE(S)`);
await browser.close();
if (failures > 0) process.exit(1);
