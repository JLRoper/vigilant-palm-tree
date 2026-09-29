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
  if (!overlapsAt(base.x, base.y)) return base;
  const stepX = desired.w + STEP_GAP;
  for (let x = base.x + stepX; x <= maxX; x += stepX) {
    if (!overlapsAt(x, base.y)) return { x, y: base.y };
  }
  const stepY = desired.h + STEP_GAP;
  for (let y = base.y - stepY; y >= minTop; y -= stepY) {
    if (!overlapsAt(base.x, y)) return { x: base.x, y };
  }
  return base;
}
