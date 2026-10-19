import { TERRAIN_COLORS, hashString, mulberry32, type CityBackdropSignature, type CityViewSize, type Terrain } from "@heroes/engine";
import type { CityGridFootprint } from "../types";

const TAU = Math.PI * 2;
const MIST = "#ece6d8";
const PLATE_BASE_RX = 550;
const PLATE_BASE_RY = 310;

interface TierProfile {
  plateScale: number;
  wider: boolean;
  maskSolid: number;
}

const TIER_PROFILES: Record<CityViewSize, TierProfile> = {
  5: { plateScale: 1, wider: false, maskSolid: 0.78 },
  10: { plateScale: 1.08, wider: true, maskSolid: 0.86 },
  15: { plateScale: 1.16, wider: true, maskSolid: 0.9 },
};

function tierProfile(size?: CityViewSize): TierProfile {
  return TIER_PROFILES[size ?? 5];
}
const TERRAINS: readonly Terrain[] = ["grass", "dirt", "water", "forest", "denseForest", "desert", "mountain", "swamp", "snow"];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channelHex(n: number): string {
  return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + channelHex(r) + channelHex(g) + channelHex(b);
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = clamp(t, 0, 1);
  return rgbToHex(lerp(a.r, b.r, k), lerp(a.g, b.g, k), lerp(a.b, b.b, k));
}

function lighten(hex: string, t: number): string {
  return mix(hex, "#ffffff", t);
}

function darken(hex: string, t: number): string {
  return mix(hex, "#000000", t);
}

function alpha(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + clamp(a, 0, 1) + ")";
}

interface BiomePalette {
  fill: string;
  stroke: string;
  sky: string;
  far: string;
  mid: string;
  near: string;
  accent: string;
  water: string;
  ink: string;
}

function derive(terrain: Terrain): BiomePalette {
  const c = TERRAIN_COLORS[terrain];
  return {
    fill: c.fill,
    stroke: c.stroke,
    sky: mix(c.fill, MIST, 0.84),
    far: mix(c.fill, MIST, 0.58),
    mid: mix(c.fill, MIST, 0.26),
    near: mix(c.fill, MIST, 0.08),
    accent: mix(lighten(c.fill, 0.35), MIST, 0.18),
    water: terrain === "water" ? mix(c.fill, "#d7eaf0", 0.32) : mix(TERRAIN_COLORS.water.fill, MIST, 0.28),
    ink: c.stroke,
  };
}

const PALETTES: Record<Terrain, BiomePalette> = {
  grass: derive("grass"),
  dirt: derive("dirt"),
  water: derive("water"),
  forest: derive("forest"),
  denseForest: derive("denseForest"),
  desert: derive("desert"),
  mountain: derive("mountain"),
  swamp: derive("swamp"),
  snow: derive("snow"),
};

interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  sign(): number;
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p) { return next() < p; },
    sign() { return next() < 0.5 ? -1 : 1; },
  };
}

function noise1D(x: number, seed: number): number {
  const rnd = mulberry32(hashString("noise1d|" + seed));
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    const phase = rnd() * TAU;
    value += Math.sin(x * frequency * TAU + phase) * amplitude;
    norm += amplitude;
    amplitude *= 0.56;
    frequency *= 2.07;
  }
  return clamp(value / norm, -1, 1);
}

interface Point {
  x: number;
  y: number;
}

interface RibbonPoint extends Point {
  w: number;
}

interface Blob extends Point {
  rx: number;
  ry: number;
  rotation: number;
  pts: Point[];
  biomeKey: Terrain;
  scale: number;
}

interface Plate {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface Zone {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

interface DioramaEnv {
  sky: string;
  mist: string;
  ink: string;
  base: string;
  baseNear: string;
  baseFar: string;
  plate: Plate;
  cityZone: Zone;
  paths: Point[][];
}

interface WeightedBiomes {
  weights: Record<Terrain, number>;
  total: number;
  dominant: Terrain;
}

function weightedBiomes(signature: CityBackdropSignature): WeightedBiomes {
  const weights = {} as Record<Terrain, number>;
  for (const terrain of TERRAINS) weights[terrain] = 0;
  weights[signature.center] += 2;
  for (const terrain of signature.neighbors) weights[terrain] += 1;
  const total = 2 + signature.neighbors.length;
  let dominant = signature.center;
  for (const terrain of TERRAINS) {
    if (weights[terrain] > weights[dominant]) dominant = terrain;
  }
  return { weights, total, dominant };
}

function blendBiomeColor(
  signature: CityBackdropSignature,
  key: keyof BiomePalette,
  extraMix: number,
): string {
  const { weights, total, dominant } = weightedBiomes(signature);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const terrain of TERRAINS) {
    const weight = weights[terrain];
    if (!weight) continue;
    const c = hexToRgb(PALETTES[terrain][key]);
    r += c.r * weight;
    g += c.g * weight;
    b += c.b * weight;
  }
  const blended = rgbToHex(r / total, g / total, b / total);
  if (extraMix > 0) return mix(blended, PALETTES[dominant][key], clamp(extraMix, 0, 1));
  return blended;
}

function softEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  strength: number,
  inner = 0.42,
): void {
  const inStop = clamp(inner, 0.05, 0.88);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(1, rx), Math.max(1, ry));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, alpha(color, strength));
  g.addColorStop(inStop, alpha(color, strength * 0.72));
  g.addColorStop(inStop + (1 - inStop) * 0.55, alpha(color, strength * 0.3));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function ringEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  strength: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(1, rx), Math.max(1, ry));
  const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1);
  g.addColorStop(0, alpha(color, 0));
  g.addColorStop(0.58, alpha(color, strength * 0.22));
  g.addColorStop(0.84, alpha(color, strength));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function closedSmoothPath(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
  const n = pts.length;
  if (!n) return;
  const first = pts[0];
  const last = pts[n - 1];
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
}

function ribbonPoints(pts: readonly RibbonPoint[], widthScale: number): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = p.w * widthScale;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  return left.concat(right.reverse());
}

function makeBlob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  rng: Rng,
  count?: number,
): Point[] {
  const n = count ?? rng.int(9, 13);
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * TAU;
    const jitter = rng.range(0.78, 1.18);
    pts.push({ x: cx + Math.cos(a) * rx * jitter, y: cy + Math.sin(a) * ry * jitter });
  }
  return pts;
}

function makeOutline(cx: number, cy: number, rx: number, ry: number, rng: Rng, seed: number): Point[] {
  const count = rng.int(24, 32);
  const phase = rng.range(0, TAU);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * TAU;
    const n1 = noise1D((i / count) * 2.2, seed + 17) * 7;
    const n2 = noise1D((i / count) * 5.4, seed + 41) * 4;
    const jitter = rng.range(-14, 14);
    const radial = n1 + n2 + jitter;
    pts.push({
      x: cx + Math.cos(a) * (rx + radial),
      y: cy + Math.sin(a) * (ry + radial * 0.62),
    });
  }
  return pts;
}

function distanceToPath(x: number, y: number, paths: readonly Point[][]): number {
  let best = Infinity;
  for (const pts of paths) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1);
      const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (d < best) best = d;
    }
  }
  return best;
}

function underCity(x: number, y: number, zone: Zone): boolean {
  const dx = (x - zone.x) / zone.rx;
  const dy = (y - zone.y) / zone.ry;
  return dx * dx + dy * dy < 1;
}

function blocked(env: DioramaEnv, x: number, y: number, margin = 18): boolean {
  if (underCity(x, y, env.cityZone)) return true;
  if (env.paths.length && distanceToPath(x, y, env.paths) < margin) return true;
  return false;
}

function buildEnv(
  signature: CityBackdropSignature,
  w: number,
  h: number,
  size?: CityViewSize,
  footprint?: CityGridFootprint,
): DioramaEnv {
  const info = weightedBiomes(signature);
  const centerPalette = PALETTES[signature.center];
  const dominantPalette = PALETTES[info.dominant];
  const sky = mix(centerPalette.sky, blendBiomeColor(signature, "sky", 0.3), 0.5);
  const mist = mix(lighten(sky, 0.32), dominantPalette.far, 0.18);
  const ink = dominantPalette.ink;
  const base = mix(
    blendBiomeColor(signature, "mid", 0.25),
    mix(PALETTES.grass.mid, PALETTES.dirt.mid, 0.4),
    0.16,
  );
  const baseNear = mix(
    blendBiomeColor(signature, "near", 0.2),
    mix(PALETTES.grass.near, PALETTES.dirt.near, 0.42),
    0.18,
  );
  const baseFar = mix(blendBiomeColor(signature, "far", 0.2), PALETTES.grass.far, 0.14);

  const profile = tierProfile(size);
  const gridHalfW = footprint?.halfWidth ?? 0;
  const gridHalfH = footprint?.halfHeight ?? 0;
  const plateRx = Math.min(
    Math.max(Math.min(w * 0.43, PLATE_BASE_RX) * profile.plateScale, gridHalfW * 1.14),
    w * 0.49,
  );
  const plateRy = Math.min(
    Math.max(Math.min(h * 0.3875, PLATE_BASE_RY) * profile.plateScale, gridHalfH * 1.16),
    h * 0.47,
  );
  const plateCx = footprint?.centerX ?? w / 2;
  const plateCy = footprint?.centerY ?? h * (profile.wider ? 0.4925 : 0.5375);
  const zoneRx = Math.max(w * (profile.wider ? 0.38 : 0.3), gridHalfW * 1.12);
  const zoneRy = Math.max(h * (profile.wider ? 0.28 : 0.22), gridHalfH * 1.12);

  return {
    sky,
    mist,
    ink,
    base,
    baseNear,
    baseFar,
    plate: {
      cx: plateCx,
      cy: plateCy,
      rx: plateRx,
      ry: plateRy,
    },
    cityZone: {
      x: plateCx,
      y: plateCy,
      rx: zoneRx,
      ry: zoneRy,
    },
    paths: [],
  };
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, env: DioramaEnv, rng: Rng): void {
  const top = lighten(env.sky, 0.22);
  const mid = env.sky;
  const bottom = mix(env.sky, env.baseFar, 0.32);
  const g = ctx.createLinearGradient(0, 0, w * 0.18, h);
  g.addColorStop(0, top);
  g.addColorStop(0.45, mid);
  g.addColorStop(0.76, mix(mid, bottom, 0.55));
  g.addColorStop(1, darken(bottom, 0.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  softEllipse(ctx, w / 2, h * 0.48, w * 0.44, h * 0.45, lighten(env.sky, 0.34), 0.4, 0.3);
  softEllipse(ctx, w / 2, h * 0.56, w * 0.24, h * 0.28, lighten(env.mist, 0.1), 0.25, 0.2);

  const bands = rng.int(2, 3);
  for (let i = 0; i < bands; i++) {
    const left = i % 2 === 0;
    const x = left ? rng.range(-40, w * 0.23) : w - rng.range(-40, w * 0.23);
    const y = rng.range(10, h * 0.16);
    const rx = rng.range(w * 0.13, w * 0.26);
    const ry = rng.range(h * 0.07, h * 0.14);
    const color = mix(env.mist, lighten(env.sky, 0.4), 0.5);
    softEllipse(ctx, x, y, rx, ry, color, rng.range(0.12, 0.2), 0.2);
    softEllipse(ctx, x + (left ? 60 : -60), y + 12, rx * 1.25, ry * 0.5, color, 0.07, 0.2);
  }

  const lower = ctx.createLinearGradient(0, h * 0.7, 0, h);
  lower.addColorStop(0, alpha(env.mist, 0));
  lower.addColorStop(1, alpha(env.mist, 0.16));
  ctx.fillStyle = lower;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
}

function drawPlateUnderside(
  ctx: CanvasRenderingContext2D,
  outline: readonly Point[],
  env: DioramaEnv,
  rng: Rng,
): void {
  const depth = rng.range(24, 32);
  const bottom = outline.map((p) => ({
    x: p.x + rng.range(-1.5, 1.5),
    y: p.y + depth + rng.range(-1.5, 1.5),
  }));
  closedSmoothPath(ctx, bottom);
  const g = ctx.createLinearGradient(
    0,
    env.plate.cy - env.plate.ry,
    0,
    env.plate.cy + env.plate.ry + depth,
  );
  g.addColorStop(0, darken(env.base, 0.42));
  g.addColorStop(0.55, darken(env.base, 0.6));
  g.addColorStop(1, darken(env.ink, 0.32));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  closedSmoothPath(ctx, bottom);
  ctx.clip();
  for (let i = 0; i < rng.int(22, 34); i++) {
    const p = outline[rng.int(0, outline.length - 1)];
    const len = rng.range(9, depth + 10);
    ctx.strokeStyle = alpha(darken(env.ink, 0.45), rng.range(0.12, 0.28));
    ctx.lineWidth = rng.range(1, 2.4);
    ctx.beginPath();
    ctx.moveTo(p.x + rng.range(-3, 3), p.y + rng.range(0, 5));
    ctx.lineTo(p.x + rng.range(-4, 4), p.y + len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlateTop(
  ctx: CanvasRenderingContext2D,
  outline: readonly Point[],
  env: DioramaEnv,
  rng: Rng,
): void {
  const p = env.plate;
  closedSmoothPath(ctx, outline);
  const g = ctx.createRadialGradient(p.cx - p.rx * 0.18, p.cy - p.ry * 0.4, 80, p.cx, p.cy, p.rx * 1.08);
  g.addColorStop(0, lighten(env.base, 0.14));
  g.addColorStop(0.5, env.base);
  g.addColorStop(0.82, mix(env.base, env.baseNear, 0.55));
  g.addColorStop(1, darken(env.baseNear, 0.18));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  closedSmoothPath(ctx, outline);
  ctx.clip();
  for (let i = 0; i < 3; i++) {
    const m = makeBlob(
      p.cx + rng.range(-0.55, 0.55) * p.rx,
      p.cy + rng.range(-0.4, 0.5) * p.ry,
      p.rx * rng.range(0.14, 0.3),
      p.ry * rng.range(0.12, 0.26),
      rng.range(0, TAU),
      rng,
      10,
    );
    closedSmoothPath(ctx, m);
    ctx.fillStyle = alpha(i % 2 === 0 ? lighten(env.base, 0.08) : darken(env.base, 0.08), 0.1);
    ctx.fill();
  }
  ctx.restore();

  closedSmoothPath(ctx, outline);
  ctx.strokeStyle = alpha(darken(env.base, 0.4), 0.4);
  ctx.lineWidth = 3;
  ctx.stroke();
}

interface Wedge {
  a0: number;
  a1: number;
  midAngle: number;
  biomeKey: Terrain;
  weight: number;
}

function buildWedges(signature: CityBackdropSignature, neighborBase: number, rng: Rng): Wedge[] {
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const w = rng.range(0.75, 1.35);
    weights.push(w);
    total += w;
  }
  const wedges: Wedge[] = [];
  let cursor = neighborBase + rng.range(0, 0.2);
  for (let i = 0; i < 6; i++) {
    const span = (weights[i] / total) * TAU;
    const a0 = cursor;
    const a1 = cursor + span;
    wedges.push({
      a0,
      a1,
      midAngle: (a0 + a1) / 2,
      biomeKey: signature.neighbors[i] ?? signature.center,
      weight: weights[i],
    });
    cursor = a1;
  }
  return wedges;
}

function drawSectors(ctx: CanvasRenderingContext2D, env: DioramaEnv, wedges: readonly Wedge[], rng: Rng): void {
  const p = env.plate;
  const radius = Math.hypot(p.rx, p.ry) * 1.08;
  ctx.save();
  if ("filter" in ctx) ctx.filter = "blur(8px)";
  for (const wedge of wedges) {
    const palette = PALETTES[wedge.biomeKey];
    const col = mix(palette.mid, palette.near, 0.28);
    const strength = rng.range(0.34, 0.52) * (0.85 + wedge.weight * 0.15);
    const g = ctx.createRadialGradient(p.cx, p.cy, 40, p.cx, p.cy, radius);
    g.addColorStop(0, alpha(col, 0.015));
    g.addColorStop(0.42, alpha(col, strength * 0.35));
    g.addColorStop(0.82, alpha(col, strength));
    g.addColorStop(1, alpha(col, strength * 0.7));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.cx, p.cy);
    ctx.arc(p.cx, p.cy, radius, wedge.a0 - 0.025, wedge.a1 + 0.025);
    ctx.closePath();
    ctx.fill();
  }
  if ("filter" in ctx) ctx.filter = "none";
  ctx.restore();
}

function drawCalmCenter(ctx: CanvasRenderingContext2D, env: DioramaEnv, rng: Rng): void {
  const z = env.cityZone;
  softEllipse(ctx, z.x, z.y - 10, z.rx * 0.92, z.ry * 0.94, env.baseNear, 0.14, 0.32);
  softEllipse(ctx, z.x - 20, z.y - 30, z.rx * 0.52, z.ry * 0.54, lighten(env.base, 0.16), 0.08, 0.2);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = darken(env.base, 0.18);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(0.2, 0.5);
    ctx.beginPath();
    ctx.moveTo(z.x + Math.cos(a) * z.rx * r, z.y + Math.sin(a) * z.ry * r);
    ctx.quadraticCurveTo(
      z.x + Math.cos(a + 0.4) * z.rx * (r + 0.08),
      z.y + Math.sin(a + 0.4) * z.ry * (r + 0.08),
      z.x + Math.cos(a + 0.2) * z.rx * (r + 0.16),
      z.y + Math.sin(a + 0.2) * z.ry * (r + 0.16),
    );
    ctx.stroke();
  }
  ctx.restore();
}

interface PathSpec {
  pts: RibbonPoint[];
}

const PATH_PREFERENCE: readonly Terrain[] = ["grass", "forest", "dirt", "desert", "snow"];

function buildPaths(
  env: DioramaEnv,
  signature: CityBackdropSignature,
  neighborBase: number,
  rng: Rng,
): PathSpec[] {
  const candidates: Array<{ slot: number; terrain: Terrain; pref: number }> = [];
  for (let slot = 0; slot < signature.neighbors.length; slot++) {
    const terrain = signature.neighbors[slot];
    const pref = PATH_PREFERENCE.indexOf(terrain);
    candidates.push({ slot, terrain, pref: pref >= 0 ? pref : PATH_PREFERENCE.length });
  }
  const passable = candidates.filter((c) => c.pref < PATH_PREFERENCE.length);
  const pool = passable.length > 0 ? passable : candidates;
  const count = Math.min(pool.length, rng.chance(0.58) ? 2 : 1);
  if (count <= 0) return [];

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const chosen = shuffled.slice(0, count).sort((a, b) => a.pref - b.pref);

  const p = env.plate;
  const scale = Math.max(0.6, Math.min(p.rx / PLATE_BASE_RX, p.ry / PLATE_BASE_RY));
  const zoneT = Math.max(env.cityZone.rx / p.rx, env.cityZone.ry / p.ry) * 1.02;

  const out: PathSpec[] = [];
  for (const candidate of chosen) {
    const angle = neighborBase + candidate.slot * (TAU / 6) + rng.range(-0.18, 0.18);
    const steps = 10;
    const startT = Math.min(0.9, zoneT);
    const endT = Math.max(startT + 0.14, rng.range(0.94, 1.01));
    const bend = rng.range(-0.16, 0.16);
    const w0 = rng.range(10, 13) * scale;
    const w1 = rng.range(5, 8) * scale;
    const pts: RibbonPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(startT, endT, u);
      const a = angle + Math.sin(u * Math.PI) * bend + rng.range(-0.018, 0.018);
      pts.push({
        x: p.cx + Math.cos(a) * p.rx * t,
        y: p.cy + Math.sin(a) * p.ry * t,
        w: lerp(w0, w1, smoothstep(0, 1, u)) * rng.range(0.85, 1.15),
      });
    }
    out.push({ pts });
  }
  return out;
}

function drawPath(ctx: CanvasRenderingContext2D, path: PathSpec, env: DioramaEnv, rng: Rng): void {
  const pts = path.pts;
  const tan = mix(PALETTES.dirt.accent, PALETTES.dirt.mid, 0.48);
  ctx.save();
  closedSmoothPath(ctx, ribbonPoints(pts, 1.22));
  ctx.fillStyle = alpha(darken(tan, 0.32), 0.24);
  ctx.fill();
  closedSmoothPath(ctx, ribbonPoints(pts, 0.95));
  ctx.fillStyle = alpha(tan, 0.58);
  ctx.fill();
  closedSmoothPath(ctx, ribbonPoints(pts, 0.45));
  ctx.fillStyle = alpha(lighten(tan, 0.16), 0.16);
  ctx.fill();

  ctx.strokeStyle = alpha(darken(tan, 0.28), 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[1].x, pts[1].y);
  for (let i = 2; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  for (let i = 0; i < rng.int(5, 10); i++) {
    const idx = rng.int(1, pts.length - 2);
    const q = pts[idx];
    const off = rng.range(0.55, 1.15) * q.w;
    const side = rng.sign();
    const x = q.x + side * off + rng.range(-2, 2);
    const y = q.y + side * off * 0.8 + rng.range(-2, 2);
    ctx.fillStyle = alpha(mix(darken(tan, 0.3), env.ink, 0.3), 0.45);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(1.4, 3), rng.range(0.9, 1.8), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const BLOB_SIZE: Record<Terrain, readonly [number, number]> = {
  water: [58, 96],
  forest: [96, 150],
  denseForest: [104, 158],
  mountain: [82, 122],
  desert: [92, 142],
  swamp: [86, 126],
  snow: [80, 118],
  grass: [76, 122],
  dirt: [80, 126],
};

function buildBlobs(env: DioramaEnv, wedges: readonly Wedge[], rng: Rng): Blob[] {
  const p = env.plate;
  const scale = Math.max(0.6, Math.min(p.rx / PLATE_BASE_RX, p.ry / PLATE_BASE_RY));
  const blobs: Blob[] = [];
  for (const wedge of wedges) {
    const count = rng.int(2, 3);
    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count;
      const angle = lerp(wedge.a0 + 0.05, wedge.a1 - 0.05, u) + rng.range(-0.05, 0.05);
      const t = rng.range(0.55, 0.85);
      let x = p.cx + Math.cos(angle) * p.rx * t;
      let y = p.cy + Math.sin(angle) * p.ry * t;
      for (let push = 0; push < 12 && underCity(x, y, env.cityZone); push++) {
        x = p.cx + (x - p.cx) * 1.06;
        y = p.cy + (y - p.cy) * 1.06;
      }
      const range = BLOB_SIZE[wedge.biomeKey];
      const sizeBoost = lerp(0.82, 1.2, t);
      const rx = rng.range(range[0], range[1]) * sizeBoost * scale;
      const ry = rx * rng.range(0.55, 0.88);
      const rotation = rng.range(0, TAU);
      blobs.push({
        x: x + rng.range(-10, 10) * scale,
        y: y + rng.range(-8, 8) * scale,
        rx,
        ry,
        rotation,
        pts: makeBlob(x, y, rx, ry, rotation, rng, rng.int(9, 13)),
        biomeKey: wedge.biomeKey,
        scale: clamp(rx / (105 * scale), 0.78, 1.3),
      });
    }
  }
  return blobs;
}

function groundColor(terrain: Terrain, env: DioramaEnv): string {
  return mix(PALETTES[terrain].near, env.base, 0.18);
}

function drawBlobGround(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  if (blob.biomeKey === "water") {
    drawWaterGround(ctx, blob, env, rng, false);
    return;
  }
  if (blob.biomeKey === "swamp") {
    drawWaterGround(ctx, blob, env, rng, true);
    return;
  }
  const palette = PALETTES[blob.biomeKey];
  const base = groundColor(blob.biomeKey, env);
  closedSmoothPath(ctx, blob.pts);
  ctx.fillStyle = alpha(base, 0.80);
  ctx.fill();
  ctx.strokeStyle = alpha(palette.stroke, 0.34);
  ctx.lineWidth = 2.4;
  ctx.stroke();
  closedSmoothPath(ctx, makeBlob(
    blob.x + rng.range(-0.4, 0.4) * blob.rx,
    blob.y + rng.range(-0.4, 0.4) * blob.ry,
    blob.rx * rng.range(0.18, 0.38),
    blob.ry * rng.range(0.18, 0.38),
    rng.range(0, TAU),
    rng,
    8,
  ));
  ctx.fillStyle = alpha(lighten(palette.mid, 0.08), 0.30);
  ctx.fill();
}

function drawWaterGround(
  ctx: CanvasRenderingContext2D,
  blob: Blob,
  env: DioramaEnv,
  rng: Rng,
  murky: boolean,
): void {
  const palette = PALETTES.swamp;
  const water = murky
    ? mix(PALETTES.swamp.water, palette.near, 0.4)
    : PALETTES.water.water;
  const bank = mix(water, env.base, 0.46);
  closedSmoothPath(ctx, blob.pts);
  ctx.fillStyle = alpha(bank, 0.55);
  ctx.fill();

  const rim = makeBlob(blob.x, blob.y + blob.ry * 0.04, blob.rx * 0.82, blob.ry * 0.78, blob.rotation, rng, 11);
  closedSmoothPath(ctx, rim);
  ctx.fillStyle = alpha(darken(water, 0.42), 0.5);
  ctx.fill();

  const inner = makeBlob(blob.x, blob.y + blob.ry * 0.04, blob.rx * 0.7, blob.ry * 0.66, blob.rotation, rng, 11);
  const g = ctx.createLinearGradient(blob.x - blob.rx, blob.y - blob.ry, blob.x + blob.rx, blob.y + blob.ry);
  g.addColorStop(0, alpha(lighten(water, murky ? 0.12 : 0.26), 0.75));
  g.addColorStop(0.46, alpha(water, 0.78));
  g.addColorStop(1, alpha(darken(water, 0.22), 0.8));
  closedSmoothPath(ctx, inner);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha(darken(water, 0.3), 0.25);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (murky) {
    softEllipse(ctx, blob.x, blob.y - blob.ry * 0.12, blob.rx * 0.7, blob.ry * 0.3, lighten(env.mist, 0.15), 0.1, 0.2);
  }
}

function drawBroadleaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  env: DioramaEnv,
  rng: Rng,
): void {
  const trunk = mix(color, env.ink, 0.55);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = alpha(trunk, 0.6);
  ctx.lineWidth = Math.max(1, size * 0.07);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + rng.range(-1.2, 1.2), y - size * 0.4);
  ctx.stroke();
  const rx = size * rng.range(0.24, 0.34);
  const ry = rx * rng.range(0.82, 1.12);
  const cx = x + rng.range(-1.5, 1.5);
  const cy = y - size * 0.6;
  ctx.fillStyle = alpha(mix(color, env.mist, 0.1), 0.75);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.12, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = alpha(mix(lighten(color, 0.18), env.mist, 0.08), 0.5);
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.28, cy - ry * 0.32, rx * 0.72, ry * 0.66, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawConifer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  env: DioramaEnv,
  rng: Rng,
): void {
  const trunk = mix(color, env.ink, 0.5);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = alpha(trunk, 0.55);
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + rng.range(-0.8, 0.8), y - size * 0.22);
  ctx.stroke();
  for (let layer = 0; layer < 3; layer++) {
    const ly = y - size * (0.18 + 0.22 * layer);
    const half = size * (0.3 - 0.07 * layer);
    ctx.fillStyle = alpha(mix(lighten(color, layer * 0.035), env.mist, 0.1), 0.78);
    ctx.beginPath();
    ctx.moveTo(x - half, ly);
    ctx.lineTo(x + half, ly);
    ctx.lineTo(x, ly - size * 0.34);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawReedClump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  h: number,
  env: DioramaEnv,
  rng: Rng,
): void {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const lean = rng.range(-3, 3);
    const hh = h * rng.range(0.6, 1.1);
    const bx = x + (i - count / 2) * 1.6;
    ctx.strokeStyle = alpha(mix(PALETTES.swamp.near, env.ink, 0.35), 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.quadraticCurveTo(bx + lean * 0.4, y - hh * 0.6, bx + lean, y - hh);
    ctx.stroke();
    ctx.fillStyle = alpha(PALETTES.swamp.accent, 0.4);
    ctx.beginPath();
    ctx.ellipse(bx + lean, y - hh, 1.2, 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawTuft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  color: string,
  env: DioramaEnv,
  rng: Rng,
): void {
  ctx.save();
  ctx.strokeStyle = alpha(mix(color, env.mist, 0.15), 0.5);
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const blades = rng.int(3, 5);
  for (let i = 0; i < blades; i++) {
    const lean = rng.range(-4, 4);
    const bx = x + (i - blades / 2) * 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.quadraticCurveTo(bx + lean * 0.5, y - h * 0.55, bx + lean, y - h * rng.range(0.6, 1.05));
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  env: DioramaEnv,
): void {
  ctx.save();
  ctx.strokeStyle = alpha(mix(PALETTES.grass.near, env.mist, 0.2), 0.4);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + r * 0.4, y - r * 3);
  ctx.stroke();
  ctx.fillStyle = alpha(mix(color, env.mist, 0.08), 0.62);
  ctx.beginPath();
  ctx.arc(x + r * 0.4, y - r * 3, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBoulder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  env: DioramaEnv,
  rng: Rng,
): void {
  softEllipse(ctx, x, y + r * 0.28, r * 1.15, r * 0.38, env.ink, 0.12);
  const pts: Point[] = [];
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * rng.range(0.68, 1.02);
    pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * 0.7 });
  }
  closedSmoothPath(ctx, pts);
  ctx.fillStyle = alpha(mix(color, env.mist, 0.12), 0.72);
  ctx.fill();
  ctx.strokeStyle = alpha(darken(color, 0.3), 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = alpha(mix(lighten(color, 0.2), env.mist, 0.1), 0.4);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.16, y - r * 0.28, r * 0.48, r * 0.26, -0.2, 0, TAU);
  ctx.fill();
}

function drawCactus(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  color: string,
  env: DioramaEnv,
  rng: Rng,
): void {
  ctx.save();
  ctx.strokeStyle = alpha(mix(color, env.mist, 0.1), 0.68);
  ctx.lineWidth = Math.max(1.5, h * 0.14);
  ctx.lineCap = "round";
  const lean = rng.range(-2.5, 2.5);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * 0.5, y - h * 0.5, x + lean, y - h);
  ctx.stroke();
  const side = rng.sign();
  const armY = y - h * rng.range(0.35, 0.6);
  ctx.beginPath();
  ctx.moveTo(x + lean * 0.3, armY);
  ctx.quadraticCurveTo(x + side * h * 0.3, armY + h * 0.02, x + side * h * 0.28, armY - h * 0.22);
  ctx.stroke();
  ctx.restore();
}

function drawPeak(
  ctx: CanvasRenderingContext2D,
  peak: { x: number; y: number; w: number; h: number },
  env: DioramaEnv,
  rng: Rng,
): void {
  const gray = PALETTES.mountain.mid;
  const light = PALETTES.mountain.far;
  const dark = PALETTES.mountain.near;
  const g = ctx.createLinearGradient(peak.x - peak.w, peak.y, peak.x + peak.w, peak.y - peak.h);
  g.addColorStop(0, alpha(mix(light, env.mist, 0.12), 0.72));
  g.addColorStop(0.55, alpha(mix(gray, env.mist, 0.14), 0.78));
  g.addColorStop(1, alpha(mix(dark, env.mist, 0.1), 0.78));
  ctx.beginPath();
  ctx.moveTo(peak.x - peak.w, peak.y);
  ctx.lineTo(peak.x - peak.w * 0.55, peak.y - peak.h * 0.34);
  ctx.lineTo(peak.x - peak.w * 0.22, peak.y - peak.h * 0.62);
  ctx.lineTo(peak.x + rng.range(-peak.w * 0.06, peak.w * 0.06), peak.y - peak.h);
  ctx.lineTo(peak.x + peak.w * 0.32, peak.y - peak.h * 0.55);
  ctx.lineTo(peak.x + peak.w * 0.7, peak.y - peak.h * 0.2);
  ctx.lineTo(peak.x + peak.w, peak.y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha(darken(dark, 0.2), 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();

  const capH = peak.h * rng.range(0.2, 0.32);
  ctx.beginPath();
  ctx.moveTo(peak.x, peak.y - peak.h);
  ctx.lineTo(peak.x + peak.w * 0.2, peak.y - peak.h + capH);
  ctx.lineTo(peak.x + peak.w * 0.07, peak.y - peak.h + capH * 0.66);
  ctx.lineTo(peak.x - peak.w * 0.02, peak.y - peak.h + capH * 1.02);
  ctx.lineTo(peak.x - peak.w * 0.17, peak.y - peak.h + capH * 0.58);
  ctx.closePath();
  ctx.fillStyle = alpha(mix(lighten(PALETTES.snow.accent, 0.1), env.mist, 0.06), 0.72);
  ctx.fill();
}

function drawMesa(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const mx = blob.x + rng.range(-0.4, 0.4) * blob.rx;
  const my = blob.y + rng.range(-0.15, 0.45) * blob.ry;
  if (blocked(env, mx, my, 16)) return;
  const mw = rng.range(16, 30) * blob.scale;
  const mh = rng.range(12, 24) * blob.scale;
  const col = mix(PALETTES.desert.near, PALETTES.mountain.mid, 0.35);
  ctx.beginPath();
  ctx.moveTo(mx - mw, my);
  ctx.lineTo(mx - mw * 0.72, my - mh);
  ctx.lineTo(mx + mw * 0.62, my - mh);
  ctx.lineTo(mx + mw, my);
  ctx.closePath();
  ctx.fillStyle = alpha(mix(col, env.mist, 0.15), 0.68);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(mx - mw * 0.72, my - mh);
  ctx.lineTo(mx - mw * 0.5, my - mh - mh * 0.18);
  ctx.lineTo(mx + mw * 0.7, my - mh - mh * 0.18);
  ctx.lineTo(mx + mw * 0.62, my - mh);
  ctx.closePath();
  ctx.fillStyle = alpha(mix(lighten(col, 0.18), env.mist, 0.1), 0.55);
  ctx.fill();
  ctx.strokeStyle = alpha(darken(col, 0.25), 0.18);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const x = mx + (i - 1) * mw * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, my - mh + 2);
    ctx.lineTo(x + rng.range(-2, 2), my);
    ctx.stroke();
  }
}

function drawWaterProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const water = PALETTES.water.water;
  ctx.save();
  ctx.strokeStyle = alpha(lighten(water, 0.55), 0.42);
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (let i = 0; i < rng.int(2, 3); i++) {
    const gx = blob.x + rng.range(-0.5, 0.5) * blob.rx;
    const gy = blob.y + rng.range(-0.5, 0.2) * blob.ry;
    ctx.beginPath();
    ctx.moveTo(gx - rng.range(6, 14), gy);
    ctx.quadraticCurveTo(gx, gy - rng.range(2, 5), gx + rng.range(5, 12), gy);
    ctx.stroke();
  }
  ctx.restore();

  for (let i = 0; i < rng.int(1, 3); i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(0.1, 0.55);
    const x = blob.x + Math.cos(a) * blob.rx * r;
    const y = blob.y + Math.sin(a) * blob.ry * r;
    ctx.fillStyle = alpha(mix(PALETTES.grass.mid, env.mist, 0.15), 0.3);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(3, 6), rng.range(1.5, 3), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < rng.int(3, 5); i++) {
    const a = rng.range(0, TAU);
    const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.75, 0.95);
    const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.68, 0.9);
    if (blocked(env, x, y, 12)) continue;
    drawReedClump(ctx, x, y, rng.int(3, 5), rng.range(8, 15) * blob.scale, env, rng);
  }
}

function drawForestProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const count = rng.int(12, 24);
  const palette = [PALETTES.forest.near, PALETTES.forest.mid, PALETTES.forest.far];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU);
    const r = Math.sqrt(rng.next()) * 0.8;
    const x = blob.x + Math.cos(a) * blob.rx * r;
    const y = blob.y + Math.sin(a) * blob.ry * r;
    const size = rng.range(14, 26) * blob.scale;
    if (blocked(env, x, y, 18) || blocked(env, x, y - size * 0.6, 8)) continue;
    const color = mix(rng.pick(palette), env.mist, 0.1 + rng.range(0, 0.08));
    if (rng.chance(0.32)) drawConifer(ctx, x, y, size, color, env, rng);
    else drawBroadleaf(ctx, x, y, size, color, env, rng);
  }
  for (let i = 0; i < rng.int(2, 4); i++) {
    const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
    const y = blob.y + rng.range(-0.35, 0.6) * blob.ry;
    if (blocked(env, x, y, 14)) continue;
    ctx.fillStyle = alpha(mix(PALETTES.forest.near, env.mist, 0.2), 0.28);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(4, 9), rng.range(2, 4), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }
}

function drawMountainProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const peaks: Array<{ x: number; y: number; w: number; h: number }> = [];
  const num = rng.int(3, 5);
  for (let i = 0; i < num; i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.3, 0.52) * blob.ry;
    if (blocked(env, x, y, 16)) continue;
    peaks.push({
      x,
      y,
      w: rng.range(20, 38) * blob.scale,
      h: rng.range(22, 48) * blob.scale,
    });
  }
  peaks.sort((a, b) => (a.y - a.h) - (b.y - b.h));
  for (const peak of peaks) drawPeak(ctx, peak, env, rng);
  for (let i = 0; i < rng.int(8, 14); i++) {
    const x = blob.x + rng.range(-0.75, 0.75) * blob.rx;
    const y = blob.y + rng.range(-0.1, 0.75) * blob.ry;
    if (blocked(env, x, y, 10)) continue;
    ctx.fillStyle = alpha(mix(PALETTES.mountain.far, env.mist, 0.15), 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(1.2, 3.2), rng.range(0.8, 2.2), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }
}

function drawDesertProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const sand = PALETTES.desert.mid;
  ctx.save();
  closedSmoothPath(ctx, blob.pts);
  ctx.clip();
  for (let i = 0; i < rng.int(2, 3); i++) {
    const y = blob.y + rng.range(-0.45, 0.42) * blob.ry;
    const x0 = blob.x - blob.rx * 1.05;
    const x1 = blob.x + blob.rx * 1.05;
    const lift = rng.range(14, 32) * blob.scale;
    const mid = blob.x + rng.range(-0.25, 0.25) * blob.rx;
    const y1 = y + rng.range(-6, 10);
    ctx.beginPath();
    ctx.moveTo(x0, y + lift * 0.4);
    ctx.quadraticCurveTo(mid, y - lift, x1, y1);
    ctx.quadraticCurveTo(mid, y - lift + rng.range(8, 16), x0, y + lift * 0.4 + rng.range(4, 8));
    ctx.closePath();
    ctx.fillStyle = alpha(lighten(sand, 0.18), 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x0, y + lift * 0.4);
    ctx.quadraticCurveTo(mid, y - lift, x1, y1);
    ctx.strokeStyle = alpha(darken(sand, 0.15), 0.22);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();

  if (rng.chance(0.62)) drawMesa(ctx, blob, env, rng);
  for (let i = 0; i < rng.int(1, 3); i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.15, 0.55) * blob.ry;
    if (blocked(env, x, y, 14)) continue;
    drawCactus(
      ctx,
      x,
      y,
      rng.range(12, 22) * blob.scale,
      mix(PALETTES.grass.near, env.mist, 0.18),
      env,
      rng,
    );
  }
  for (let i = 0; i < rng.int(2, 4); i++) {
    const x = blob.x + rng.range(-0.6, 0.6) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
    if (blocked(env, x, y, 10)) continue;
    drawBoulder(ctx, x, y, rng.range(2.5, 6) * blob.scale, mix(PALETTES.desert.near, env.mist, 0.15), env, rng);
  }
}

function drawSwampProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const pool = PALETTES.swamp.water;
  ctx.save();
  ctx.strokeStyle = alpha(lighten(pool, 0.35), 0.3);
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 2; i++) {
    const gx = blob.x + rng.range(-0.4, 0.4) * blob.rx;
    const gy = blob.y + rng.range(-0.4, 0.1) * blob.ry;
    ctx.beginPath();
    ctx.moveTo(gx - rng.range(4, 10), gy);
    ctx.quadraticCurveTo(gx, gy - 2, gx + rng.range(4, 9), gy);
    ctx.stroke();
  }
  ctx.restore();

  for (let i = 0; i < rng.int(2, 4); i++) {
    const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
    const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
    if (blocked(env, x, y, 16)) continue;
    const th = rng.range(16, 32) * blob.scale;
    const lean = rng.range(-10, 10);
    ctx.strokeStyle = alpha(mix(PALETTES.swamp.ink, env.ink, 0.3), 0.6);
    ctx.lineWidth = rng.range(1.5, 2.8);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + lean * 0.3, y - th * 0.35, x + lean * 0.7, y - th * 0.6, x + lean, y - th);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + lean * 0.45, y - th * 0.5);
    ctx.quadraticCurveTo(
      x + lean * 0.45 + rng.range(4, 10),
      y - th * 0.66,
      x + lean * 0.45 + rng.range(6, 12),
      y - th * rng.range(0.6, 0.8),
    );
    ctx.stroke();
  }

  for (let i = 0; i < rng.int(2, 3); i++) {
    const a = rng.range(0, TAU);
    const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.6, 0.9);
    const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.55, 0.85);
    if (blocked(env, x, y, 12)) continue;
    drawReedClump(ctx, x, y, rng.int(4, 6), rng.range(10, 17) * blob.scale, env, rng);
  }

  for (let i = 0; i < rng.int(1, 3); i++) {
    const a = rng.range(0, TAU);
    const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.1, 0.5);
    const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.1, 0.5);
    ctx.fillStyle = alpha(mix(PALETTES.swamp.mid, env.mist, 0.2), 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(3, 7), rng.range(1.5, 3), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }
}

function drawSnowProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const snow = PALETTES.snow.accent;
  for (let i = 0; i < rng.int(2, 4); i++) {
    closedSmoothPath(ctx, makeBlob(
      blob.x + rng.range(-0.4, 0.4) * blob.rx,
      blob.y + rng.range(-0.4, 0.4) * blob.ry,
      blob.rx * rng.range(0.2, 0.45),
      blob.ry * rng.range(0.18, 0.4),
      rng.range(0, TAU),
      rng,
      9,
    ));
    ctx.fillStyle = alpha(mix(snow, env.mist, 0.08), 0.5);
    ctx.fill();
  }
  for (let i = 0; i < rng.int(3, 6); i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.55) * blob.ry;
    const size = rng.range(9, 16) * blob.scale;
    if (blocked(env, x, y, 16) || blocked(env, x, y - size * 0.6, 8)) continue;
    drawConifer(
      ctx,
      x,
      y,
      size,
      mix(PALETTES.forest.near, PALETTES.snow.near, 0.35),
      env,
      rng,
    );
  }
  for (let i = 0; i < rng.int(2, 4); i++) {
    const x = blob.x + rng.range(-0.6, 0.6) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
    if (blocked(env, x, y, 10)) continue;
    drawBoulder(ctx, x, y, rng.range(3, 6) * blob.scale, mix(PALETTES.snow.far, env.mist, 0.1), env, rng);
  }
}

function drawGrassProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const ground = PALETTES.grass.mid;
  for (let i = 0; i < rng.int(10, 16); i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
    if (blocked(env, x, y, 12)) continue;
    drawTuft(ctx, x, y, rng.range(4, 9) * blob.scale, ground, env, rng);
  }
  for (let i = 0; i < rng.int(3, 6); i++) {
    const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
    const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
    if (blocked(env, x, y, 10)) continue;
    drawFlower(
      ctx,
      x,
      y,
      rng.range(1, 2.2),
      rng.pick([PALETTES.grass.accent, PALETTES.desert.accent, PALETTES.water.accent]),
      env,
    );
  }
  for (let i = 0; i < rng.int(1, 3); i++) {
    const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
    const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
    if (blocked(env, x, y, 12)) continue;
    drawBoulder(ctx, x, y, rng.range(3, 6.5) * blob.scale, mix(PALETTES.mountain.far, env.mist, 0.18), env, rng);
  }
  if (rng.chance(0.6)) {
    const hx = blob.x + rng.range(-0.35, 0.35) * blob.rx;
    const hy = blob.y + rng.range(-0.05, 0.4) * blob.ry;
    if (!blocked(env, hx, hy, 16)) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = alpha(mix(PALETTES.forest.near, env.mist, 0.15), 0.35);
        ctx.beginPath();
        ctx.ellipse(hx + (i - 1) * 5, hy - rng.range(0, 2), rng.range(5, 8), rng.range(2.5, 4), 0, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function drawDirtProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  const dirt = PALETTES.dirt.mid;
  for (let i = 0; i < rng.int(4, 8); i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
    if (blocked(env, x, y, 12)) continue;
    drawTuft(ctx, x, y, rng.range(3, 7) * blob.scale, mix(dirt, PALETTES.grass.near, 0.35), env, rng);
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
    if (blocked(env, x, y, 10)) continue;
    drawBoulder(ctx, x, y, rng.range(3.5, 8) * blob.scale, mix(PALETTES.mountain.far, dirt, 0.35), env, rng);
  }
  ctx.save();
  ctx.strokeStyle = alpha(darken(dirt, 0.3), 0.18);
  ctx.lineWidth = 1;
  for (let i = 0; i < rng.int(2, 4); i++) {
    const x = blob.x + rng.range(-0.4, 0.4) * blob.rx;
    const y = blob.y + rng.range(-0.2, 0.4) * blob.ry;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-8, 8), y + rng.range(2, 7));
    ctx.stroke();
  }
  ctx.restore();
}

type PropPainter = (ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng) => void;

const PROP_PAINTERS: Record<Terrain, PropPainter> = {
  water: drawWaterProps,
  forest: drawForestProps,
  denseForest: drawForestProps,
  mountain: drawMountainProps,
  desert: drawDesertProps,
  swamp: drawSwampProps,
  snow: drawSnowProps,
  dirt: drawDirtProps,
  grass: drawGrassProps,
};

function drawBlobProps(ctx: CanvasRenderingContext2D, blob: Blob, env: DioramaEnv, rng: Rng): void {
  PROP_PAINTERS[blob.biomeKey](ctx, blob, env, rng);
}

function drawBaseTexture(
  ctx: CanvasRenderingContext2D,
  outline: readonly Point[],
  env: DioramaEnv,
  rng: Rng,
): void {
  ctx.save();
  closedSmoothPath(ctx, outline);
  ctx.clip();
  const z = env.cityZone;
  const tuftColors = [PALETTES.grass.near, PALETTES.dirt.near, env.baseNear];
  for (let i = 0; i < 90; i++) {
    const x = rng.range(env.plate.cx - env.plate.rx, env.plate.cx + env.plate.rx);
    const y = rng.range(env.plate.cy - env.plate.ry, env.plate.cy + env.plate.ry);
    if (underCity(x, y, z)) continue;
    const h = rng.range(2, 7);
    ctx.strokeStyle = alpha(rng.pick(tuftColors), rng.range(0.08, 0.18));
    ctx.lineWidth = rng.range(0.8, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - h);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.range(env.plate.cx - env.plate.rx * 0.95, env.plate.cx + env.plate.rx * 0.95);
    const y = rng.range(env.plate.cy - env.plate.ry * 0.9, env.plate.cy + env.plate.ry * 0.9);
    if (underCity(x, y, z)) continue;
    ctx.fillStyle = alpha(mix(env.ink, env.base, 0.45), rng.range(0.08, 0.16));
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(2, 7), rng.range(1.2, 4), rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, TAU);
    const x = env.plate.cx + Math.cos(a) * env.plate.rx * rng.range(0.72, 0.9);
    const y = env.plate.cy + Math.sin(a) * env.plate.ry * rng.range(0.72, 0.9);
    if (underCity(x, y, z)) continue;
    const size = rng.range(13, 22);
    const color = mix(PALETTES.forest.near, env.mist, 0.18);
    if (rng.chance(0.5)) drawConifer(ctx, x, y, size, color, env, rng);
    else drawBroadleaf(ctx, x, y, size, color, env, rng);
  }
  ctx.restore();
}

function drawRim(ctx: CanvasRenderingContext2D, outline: readonly Point[], env: DioramaEnv): void {
  const inset = outline.map((p) => ({
    x: env.plate.cx + (p.x - env.plate.cx) * 0.972,
    y: env.plate.cy + (p.y - env.plate.cy) * 0.972,
  }));
  closedSmoothPath(ctx, inset);
  ctx.strokeStyle = alpha(lighten(env.sky, 0.45), 0.4);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = alpha(lighten(env.base, 0.5), 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawEdgeWisps(ctx: CanvasRenderingContext2D, env: DioramaEnv, rng: Rng): void {
  const p = env.plate;
  for (let i = 0; i < rng.int(4, 6); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = p.cx + side * p.rx * rng.range(0.85, 1.15);
    const y = p.cy + Math.sin(rng.range(0, TAU)) * p.ry * rng.range(0.4, 0.9);
    softEllipse(ctx, x, y, rng.range(60, 130), rng.range(18, 42), env.mist, rng.range(0.1, 0.18), 0.2);
  }
}

function drawFloatingRock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  env: DioramaEnv,
  rng: Rng,
): void {
  softEllipse(ctx, x, y + s * 0.55, s * 1.2, s * 0.4, env.ink, 0.12);
  closedSmoothPath(ctx, makeBlob(x, y + s * 0.45, s * 0.72, s * 0.68, rng.range(0, TAU), rng, 7));
  ctx.fillStyle = alpha(darken(env.base, 0.55), 0.85);
  ctx.fill();
  closedSmoothPath(ctx, makeBlob(x, y, s, s * 0.4, rng.range(0, TAU), rng, 8));
  ctx.fillStyle = alpha(mix(env.base, env.mist, 0.12), 0.85);
  ctx.fill();
  ctx.strokeStyle = alpha(lighten(env.sky, 0.4), 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = alpha(mix(PALETTES.grass.mid, env.mist, 0.15), 0.4);
  ctx.beginPath();
  ctx.ellipse(x - s * 0.1, y - s * 0.12, s * 0.6, s * 0.2, rng.range(0, TAU), 0, TAU);
  ctx.fill();
}

function drawFloatingRocks(ctx: CanvasRenderingContext2D, w: number, env: DioramaEnv, rng: Rng): void {
  const p = env.plate;
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = clamp(p.cx + side * p.rx * rng.range(0.9, 1.12), 24, w - 24);
    const y = p.cy + rng.range(-0.05, 0.45) * p.ry;
    drawFloatingRock(ctx, x, y, rng.range(11, 22), env, rng);
  }
  for (let i = 0; i < rng.int(2, 3); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = clamp(p.cx + side * p.rx * rng.range(0.9, 1.15), 20, w - 20);
    const y = p.cy + rng.range(-0.2, 0.3) * p.ry;
    softEllipse(ctx, x, y, rng.range(80, 160), rng.range(20, 44), lighten(env.mist, 0.12), 0.16, 0.2);
  }
}

function drawBottomHaze(ctx: CanvasRenderingContext2D, w: number, h: number, env: DioramaEnv, rng: Rng): void {
  const g = ctx.createLinearGradient(0, h * 0.78, 0, h);
  g.addColorStop(0, alpha(env.mist, 0));
  g.addColorStop(1, alpha(env.mist, 0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  for (let i = 0; i < rng.int(2, 3); i++) {
    const x = rng.range(0, w);
    const y = rng.range(h * 0.8, h * 0.96);
    softEllipse(ctx, x, y, rng.range(120, 260), rng.range(20, 50), lighten(env.mist, 0.08), 0.14, 0.2);
  }
}

function renderDiorama(
  w: number,
  h: number,
  signature: CityBackdropSignature,
  size?: CityViewSize,
  footprint?: CityGridFootprint,
  dpr = 1,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);

  const rng = makeRng(signature.seed);
  const env = buildEnv(signature, w, h, size, footprint);
  const p = env.plate;

  drawBackground(ctx, w, h, env, rng);

  const outline = makeOutline(p.cx, p.cy, p.rx, p.ry, rng, signature.seed);
  const neighborBase = rng.range(0, TAU);
  const wedges = buildWedges(signature, neighborBase, rng);
  const paths = buildPaths(env, signature, neighborBase, rng);
  env.paths = paths.map((path) => path.pts);
  const blobs = buildBlobs(env, wedges, rng);

  softEllipse(ctx, p.cx, p.cy + p.ry * 0.58, p.rx * 0.9, p.ry * 0.6, darken(env.ink, 0.1), 0.18, 0.2);
  softEllipse(ctx, p.cx, p.cy + p.ry * 0.24, p.rx * 0.78, p.ry * 0.46, env.ink, 0.1, 0.2);

  const plate = document.createElement("canvas");
  plate.width = canvas.width;
  plate.height = canvas.height;
  const pctx = plate.getContext("2d");
  if (!pctx) return canvas;
  pctx.scale(dpr, dpr);

  drawPlateUnderside(pctx, outline, env, rng);
  drawPlateTop(pctx, outline, env, rng);

  pctx.save();
  closedSmoothPath(pctx, outline);
  pctx.clip();
  drawSectors(pctx, env, wedges, rng);
  drawCalmCenter(pctx, env, rng);
  for (const blob of blobs) drawBlobGround(pctx, blob, env, rng);
  drawBaseTexture(pctx, outline, env, rng);
  for (const path of paths) drawPath(pctx, path, env, rng);
  for (const blob of blobs) drawBlobProps(pctx, blob, env, rng);
  drawRim(pctx, outline, env);
  pctx.restore();

  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const mctx = mask.getContext("2d");
  if (!mctx) return canvas;
  mctx.scale(dpr, dpr);
  mctx.save();
  mctx.translate(p.cx, p.cy + 4);
  mctx.scale(p.rx * 1.06, p.ry * 1.06);
  const solid = tierProfile(size).maskSolid;
  const mg = mctx.createRadialGradient(0, 0, 0.55, 0, 0, 1);
  mg.addColorStop(0, "rgba(255, 255, 255, 1)");
  mg.addColorStop(solid, "rgba(255, 255, 255, 1)");
  mg.addColorStop(solid + (1 - solid) * 0.5, "rgba(255, 255, 255, 0.72)");
  mg.addColorStop(0.99, "rgba(255, 255, 255, 0.12)");
  mg.addColorStop(1, "rgba(255, 255, 255, 0)");
  mctx.fillStyle = mg;
  mctx.beginPath();
  mctx.arc(0, 0, 1, 0, TAU);
  mctx.fill();
  mctx.restore();

  pctx.save();
  pctx.globalCompositeOperation = "destination-in";
  pctx.drawImage(mask, 0, 0, w, h);
  pctx.restore();

  ctx.drawImage(plate, 0, 0, w, h);
  ringEllipse(ctx, p.cx, p.cy + 6, p.rx * 1.08, p.ry * 1.06, env.mist, 0.3);
  drawEdgeWisps(ctx, env, rng);
  drawFloatingRocks(ctx, w, env, rng);
  drawBottomHaze(ctx, w, h, env, rng);

  return canvas;
}

interface CachedPlate {
  canvas: HTMLCanvasElement;
  pixels: number;
}

const cache = new Map<string, CachedPlate>();
const CACHE_PIXEL_BUDGET = 24_000_000;

function deviceScale(ctx: CanvasRenderingContext2D): number {
  const scale = ctx.getTransform().a;
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return clamp(Math.round(scale * 2) / 2, 1, 2);
}

export function paintCityDiorama(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  signature: CityBackdropSignature,
  size?: CityViewSize,
  footprint?: CityGridFootprint,
): void {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const dpr = deviceScale(ctx);
  const foot = footprint
    ? `${Math.round(footprint.centerX)},${Math.round(footprint.centerY)},${Math.round(footprint.halfWidth)},${Math.round(footprint.halfHeight)}`
    : "-";
  const key = `${signature.center}|${signature.neighbors.join(",")}|${signature.seed}|${width}x${height}|s${size ?? 5}|d${dpr}|g${foot}`;

  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  } else {
    const canvas = renderDiorama(width, height, signature, size, footprint, dpr);
    const entry: CachedPlate = { canvas, pixels: canvas.width * canvas.height };
    let total = entry.pixels;
    for (const existing of cache.values()) total += existing.pixels;
    while (cache.size > 0 && total > CACHE_PIXEL_BUDGET) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = cache.get(oldestKey);
      if (evicted) total -= evicted.pixels;
      cache.delete(oldestKey);
    }
    cache.set(key, entry);
  }

  const entry = cache.get(key);
  if (!entry) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(entry.canvas, 0, 0, width, height);
  ctx.restore();
}
