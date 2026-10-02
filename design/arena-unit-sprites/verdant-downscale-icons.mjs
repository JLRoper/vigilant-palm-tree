// The Verdant Wild faction wave (2026-10-02): downscale the 1024px masters from
// verdant-wave-1024/ to the 128px game assets, with the same hard pixel gate as
// the prior waves (copied from wave3-downscale.mjs's inset-retry pattern):
// exactly 128x128 and a fully transparent 2px border ring.
//   node verdant-downscale-icons.mjs       downscale + gate all 14 (7 icons + 7 idles)
// Plain Node + bundled Chromium (playwright devDependency). No network, no API.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SRC_DIR = join(HERE, "verdant-wave-1024");
const OUT = 128;

const VERDANT_UNIT_IDS = [
  "forest_scout",
  "briar_warden",
  "warbeast",
  "thorn_archer",
  "elk_rider",
  "treant_elder",
  "stag_knight",
];

const JOBS = [];
for (const id of VERDANT_UNIT_IDS) {
  JOBS.push({ master: `${id}.png`, out: join(REPO, "src", "resources", "units", "icons", `${id}.png`) });
  JOBS.push({ master: `${id}-idle.png`, out: join(REPO, "src", "resources", "units", "arena", `${id}-idle.png`) });
}

const HTML = `<!DOCTYPE html><html><body><canvas id="out"></canvas><canvas id="gate"></canvas><script>
window.convert = async (b64, out) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const attempts = [0, 2, 4, 6];
  for (const inset of attempts) {
    const cout = document.getElementById("out");
    cout.width = out; cout.height = out;
    const octx = cout.getContext("2d");
    octx.clearRect(0, 0, out, out);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    const size = out - 2 * inset;
    octx.drawImage(img, 0, 0, img.width, img.height, inset, inset, size, size);
    const url = cout.toDataURL("image/png");
    const img2 = new Image();
    await new Promise((res, rej) => { img2.onload = res; img2.onerror = rej; img2.src = url; });
    const sizeOk = img2.width === out && img2.height === out;
    const cg = document.getElementById("gate");
    cg.width = img2.width; cg.height = img2.height;
    const gctx = cg.getContext("2d");
    gctx.clearRect(0, 0, cg.width, cg.height);
    gctx.drawImage(img2, 0, 0);
    const px = gctx.getImageData(0, 0, img2.width, img2.height).data;
    let ringBad = 0;
    for (let y = 0; y < img2.height; y++) for (let x = 0; x < img2.width; x++) {
      if (x < 2 || y < 2 || x >= img2.width - 2 || y >= img2.height - 2) {
        if (px[(y * img2.width + x) * 4 + 3] !== 0) ringBad++;
      }
    }
    if (sizeOk && ringBad === 0) return { url, sizeOk, w: img2.width, h: img2.height, ringBad, inset, srcW: img.width, srcH: img.height };
    if (inset === attempts[attempts.length - 1]) return { url, sizeOk, w: img2.width, h: img2.height, ringBad, inset, srcW: img.width, srcH: img.height };
  }
};
</script></body></html>`;

mkdirSync(join(REPO, "src", "resources", "units", "icons"), { recursive: true });
mkdirSync(join(REPO, "src", "resources", "units", "arena"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

let failures = 0;
for (const job of JOBS) {
  const src = join(SRC_DIR, job.master);
  if (!existsSync(src)) {
    console.log(`${job.master} MISSING MASTER  GATE FAIL`);
    failures++;
    continue;
  }
  const r = await page.evaluate(async ([b64, out]) => window.convert(b64, out), [readFileSync(src).toString("base64"), OUT]);
  const ok = r.sizeOk && r.ringBad === 0;
  if (!ok) failures++;
  writeFileSync(job.out, Buffer.from(r.url.split("base64,")[1], "base64"));
  console.log(`${job.master} (${r.srcW}x${r.srcH}, inset=${r.inset}) -> ${job.out.replace(REPO + "\\", "")} ${r.w}x${r.h} ring-bad-px=${r.ringBad} ${ok ? "GATE PASS" : "GATE FAIL"}`);
}

console.log(failures === 0 ? "ALL GATES PASS" : `${failures} GATE FAILURE(S)`);
await browser.close();
if (failures > 0) process.exit(1);