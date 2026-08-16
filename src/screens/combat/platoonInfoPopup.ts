// Click-anchored info card for a single platoon: composition, HP, movement
// left, and (for an enemy) a win-odds estimate against whichever of your
// platoons is currently selected. Used by manualBattleArena.ts for two
// cases — the platoon you've just selected to act with, and any enemy
// platoon you click on or hover.
//
// Deliberately a dumb rendering+placement component: the caller decides
// *which side* of the anchor point counts as "behind the line" (away from
// the opposing army) — this file just draws the card there and keeps it
// on-screen.

import { estimateWinChance, totalHealth } from "../../../shared/combat/damage";
import type { Combatant } from "../../../shared/combat/types";
import type { UnitType } from "../../state/units";
import { menuTheme } from "@screens/shared/menu";

export interface PlatoonInfoPopupWinChance {
  entries: Combatant["entries"];
  label: string;
}

// A labelled scalar shown as a small chip (Atk/Def/Spd/Rng/Terrain). The
// caller formats the value — this component never reads UnitType stats
// itself, keeping the "dumb rendering" contract in the file header.
export interface PlatoonInfoPopupStat {
  label: string;
  value: string;
}

// A 0..1 ratio drawn as a labelled bar (Morale/Fatigue). `color` is resolved
// by the caller so the popup doesn't need to know which direction is "good"
// for a given metric.
export interface PlatoonInfoPopupMetric {
  label: string;
  value: number;
  color: string;
}

export interface PlatoonInfoPopupShowOptions {
  combatant: Combatant;
  unitTypes: Record<string, UnitType>;
  accent: string;
  ownerLabel: string;
  canAct: boolean;
  movementRemaining: number;
  // Dominant specialty, already threshold-checked by the caller. Omitted
  // when nothing clears the threshold.
  specialty?: { icon: string; label: string };
  stats?: PlatoonInfoPopupStat[];
  metrics?: PlatoonInfoPopupMetric[];
  winChanceVs?: PlatoonInfoPopupWinChance;
  anchorX: number;
  anchorY: number;
  anchorSide: "left" | "right";
  // Allowable placement range, in the same local coordinate space as
  // anchorX/anchorY. NOT the same as the canvas's own pixel dimensions —
  // the canvas is snug around the hex grid (~50px of padding), nowhere near
  // wide enough to fit a 220px-wide card beside an edge-column unit without
  // this covering it. The caller should pass real on-screen room (e.g. the
  // arena window's bounds translated into this local space), which the
  // popup's positioned parent doesn't clip since it has no overflow:hidden.
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PlatoonInfoPopupController {
  show(opts: PlatoonInfoPopupShowOptions): void;
  hide(): void;
}

function hpColor(pct: number): string {
  return pct > 0.5 ? "#4caf50" : pct > 0.25 ? "#ffb300" : "#e53935";
}

export function createPlatoonInfoPopup(container: HTMLElement): PlatoonInfoPopupController {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "absolute",
    width: "220px",
    background: menuTheme.panel.background,
    color: menuTheme.panel.color,
    border: menuTheme.panel.border,
    borderRadius: menuTheme.panel.borderRadius,
    boxShadow: menuTheme.panel.shadow,
    fontFamily: menuTheme.font,
    fontSize: "12px",
    zIndex: "6",
    display: "none",
    pointerEvents: "none",
  });
  container.appendChild(el);

  const tail = document.createElement("div");
  Object.assign(tail.style, {
    position: "absolute",
    width: "10px",
    height: "10px",
    background: menuTheme.panel.background,
    border: menuTheme.panel.border,
    transform: "rotate(45deg)",
  });
  el.appendChild(tail);

  const head = document.createElement("div");
  Object.assign(head.style, {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    padding: "8px 10px",
    background: menuTheme.panel.headerBackground,
    color: menuTheme.panel.headerColor,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px 6px 0 0",
  });
  const swatch = document.createElement("span");
  Object.assign(swatch.style, {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    flexShrink: "0",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.4)",
  });
  const title = document.createElement("div");
  Object.assign(title.style, { fontWeight: "600", fontSize: "12.5px", flex: "1", lineHeight: "1.2" });
  head.append(swatch, title);
  el.appendChild(head);

  const body = document.createElement("div");
  Object.assign(body.style, { padding: "9px 10px 10px", display: "flex", flexDirection: "column", gap: "7px" });
  el.appendChild(body);

  function row(label: string, value: string): HTMLElement {
    const r = document.createElement("div");
    Object.assign(r.style, { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" });
    const l = document.createElement("span");
    l.textContent = label;
    l.style.opacity = "0.7";
    l.style.fontSize = "11px";
    const v = document.createElement("span");
    v.textContent = value;
    Object.assign(v.style, { fontVariantNumeric: "tabular-nums", textAlign: "right" });
    r.append(l, v);
    return r;
  }

  function show(opts: PlatoonInfoPopupShowOptions): void {
    const { combatant, unitTypes } = opts;
    swatch.style.background = opts.accent;
    title.innerHTML = "";
    title.textContent = `Platoon ${combatant.slotIndex + 1}`;
    const sub = document.createElement("small");
    Object.assign(sub.style, { display: "block", fontWeight: "400", opacity: "0.65", fontSize: "10.5px", marginTop: "1px" });
    sub.textContent = opts.specialty ? `${opts.specialty.icon} ${opts.specialty.label} · ${opts.ownerLabel}` : opts.ownerLabel;
    title.appendChild(sub);

    body.innerHTML = "";

    const compList = document.createElement("div");
    Object.assign(compList.style, { display: "flex", flexDirection: "column", gap: "2px" });
    for (const e of combatant.entries) {
      if (e.count <= 0) continue;
      compList.appendChild(row(unitTypes[e.unitTypeId]?.name ?? e.unitTypeId, `x${e.count}`));
    }
    body.appendChild(compList);

    const hp = totalHealth(combatant.entries, unitTypes);
    const hpPct = combatant.maxHealth > 0 ? hp / combatant.maxHealth : 0;
    const hpWrap = document.createElement("div");
    hpWrap.appendChild(row("HP", `${hp} / ${combatant.maxHealth}`));
    const track = document.createElement("div");
    Object.assign(track.style, { height: "5px", borderRadius: "3px", background: "rgba(0,0,0,0.5)", overflow: "hidden", marginTop: "3px" });
    const fill = document.createElement("div");
    Object.assign(fill.style, { height: "100%", width: `${Math.max(0, Math.min(1, hpPct)) * 100}%`, background: hpColor(hpPct) });
    track.appendChild(fill);
    hpWrap.appendChild(track);
    body.appendChild(hpWrap);

    body.appendChild(row("Movement", `${opts.movementRemaining} left`));

    if (opts.stats && opts.stats.length > 0) {
      const statRow = document.createElement("div");
      Object.assign(statRow.style, { display: "flex", flexWrap: "wrap", gap: "3px 5px" });
      for (const s of opts.stats) {
        const c = document.createElement("span");
        Object.assign(c.style, {
          fontSize: "10px",
          padding: "2px 5px",
          borderRadius: "3px",
          background: "rgba(255,255,255,0.06)",
          fontVariantNumeric: "tabular-nums",
        });
        c.innerHTML = `<span style="opacity:0.6">${s.label}</span> ${s.value}`;
        statRow.appendChild(c);
      }
      body.appendChild(statRow);
    }

    if (opts.metrics && opts.metrics.length > 0) {
      const metricWrap = document.createElement("div");
      Object.assign(metricWrap.style, { display: "flex", flexDirection: "column", gap: "4px" });
      for (const m of opts.metrics) {
        const clamped = Math.max(0, Math.min(1, m.value));
        const line = document.createElement("div");
        line.appendChild(row(m.label, String(Math.round(clamped * 100))));
        const t = document.createElement("div");
        Object.assign(t.style, { height: "4px", borderRadius: "2px", background: "rgba(0,0,0,0.5)", overflow: "hidden", marginTop: "2px" });
        const f = document.createElement("div");
        Object.assign(f.style, { height: "100%", width: `${clamped * 100}%`, background: m.color });
        t.appendChild(f);
        line.appendChild(t);
        metricWrap.appendChild(line);
      }
      body.appendChild(metricWrap);
    }

    const chips = document.createElement("div");
    Object.assign(chips.style, { display: "flex", gap: "5px", flexWrap: "wrap" });
    const chip = document.createElement("span");
    Object.assign(chip.style, { fontSize: "10px", padding: "2px 6px", borderRadius: "3px", border: "1px solid rgba(255,255,255,0.15)", opacity: "0.85" });
    chip.textContent = opts.canAct ? "Can act" : "Acted";
    chips.appendChild(chip);
    body.appendChild(chips);

    if (opts.winChanceVs) {
      const pct = estimateWinChance(opts.winChanceVs.entries, combatant.entries, unitTypes);
      const note = document.createElement("div");
      Object.assign(note.style, { fontSize: "10.5px", paddingTop: "5px", borderTop: "1px solid rgba(255,255,255,0.08)" });
      note.appendChild(row(`Est. win vs ${opts.winChanceVs.label}`, `${pct}%`));
      body.appendChild(note);
    }

    el.style.display = "block";
    el.style.visibility = "hidden"; // measure off-screen first, then place
    const popupW = el.offsetWidth;
    const popupH = el.offsetHeight;
    const gap = 16;

    let left = opts.anchorSide === "left" ? opts.anchorX - gap - popupW : opts.anchorX + gap;
    left = Math.max(opts.minX, Math.min(left, opts.maxX - popupW));
    let top = opts.anchorY - popupH / 2;
    top = Math.max(opts.minY, Math.min(top, opts.maxY - popupH));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";

    const tailTop = Math.max(10, Math.min(opts.anchorY - top - 5, popupH - 20));
    tail.style.top = `${tailTop}px`;
    if (opts.anchorSide === "left") {
      tail.style.left = "-6px";
      tail.style.right = "";
      tail.style.borderRight = "none";
      tail.style.borderTop = "none";
      tail.style.borderBottom = menuTheme.panel.border;
      tail.style.borderLeft = menuTheme.panel.border;
    } else {
      tail.style.right = "-6px";
      tail.style.left = "";
      tail.style.borderLeft = "none";
      tail.style.borderBottom = "none";
      tail.style.borderTop = menuTheme.panel.border;
      tail.style.borderRight = menuTheme.panel.border;
    }
  }

  function hide(): void {
    el.style.display = "none";
  }

  return { show, hide };
}
