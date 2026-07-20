import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS_DIR, CASTLE_SPRITES, RESOURCE_SPRITES } from "./manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "..", "..", "sprite-preview.html");

const RESOURCE_LABELS = {
  gold: "gold — alchemical sun rune",
  wood: "wood — leaf rune",
  stone: "stone — earth rune",
  iron: "iron — mars rune",
  arcane: "arcane — star rune",
};

const ASSET_BASE = ASSETS_DIR;

function img(cls, src, style = "") {
  const styleAttr = style ? ` style="${style}"` : "";
  return `<img class="${cls}" src="${ASSET_BASE}/${src}"${styleAttr}/>`;
}

const castleRow = (cls, height) =>
  Object.values(CASTLE_SPRITES)
    .map((f, i) => {
      const lvl = i + 1;
      const labels = ["L1 small town", "L2 fortified", "L3 castle"];
      return `    <div class="cell">${img(`pixel ${cls}`, f, `height:${height}px`)}<div class="lbl">${labels[i]}</div></div>`;
    })
    .join("\n");

const resourceIcons = Object.entries(RESOURCE_SPRITES)
  .map(([k, f]) => `    <div class="cell">${img("pixel", f, "height:48px")}<div class="lbl">${RESOURCE_LABELS[k]}</div></div>`)
  .join("\n");

const resourceInHex = Object.entries(RESOURCE_SPRITES)
  .map(([k, f]) => `    <div class="cell" style="position:relative;">
      <div class="hex-frame" style="width:96px; height:84px;">${img("pixel", f, "height:36px")}</div>
      <div class="lbl">in hex (${k})</div>
    </div>`)
  .join("\n");

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Castle Sprite Preview</title>
<style>
  body { background:#0a0a0a; margin:0; padding:24px; font-family:monospace; color:#ccc; }
  h1 { font-size:16px; color:#ffcc00; margin:0 0 4px; }
  .sub { font-size:12px; color:#888; margin-bottom:18px; }
  .row { display:flex; gap:24px; margin-bottom:22px; align-items:flex-end; flex-wrap:wrap; }
  .cell { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .hex-frame {
    width:74px; height:64px;
    background:#3a6b3a;
    clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
    display:flex; align-items:center; justify-content:center;
    position:relative; overflow:visible;
  }
  .lbl { font-size:12px; color:#bbb; }
  .title { font-size:13px; color:#ffcc00; margin: 16px 0 8px; }
  img.pixel { image-rendering: pixelated; image-rendering: crisp-edges; }
  img.s1 { width:auto; height:48px; }
  img.s2 { width:auto; height:96px; }
  img.s3 { width:auto; height:160px; }
  img.s4 { width:auto; height:240px; }
  .hexrow { display:flex; gap:6px; align-items:center; }
  .hex-empty {
    width:74px; height:64px;
    background:#3a6b3a;
    clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  }
  .stage { background:#2a4a2a; padding:18px; border:1px solid #1a3a1a; border-radius:4px; }
  .hex-bg { width:200px; height:184px; background:#3a6b3a; border:1px solid #2a4a2a;
            clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%); }
  .hexlbl { font-size:11px; color:#ffcc00; text-align:center; width:200px; }
</style>
</head>
<body>
  <h1>Castle Sprite Preview</h1>
  <div class="sub">Auto-generated from tools/sprites/manifest.mjs. Do not edit by hand.</div>

  <div class="title">In-game hex scale (1x — sprite drawn over a 55x48 hex)</div>
  <div class="stage">
    <div class="hexrow">
      <div class="hex-frame"><img class="pixel s1" src="${ASSET_BASE}/${CASTLE_SPRITES[1]}"/></div>
      <div class="hex-empty"></div>
      <div class="hex-frame"><img class="pixel s1" src="${ASSET_BASE}/${CASTLE_SPRITES[2]}"/></div>
      <div class="hex-empty"></div>
      <div class="hex-frame"><img class="pixel s1" src="${ASSET_BASE}/${CASTLE_SPRITES[3]}"/></div>
    </div>
    <div class="hexrow" style="margin-top:8px;">
      <div class="lbl" style="width:74px; text-align:center;">L1 small town</div>
      <div style="width:74px;"></div>
      <div class="lbl" style="width:74px; text-align:center;">L2 fortified</div>
      <div style="width:74px;"></div>
      <div class="lbl" style="width:74px; text-align:center;">L3 castle</div>
    </div>
  </div>

  <div class="title">2x preview</div>
  <div class="row">
${castleRow("s2", 96).replace(/L1 small town|L2 fortified|L3 castle/g, m => ({ "L1 small town": "L1 — small town", "L2 fortified": "L2 — fortified town", "L3 castle": "L3 — castle with keep" }[m]))}
  </div>

  <div class="title">3x detail</div>
  <div class="row">
${castleRow("s3", 160).replace(/L1 small town|L2 fortified|L3 castle/g, m => ({ "L1 small town": "L1 (96x80)", "L2 fortified": "L2 (112x112)", "L3 castle": "L3 (128x160)" }[m]))}
  </div>

  <div class="title">Resource tile icons (32x32, transparent, in-game at hex centre)</div>
  <div class="row">
${resourceIcons}
  </div>
  <div class="row">
${resourceInHex}
  </div>

  <div class="title">Depth leak demo — L3 tower extending into hex above</div>
  <div class="stage" style="position:relative; padding:30px; background:transparent; border:none;">
    <div style="position:relative; width:340px; height:340px;">
      <div class="hex-bg hex-up" style="position:absolute; left:60px; top:0px;"></div>
      <div class="hexlbl" style="position:absolute; left:60px; top:60px;">hex (r-1) — above</div>
      <div class="hex-bg hex-cur" style="position:absolute; left:0px; top:120px;"></div>
      <div class="hexlbl" style="position:absolute; left:0px; top:200px;">current hex</div>
      <img class="pixel" src="${ASSET_BASE}/${CASTLE_SPRITES[3]}" style="position:absolute; left:-46px; top:0px; width:240px; height:300px;"/>
    </div>
  </div>
</body>
</html>
`;

writeFileSync(outPath, html, "utf8");
console.log("wrote", outPath);
