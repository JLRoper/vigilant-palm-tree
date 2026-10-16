// Downscale 1024px arena pose masters to 128x128 transparent PNGs (final game assets),
// with a hard pixel gate on every output: exactly 128x128 and a fully transparent
// 2px border ring. Optionally builds the attack/move review sheet.
//
//   node downscale-poses.mjs            downscale + gate
//   node downscale-poses.mjs --sheet    also build the review sheet
//                                       (design/arena-unit-sprites/pose-wave-sheet.png:
//                                        12 rows x [idle | attack | move], 2x zoom cells)
//
// Reads:  design/arena-unit-sprites/pose-wave-1024/<id>-{attack,move}.png (24 files)
// Writes: src/resources/units/arena/<id>-{attack,move}.png (existing -idle files untouched)
// Plain Node + bundled Chromium (playwright devDependency). No network, no API.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SRC_DIR = join(HERE, "pose-wave-1024");
const ARENA_DIR = join(REPO, "src", "resources", "units", "arena");
const SHEET_PATH = join(HERE, "pose-wave-sheet.png");
const OUT = 128;

const CATALOG = [
  "peasant", "archer", "crossbowman", "swordsman", "pikeman", "cavalry",
  "monk", "crusader", "griffin", "hydra", "wisp", "black_dragon",
];
const POSES = ["attack", "move"];

const HTML = `<!DOCTYPE html><html><body><canvas id="in"></canvas><canvas id="out"></canvas><canvas id="sheet"></canvas><script>
window.convert = async (b64, out) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const cin = document.getElementById("in");
  cin.width = img.width; cin.height = img.height;
  const ictx = cin.getContext("2d");
  ictx.drawImage(img, 0, 0);
  const cout = document.getElementById("out");
  cout.width = out; cout.height = out;
  const octx = cout.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(cin, 0, 0, cin.width, cin.height, 0, 0, out, out);
  const url = cout.toDataURL("image/png");
  // gate: re-read the encoded output, exact size + transparent 2px border ring
  const img2 = new Image();
  await new Promise((res, rej) => { img2.onload = res; img2.onerror = rej; img2.src = url; });
  const sizeOk = img2.width === out && img2.height === out;
  const c2 = document.getElementById("in");
  c2.width = img2.width; c2.height = img2.height;
  const px = c2.getContext("2d").getImageData(0, 0, img2.width, img2.height).data;
  let ringBad = 0;
  for (let y = 0; y < img2.height; y++) for (let x = 0; x < img2.width; x++) {
    if (x < 2 || y < 2 || x >= img2.width - 2 || y >= img2.height - 2) {
      if (px[(y * img2.width + x) * 4 + 3] !== 0) ringBad++;
    }
  }
  return { url, sizeOk, w: img2.width, h: img2.height, ringBad, srcW: cin.width, srcH: cin.height };
};
window.sheet = async (cells, order) => {
  const CELL = 256, GAP = 12, MARGIN = 16, LABEL = 120, HEAD = 24;
  const imgs = await Promise.all(cells.map(b64 => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = "data:image/png;base64," + b64;
  })));
  const c = document.getElementById("sheet");
  c.width = MARGIN + LABEL + 3 * CELL + 2 * GAP + MARGIN;
  c.height = MARGIN + HEAD + 12 * CELL + 11 * GAP + MARGIN;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#14171e";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#9aa4b2";
  ["idle", "attack", "move"].forEach((p, i) => {
    ctx.fillText(p, MARGIN + LABEL + i * (CELL + GAP) + CELL / 2, MARGIN + 16);
  });
  order.forEach((id, r) => {
    const y = MARGIN + HEAD + r * (CELL + GAP);
    ctx.textAlign = "right";
    ctx.fillStyle = "#9aa4b2";
    ctx.fillText(id, MARGIN + LABEL - 8, y + CELL / 2 + 4);
    for (let col = 0; col < 3; col++) {
      const x = MARGIN + LABEL + col * (CELL + GAP);
      ctx.drawImage(imgs[r * 3 + col], x, y, CELL, CELL);
    }
  });
  return c.toDataURL("image/png");
};
</script></body></html>`;

const wantSheet = process.argv.includes("--sheet");

const expected = new Set(CATALOG.flatMap(id => POSES.map(p => `${id}-${p}.png`)));
const files = readdirSync(SRC_DIR).filter(f => f.endsWith(".png") && /-(attack|move)\.png$/.test(f)).sort();
const missing = [...expected].filter(f => !files.includes(f));
if (missing.length) {
  console.error(`missing ${missing.length} expected master(s) in ${SRC_DIR}: ${missing.join(", ")}`);
  process.exit(1);
}
if (files.length !== 24) {
  console.error(`expected 24 masters in ${SRC_DIR}, found ${files.length}: ${files.join(", ")}`);
  process.exit(1);
}
mkdirSync(ARENA_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

let failures = 0;
const outputs = {};
for (const f of files) {
  const buf = readFileSync(join(SRC_DIR, f));
  const r = await page.evaluate(async ([b64, out]) => window.convert(b64, out), [buf.toString("base64"), OUT]);
  const ok = r.sizeOk && r.ringBad === 0;
  if (!ok) failures++;
  writeFileSync(join(ARENA_DIR, f), Buffer.from(r.url.split("base64,")[1], "base64"));
  outputs[f] = r.url;
  console.log(`${f} (${r.srcW}x${r.srcH}) -> src/resources/units/arena/${f} ${r.w}x${r.h} ring-bad-px=${r.ringBad} ${ok ? "GATE PASS" : "GATE FAIL"}`);
}

if (wantSheet) {
  const cells = [];
  for (const id of CATALOG) {
    cells.push(readFileSync(join(ARENA_DIR, `${id}-idle.png`)).toString("base64"));
    cells.push(outputs[`${id}-attack.png`].split("base64,")[1]);
    cells.push(outputs[`${id}-move.png`].split("base64,")[1]);
  }
  const url = await page.evaluate(async ([c, order]) => window.sheet(c, order), [cells, CATALOG]);
  writeFileSync(SHEET_PATH, Buffer.from(url.split("base64,")[1], "base64"));
  console.log(`review sheet -> ${SHEET_PATH}`);
}

console.log(failures === 0 ? "ALL GATES PASS" : `${failures} GATE FAILURE(S)`);
await browser.close();
if (failures > 0) process.exit(1);
