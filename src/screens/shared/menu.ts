const MENU_FONT = "system-ui, sans-serif";
const MENU_FONT_SIZE = "13px";

export const menuTheme = {
  font: MENU_FONT,
  fontSize: MENU_FONT_SIZE,
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
    fontFamily: MENU_FONT,
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
    fontFamily: MENU_FONT,
  },
  error: { color: "#f88", fontSize: "11px" },
};

export function styleButton(btn: HTMLButtonElement, primary = false): void {
  btn.style.padding = menuTheme.button.padding;
  btn.style.background = primary
    ? menuTheme.buttonPrimary.background
    : menuTheme.button.background;
  btn.style.color = menuTheme.button.color;
  btn.style.border = menuTheme.button.border;
  btn.style.borderRadius = menuTheme.button.borderRadius;
  btn.style.fontSize = menuTheme.button.fontSize;
  btn.style.fontFamily = menuTheme.button.fontFamily;
  btn.style.cursor = menuTheme.button.cursor;
}

export function styleInput(input: HTMLInputElement): void {
  input.style.padding = menuTheme.input.padding;
  input.style.background = menuTheme.input.background;
  input.style.color = menuTheme.input.color;
  input.style.border = menuTheme.input.border;
  input.style.borderRadius = menuTheme.input.borderRadius;
  input.style.fontFamily = menuTheme.input.fontFamily;
}

/** Gap kept between a panel edge and the viewport edge, in px. */
const VIEWPORT_MARGIN = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface PopupMenuOptions {
  parent?: HTMLElement;
  title: string;
  initialPosition?: { x: number; y: number };
  width?: number | string;
  closeable?: boolean;
  draggable?: boolean;
  zIndex?: number;
  onClose?: () => void;
  onMove?: (pos: { x: number; y: number }) => void;
}

export class PopupMenu {
  readonly root: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly titleEl: HTMLDivElement;
  readonly body: HTMLDivElement;

  private closeBtn: HTMLButtonElement | null = null;
  private draggable: boolean;
  private dragOffset: { dx: number; dy: number } | null = null;
  private pos: { x: number; y: number };
  private onClose?: () => void;

  constructor(private opts: PopupMenuOptions) {
    this.draggable = opts.draggable ?? true;
    this.onClose = opts.onClose;
    this.pos = opts.initialPosition ?? { x: 0, y: 0 };

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      left: `${this.pos.x}px`,
      top: `${this.pos.y}px`,
      minWidth: "180px",
      // Column layout so the header stays pinned and only the body scrolls.
      display: "flex",
      flexDirection: "column",
      maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
      background: menuTheme.panel.background,
      color: menuTheme.panel.color,
      border: menuTheme.panel.border,
      borderRadius: menuTheme.panel.borderRadius,
      boxShadow: menuTheme.panel.shadow,
      fontFamily: menuTheme.font,
      fontSize: menuTheme.fontSize,
      zIndex: String(opts.zIndex ?? 50),
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
      background: menuTheme.panel.headerBackground,
      color: menuTheme.panel.headerColor,
      borderTopLeftRadius: menuTheme.panel.borderRadius,
      borderTopRightRadius: menuTheme.panel.borderRadius,
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      cursor: this.draggable ? "move" : "default",
      fontSize: "13px",
      fontWeight: "600",
      flexShrink: "0",
    });

    this.titleEl = document.createElement("div");
    this.titleEl.textContent = opts.title;
    this.header.appendChild(this.titleEl);

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
        fontFamily: menuTheme.font,
      });
      this.closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
      this.header.appendChild(this.closeBtn);
    }

    this.body = document.createElement("div");
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

    const parent = opts.parent ?? document.body;
    parent.appendChild(this.root);
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

  setPosition(x: number, y: number): void {
    this.pos = { x, y };
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }

  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }

  getPosition(): { x: number; y: number } {
    return { ...this.pos };
  }

  setDraggable(value: boolean): void {
    this.draggable = value;
    this.header.style.cursor = value ? "move" : "default";
  }

  close(): void {
    this.root.remove();
    this.onClose?.();
  }

  private attachDrag(): void {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.closeBtn && e.target === this.closeBtn) return;
      e.preventDefault();
      const rect = this.root.getBoundingClientRect();
      // Centred modals sit in normal flex flow so CSS can keep them centred.
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
        // Clamp both edges so a panel can never be dragged out of reach.
        const { width, height } = this.root.getBoundingClientRect();
        const x = clamp(ev.clientX - this.dragOffset.dx, 0, Math.max(0, window.innerWidth - width));
        const y = clamp(ev.clientY - this.dragOffset.dy, 0, Math.max(0, window.innerHeight - height));
        this.setPosition(x, y);
        this.opts.onMove?.({ x, y });
      };
      const onUp = () => {
        this.dragOffset = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    this.header.addEventListener("mousedown", onDown);
  }
}

export function openCenteredModal(
  parent: HTMLElement,
  title: string,
  width = 360,
  draggable = false,
  closeable = true,
): PopupMenu {
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
    // Must sit above the home overlay (z-index 200 in homeView.ts).
    zIndex: "300",
  });
  parent.appendChild(wrapper);

  const menu = new PopupMenu({
    parent: wrapper,
    title,
    width,
    draggable,
    closeable,
    onClose: () => {
      window.removeEventListener("resize", clampIntoView);
      wrapper.remove();
    },
  });

  // Centring is left to the wrapper's flexbox rather than computed here. A
  // measured position would go stale the moment content grew, and once the
  // panel reaches its max-height a ResizeObserver stops firing entirely --
  // further growth is absorbed by the scrolling body, not the panel's box.
  // Flex re-centres on content growth and window resize for free.
  // Note: the constructor's viewport-based max-height is deliberately kept
  // rather than switching to 100%. A percentage resolves against the wrapper's
  // content box in flex flow but its padding box once a drag promotes the
  // panel to absolute, which would quietly loosen the cap by the padding.
  menu.root.style.position = "relative";

  // Only relevant once a drag has switched the panel to absolute positioning:
  // a later window resize could otherwise strand it off screen.
  function clampIntoView(): void {
    if (menu.root.style.position !== "absolute") return;
    const rect = menu.root.getBoundingClientRect();
    const pos = menu.getPosition();
    const x = clamp(pos.x, 0, Math.max(0, window.innerWidth - rect.width));
    const y = clamp(pos.y, 0, Math.max(0, window.innerHeight - rect.height));
    if (x !== pos.x || y !== pos.y) menu.setPosition(x, y);
  }

  window.addEventListener("resize", clampIntoView);
  return menu;
}
