export interface StatPill {
  chip: HTMLDivElement;
  value: HTMLSpanElement;
}

export function makePillLabel(text: string): HTMLSpanElement {
  const labelEl = document.createElement("span");
  labelEl.textContent = text;
  Object.assign(labelEl.style, {
    color: "var(--tb-text-muted, #9aa7bd)",
    fontSize: "9px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
  });
  return labelEl;
}

export function makePillValueSpan(): HTMLSpanElement {
  const value = document.createElement("span");
  Object.assign(value.style, {
    fontSize: "11.5px",
    fontWeight: "600",
    color: "var(--tb-text, #e9eef8)",
    fontVariantNumeric: "tabular-nums",
  });
  return value;
}

export function makePillDivider(): HTMLSpanElement {
  const divider = document.createElement("span");
  Object.assign(divider.style, {
    width: "1px",
    height: "14px",
    alignSelf: "center",
    flexShrink: "0",
    background: "var(--tb-divider, rgba(148,163,184,0.22))",
    borderRadius: "1px",
  });
  return divider;
}

/**
 * The header's stat pill: a rounded surface with an optional uppercase
 * micro-label and a tabular-nums value. Shared by the toolbar's date pill and
 * the HUD economy pills so the two rows cannot drift apart.
 */
export function makeStatPill(label?: string): StatPill {
  const chip = document.createElement("div");
  Object.assign(chip.style, {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "6px",
    padding: "3px 10px",
    background: "var(--tb-surface, rgba(255,255,255,0.045))",
    border: "1px solid var(--tb-border, rgba(148,163,184,0.22))",
    borderRadius: "var(--tb-radius-chip, 999px)",
    whiteSpace: "nowrap",
  });
  if (label) {
    chip.appendChild(makePillLabel(label));
  }
  const value = makePillValueSpan();
  chip.appendChild(value);
  return { chip, value };
}
