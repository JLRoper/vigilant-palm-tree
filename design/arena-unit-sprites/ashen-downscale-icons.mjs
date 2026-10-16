// Ashen Court wave A (ghoul, bone_pikeman, bone_archer, wraith, blood_knight,
// vampire_lord, lich): downscale 1024px masters from ashen-wave-1024/ to the
// 128px game assets, with the same hard pixel gate as the prior waves: exactly
// 128x128 and a fully transparent 2px border ring. Per-faction copy of
// wave3-downscale.mjs (the inset-retry pattern) — the shared CATALOG lists stay
// untouched so sibling faction agents don't conflict.
//   node ashen-downscale-icons.mjs     downscale + gate all 14
// Plain Node + bundled Chromium (playwright devDependency). No network, no API.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SRC_DIR = join(HERE, "ashen-wave-1024", "masters");
const OUT = 128;

const JOBS = [
  { master: "ghoul.png", out: join(REPO, "src", "resources", "units", "icons", "ghoul.png") },
  { master: "bone_pikeman.png", out: join(REPO, "src", "resources", "units", "icons", "bone_pikeman.png") },
  { master: "bone_archer.png", out: join(REPO, "src", "resources", "units", "icons", "bone_archer.png") },
  { master: "wraith.png", out: join(REPO, "src", "resources", "units", "icons", "wraith.png") },
  { master: "blood_knight.png", out: join(REPO, "src", "resources", "units", "icons", "blood_knight.png") },
  { master: "vampire_lord.png", out: join(REPO, "src", "resources", "units", "icons", "vampire_lord.png") },
  { master: "lich.png", out: join(REPO, "src", "resources", "units", "icons", "lich.png") },
  { master: "ghoul-idle.png", out: join(REPO, "src", "resources", "units", "arena", "ghoul-idle.png") },
  { master: "bone_pikeman-idle.png", out: join(REPO, "src", "resources", "units", "arena", "bone_pikeman-idle.png") },
  { master: "bone_archer-idle.png", out: join(REPO, "src", "resources", "units", "arena", "bone_archer-idle.png") },
  { master: "wraith-idle.png", out: join(REPO, "src", "resources", "units", "arena", "wraith-idle.png") },
  { master: "blood_knight-idle.png", out: join(REPO, "src", "resources", "units", "arena", "blood_knight-idle.png") },
  { master: "vampire_lord-idle.png", out: join(REPO, "src", "resources", "units", "arena", "vampire_lord-idle.png") },
  { master: "lich-idle.png", out: join(REPO, "src", "resources", "units", "arena", "lich-idle.png") },
];

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
