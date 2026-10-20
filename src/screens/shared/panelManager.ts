// The one owner of open panels: stacking (click-to-front) and Escape.
//
// Every FloatingPanel registers here when it is constructed and unregisters
// when it closes, so a surface becomes Escape-closable by existing -- there is
// no per-screen keydown listener and no per-view Escape ladder listing panel
// names. The registry order is the stacking order (last = topmost), which is
// also what Escape acts on.
//
// Vocabulary: a **panel** is one floating surface with a title bar
// (`FloatingPanel`); a **dialog** is a panel shown centred over a backdrop
// (`openDialog`). Both are panels to this module.

export interface ManagedPanel {
  /**
   * What Escape (and the × button) does: close a panel that is built on
   * demand, hide one that is long-lived and re-shown by its owner.
   */
  dismiss(): void;
  close(): void;
  setPanelZ(z: number): void;
  /** Hidden panels are not Escape targets and never swallow the key. */
  isPanelVisible?(): boolean;
  /**
   * Nested-state hook, consulted before the panel closes: return true to
   * consume the keystroke and stay open (e.g. an active build placement that
   * the first Escape should cancel instead of closing its palette).
   */
  handleEscape?(): boolean;
  /**
   * False for a panel that must outlive Escape -- the city view owns the City
   * Design box, for instance, and closing it would strand the player without
   * Build/Back. Such a panel is skipped, letting the key fall through to the
   * view's own handler.
   */
  escapeClosable?: boolean;
}

export const PANEL_Z_RAISE_BASE = 76;
const PANEL_Z_RAISE_CAP = 88;

/** Open panels, bottom -> top. The last entry is the topmost surface. */
const openPanels: ManagedPanel[] = [];

/**
 * Handlers that own Escape *before* any panel does: a transient state whose
 * owner is a view rather than a panel (an in-progress worker drag in the city,
 * a pending build placement). They are consulted in registration order and the
 * first one to return true consumes the key. A view claims one on open and
 * releases it on close, so an inactive view never holds the key.
 */
const escapeBeforePanels = new Set<() => boolean>();
let nextZ = PANEL_Z_RAISE_BASE;
/**
 * The window the Escape listener was attached to, so it can always be removed
 * from the same object -- a test harness that swaps `globalThis.window` must not
 * leave the manager believing it is still listening.
 */
let escapeHost: Pick<Window, "addEventListener" | "removeEventListener"> | null = null;

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key !== "Escape") return;
  if (!closeTopPanelOnEscape()) return;
  // The panel owned this Escape: keep the view-level handlers (the city view's
  // ladder, UIManager's shortcuts, a modal's own listener) from reacting to the
  // same keystroke and closing something underneath it.
  e.preventDefault();
  e.stopImmediatePropagation();
};

type KeyHost = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * The object Escape can actually be listened on, or null. The hand-rolled DOM
 * stand-ins in the screen tests provide `window` without event listeners, and
 * a panel must still construct there (it simply has no Escape to route).
 */
function keyHost(): KeyHost | null {
  if (typeof window === "undefined") return null;
  const host = window as Partial<KeyHost>;
  if (typeof host.addEventListener !== "function") return null;
  if (typeof host.removeEventListener !== "function") return null;
  return host as KeyHost;
}

function bindEscape(): void {
  const host = keyHost();
  if (!host) return;
  // Re-bind when the window object itself changed (a test harness swaps
  // `globalThis.window` between cases): a listener left on a dead window would
  // silently stop Escape from working.
  if (escapeHost === host) return;
  escapeHost?.removeEventListener("keydown", onKeyDown, true);
  escapeHost = host;
  // Capture phase: window bubble listeners (views registering their own
  // keydown on open) must never see an Escape a panel already handled.
  escapeHost.addEventListener("keydown", onKeyDown, true);
}

function unbindEscape(): void {
  escapeHost?.removeEventListener("keydown", onKeyDown, true);
  escapeHost = null;
}

export function registerPanel(panel: ManagedPanel): void {
  if (openPanels.includes(panel)) return;
  openPanels.push(panel);
  bindEscape();
}

export function unregisterPanel(panel: ManagedPanel): void {
  const index = openPanels.indexOf(panel);
  if (index >= 0) openPanels.splice(index, 1);
  if (openPanels.length === 0) unbindEscape();
}

/** Click-to-front: move the panel to the top of the stack and hand it the next z. */
export function raisePanel(panel: ManagedPanel): void {
  const index = openPanels.indexOf(panel);
  if (index >= 0) openPanels.splice(index, 1);
  openPanels.push(panel);
  if (nextZ > PANEL_Z_RAISE_CAP) renormalize();
  panel.setPanelZ(nextZ++);
}

/** The panel an Escape would act on: the topmost one that did not opt out. */
export function escapeTarget(): ManagedPanel | null {
  for (let i = openPanels.length - 1; i >= 0; i--) {
    const panel = openPanels[i];
    // Long-lived panels register once and toggle display: a hidden one is not
    // open, so it must neither consume Escape nor be closed by it.
    if (panel.isPanelVisible && !panel.isPanelVisible()) continue;
    if (panel.escapeClosable !== false) return panel;
  }
  return null;
}

/**
 * Claims Escape ahead of every panel for as long as the returned release
 * function has not been called. For view-owned transient state that must
 * cancel before a panel closes underneath it (a worker drag, a placement).
 */
export function claimEscapeBeforePanels(hook: () => boolean): () => void {
  escapeBeforePanels.add(hook);
  bindEscape();
  return () => {
    escapeBeforePanels.delete(hook);
  };
}

/**
 * One Escape, one action, in priority order: a view-owned transient state
 * first (it cancels and leaves panels alone), then the topmost eligible panel
 * (its own nested state, or close). Returns whether anything happened, so the
 * global listener knows to stop the event before a view-level handler reacts.
 */
export function closeTopPanelOnEscape(): boolean {
  for (const hook of [...escapeBeforePanels]) {
    if (hook()) return true;
  }
  const target = escapeTarget();
  if (!target) return false;
  if (target.handleEscape?.()) return true;
  target.dismiss();
  return true;
}

export function hasOpenPanels(): boolean {
  return openPanels.length > 0;
}

function renormalize(): void {
  nextZ = PANEL_Z_RAISE_BASE;
  for (const panel of openPanels) panel.setPanelZ(nextZ++);
}

export function panelManagerSizeForTest(): number {
  return openPanels.length;
}

export function resetPanelManagerForTest(): void {
  openPanels.length = 0;
  escapeBeforePanels.clear();
  nextZ = PANEL_Z_RAISE_BASE;
  // The DOM listener cannot outlive the registry: a test that resets must not
  // leave a handler pointing at panels it can no longer see.
  unbindEscape();
}
