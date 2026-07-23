import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

console.log("start, process.argv[2] =", process.argv[2] ? "set" : "MISSING");

const apiKey = process.argv[2];
if (!apiKey) { console.error("Need API key arg"); process.exit(1); }

const tmpDir = "C:/Users/Jacob/AppData/Local/Temp/kilo/flux";
const resDir = "C:/ProjectDevelopment/heroes-js/src/resources";
const TOL = 32, FEATHER = 24;

const browser = await chromium.launch();

const promptL2 = "Top-down three-quarter isometric view of a small fortified medieval town, scale miniatures: a wood palisade wall of pointed log stakes enclosing the settlement, a central gated arch entrance with a banner, two front-side watchtowers with crenellated tops and small red and blue banners, several thatched-roof cottages of varied sizes inside the walls, a small well or shed, dirt paths between buildings, surrounded by olive grass. Warm painterly medieval-fantasy strategy game style, soft hand-painted shading, varied building sizes, tawny and brown thatch, pale plaster walls with dark brown ink outlines, no people, isolated game asset, transparent background, no background, no frame.";

const promptL3 = "Top-down three-quarter isometric view of a tall medieval stone castle, scale miniatures: a tall central keep with a high pointed spire topped with a banner finial, stone curtain walls with crenellations, two back corner towers and two front corner towers with conical red roofs, a gatehouse, surrounded by olive grass. Warm painterly medieval-fantasy strategy game style, soft hand-painted shading, grey stone walls with highlights and shadows, red roofs, red and blue banners with yellow emblems, vertically taller than wide, dark brown ink outlines, no people, isolated game asset, transparent background, no background, no frame.";

async function gen(prompt, genW, genH) {
  const resp = await fetch("https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, width: genW, height: genH, safety_tolerance: 5, output_format: "png" }),
  });
  if (!resp.ok) throw new Error("FLUX HTTP " + resp.status + ": " + await resp.text());
  const json = await resp.json();
  const d = json.images[0];
  const i = d.indexOf("base64,");
  return Buffer.from(d.substring(i + 7), "base64");
}

async function process(rawPath, outPath, W, H) {
  const buf = readFileSync(rawPath);
  const dataUri = "data:image/png;base64," + buf.toString("base64");
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">
    <canvas id="c" width="${W}" height="${H}"></canvas>
    <img id="i" src="${dataUri}" style="display:none">
    <script>
      const img = document.getElementById('i');
      const run = () => {
        const c = document.getElementById('c');
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        window.__done = true;
      };
      if (img.complete && img.naturalWidth) run();
      else img.onload = run;
      img.onerror = (e) => { window.__err = String(e); };
    </script></body></html>`);
  await page.waitForFunction(() => window.__done === true || window.__err, { timeout: 30000 });
  const err = await page.evaluate(() => window.__err);
  if (err) throw new Error("img error: " + err);

  await page.evaluate(({ TOL, FEATHER, W, H }) => {
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const idx = (x, y) => (y * W + x) * 4;
    const samples = [];
    const cands = [[0,0],[W-1,0],[0,H-1],[W-1,H-1],
      [Math.floor(W/2),0],[Math.floor(W/2),H-1],[0,Math.floor(H/2)],[W-1,Math.floor(H/2)],
      [2,2],[W-3,2],[2,H-3],[W-3,H-3]];
    for (const [x,y] of cands) { const i=idx(x,y); samples.push([d[i],d[i+1],d[i+2]]); }
    const key = (c)=>Math.round(c[0]/16)+"_"+Math.round(c[1]/16)+"_"+Math.round(c[2]/16);
    const counts={}; let bg=samples[0], best=0;
    for (const s of samples){const k=key(s);counts[k]=(counts[k]||0)+1;if(counts[k]>best){best=counts[k];bg=s;}}
    const match=(x,y)=>{const i=idx(x,y);if(d[i+3]===0)return false;const dr=Math.abs(d[i]-bg[0]),dg=Math.abs(d[i+1]-bg[1]),db=Math.abs(d[i+2]-bg[2]);return (dr+dg+db)<=TOL*3;};
    const visited=new Uint8Array(W*H); const stack=[];
    for(let x=0;x<W;x++){if(match(x,0))stack.push([x,0]);if(match(x,H-1))stack.push([x,H-1]);}
    for(let y=0;y<H;y++){if(match(0,y))stack.push([0,y]);if(match(W-1,y))stack.push([W-1,y]);}
    while(stack.length){const [x,y]=stack.pop();if(visited[y*W+x])continue;visited[y*W+x]=1;if(!match(x,y))continue;d[idx(x,y)+3]=0;
      if(x>0)stack.push([x-1,y]);if(x<W-1)stack.push([x+1,y]);if(y>0)stack.push([x,y-1]);if(y<H-1)stack.push([x,y+1]);}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=idx(x,y);if(d[i+3]===0)continue;
      const dist=Math.abs(d[i]-bg[0])+Math.abs(d[i+1]-bg[1])+Math.abs(d[i+2]-bg[2]);
      if(dist<TOL*3+FEATHER*3){const t=(dist-TOL*3)/(FEATHER*3);if(t<1)d[i+3]=Math.round(d[i+3]*t);}}
    ctx.putImageData(img,0,0);
    const sx = W / 2, sy = H * 0.75, rx = W * 0.65, ry = H * 0.25;
    const off = document.createElement('canvas');
    const R = Math.max(rx, ry);
    off.width = R * 2; off.height = R * 2;
    const octx = off.getContext('2d');
    const rg = octx.createRadialGradient(R, R, 0, R, R, R);
    rg.addColorStop(0,    "rgba(0,0,0,0.55)");
    rg.addColorStop(0.45, "rgba(0,0,0,0.30)");
    rg.addColorStop(0.85, "rgba(0,0,0,0.08)");
    rg.addColorStop(1,    "rgba(0,0,0,0)");
    octx.fillStyle = rg;
    octx.fillRect(0, 0, off.width, off.height);
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(off, sx - rx, sy - ry, rx * 2, ry * 2);
    ctx.restore();
  }, { TOL, FEATHER, W, H });

  const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL("image/png"));
  await page.close();
  const b64 = dataUrl.substring(dataUrl.indexOf("base64,") + 7);
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  console.log("Wrote", outPath, "-", readFileSync(outPath).length, "bytes");
}

console.log("Generating L2 (fortified town)...");
const raw2 = await gen(promptL2, 224, 224);
writeFileSync(tmpDir + "/castle-l2-raw.png", raw2);
await process(tmpDir + "/castle-l2-raw.png", resDir + "/castle-l2.png", 112, 112);

console.log("Generating L3 (stone castle)...");
const raw3 = await gen(promptL3, 192, 240);
writeFileSync(tmpDir + "/castle-l3-raw.png", raw3);
await process(tmpDir + "/castle-l3-raw.png", resDir + "/castle-l3.png", 128, 160);

await browser.close();
console.log("Done.");