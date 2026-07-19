import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "src", "resources");

// ---------- pixel buffer ----------
function makeBuf(w, h) {
  // RGBA, premultiplied alpha = false. (r,g,b,a) per pixel, row-major.
  return { w, h, px: new Uint8Array(w * h * 4) };
}
function setPx(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = (y * buf.w + x) * 4;
  buf.px[i] = r; buf.px[i + 1] = g; buf.px[i + 2] = b; buf.px[i + 3] = a;
}
function parseHex(hex) {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, (n >> 0) & 15 * 17];
}
function fillRect(buf, x, y, w, h, color) {
  const [r, g, b, a] = parseHex(color);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(buf, xx, yy, r, g, b, a);
  }
}
function outlineRect(buf, x, y, w, h, color) {
  fillRect(buf, x, y, w, 1, color);
  fillRect(buf, x, y + h - 1, w, 1, color);
  fillRect(buf, x, y, 1, h, color);
  fillRect(buf, x + w - 1, y, 1, h, color);
}

// ---------- palette (mirrors tools/sprites/pixel-art.html RESOURCE_PAL) ----------
const RESOURCE_PAL = {
  gold:   { stone:"#c8a868", stoneDk:"#7a5a30", stoneHi:"#ecd49a", outline:"#1a1208", rune:"#ffd84a", glow:"#fff200" },
  wood:   { stone:"#8aa66c", stoneDk:"#4a5a30", stoneHi:"#b8c898", outline:"#10180a", rune:"#a8e860", glow:"#e8ffb0" },
  stone:  { stone:"#a8a8a0", stoneDk:"#585850", stoneHi:"#d0d0c8", outline:"#101010", rune:"#e8e8e0", glow:"#ffffff" },
  iron:   { stone:"#787886", stoneDk:"#383848", stoneHi:"#a0a0b0", outline:"#0a0a0e", rune:"#e87a5a", glow:"#ffb070" },
  arcane: { stone:"#5a4878", stoneDk:"#2a1838", stoneHi:"#8870a0", outline:"#08040a", rune:"#d098ff", glow:"#f8d8ff" },
};

function drawStone(buf, p) {
  fillRect(buf, 4, 4, 24, 24, p.stone);
  outlineRect(buf, 4, 4, 24, 24, p.outline);
  // chip two corners (paint transparent)
  setPx(buf, 4, 4, 0, 0, 0, 0);
  setPx(buf, 27, 27, 0, 0, 0, 0);
  // bevel
  fillRect(buf, 5, 5, 22, 1, p.stoneHi);
  fillRect(buf, 5, 26, 22, 1, p.stoneDk);
  // carved inner frame
  fillRect(buf, 7, 7, 18, 1, p.stoneDk);
  fillRect(buf, 7, 23, 18, 1, p.stoneDk);
  fillRect(buf, 7, 7, 1, 17, p.stoneDk);
  fillRect(buf, 24, 7, 1, 17, p.stoneDk);
}

function drawGold(buf) {
  const p = RESOURCE_PAL.gold; drawStone(buf, p);
  fillRect(buf, 16, 10, 1, 1, p.glow); fillRect(buf, 16, 22, 1, 1, p.glow);
  fillRect(buf, 10, 16, 1, 1, p.glow); fillRect(buf, 22, 16, 1, 1, p.glow);
  fillRect(buf, 16, 11, 1, 2, p.rune); fillRect(buf, 16, 20, 1, 2, p.rune);
  fillRect(buf, 11, 16, 2, 1, p.rune); fillRect(buf, 20, 16, 2, 1, p.rune);
  fillRect(buf, 14, 14, 5, 5, p.rune);
  fillRect(buf, 15, 15, 2, 2, p.glow);
  fillRect(buf, 16, 15, 1, 1, "#ffffff");
}
function drawWood(buf) {
  const p = RESOURCE_PAL.wood; drawStone(buf, p);
  fillRect(buf, 15, 12, 3, 1, p.rune);
  fillRect(buf, 14, 13, 5, 1, p.rune);
  fillRect(buf, 14, 14, 5, 1, p.rune);
  fillRect(buf, 14, 15, 5, 1, p.rune);
  fillRect(buf, 15, 16, 3, 1, p.rune);
  fillRect(buf, 16, 13, 1, 3, p.glow);
  fillRect(buf, 16, 17, 1, 4, p.rune);
  fillRect(buf, 15, 12, 1, 1, p.glow);
}
function drawStone2(buf) {
  const p = RESOURCE_PAL.stone; drawStone(buf, p);
  fillRect(buf, 13, 13, 7, 1, p.rune);
  fillRect(buf, 13, 19, 7, 1, p.rune);
  fillRect(buf, 13, 13, 1, 7, p.rune);
  fillRect(buf, 19, 13, 1, 7, p.rune);
  fillRect(buf, 16, 14, 1, 5, p.rune);
  fillRect(buf, 14, 16, 5, 1, p.rune);
  fillRect(buf, 14, 14, 1, 1, p.glow);
}
function drawIron(buf) {
  const p = RESOURCE_PAL.iron; drawStone(buf, p);
  fillRect(buf, 16, 10, 1, 1, p.glow);
  fillRect(buf, 16, 11, 1, 1, p.rune);
  fillRect(buf, 15, 12, 3, 1, p.rune);
  fillRect(buf, 14, 13, 5, 1, p.rune);
  fillRect(buf, 16, 14, 1, 8, p.rune);
  fillRect(buf, 11, 15, 9, 1, p.rune);
  fillRect(buf, 11, 16, 1, 1, p.glow);
}
function drawArcane(buf) {
  const p = RESOURCE_PAL.arcane; drawStone(buf, p);
  fillRect(buf, 16, 9, 1, 1, p.glow); fillRect(buf, 16, 23, 1, 1, p.glow);
  fillRect(buf, 9, 16, 1, 1, p.glow); fillRect(buf, 23, 16, 1, 1, p.glow);
  fillRect(buf, 16, 10, 1, 13, p.rune);
  fillRect(buf, 10, 16, 13, 1, p.rune);
  fillRect(buf, 15, 15, 3, 3, p.rune);
  fillRect(buf, 16, 16, 1, 1, "#ffffff");
  fillRect(buf, 14, 14, 1, 1, p.glow);
  fillRect(buf, 18, 18, 1, 1, p.glow);
}

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(4 + 4 + len + 4);
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(out.subarray(4, 4 + 4 + len), 0);
  const c = crc32(crcInput);
  out[8 + len] = (c >>> 24) & 0xff;
  out[8 + len + 1] = (c >>> 16) & 0xff;
  out[8 + len + 2] = (c >>> 8) & 0xff;
  out[8 + len + 3] = c & 0xff;
  return out;
}
function encodePng(buf) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr[0] = (buf.w >>> 24) & 0xff;
  ihdr[1] = (buf.w >>> 16) & 0xff;
  ihdr[2] = (buf.w >>> 8) & 0xff;
  ihdr[3] = buf.w & 0xff;
  ihdr[4] = (buf.h >>> 24) & 0xff;
  ihdr[5] = (buf.h >>> 16) & 0xff;
  ihdr[6] = (buf.h >>> 8) & 0xff;
  ihdr[7] = buf.h & 0xff;
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // scanlines with filter byte 0
  const stride = buf.w * 4;
  const raw = new Uint8Array((stride + 1) * buf.h);
  for (let y = 0; y < buf.h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(buf.px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);
  const png = new Uint8Array(
    sig.length + (4 + 4 + 13 + 4) + (4 + 4 + compressed.length + 4) + (4 + 4 + 0 + 4)
  );
  let off = 0;
  png.set(sig, off); off += sig.length;
  const ihdrChunk = chunk("IHDR", ihdr);
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  const idatChunk = chunk("IDAT", compressed);
  png.set(idatChunk, off); off += idatChunk.length;
  const iendChunk = chunk("IEND", new Uint8Array(0));
  png.set(iendChunk, off);
  return png;
}

// ---------- run ----------
const sprites = [
  { name: "resource-gold",   w: 32, h: 32, draw: drawGold },
  { name: "resource-wood",   w: 32, h: 32, draw: drawWood },
  { name: "resource-stone",  w: 32, h: 32, draw: drawStone2 },
  { name: "resource-iron",   w: 32, h: 32, draw: drawIron },
  { name: "resource-arcane", w: 32, h: 32, draw: drawArcane },
];

for (const s of sprites) {
  const buf = makeBuf(s.w, s.h);
  s.draw(buf);
  const png = encodePng(buf);
  const out = path.join(outDir, s.name + ".png");
  writeFileSync(out, png);
  console.log("wrote", out, png.length, "bytes");
}
