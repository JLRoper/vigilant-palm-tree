import { resolvePanelPlacement, type PanelRect } from "@screens/shared/panelPlacement";
import { cellToScreen, cityLayout } from "../../../core/cityGrid";
import type { CityViewSize } from "@heroes/engine";

export type FloatingPanelRectProvider = () => Array<PanelRect | null>;

export const DESIGN_BOX_INSET = 12;

export const CITY_GRID_PAD = 8;

export function cityGridRect(
  size: CityViewSize,
  viewportW: number,
  viewportH: number,
  pad = CITY_GRID_PAD,
  topInset = 0,
): PanelRect {
  const layout = cityLayout(size, viewportW, viewportH, topInset);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      const cell = cellToScreen(gx, gy, layout.gridOrigin);
      const cx = layout.screenOrigin.x + cell.x * layout.tileScale;
      const cy = layout.screenOrigin.y + cell.y * layout.tileScale;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }
  }
  return {
    x: minX - layout.tw / 2 - pad,
    y: minY - layout.td / 2 - pad,
    w: maxX - minX + layout.tw + pad * 2,
    h: maxY - minY + layout.td + pad * 2,
  };
}

export function collectPanelRects(provider: FloatingPanelRectProvider | undefined): PanelRect[] {
  if (!provider) return [];
  const out: PanelRect[] = [];
  for (const rect of provider()) {
    if (rect) out.push(rect);
  }
  return out;
}

export function elementRect(el: HTMLElement | null): PanelRect | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }
  return null;
}

export function resolveDesignBoxPlacement(
  width: number,
  height: number,
  panelRects: PanelRect[],
  viewport: { width: number; height: number },
  minTop: number,
): { x: number; y: number } {
  return resolvePanelPlacement(
    { x: DESIGN_BOX_INSET, y: viewport.height - DESIGN_BOX_INSET - height, w: width, h: height },
    panelRects,
    viewport,
    minTop,
  );
}
