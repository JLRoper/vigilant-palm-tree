// Downscale 1024px arena unit masters to 128x128 transparent PNGs (final game assets).
// Usage: node downscale-arena.mjs
// Reads: design/arena-unit-sprites/prod-1024/*-idle.png (12 files)
// Writes: src/resources/units/arena/<id>-idle.png ("prod-" prefix stripped)
// Pixel check per output: must be 128x128, and the outer 2px border ring must be
// fully transparent (background check); reports opaque-pixel coverage too.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { chromium } from "playwright";

const SRC = "design/arena-unit-sprites/prod-1024";
const DST = "src/resources/units/arena";
const OUT = 128;

const HTML = `<!DOCTYPE html><html><body><canvas id="in"></canvas><canvas id="out"></canvas><script>
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
  const data = octx.getImageData(0, 0, out, out).data;
  let border = 0, borderOpaque = 0, opaque = 0;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const a = data[(y * out + x) * 4 + 3];
      if (a > 0) opaque++;
      const onBorder = x < 2 || y < 2 || x >= out - 2 || y >= out - 2;
      if (onBorder) { border++; if (a > 0) borderOpaque++; }
    }
  }
  return {
    srcW: cin.width, srcH: cin.height,
    borderOpaque,
    opaquePct: +(100 * opaque / (out * out)).toFixed(1),
    url: cout.toDataURL("image/png"),
  };
};
</script></body></html>`;

const files = readdirSync(SRC).filter(f => f.endsWith("-idle.png")).sort();
if (files.length !== 12) {
  console.error(`expected 12 masters in ${SRC}, found ${files.length}: ${files.join(", ")}`);
  process.exit(1);
}
mkdirSync(DST, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

let failures = 0;
for (const f of files) {
  const buf = readFileSync(join(SRC, f));
  const r = await page.evaluate(async ([b64, out]) => window.convert(b64, out), [buf.toString("base64"), OUT]);
  const id = basename(f).replace(/^prod-/, "");
  const dstPath = join(DST, id);
  if (r.srcW !== r.srcH) { console.error(`${f}: NOT SQUARE ${r.srcW}x${r.srcH}`); failures++; }
  if (r.borderOpaque > 0) { console.error(`${f}: border not transparent (${r.borderOpaque} opaque px in outer ring)`); failures++; }
  writeFileSync(dstPath, Buffer.from(r.url.split("base64,")[1], "base64"));
  console.log(`${f} (${r.srcW}x${r.srcH}) -> ${dstPath} 128x128, border-clean, opaque ${r.opaquePct}%`);
}
await browser.close();
if (failures) { console.error(`${failures} file(s) FAILED checks`); process.exit(1); }
console.log("all 12 downscaled and checked");
