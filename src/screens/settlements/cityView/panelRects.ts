import { resolvePanelPlacement, type PanelRect } from "@screens/shared/panelPlacement";

export type FloatingPanelRectProvider = () => Array<PanelRect | null>;

export const DESIGN_BOX_INSET = 12;

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
