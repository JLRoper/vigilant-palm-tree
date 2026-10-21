import {
  registerPanel,
  unregisterPanel,
  raisePanel,
  PANEL_Z_RAISE_BASE,
  type ManagedPanel,
} from "./panelManager";
import { attachPanelResize } from "./panelResize";
import { loadPanelGeometry, loadPanelSize, savePanelGeometry, type PanelGeometryKey } from "./panelLayout";
import {
  beginStackDrag,
  dragStackGroup,
  endStackDrag,
  hoverStackDrop,
  isPanelLocked,
  registerStackPanel,
  resizeStackedPanel,
  scheduleStackLayout,
  unregisterStackPanel,
  type StackSlot,
  type StackablePanel,
} from "./panelTiling";

// One floating panel: the title bar, the scrolling body, drag, resize,
// click-to-front, and Escape (owned by panelManager -- a panel is
// Escape-closable by existing, it never wires its own keydown).
//
// Vocabulary: a **panel** is this surface; a **dialog** is a panel shown
// centred over a backdrop (`openDialog` in dialog.ts). "Menu" is reserved for
// an actual command list (there are none here), and "module" is not a UI term.

const PANEL_FONT = "system-ui, sans-serif";
const PANEL_FONT_SIZE = "13px";

export const panelTheme = {
  font: PANEL_FONT,
  fontSize: PANEL_FONT_SIZE,
  panel: {
    background: "#1a1a1a",
    color: "#eee",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "6px",
    headerBackground: "#0e0e0e",
    headerColor: "#eee",
    shadow: "0 4px 18px rgba(0,0,0,0.55)",
  },
  button: {
    padding: "6px 12px",
    background: "rgba(0,0,0,0.6)",
    color: "#eee",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
    fontSize: "12px",
    fontFamily: PANEL_FONT,
    cursor: "pointer",
  },
  buttonPrimary: {
    background: "rgba(40,90,40,0.7)",
    color: "#eee",
  },
  input: {
    padding: "6px 8px",
    background: "#0e0e0e",
    color: "#eee",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "3px",
    fontFamily: PANEL_FONT,
  },
  error: { color: "#f88", fontSize: "11px" },
};

export function styleButton(btn: HTMLButtonElement, primary = false): void {
  btn.style.padding = panelTheme.button.padding;
  btn.style.background = primary
    ? panelTheme.buttonPrimary.background
    : panelTheme.button.background;
  btn.style.color = panelTheme.button.color;
  btn.style.border = panelTheme.button.border;
  btn.style.borderRadius = panelTheme.button.borderRadius;
  btn.style.fontSize = panelTheme.button.fontSize;
  btn.style.fontFamily = panelTheme.button.fontFamily;
  btn.style.cursor = panelTheme.button.cursor;
}

export function styleInput(input: HTMLInputElement): void {
  input.style.padding = panelTheme.input.padding;
  input.style.background = panelTheme.input.background;
  input.style.color = panelTheme.input.color;
  input.style.border = panelTheme.input.border;
  input.style.borderRadius = panelTheme.input.borderRadius;
  input.style.fontFamily = panelTheme.input.fontFamily;
}

/** Gap kept between a panel edge and the viewport edge, in px. */
const VIEWPORT_MARGIN = 24;

const FLOATING_MAX_HEIGHT = `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`;

/** A panel is either floating (positioned by the user) or docked in the rail. */
export type PanelMode = "docked" | "floating";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface FloatingPanelOptions {
  parent?: HTMLElement;
  title: string;
  initialPosition?: { x: number; y: number };
  width?: number | string;
  closeable?: boolean;
  draggable?: boolean;
  zIndex?: number;
  onClose?: () => void;
  onMove?: (pos: { x: number; y: number }) => void;
  minTop?: () => number;
  clickToFront?: boolean;
  /** Adds the shared corner resize grip (see shared/panelResize.ts). */
  resizeable?: boolean;
  /** Remembers the dragged size under this key (panel geometry store). */
  resizeKey?: PanelGeometryKey;
  /**
   * A dismiss (Escape or the × button) hides the panel and leaves it reusable,
   * instead of destroying it. Long-lived panels that their owner shows and
   * hides repeatedly (hero/settlement info, rosters, tile info) set this; a
   * panel built on demand omits it and a dismiss tears it down.
   */
  hideOnDismiss?: boolean;
  /** Escape closes the panel (default true). See panelManager. */
  escapeClosable?: boolean;
  /**
   * Nested-state hook, consulted before Escape closes the panel: return true to
   * consume the key and stay open.
   */
  onEscape?: () => boolean;
  stackable?: boolean;
}

let nextStackId = 1;

export class FloatingPanel implements ManagedPanel, StackablePanel {
  readonly stackId = nextStackId++;
  readonly root: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly titleEl: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly actions: HTMLDivElement;
  /** Escape closes the panel unless the owner opts out (see panelManager). */
  escapeClosable: boolean;

  private layout: PanelMode = "floating";
  private closeBtn: HTMLButtonElement | null = null;
  private moveBtn: HTMLButtonElement | null = null;
  private draggable: boolean;
  private dragOffset: { dx: number; dy: number } | null = null;
  private pos: { x: number; y: number };
  private onClose?: () => void;
  private onEscape?: () => boolean;
  private resizeGrip: HTMLDivElement | null = null;
  private resizeKey?: PanelGeometryKey;
  private stackable: boolean;
  private stackSlot: StackSlot | null = null;
  private userHeight: number | null = null;
  private heightLock: number | null = null;

  constructor(private opts: FloatingPanelOptions) {
    this.draggable = opts.draggable ?? true;
    this.onClose = opts.onClose;
    this.onEscape = opts.onEscape;
    this.escapeClosable = opts.escapeClosable ?? true;
    this.pos = opts.initialPosition ?? { x: 0, y: 0 };
    this.stackable = opts.stackable ?? false;

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      left: `${this.pos.x}px`,
      top: `${this.pos.y}px`,
      minWidth: "180px",
      // Column layout so the header stays pinned and only the body scrolls.
      display: "flex",
      flexDirection: "column",
      maxHeight: FLOATING_MAX_HEIGHT,
      background: panelTheme.panel.background,
      color: panelTheme.panel.color,
      border: panelTheme.panel.border,
      borderRadius: panelTheme.panel.borderRadius,
      boxShadow: panelTheme.panel.shadow,
      fontFamily: panelTheme.font,
      fontSize: panelTheme.fontSize,
      zIndex: String(opts.zIndex ?? PANEL_Z_RAISE_BASE),
      userSelect: "none",
      pointerEvents: "auto",
      isolation: "isolate",
    });
    if (opts.width !== undefined) {
      this.root.style.width = typeof opts.width === "number" ? `${opts.width}px` : opts.width;
    }

    this.header = document.createElement("div");
    Object.assign(this.header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 10px",
      background: panelTheme.panel.headerBackground,
      color: panelTheme.panel.headerColor,
      borderTopLeftRadius: panelTheme.panel.borderRadius,
      borderTopRightRadius: panelTheme.panel.borderRadius,
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      cursor: this.draggable ? "move" : "default",
      fontSize: "13px",
      fontWeight: "600",
      flexShrink: "0",
    });

    this.titleEl = document.createElement("div");
    this.titleEl.textContent = opts.title;
    this.header.appendChild(this.titleEl);

    this.actions = document.createElement("div");
    Object.assign(this.actions.style, {
      display: "flex",
      alignItems: "center",
      gap: "2px",
      flexShrink: "0",
    });
    this.header.appendChild(this.actions);

    if (opts.closeable ?? true) {
      this.closeBtn = document.createElement("button");
      this.closeBtn.textContent = "×";
      Object.assign(this.closeBtn.style, {
        background: "transparent",
        color: "rgba(255,255,255,0.7)",
        border: "none",
        fontSize: "16px",
        lineHeight: "1",
        padding: "0 4px",
        cursor: "pointer",
        fontFamily: panelTheme.font,
      });
      this.closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.dismiss();
      });
      this.actions.appendChild(this.closeBtn);
    }

    this.body = document.createElement("div");
    this.body.dataset.panelBody = "true";
    Object.assign(this.body.style, {
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      overflowY: "auto",
      // Flex children default to min-height:auto and refuse to shrink below
      // their content, which would defeat the max-height on root.
      minHeight: "0",
      // Keep wheel events from chaining to the map once the list bottoms out.
      overscrollBehavior: "contain",
    });

    this.root.appendChild(this.header);
    this.root.appendChild(this.body);

    if (this.draggable) this.attachDrag();
    if (this.stackable && this.draggable) this.addMoveHandle();

    if (this.opts.clickToFront) {
      this.root.addEventListener(
        "mousedown",
        () => {
          if (this.layout === "floating") raisePanel(this);
        },
        true,
      );
    }

    const parent = opts.parent ?? document.body;
    parent.appendChild(this.root);

    if (opts.resizeable) this.enableResize(opts.resizeKey);
    registerPanel(this);
    if (this.stackable) registerStackPanel(this);
  }

  setTitle(text: string): void {
    this.titleEl.textContent = text;
  }

  setContent(node: HTMLElement | string): void {
    this.body.replaceChildren();
    if (typeof node === "string") {
      this.body.textContent = node;
    } else {
      this.body.appendChild(node);
    }
  }

  appendContent(node: HTMLElement): void {
    this.body.appendChild(node);
  }

  clearContent(): void {
    this.body.replaceChildren();
  }

  addHeaderAction(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    Object.assign(btn.style, {
      background: "transparent",
      color: "rgba(255,255,255,0.7)",
      border: "none",
      fontSize: "13px",
      lineHeight: "1",
      padding: "0 4px",
      cursor: "pointer",
      fontFamily: panelTheme.font,
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    this.actions.insertBefore(btn, this.closeBtn);
    return btn;
  }

  setLayout(mode: PanelMode): void {
    this.layout = mode;
    this.clearStackSlot();
    if (this.stackable) scheduleStackLayout();
    if (mode === "docked") {
      Object.assign(this.root.style, {
        position: "static",
        left: "",
        top: "",
        width: "100%",
        // Capped, not stretched: a lone open panel should size to its
        // content rather than fill the whole rail, and two open panels
        // should split it evenly. -4px is half of panelRail.ts's RAIL_GAP
        // (8px) so two capped panels plus the gap between them sum to
        // exactly 100% instead of overflowing the rail by the gap amount.
        maxHeight: "calc(50% - 4px)",
        flex: "0 1 auto",
        minHeight: "0",
        // A grip drag sets an explicit height; the rail sizes this panel, so
        // drop it here and let applyStoredSize() put it back on pop-out.
        height: "",
      });
      this.setDraggable(false);
      this.syncResizeGrip();
      return;
    }
    Object.assign(this.root.style, {
      position: "absolute",
      maxHeight: FLOATING_MAX_HEIGHT,
      flex: "",
      minHeight: "",
      width: this.opts.width === undefined
        ? ""
        : typeof this.opts.width === "number"
          ? `${this.opts.width}px`
          : this.opts.width,
    });
    this.setPosition(this.pos.x, this.pos.y);
    this.setDraggable(this.opts.draggable ?? true);
    this.applyStoredSize();
    this.syncResizeGrip();
  }

  getLayout(): PanelMode {
    return this.layout;
  }

  setPosition(x: number, y: number): void {
    this.pos = { x, y };
    this.root.style.left = `${x}px`;
    this.root.style.top = `${this.stackSlot ? this.stackSlot.y : y}px`;
    this.fitToViewport();
    if (this.stackable) scheduleStackLayout();
  }

  moveTo(x: number, y: number): void {
    this.setPosition(x, y);
    this.opts.onMove?.({ x, y });
  }

  isStacked(): boolean {
    return this.stackSlot !== null;
  }

  getStackSlot(): StackSlot | null {
    return this.stackSlot;
  }

  stackMinTop(): number {
    return this.opts.minTop?.() ?? 0;
  }

  isStackEligible(): boolean {
    return (
      this.layout === "floating" &&
      this.root.isConnected &&
      this.root.style.position === "absolute" &&
      this.isPanelVisible()
    );
  }

  naturalHeight(): number {
    const room = Math.max(120, window.innerHeight - this.stackMinTop() - VIEWPORT_MARGIN);
    const fixed = this.heightLock ?? this.userHeight;
    if (fixed !== null) return Math.min(fixed, room);
    const frame = this.root.offsetHeight - this.root.clientHeight;
    return Math.min(Math.ceil(this.header.offsetHeight + this.body.scrollHeight + frame), room);
  }

  setStackSlot(slot: StackSlot | null): void {
    const prev = this.stackSlot;
    if (!prev && !slot) return;
    if (prev && slot && prev.y === slot.y && prev.h === slot.h) return;
    if (!slot) {
      this.clearStackSlot();
      this.root.style.top = `${this.pos.y}px`;
      this.applyOwnHeight();
      this.fitToViewport();
      return;
    }
    this.stackSlot = slot;
    this.root.dataset.panelStacked = "true";
    const frame = this.root.style.boxSizing === "border-box"
      ? 0
      : this.root.offsetHeight - this.root.clientHeight;
    this.root.style.top = `${slot.y}px`;
    this.root.style.height = `${Math.max(0, slot.h - frame)}px`;
    this.root.style.maxHeight = "none";
  }

  getHeightLock(): number | null {
    return this.heightLock;
  }

  toggleHeightLock(): void {
    if (this.heightLock !== null) {
      this.heightLock = null;
    } else {
      this.heightLock = Math.round(this.stackSlot?.h ?? this.root.getBoundingClientRect().height);
    }
    if (!this.stackSlot) this.applyOwnHeight();
    this.syncGripHighlight();
    if (this.stackable) scheduleStackLayout();
  }

  private applyOwnHeight(): void {
    const fixed = this.heightLock ?? this.userHeight;
    this.root.style.boxSizing = fixed !== null ? "border-box" : this.root.style.boxSizing;
    this.root.style.height = fixed !== null ? `${fixed}px` : "";
  }

  private syncGripHighlight(): void {
    if (!this.resizeGrip) return;
    const locked = this.heightLock !== null;
    this.resizeGrip.style.background = locked
      ? "linear-gradient(135deg, transparent 52%, rgba(230,190,90,0.95) 52%)"
      : "linear-gradient(135deg, transparent 52%, rgba(255,255,255,0.30) 52%)";
    this.resizeGrip.title = locked
      ? "Height locked - click to unlock, drag to resize"
      : "Click to lock this panel's height, drag to resize";
  }

  private clearStackSlot(): void {
    this.stackSlot = null;
    delete this.root.dataset.panelStacked;
  }

  savedSize(): { w: number; h: number } {
    const rect = this.root.getBoundingClientRect();
    const h = this.stackSlot ? this.userHeight ?? this.naturalHeight() : rect.height;
    return { w: Math.round(rect.width), h: Math.round(h) };
  }

  /**
   * Caps the panel's height to the space it actually has below its own top edge,
   * so a long list scrolls inside the panel instead of running off the bottom of
   * the screen (where its scrollbar is unreachable).
   */
  fitToViewport(): void {
    if (this.layout !== "floating" || this.stackSlot) return;
    const top = this.pos.y;
    const available = window.innerHeight - top - VIEWPORT_MARGIN;
    this.root.style.maxHeight = `${Math.max(120, Math.round(available))}px`;
  }

  /** Explicit panel size (the resize grip); the body scrolls inside it. */
  setSize(width: number, height: number): void {
    // The grip measures the bordered box (getBoundingClientRect) and hands that
    // back as the size, so size the border box here too -- otherwise every
    // reopen re-applied a content-box width and the panel crept 2px wider.
    this.root.style.boxSizing = "border-box";
    this.root.style.width = `${Math.round(width)}px`;
    this.body.style.overflowY = "auto";
    if (this.stackSlot) {
      const wasLocked = this.heightLock !== null;
      this.heightLock = null;
      resizeStackedPanel(this, height);
      if (wasLocked) this.heightLock = this.stackSlot?.h ?? Math.round(height);
      return;
    }
    this.userHeight = Math.round(height);
    if (this.heightLock !== null) this.heightLock = this.userHeight;
    this.root.style.height = `${this.userHeight}px`;
    this.fitToViewport();
    if (this.stackable) scheduleStackLayout();
  }

  getSize(): { w: number; h: number } {
    const rect = this.root.getBoundingClientRect();
    return { w: Math.round(rect.width), h: Math.round(rect.height) };
  }

  /**
   * Adds the shared corner resize grip (idempotent). The constructor's
   * `resizeable` option routes through here, and surfaces built by a helper
   * (openDialog's dialogs, say) opt in by calling it after construction.
   */
  enableResize(key?: PanelGeometryKey): void {
    if (this.resizeGrip) return;
    this.resizeKey = key;
    this.resizeGrip = attachPanelResize(
      { key, applyStored: this.layout === "floating" },
      this,
    );
    this.syncResizeGrip();
    this.syncGripHighlight();
  }

  /**
   * The grip belongs to a floating panel only: a docked one is sized by the
   * rail (width 100%, height capped), and a grip drag would fight that layout.
   */
  private syncResizeGrip(): void {
    if (!this.resizeGrip) return;
    this.resizeGrip.style.display = this.layout === "docked" ? "none" : "";
  }

  /** Re-applies the remembered size after a dock -> float round trip. */
  private applyStoredSize(): void {
    if (!this.resizeKey) return;
    const stored = loadPanelSize(this.resizeKey);
    if (stored) this.setSize(stored.w, stored.h);
  }

  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }

  setEscapeClosable(value: boolean): void {
    this.escapeClosable = value;
  }

  setOnEscape(fn: () => boolean): void {
    this.onEscape = fn;
  }

  /** panelManager's hook: a nested state can consume Escape without closing. */
  handleEscape(): boolean {
    return this.onEscape?.() ?? false;
  }

  /** panelManager's hook: a hidden panel is not open and must not eat Escape. */
  isPanelVisible(): boolean {
    // Only an explicit `false` means detached: a DOM stand-in without the
    // property (the hand-rolled mocks in the screen tests) is treated as live.
    if (this.root.isConnected === false) return false;
    if (this.root.style.display === "none") return false;
    if (typeof this.root.getClientRects !== "function") return true;
    return this.root.getClientRects().length > 0;
  }

  /**
   * Escape and the × button: hide a long-lived panel (its owner re-shows the
   * same DOM) or tear down one built on demand. Both run onClose, so callers
   * that clear a selection there keep doing it either way.
   */
  dismiss(): void {
    if (!this.opts.hideOnDismiss) {
      this.close();
      return;
    }
    this.root.style.display = "none";
    if (this.stackable) scheduleStackLayout();
    this.onClose?.();
  }

  getPosition(): { x: number; y: number } {
    return { ...this.pos };
  }

  setDraggable(value: boolean): void {
    this.draggable = value;
    this.header.style.cursor = value ? "move" : "default";
    if (this.moveBtn) this.moveBtn.style.display = value ? "" : "none";
  }

  setPanelZ(z: number): void {
    this.root.style.zIndex = String(z);
  }

  close(): void {
    // Unregister first, then run onClose while root is still attached:
    // callbacks may remove the wrapper (or otherwise reason about root's
    // placement) and rely on the pre-close DOM. root.remove() afterwards is
    // idempotent for callbacks that already detached it.
    unregisterPanel(this);
    if (this.stackable) unregisterStackPanel(this);
    this.onClose?.();
    this.root.remove();
  }

  private addMoveHandle(): void {
    const btn = document.createElement("button");
    btn.dataset.panelMoveHandle = "true";
    btn.title = "Drag to move just this panel (it stays locked to its column)";
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5v13M1.5 8h13"/>' +
      '<path d="M6 3.5 8 1.5l2 2M6 12.5l2 2 2-2M3.5 6 1.5 8l2 2M12.5 6l2 2-2 2"/></svg>';
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      background: "transparent",
      color: "rgba(255,255,255,0.7)",
      border: "none",
      padding: "0 4px",
      cursor: "move",
    });
    btn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.startDrag(e, true);
    });
    btn.addEventListener("click", (e) => e.stopPropagation());
    this.actions.insertBefore(btn, this.actions.firstChild);
    this.moveBtn = btn;
  }

  private attachDrag(): void {
    this.header.addEventListener("mousedown", (e) => this.startDrag(e, false));
  }

  private startDrag(e: MouseEvent, solo: boolean): void {
    if (!this.draggable) return;
    if (e.button !== 0) return;
    if (this.closeBtn && e.target === this.closeBtn) return;
    e.preventDefault();
    const grouped = !solo && this.stackable && isPanelLocked(this);
    if (!grouped && this.stackSlot) this.pos = { x: this.pos.x, y: this.stackSlot.y };
    if (this.stackable) beginStackDrag(this, solo);
    const start = { x: e.clientX, y: e.clientY };
    const rect = this.root.getBoundingClientRect();
    // Centred dialogs sit in normal flex flow so CSS can keep them centred.
    // Dragging one means taking it out of flow, pinned where it currently is.
    if (this.root.style.position !== "absolute") {
      const origin = (this.root.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      this.root.style.position = "absolute";
      this.setPosition(rect.left - (origin?.left ?? 0), rect.top - (origin?.top ?? 0));
    }
    this.dragOffset = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!this.dragOffset) return;
      if (grouped) {
        dragStackGroup(ev.clientX - start.x, ev.clientY - start.y);
        return;
      }
      // Clamp both edges so a panel can never be dragged out of reach.
      const { width, height } = this.root.getBoundingClientRect();
      const minY = this.opts.minTop?.() ?? 0;
      const x = clamp(ev.clientX - this.dragOffset.dx, 0, Math.max(0, window.innerWidth - width));
      const y = clamp(ev.clientY - this.dragOffset.dy, minY, Math.max(minY, window.innerHeight - height));
      this.setPosition(x, y);
      this.opts.onMove?.({ x, y });
      if (this.stackable) hoverStackDrop(ev.clientX, ev.clientY);
    };
    const onUp = (ev: MouseEvent) => {
      this.dragOffset = null;
      if (this.stackable) endStackDrag(ev.clientX, ev.clientY);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
}

export function clampPanelIntoView(panel: FloatingPanel, minTop = 0): void {
  if (panel.root.style.position !== "absolute" || panel.isStacked()) return;
  const rect = panel.root.getBoundingClientRect();
  const pos = panel.getPosition();
  const x = clamp(pos.x, 0, Math.max(0, window.innerWidth - rect.width));
  const y = clamp(pos.y, minTop, Math.max(minTop, window.innerHeight - rect.height));
  if (x !== pos.x || y !== pos.y) panel.setPosition(x, y);
}

// Anchors a floating panel against the bottom-left of the viewport from its
// *measured* height, instead of guessing that height and subtracting the guess
// from window.innerHeight. Panels whose content varies (a hero's army, a
// settlement's available actions) have no single correct constant, so the only
// reliable anchor is the box the browser actually laid out.
//
// The caller must have the panel displayed before calling: a `display: none`
// element measures 0x0, and an anchor derived from that silently does nothing.
export function anchorPanelToBottom(panel: FloatingPanel, x: number, minTop = 0): void {
  if (panel.isStacked()) return;
  // The shared FLOATING_MAX_HEIGHT cap is measured against the whole viewport
  // and knows nothing about the space reserved at the top for the toolbar.
  // Without narrowing it here, a panel that grows to the full cap still hangs
  // past the bottom edge by roughly the toolbar's height once anchored, and
  // clamping alone cannot recover that -- there is nowhere left to move it to.
  panel.root.style.maxHeight = `${Math.max(0, window.innerHeight - minTop - VIEWPORT_MARGIN)}px`;
  const { height } = panel.root.getBoundingClientRect();
  panel.setPosition(x, Math.max(minTop, window.innerHeight - height - VIEWPORT_MARGIN));
  clampPanelIntoView(panel, minTop);
}

const DEFAULT_PANEL_POSITION = { x: 48, y: 160 };

export interface PanelSpec extends Omit<
  FloatingPanelOptions,
  "initialPosition" | "clickToFront" | "onMove" | "resizeable" | "resizeKey"
> {
  /** Geometry store key: remembers the dragged position and the resize size. */
  key?: PanelGeometryKey;
  /** First-open position when nothing is stored. */
  defaultPosition?: { x: number; y: number };
  /** False when the owner persists the position elsewhere (rail panels). */
  persistPosition?: boolean;
  /** Defaults to true when a key is given. */
  resizable?: boolean;
  onMove?: (pos: { x: number; y: number }) => void;
}

/**
 * The one factory for a floating panel: the chrome, the click-to-front policy
 * and the remembered geometry in a single call, so no caller re-spells
 * loadPanelGeometry/savePanelGeometry/resizeable/clickToFront.
 */
export function createPanel(spec: PanelSpec): FloatingPanel {
  const {
    key,
    defaultPosition,
    persistPosition = true,
    resizable,
    onMove,
    stackable = true,
    ...rest
  } = spec;
  const stored = key ? loadPanelGeometry(key) : null;
  const resizeable = resizable ?? key !== undefined;
  return new FloatingPanel({
    ...rest,
    stackable,
    initialPosition: stored ?? defaultPosition ?? DEFAULT_PANEL_POSITION,
    clickToFront: true,
    onMove: (pos) => {
      if (key && persistPosition) savePanelGeometry(key, pos);
      onMove?.(pos);
    },
    resizeable,
    ...(resizeable && key ? { resizeKey: key } : {}),
  });
}
