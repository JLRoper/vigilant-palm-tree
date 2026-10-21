import { loadPanelSize, savePanelSize, type PanelGeometryKey } from "./panelLayout";

// A reusable resize grip for floating panels. `FloatingPanel` wires it from a single
// option (`resizeable: true`, plus `resizeKey` to remember the size), and any
// other surface can call `attachPanelResize(el, ...)` directly -- so making a
// panel/menu resizeable is one flag, not a bespoke implementation per screen.

const MIN_WIDTH = 220;
const MIN_HEIGHT = 140;
const VIEWPORT_MARGIN = 8;
const GRIP_PX = 14;
const CLICK_SLOP = 3;

export interface PanelResizeOptions {
  /** Remembers the last size under this key (same store as panel geometry). */
  key?: PanelGeometryKey;
  /**
   * Apply the remembered size to the target the moment the grip is attached
   * (default true). False for a surface that starts docked -- the rail owns its
   * size there, and the panel re-applies the stored size when it floats.
   */
  applyStored?: boolean;
  minWidth?: number;
  minHeight?: number;
}

/** What the grip was attached to: a FloatingPanel (its root gets the size) or a bare element. */
export interface ResizeTarget {
  element: HTMLElement;
  /** Applies width/height (a FloatingPanel mirrors them onto its own state). */
  apply: (width: number, height: number) => void;
  measure?: () => { w: number; h: number };
  onClick?: () => void;
}

export function attachPanelResizeTo(target: ResizeTarget, opts: PanelResizeOptions = {}): HTMLDivElement {
  const key = opts.key;
  const minW = opts.minWidth ?? MIN_WIDTH;
  const minH = opts.minHeight ?? MIN_HEIGHT;

  if (key && opts.applyStored !== false) {
    const stored = loadPanelSize(key);
    if (stored) target.apply(stored.w, stored.h);
  }

  const host = target.element;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";

  const grip = document.createElement("div");
  grip.dataset.panelResize = "true";
  grip.title = "Drag to resize (remembered per panel)";
  Object.assign(grip.style, {
    position: "absolute",
    right: "0",
    bottom: "0",
    width: `${GRIP_PX}px`,
    height: `${GRIP_PX}px`,
    cursor: "nwse-resize",
    zIndex: "3",
    background: "linear-gradient(135deg, transparent 52%, rgba(255,255,255,0.30) 52%)",
    borderBottomRightRadius: "6px",
  });
  host.appendChild(grip);

  let drag: { startX: number; startY: number; startW: number; startH: number; moved: boolean } | null = null;

  const clamp = (w: number, h: number): { w: number; h: number } => ({
    w: Math.max(minW, Math.min(w, window.innerWidth - VIEWPORT_MARGIN * 2)),
    h: Math.max(minH, Math.min(h, window.innerHeight - VIEWPORT_MARGIN * 2)),
  });

  const onMove = (e: MouseEvent): void => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < CLICK_SLOP) return;
    drag.moved = true;
    const next = clamp(drag.startW + (e.clientX - drag.startX), drag.startH + (e.clientY - drag.startY));
    target.apply(next.w, next.h);
  };

  const onUp = (): void => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    if (!moved) {
      target.onClick?.();
      return;
    }
    const rect = host.getBoundingClientRect();
    const size = target.measure?.() ?? { w: rect.width, h: rect.height };
    if (key) savePanelSize(key, { w: Math.round(size.w), h: Math.round(size.h) });
  };

  grip.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = host.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, moved: false };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  });

  return grip;
}

/** Convenience wrapper for the common case: a FloatingPanel's own root. */
export function attachPanelResize(
  opts: PanelResizeOptions,
  menu: {
    root: HTMLElement;
    setSize: (w: number, h: number) => void;
    savedSize?: () => { w: number; h: number };
    toggleHeightLock?: () => void;
  },
): HTMLDivElement {
  return attachPanelResizeTo(
    {
      element: menu.root,
      apply: (w, h) => menu.setSize(w, h),
      measure: menu.savedSize?.bind(menu),
      onClick: menu.toggleHeightLock?.bind(menu),
    },
    opts,
  );
}
