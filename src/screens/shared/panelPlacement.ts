export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VIEWPORT_MARGIN = 24;
const STEP_GAP = 12;

export function rectsOverlap(a: PanelRect, b: PanelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function resolvePanelPlacement(
  desired: PanelRect,
  occupied: PanelRect[],
  viewport: { width: number; height: number },
  minTop: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewport.width - VIEWPORT_MARGIN - desired.w);
  const maxY = Math.max(minTop, viewport.height - VIEWPORT_MARGIN - desired.h);
  const base = {
    x: Math.min(Math.max(desired.x, 0), maxX),
    y: Math.min(Math.max(desired.y, minTop), maxY),
  };
  const overlapsAt = (x: number, y: number): boolean => {
    const candidate: PanelRect = { x, y, w: desired.w, h: desired.h };
    return occupied.some((o) => rectsOverlap(candidate, o));
  };
  const overlapAreaAt = (x: number, y: number): number => {
    let area = 0;
    for (const o of occupied) {
      const w = Math.min(x + desired.w, o.x + o.w) - Math.max(x, o.x);
      const h = Math.min(y + desired.h, o.y + o.h) - Math.max(y, o.y);
      if (w > 0 && h > 0) area += w * h;
    }
    return area;
  };
  const candidates: Array<{ x: number; y: number }> = [];
  if (!overlapsAt(base.x, base.y)) return base;
  candidates.push(base);
  const stepX = desired.w + STEP_GAP;
  for (let x = base.x + stepX; x <= maxX; x += stepX) {
    if (!overlapsAt(x, base.y)) return { x, y: base.y };
    candidates.push({ x, y: base.y });
  }
  const stepY = desired.h + STEP_GAP;
  for (let y = base.y - stepY; y >= minTop; y -= stepY) {
    if (!overlapsAt(base.x, y)) return { x: base.x, y };
    candidates.push({ x: base.x, y });
  }
  const rightAligned = { x: maxX, y: base.y };
  if (!overlapsAt(rightAligned.x, rightAligned.y)) return rightAligned;
  candidates.push(rightAligned);
  let best = candidates[0];
  let bestArea = Infinity;
  for (const candidate of candidates) {
    const area = overlapAreaAt(candidate.x, candidate.y);
    if (area < bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}
