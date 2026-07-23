import { Axial, axialToPixel } from "../../core/hex";
import { Hero } from "../../entities/hero";
import { GameMap } from "../../map/gameMap";
import { TERRAIN_COST } from "../../map/terrain";
import type { RenderOptions } from "../renderer";

const REACHABLE_COLOR = "rgba(255, 204, 0, 0.85)";
const UNREACHABLE_COLOR = "rgba(255, 204, 0, 0.30)";
const MINIMAP_PATH_COLOR = "rgba(255,204,0,0.5)";

export function computeReachableSplit(
  path: readonly Axial[],
  map: GameMap,
  movementRemaining: number,
): number {
  let cumulative = 0;
  for (let i = 0; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    const stepCost = t ? TERRAIN_COST[t] : Infinity;
    if (!Number.isFinite(stepCost) || stepCost <= 0) return i;
    if (cumulative + stepCost > movementRemaining) return i;
    cumulative += stepCost;
  }
  return path.length;
}

export function drawPathSegment(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  fromIdx: number,
  toIdx: number,
  strokeColor: string,
  lineWidth: number,
  dotRadius: number,
): void {
  if (toIdx <= fromIdx) return;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeColor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = fromIdx; i < toIdx; i++) {
    const p = points[i];
    if (i === fromIdx) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  for (let i = fromIdx + 1; i < toIdx; i++) {
    const p = points[i];
    ctx.fillStyle = strokeColor.replace(/[\d.]+\)$/, "0.5)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawTrail(
  ctx: CanvasRenderingContext2D,
  hero: Hero,
  opts: RenderOptions,
): void {
  if (!hero.trail || hero.trail.length < 2) return;
  const color = opts.colorForOwner(hero.ownerId);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let i = 1; i < hero.trail.length; i++) {
    const p = axialToPixel(hero.trail[i].q, hero.trail[i].r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < hero.trail.length; i++) {
    const p = axialToPixel(hero.trail[i].q, hero.trail[i].r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPathOverlay(
  ctx: CanvasRenderingContext2D,
  heroes: Hero[],
  path: Axial[],
  map: GameMap,
  opts: RenderOptions,
): void {
  if (path.length === 0 || heroes.length === 0) return;
  const pathPx = path.map((t) => axialToPixel(t.q, t.r));
  const originPx = opts.pathOrigin
    ? axialToPixel(opts.pathOrigin.q, opts.pathOrigin.r)
    : opts.selectedHeroTile
    ? axialToPixel(opts.selectedHeroTile.q, opts.selectedHeroTile.r)
    : axialToPixel(heroes[0].tile.q, heroes[0].tile.r);
  const fullPx = [originPx, ...pathPx];
  const selectedHero = opts.selectedHeroId ? heroes.find((h) => h.id === opts.selectedHeroId) : heroes[0];
  const movementRemaining = selectedHero?.movementRemaining ?? 0;
  const splitIdx = Math.min(
    opts.pathReachableIdx ?? computeReachableSplit(path, map, movementRemaining),
    path.length
  );
  drawPathSegment(ctx, fullPx, 0, splitIdx + 1, REACHABLE_COLOR, 4, 6);
  if (splitIdx < path.length) {
    drawPathSegment(ctx, fullPx, splitIdx, pathPx.length, UNREACHABLE_COLOR, 3, 4);
  }
  if (selectedHero) {
    drawTrail(ctx, selectedHero, opts);
  }
}

export function drawMinimapPath(
  ctx: CanvasRenderingContext2D,
  path: Axial[],
  x0: number,
  y0: number,
  cellW: number,
  cellH: number,
): void {
  if (path.length === 0) return;
  ctx.fillStyle = MINIMAP_PATH_COLOR;
  for (const t of path) {
    ctx.fillRect(x0 + t.q * cellW, y0 + t.r * cellH, cellW, cellH);
  }
}
