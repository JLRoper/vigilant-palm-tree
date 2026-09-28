// Normalize a horse run-frame sprite ("-2" gallop pose) to its base frame:
// same canvas size, same content-bbox height, same bottom edge, same horizontal
// content center — the tuning the drake run frames (commander-9) got when they
// landed in eeed5b8, since map sprites are bottom-anchored and drawn per
// descriptor sizing (any canvas/bbox drift reads as the hero popping or
// floating between animation frames).
//
// Pairs are positional: <base.png> <frame2.png> repeated. The frame-2 file is
// rewritten in place; base files are never modified.
//
// Modes:
//   default   rewrite each frame-2 in place (normalized)
//   --check   report only, no writes; exit 1 if any pair exceeds --tol
//   --tol N   max allowed px drift in check mode (default 2)
//
// Usage:
//   node tools/sprites/tune-run-frames.mjs src/resources/units/horse/commander-6/arcane-e.png src/resources/units/horse/commander-6/arcane-e-2.png [more pairs...] [--check] [--tol N]

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: node tune-run-frames.mjs <base.png> <frame2.png> [more pairs...] [--check] [--tol N]";

let check = false;
let tol = 2;
const rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check") check = true;
  else if (a === "--tol") tol = Number(argv[++i]);
  else if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
  else rest.push(a);
}
if (rest.length < 2 || rest.length % 2 !== 0) { console.error(USAGE); process.exit(2); }
const pairs = [];
for (let i = 0; i < rest.length; i += 2) pairs.push({ base: rest[i], f2: rest[i + 1] });

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.analyze = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (px[(y * c.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { w: c.width, h: c.height, empty: true };
  const clipped = [];
  if (minX === 0) clipped.push("left");
  if (minY === 0) clipped.push("top");
  if (maxX === c.width - 1) clipped.push("right");
  if (maxY === c.height - 1) clipped.push("bottom");
  return { w: c.width, h: c.height, empty: false,
           bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, clipped };
};
window.normalize = async (b64, baseW, baseH, baseBbox) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const s = document.createElement("canvas");
  s.width = img.width; s.height = img.height;
  const sctx = s.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const px = sctx.getImageData(0, 0, s.width, s.height).data;
  let minX = s.width, minY = s.height, maxX = -1, maxY = -1;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (px[(y * s.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("frame-2 image is fully transparent");
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const scale = baseBbox.h / bh;
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const contentCx = minX + bw / 2;
  const dx = Math.round(baseBbox.x + baseBbox.w / 2 - (contentCx - 0) * scale);
  const dy = Math.round(baseBbox.y + baseBbox.h - (maxY + 1) * scale);
  const c = document.createElement("canvas");
  c.width = baseW; c.height = baseH;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s, 0, 0, s.width, s.height, dx, dy, dw, dh);
  return { dataUrl: c.toDataURL("image/png"), scale };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

const b64 = (f) => readFileSync(f).toString("base64");
let failures = 0;

for (const { base, f2 } of pairs) {
  const b = await page.evaluate((d) => window.analyze(d), b64(base));
  const f = await page.evaluate((d) => window.analyze(d), b64(f2));
  const tag = `${f2}`;
  if (b.empty || f.empty) {
    console.log(`FAIL ${tag}: empty content (base empty=${b.empty}, frame2 empty=${f.empty})`);
    failures++;
    continue;
  }
  if (f.clipped.length) {
    console.log(`WARN ${tag}: frame-2 content touches canvas edge (${f.clipped.join(",")}) — possibly cropped art`);
  }
  const dH = f.bbox.h - b.bbox.h;
  const dBottom = (f.bbox.y + f.bbox.h) - (b.bbox.y + b.bbox.h);
  const dCx = (f.bbox.x + f.bbox.w / 2) - (b.bbox.x + b.bbox.w / 2);
  const canvasOk = f.w === b.w && f.h === b.h;
  // When the frame-2 art is clipped at a horizontal canvas edge its measured
  // bbox is truncated, so centerX is unreliable there (committed drake-e-2 is
  // exactly this case: pose stretches to the left edge, centerX drifts 2.5px
  // while height/bottom align within 1px). Height and bottom stay hard gates
  // — sprites are bottom-anchored, so those are what pop in-game.
  const hClipped = f.clipped.includes("left") || f.clipped.includes("right");
  const over =
    !canvasOk ||
    Math.abs(dH) > tol ||
    Math.abs(dBottom) > tol ||
    (!hClipped && Math.abs(dCx) > tol);
  if (check) {
    if (over) {
      failures++;
      console.log(`FAIL ${tag}`);
      console.log(`     canvas ${f.w}x${f.h} vs base ${b.w}x${b.h}${canvasOk ? "" : " (MISMATCH)"}`);
      console.log(`     height ${f.bbox.h} vs ${b.bbox.h} (delta ${dH > 0 ? "+" : ""}${dH})`);
      console.log(`     bottom  ${f.bbox.y + f.bbox.h} vs ${b.bbox.y + b.bbox.h} (delta ${dBottom > 0 ? "+" : ""}${dBottom})`);
      console.log(`     centerX ${dCx > 0 ? "+" : ""}${dCx.toFixed(1)}${hClipped ? " (advisory: art clipped at horizontal edge)" : ""}`);
    } else {
      console.log(`OK   ${tag} (canvas ${f.w}x${f.h}, height ${f.bbox.h}, bottom ${f.bbox.y + f.bbox.h}${hClipped ? `, centerX advisory ${dCx > 0 ? "+" : ""}${dCx.toFixed(1)} — h-clipped` : ""})`);
    }
    continue;
  }
  const res = await page.evaluate(
    (d) => window.normalize(d.f2, d.w, d.h, d.bbox),
    { f2: b64(f2), w: b.w, h: b.h, bbox: b.bbox },
  );
  writeFileSync(f2, Buffer.from(res.dataUrl.split("base64,")[1], "base64"));
  const nb = await page.evaluate((d) => window.analyze(d), b64(f2));
  console.log(`TUNED ${tag}`);
  console.log(`      canvas ${f.w}x${f.h} -> ${b.w}x${b.h}, content scale ${res.scale.toFixed(3)}`);
  console.log(`      height ${f.bbox.h} -> ${nb.bbox.h} (base ${b.bbox.h}), bottom ${f.bbox.y + f.bbox.h} -> ${nb.bbox.y + nb.bbox.h} (base ${b.bbox.y + b.bbox.h})`);
  if (nb.clipped.length) console.log(`      WARN normalized content touches edge (${nb.clipped.join(",")})`);
}

await browser.close();
if (check) {
  console.log(failures ? `\n${failures} pair(s) over tolerance ${tol}px` : `\nall ${pairs.length} pair(s) within tolerance ${tol}px`);
  process.exit(failures ? 1 : 0);
}
