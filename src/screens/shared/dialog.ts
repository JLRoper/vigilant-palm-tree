import { FloatingPanel } from "./panel";

// A dialog: a FloatingPanel shown centred over a dimmed, input-intercepting
// backdrop. It is still a panel (it registers with panelManager), so Escape,
// click-to-front and the resize grip behave exactly like a floating panel;
// the wrapper only adds the modal backdrop and the centring.
//
// Escape is NOT a dialog option: panelManager owns it for every panel, so a
// dialog is Escape-closable by construction. `onEscape` on the panel is the
// hook for "the first Escape should cancel my nested state instead".

/** Gap kept between a dialog edge and the viewport edge, in px. */
const VIEWPORT_MARGIN = 24;

/**
 * The object a resize listener can be attached to, or null: the hand-rolled
 * DOM stand-ins in the screen tests provide `window` without event listeners.
 */
function resizeHost(): Pick<Window, "addEventListener" | "removeEventListener"> | null {
  if (typeof window === "undefined") return null;
  const host = window as Partial<Pick<Window, "addEventListener" | "removeEventListener">>;
  if (typeof host.addEventListener !== "function") return null;
  if (typeof host.removeEventListener !== "function") return null;
  return host as Pick<Window, "addEventListener" | "removeEventListener">;
}

export interface DialogDismissOptions {
  /** Close when the backdrop itself is clicked (clicks inside the panel do not). */
  backdropClick?: boolean;
  /**
   * Wrapper z-index (default 300, above the home overlay's 200). A caller that
   * must sit inside another modal's layer passes its own.
   */
  zIndex?: number;
}

export interface DialogDismissListeners {
  /** Remove every listener this call registered. Idempotent. */
  detach(): void;
}

/**
 * Builds the dismissal listeners for openDialog. Split out of the dialog
 * itself so the wiring is unit-testable without a DOM (see
 * test/screens/shared/dialogDismiss.test.ts): it only touches two
 * addEventListener surfaces -- the wrapper and the window.
 */
export function createDialogDismissListeners(opts: {
  close: () => void;
  wrapper: HTMLElement;
  backdropClick?: boolean;
}): DialogDismissListeners {
  const detachers: Array<() => void> = [];

  if (opts.backdropClick) {
    const onBackdropClick = (ev: Event): void => {
      // The click bubbles up from whatever was hit; only a landing on the
      // wrapper itself is a backdrop click.
      if (ev.target !== opts.wrapper) return;
      opts.close();
    };
    opts.wrapper.addEventListener("click", onBackdropClick);
    detachers.push(() => opts.wrapper.removeEventListener("click", onBackdropClick));
  }

  return {
    detach: () => {
      while (detachers.length > 0) detachers.pop()?.();
    },
  };
}

export function openDialog(
  parent: HTMLElement,
  title: string,
  width = 360,
  draggable = false,
  closeable = true,
  onClose?: () => void,
  dismiss?: DialogDismissOptions,
): FloatingPanel {
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: `${VIEWPORT_MARGIN}px`,
    boxSizing: "border-box",
    // Above the home overlay (z-index 200 in homeView.ts) unless told otherwise.
    zIndex: String(dismiss?.zIndex ?? 300),
  });
  parent.appendChild(wrapper);
  // Self-cleaning marker (the wrapper is removed wholesale on close): lets
  // global shortcuts know a modal owns the keyboard. See Toolbar's hotkeys.
  wrapper.dataset.modal = "true";

  let detachDismiss: (() => void) | null = null;
  const panel = new FloatingPanel({
    parent: wrapper,
    title,
    width,
    draggable,
    closeable,
    onClose: () => {
      onClose?.();
      detachDismiss?.();
      host?.removeEventListener("resize", clampIntoView);
      wrapper.remove();
    },
  });

  detachDismiss = createDialogDismissListeners({
    close: () => panel.close(),
    wrapper,
    ...(dismiss?.backdropClick ? { backdropClick: true } : {}),
  }).detach;

  // Centring is left to the wrapper's flexbox rather than computed here. A
  // measured position would go stale the moment content grew, and once the
  // panel reaches its max-height a ResizeObserver stops firing entirely --
  // further growth is absorbed by the scrolling body, not the panel's box.
  // Flex re-centres on content growth and window resize for free.
  // Note: the constructor's viewport-based max-height is deliberately kept
  // rather than switching to 100%. A percentage resolves against the wrapper's
  // content box in flex flow but its padding box once a drag promotes the
  // panel to absolute, which would quietly loosen the cap by the padding.
  panel.root.style.position = "relative";

  // Only relevant once a drag has switched the panel to absolute positioning:
  // a later window resize could otherwise strand it off screen.
  function clampIntoView(): void {
    if (panel.root.style.position !== "absolute") return;
    const rect = panel.root.getBoundingClientRect();
    const pos = panel.getPosition();
    const x = Math.min(Math.max(pos.x, 0), Math.max(0, window.innerWidth - rect.width));
    const y = Math.min(Math.max(pos.y, 0), Math.max(0, window.innerHeight - rect.height));
    if (x !== pos.x || y !== pos.y) panel.setPosition(x, y);
  }

  const host = resizeHost();
  host?.addEventListener("resize", clampIntoView);

  // The wrapper cleanup above must survive a later setOnClose(): consumers
  // replace onClose for their own teardown (battleResultCard, the multiplayer
  // lobby's stopPolling) and previously clobbered the wrapper removal,
  // stranding a fullscreen rgba(0,0,0,0.6) overlay that intercepts all input.
  // Re-wrap setOnClose so wrapper removal always chains.
  const baseSetOnClose = panel.setOnClose.bind(panel);
  panel.setOnClose = (fn: () => void): void => {
    baseSetOnClose(() => {
      fn();
      detachDismiss?.();
      host?.removeEventListener("resize", clampIntoView);
      wrapper.remove();
    });
  };

  return panel;
}
