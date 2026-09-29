export interface MakeRowOptions {
  opacity?: number;
}

export function makeRow(label: string, opts: MakeRowOptions = {}): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    opacity: String(opts.opacity ?? 0.85),
    fontSize: "12px",
  });
  const lbl = document.createElement("span");
  lbl.textContent = label;
  row.appendChild(lbl);
  const value = document.createElement("span");
  value.textContent = "\u2014";
  value.style.fontVariantNumeric = "tabular-nums";
  row.appendChild(value);
  return { row, value };
}

export interface AccordionSectionOptions {
  label: string;
  startExpanded?: boolean;
  onToggle?: () => void;
}

// Collapsible panel section: a one-line header (triangle + label + right
// slot) that toggles the body between hidden and shown. Callers append their
// content to `body` and keep `rightEl`'s text up to date during renders.
// The header carries data-accordion=<label> so E2E tests can target it
// without depending on text content.
export class AccordionSection {
  readonly element: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly rightEl: HTMLSpanElement;
  readonly header: HTMLDivElement;

  private chevron: HTMLSpanElement;
  private expanded: boolean;
  private onToggle?: () => void;

  constructor(opts: AccordionSectionOptions) {
    this.expanded = opts.startExpanded ?? false;
    this.onToggle = opts.onToggle;

    this.element = document.createElement("div");
    Object.assign(this.element.style, {
      marginTop: "4px",
      paddingTop: "8px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    });

    this.header = document.createElement("div");
    this.header.dataset.accordion = opts.label;
    Object.assign(this.header.style, {
      display: "flex",
      alignItems: "baseline",
      gap: "6px",
      marginBottom: "6px",
      cursor: "pointer",
      userSelect: "none",
    });

    this.chevron = document.createElement("span");
    this.chevron.textContent = "\u25B6";
    Object.assign(this.chevron.style, {
      fontSize: "9px",
      opacity: "0.55",
      transition: "transform 120ms ease-out",
    });
    this.chevron.style.transform = this.expanded ? "rotate(90deg)" : "";
    this.header.appendChild(this.chevron);

    const label = document.createElement("span");
    label.textContent = opts.label;
    Object.assign(label.style, {
      fontSize: "11px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      flex: "1",
    });
    this.header.appendChild(label);

    this.rightEl = document.createElement("span");
    Object.assign(this.rightEl.style, {
      fontSize: "10px",
      opacity: "0.4",
    });
    this.header.appendChild(this.rightEl);

    this.header.addEventListener("click", () => this.toggle());
    this.element.appendChild(this.header);

    this.body = document.createElement("div");
    this.body.style.display = this.expanded ? "" : "none";
    this.element.appendChild(this.body);
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.chevron.style.transform = this.expanded ? "rotate(90deg)" : "";
    this.body.style.display = this.expanded ? "" : "none";
    // Toggling changes the panel's measured height; the panel re-anchors so
    // the extra rows do not push the bottom off screen. Deliberately not a
    // ResizeObserver -- see plan/2026-08-09-modal-viewport-overflow.md, an
    // observer on the root stops firing once max-height is reached.
    this.onToggle?.();
  }
}
