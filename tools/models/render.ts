import type { Vec3 } from "./math";
import { dot, normalize } from "./math";
import type { Face } from "./pose";

const SIN_ELEVATION = 0.5;
const COS_ELEVATION = Math.sqrt(3) / 2;
const INV_SQRT2 = Math.SQRT1_2;

const VIEW_FORWARD: Vec3 = [
  -COS_ELEVATION * INV_SQRT2,
  -COS_ELEVATION * INV_SQRT2,
  -SIN_ELEVATION,
];

const LIGHT: Vec3 = normalize([-0.275, 0.357, 0.893]);
const AMBIENT = 0.42;
const DIFFUSE = 0.58;

export interface Projected {
  x: number;
  y: number;
  depth: number;
}

export function project(p: Vec3): Projected {
  return {
    x: (p[0] - p[1]) * INV_SQRT2,
    y: (p[0] + p[1]) * INV_SQRT2 * SIN_ELEVATION - p[2] * COS_ELEVATION,
    depth: dot(p, VIEW_FORWARD),
  };
}

export interface Fit {
  scale: number;
  originX: number;
  originY: number;
}

export function computeFit(batches: Face[][], size: number, padding: number): Fit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const faces of batches) {
    for (const face of faces) {
      for (const corner of face.corners) {
        const p = project(corner);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }

  if (!Number.isFinite(minX)) return { scale: 1, originX: size / 2, originY: size / 2 };

  const usable = size - padding * 2;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(usable / spanX, usable / spanY);

  // Horizontally centred, but vertically BOTTOM-aligned: the lowest drawn
  // pixel across every direction and frame lands at exactly `size - padding`.
  // Centring instead would leave a per-direction amount of empty space under
  // the feet (13-17px at 128px for the archer), which reads as the unit
  // hovering above its hex once the painter bottom-anchors the sprite.
  return {
    scale,
    originX: size / 2 - ((minX + maxX) / 2) * scale,
    originY: size - padding - maxY * scale,
  };
}

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export interface Target {
  pixels: Uint8ClampedArray;
  depth: Float32Array;
  width: number;
  height: number;
}

export function createTarget(width: number, height: number): Target {
  const depth = new Float32Array(width * height);
  depth.fill(Infinity);
  return {
    pixels: new Uint8ClampedArray(width * height * 4),
    depth,
    width,
    height,
  };
}

function rasterTriangle(
  target: Target,
  p0: Projected,
  p1: Projected,
  p2: Projected,
  r: number,
  g: number,
  b: number,
  clipX0: number,
  clipX1: number,
): void {
  const area = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(area) < 1e-9) return;

  const minX = Math.max(0, clipX0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(target.width - 1, clipX1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;

      const w0 = ((p1.y - p2.y) * (cx - p2.x) + (p2.x - p1.x) * (cy - p2.y)) / area;
      const w1 = ((p2.y - p0.y) * (cx - p2.x) + (p0.x - p2.x) * (cy - p2.y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const depth = w0 * p0.depth + w1 * p1.depth + w2 * p2.depth;
      const idx = py * target.width + px;
      if (depth >= target.depth[idx]) continue;

      target.depth[idx] = depth;
      const o = idx * 4;
      target.pixels[o] = r;
      target.pixels[o + 1] = g;
      target.pixels[o + 2] = b;
      target.pixels[o + 3] = 255;
    }
  }
}

export function renderFaces(
  target: Target,
  faces: Face[],
  fit: Fit,
  offsetX: number,
  cellWidth: number,
): void {
  const clipX0 = offsetX;
  const clipX1 = offsetX + cellWidth - 1;

  for (const face of faces) {
    const shade = AMBIENT + DIFFUSE * Math.max(0, dot(face.normal, LIGHT));
    const [cr, cg, cb] = parseColor(face.color);
    const r = Math.min(255, cr * shade);
    const g = Math.min(255, cg * shade);
    const b = Math.min(255, cb * shade);

    const pts = face.corners.map((corner) => {
      const p = project(corner);
      return {
        x: p.x * fit.scale + fit.originX + offsetX,
        y: p.y * fit.scale + fit.originY,
        depth: p.depth,
      };
    });

    rasterTriangle(target, pts[0], pts[1], pts[2], r, g, b, clipX0, clipX1);
    rasterTriangle(target, pts[0], pts[2], pts[3], r, g, b, clipX0, clipX1);
  }
}
