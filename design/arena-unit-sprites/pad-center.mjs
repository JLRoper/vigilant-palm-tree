// One-off: rescale a master's content to 92% and re-center on a transparent
// 1024x1024 canvas, adding ~42px clear margin on every edge (design artifact
// QA, not repo tooling). Only for masters whose art sits too close to the
// canvas edge to survive the 128px icon border-ring gate.
//   node pad-center.mjs <file.png> [scale=0.92]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, scaleArg] = process.argv.slice(2);
if (!file) { console.error("usage: node pad-center.mjs <file.png> [scale=0.92]"); process.exit(1); }
const scale = scaleArg ? Number(scaleArg) : 0.92;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.pad = async (b64, scale) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (1024 - w) / 2, (1024 - h) / 2, w, h);
  return c.toDataURL("image/png");
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const url = await page.evaluate(async ([b64, scale]) => window.pad(b64, scale), [readFileSync(file).toString("base64"), scale]);
writeFileSync(file, Buffer.from(url.split("base64,")[1], "base64"));
console.log(file + ": content rescaled x" + scale + " and centered");
await browser.close();
