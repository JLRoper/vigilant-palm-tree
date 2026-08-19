import { clampMenuIntoView, type PopupMenu } from "./menu";
import { getCachedAuth } from "../../io/auth";

export type PanelKey = "heroes" | "settlements";

type PanelMode = "docked" | "floating";

interface PanelLayout {
  mode: PanelMode;
  x?: number;
  y?: number;
}

type StoredLayout = Partial<Record<PanelKey, PanelLayout>>;

const RAIL_ID = "panel-rail";
const TOOLBAR_ID = "toolbar";
const APP_ID = "app";
const STORAGE_KEY = "heroesjs.panelLayout.v1";
const TOOLBAR_H_VAR = "--toolbar-h";
const DEFAULT_TOOLBAR_H = 125;
const MINIMAP_RESERVE_VAR = "--minimap-reserve";
const RAIL_MAX_WIDTH = 320;
const RAIL_GAP = 8;

const PANEL_KEYS: readonly PanelKey[] = ["heroes", "settlements"];
const PANEL_ORDER: Record<PanelKey, number> = { heroes: 1, settlements: 2 };
const POP_OUT_OFFSET: Record<PanelKey, number> = { heroes: 0, settlements: 24 };

let toolbarH = DEFAULT_TOOLBAR_H;
let toolbarObserved = false;
// Held at module scope: an unreferenced ResizeObserver is eligible for GC in
// some engines, which silently stops it from firing after the first callback.
let toolbarResizeObserver: ResizeObserver | null = null;
let store: StoredLayout | null = null;
let resizeBound = false;
const attached = new Map<PanelKey, PopupMenu>();
let lastMinimapReserve = -1;
let persistFlushTimer: ReturnType<typeof setTimeout> | null = null;
let persistFlushBound = false;
const PERSIST_DEBOUNCE_MS = 200;

// Synchronous measurement, safe to call as often as needed (a read plus a
// conditional single style write -- no forced layout thrash beyond what the
// caller was already about to do). The ResizeObserver below is a live-update
// convenience for a panel that's already open; it is not load-bearing for
// correctness, since ResizeObserver/rAF callbacks can be delayed or skipped
// entirely for a document that isn't currently visible/composited.
function measureToolbar(): void {
  const el = document.getElementById(TOOLBAR_ID);
  if (!el) return;
  const h = Math.round(el.getBoundingClientRect().height);
  if (h <= 0) return;
  toolbarH = h;
  document.documentElement.style.setProperty(TOOLBAR_H_VAR, `${h}px`);
}

function observeToolbar(): void {
  measureToolbar();
  if (toolbarObserved) return;
  const el = document.getElementById(TOOLBAR_ID);
  if (!el) return;
  toolbarObserved = true;
  if (typeof ResizeObserver !== "undefined") {
    toolbarResizeObserver = new ResizeObserver(measureToolbar);
    toolbarResizeObserver.observe(el);
  } else {
    window.addEventListener("resize", measureToolbar);
  }
}

export function toolbarHeight(): number {
  observeToolbar();
  return toolbarH;
}

// Called by UIManager (which knows the current map's dimensions) whenever
// they're available, so the rail's bottom edge tracks the minimap's actual
// on-screen footprint instead of a guessed constant. UIManager calls this
// unconditionally from the engine's per-frame rAF loop (the value has no
// dedicated change hook), so this guards the DOM write itself: the map's
// dimensions are effectively constant between new-game/load-game, and a
// style write on <html> invalidates computed style for every descendant
// that resolves through --minimap-reserve, which is wasted work 60x/sec.
export function setMinimapReserve(px: number): void {
  const next = Math.max(0, Math.round(px));
  if (next === lastMinimapReserve) return;
  lastMinimapReserve = next;
  document.documentElement.style.setProperty(MINIMAP_RESERVE_VAR, `${next}px`);
}

export function getPanelRail(): HTMLDivElement {
  const existing = document.getElementById(RAIL_ID);
  if (existing instanceof HTMLDivElement) return existing;
  observeToolbar();
  const rail = document.createElement("div");
  rail.id = RAIL_ID;
  Object.assign(rail.style, {
    position: "fixed",
    top: `var(${TOOLBAR_H_VAR}, ${DEFAULT_TOOLBAR_H}px)`,
    right: "0",
    bottom: `var(${MINIMAP_RESERVE_VAR}, 0px)`,
    width: `min(${RAIL_MAX_WIDTH}px, 40vw)`,
    boxSizing: "border-box",
    padding: `${RAIL_GAP}px`,
    display: "flex",
    flexDirection: "column",
    gap: `${RAIL_GAP}px`,
    zIndex: "5",
    pointerEvents: "none",
  });
  (document.getElementById(APP_ID) ?? document.body).appendChild(rail);
  return rail;
}

function railWidth(): number {
  return Math.min(RAIL_MAX_WIDTH, window.innerWidth * 0.4);
}

// There's no server-side settings store for anonymous play, so an anonymous
// session's dock/pop-out choices only live in memory for that page load --
// every fresh, non-logged-in session starts back at the default (docked).
// Once logged in there's a stable identity to key persistence off of, so we
// fall back to localStorage as the nearest thing to durable per-user storage
// until a real settings table exists server-side.
function persistenceAllowed(): boolean {
  return getCachedAuth() !== null;
}

function loadStore(): StoredLayout {
  if (!persistenceAllowed() || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLayout;
    const out: StoredLayout = {};
    for (const key of PANEL_KEYS) {
      const entry = parsed[key];
      if (!entry) continue;
      out[key] = {
        mode: entry.mode === "floating" ? "floating" : "docked",
        x: Number.isFinite(entry.x) ? entry.x : undefined,
        y: Number.isFinite(entry.y) ? entry.y : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function layoutFor(key: PanelKey): PanelLayout {
  store ??= loadStore();
  return store[key] ?? { mode: "docked" };
}

function flushPersist(): void {
  if (persistFlushTimer !== null) {
    clearTimeout(persistFlushTimer);
    persistFlushTimer = null;
  }
  if (!store) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

// A window-level 'mouseup' (capture phase, so it fires before the drag's own
// mouseup handler removes its listeners) guarantees a pending debounced write
// lands the moment a drag ends, rather than waiting out the trailing delay.
function bindPersistFlush(): void {
  if (persistFlushBound) return;
  persistFlushBound = true;
  window.addEventListener("mouseup", flushPersist, { capture: true });
}

// The in-memory store updates synchronously (so layout reads are always
// current), but the localStorage write is debounced: savePanelPosition's
// onMove wiring calls this on every mousemove while dragging a floating
// panel, and a synchronous localStorage.setItem on every mousemove is
// needless main-thread work during a drag. bindPersistFlush's mouseup
// listener ensures the final position is still flushed immediately once
// the drag ends.
function saveLayout(key: PanelKey, patch: Partial<PanelLayout>): void {
  store ??= loadStore();
  store[key] = { ...layoutFor(key), ...patch };
  if (!persistenceAllowed()) return;
  bindPersistFlush();
  if (persistFlushTimer !== null) clearTimeout(persistFlushTimer);
  persistFlushTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
}

export function savePanelPosition(key: PanelKey, pos: { x: number; y: number }): void {
  if (layoutFor(key).mode !== "floating") return;
  saveLayout(key, pos);
}

function defaultFloatPosition(key: PanelKey): { x: number; y: number } {
  const offset = POP_OUT_OFFSET[key];
  return {
    x: Math.max(0, window.innerWidth - railWidth() - RAIL_MAX_WIDTH - 16) + offset,
    y: toolbarHeight() + 16 + offset,
  };
}

function floatPosition(key: PanelKey): { x: number; y: number } {
  const layout = layoutFor(key);
  if (layout.x === undefined || layout.y === undefined) return defaultFloatPosition(key);
  return { x: layout.x, y: layout.y };
}

function bindResize(): void {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    for (const [key, menu] of attached) {
      if (layoutFor(key).mode !== "floating") continue;
      clampMenuIntoView(menu, toolbarHeight());
      saveLayout(key, menu.getPosition());
    }
  });
}

export function mountPanel(menu: PopupMenu, key: PanelKey): void {
  measureToolbar();
  if (layoutFor(key).mode === "floating") {
    menu.setLayout("floating");
    const pos = floatPosition(key);
    menu.setPosition(pos.x, pos.y);
    if (menu.root.parentNode !== document.body) document.body.appendChild(menu.root);
    clampMenuIntoView(menu, toolbarHeight());
    saveLayout(key, menu.getPosition());
    return;
  }
  const rail = getPanelRail();
  menu.setLayout("docked");
  menu.root.style.order = String(PANEL_ORDER[key]);
  if (menu.root.parentNode !== rail) rail.appendChild(menu.root);
}

export function attachDockControl(menu: PopupMenu, key: PanelKey): void {
  attached.set(key, menu);
  bindResize();

  let btn: HTMLButtonElement | null = null;
  const sync = (): void => {
    if (!btn) return;
    const docked = layoutFor(key).mode === "docked";
    btn.textContent = docked ? "⧉" : "⇲";
    btn.title = docked ? "Pop out into a floating panel" : "Dock back into the panel rail";
  };

  btn = menu.addHeaderAction("⧉", "Pop out into a floating panel", () => {
    const next: PanelMode = layoutFor(key).mode === "docked" ? "floating" : "docked";
    saveLayout(key, { mode: next });
    mountPanel(menu, key);
    sync();
  });

  sync();
  mountPanel(menu, key);
}
