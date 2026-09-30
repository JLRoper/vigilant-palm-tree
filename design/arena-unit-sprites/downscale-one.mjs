// One-off single-file variant of downscale-poses.mjs: 1024px master -> 128x128
// transparent PNG with the same hard gate (exact size + fully transparent 2px border ring).
//   node downscale-one.mjs <in.png> <out.png>
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: node downscale-one.mjs <in.png> <out.png>");
  process.exit(1);
}
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
  const url = cout.toDataURL("image/png");
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
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(inPath);
const r = await page.evaluate(async ([b64, out]) => window.convert(b64, out), [buf.toString("base64"), OUT]);
const ok = r.sizeOk && r.ringBad === 0;
if (ok) writeFileSync(outPath, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(`${inPath} (${r.srcW}x${r.srcH}) -> ${outPath} ${r.w}x${r.h} ring-bad-px=${r.ringBad} ${ok ? "GATE PASS" : "GATE FAIL"}`);
await browser.close();
if (!ok) process.exit(1);
