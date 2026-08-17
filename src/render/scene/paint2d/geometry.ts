// Shared geometry helpers for the Canvas2D painters. Pure functions over a
// CanvasRenderingContext2D (no module state, no asset dependencies). The
// adventurer and battle painters both walk hex corners; the city painters
// walk a diamond. These helpers centralize the math so we don't re-derive
// `Math.PI / 180 * (60 * i - 30)` in every painter file.

import { HEX_SIZE } from "../../../core/hex";

/**
 * Adds the six hex corners (centered on `cx, cy`) to a fresh ctx path: a
 * moveTo to the first corner, then lineTo through the rest, then closePath.
 * The caller can then fill/stroke the resulting shape.
 *
 * The corner angles and the size argument match the upstream
 * `src/core/hex.ts`'s `hexCorners()` exactly; this is the imperative variant
 * for painters that don't want to allocate a side array.
 */
export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number = HEX_SIZE): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Adds a diamond (top/bottom/left/right corners) to a fresh ctx path.
 * Matches the city cell shape in cityRenderer.ts:375-394.
 */
export function diamondPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfHeight);
  ctx.lineTo(cx + halfWidth, cy);
  ctx.lineTo(cx, cy + halfHeight);
  ctx.lineTo(cx - halfWidth, cy);
  ctx.closePath();
}
