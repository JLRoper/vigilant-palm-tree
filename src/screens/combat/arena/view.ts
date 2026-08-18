import { totalHealth, totalUnits, type Combatant, type ManualBattleState } from "@heroes/engine";
import type { UnitType } from "../../../state/units";
import { hpColor, hpRatio, isAlive, specialtyIcon, visibleSpecialty } from "./layout";

export interface PlatoonStripDetail {
  unitTypes: Record<string, UnitType>;
  stats: { label: string; value: string }[];
  metrics: { label: string; value: number; color: string }[];
  movementRemaining: number;
  canAct: boolean;
}

export function detailRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" });
  const l = document.createElement("span");
  l.textContent = label;
  Object.assign(l.style, { opacity: "0.7", fontSize: "10.5px" });
  const v = document.createElement("span");
  v.textContent = value;
  Object.assign(v.style, { fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: "10.5px" });
  row.append(l, v);
  return row;
}

export function buildPlatoonStrip(opts: {
  state: ManualBattleState;
  combatant: Combatant;
  accent: string;
  selected: boolean;
  dimmed: boolean;
  expanded: boolean;
  detail?: PlatoonStripDetail;
}): HTMLElement {
  const { state, combatant: c, accent, selected, dimmed, expanded, detail } = opts;
  const alive = isAlive(c);

  const strip = document.createElement("div");
  Object.assign(strip.style, {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "5px 7px",
    borderRadius: "4px",
    background: selected ? `${accent}33` : "rgba(255,255,255,0.03)",
    border: selected ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.07)",
    opacity: !alive ? "0.35" : dimmed ? "0.55" : "1",
  });

  const top = document.createElement("div");
  Object.assign(top.style, { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" });

  const specialty = visibleSpecialty(state, c);
  const icon = document.createElement("span");
  Object.assign(icon.style, { width: "14px", textAlign: "center", flexShrink: "0", lineHeight: "1" });
  icon.textContent = !alive ? "✕" : specialty ? specialtyIcon(specialty.tag) : "·";
  top.appendChild(icon);

  const name = document.createElement("span");
  name.style.fontWeight = "600";
  name.textContent = `P${c.slotIndex + 1}`;
  top.appendChild(name);

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  top.appendChild(spacer);

  const count = document.createElement("span");
  Object.assign(count.style, { opacity: "0.85", fontVariantNumeric: "tabular-nums" });
  if (!alive) count.textContent = c.retreated ? "Retreated" : "Defeated";
  else count.textContent = `×${totalUnits(c.entries)}`;
  top.appendChild(count);

  strip.appendChild(top);

  if (alive) {
    const track = document.createElement("div");
    Object.assign(track.style, {
      height: "4px",
      borderRadius: "2px",
      background: "rgba(0,0,0,0.55)",
      overflow: "hidden",
    });
    const pct = hpRatio(state, c);
    const fill = document.createElement("div");
    Object.assign(fill.style, {
      height: "100%",
      width: `${Math.max(0, Math.min(1, pct)) * 100}%`,
      background: hpColor(pct),
    });
    track.appendChild(fill);
    strip.appendChild(track);

    if (expanded && detail) {
      const hp = totalHealth(c.entries, detail.unitTypes);
      strip.appendChild(detailRow("HP", `${hp} / ${c.maxHealth}`));

      const compList = document.createElement("div");
      Object.assign(compList.style, { display: "flex", flexDirection: "column", gap: "1px" });
      for (const e of c.entries) {
        if (e.count <= 0) continue;
        compList.appendChild(detailRow(detail.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId, `x${e.count}`));
      }
      strip.appendChild(compList);

      strip.appendChild(detailRow("Movement", `${detail.movementRemaining} left`));

      if (detail.stats.length > 0) {
        const statRow = document.createElement("div");
        Object.assign(statRow.style, { display: "flex", flexWrap: "wrap", gap: "3px 4px", marginTop: "1px" });
        for (const s of detail.stats) {
          const chip = document.createElement("span");
          Object.assign(chip.style, {
            fontSize: "9.5px",
            padding: "2px 5px",
            borderRadius: "3px",
            background: "rgba(255,255,255,0.06)",
            fontVariantNumeric: "tabular-nums",
          });
          chip.innerHTML = `<span style="opacity:0.6">${s.label}</span> ${s.value}`;
          statRow.appendChild(chip);
        }
        strip.appendChild(statRow);
      }

      for (const m of detail.metrics) {
        const clamped = Math.max(0, Math.min(1, m.value));
        const line = document.createElement("div");
        line.appendChild(detailRow(m.label, String(Math.round(clamped * 100))));
        const mTrack = document.createElement("div");
        Object.assign(mTrack.style, { height: "4px", borderRadius: "2px", background: "rgba(0,0,0,0.5)", overflow: "hidden", marginTop: "2px" });
        const mFill = document.createElement("div");
        Object.assign(mFill.style, { height: "100%", width: `${clamped * 100}%`, background: m.color });
        mTrack.appendChild(mFill);
        line.appendChild(mTrack);
        strip.appendChild(line);
      }

      const canActChip = document.createElement("span");
      Object.assign(canActChip.style, {
        alignSelf: "flex-start",
        fontSize: "9.5px",
        padding: "2px 6px",
        borderRadius: "3px",
        border: "1px solid rgba(255,255,255,0.15)",
        opacity: "0.85",
        marginTop: "1px",
      });
      canActChip.textContent = detail.canAct ? "Can act" : "Acted";
      strip.appendChild(canActChip);
    }
  }

  return strip;
}

export function attachRailHover(opts: {
  list: HTMLElement;
  getHumanCombatants: () => Combatant[];
  getHoveredSlot: () => number | null;
  onHoverChange: (slot: number | null) => void;
}): void {
  const { list, getHumanCombatants, getHoveredSlot, onHoverChange } = opts;
  list.addEventListener("mouseover", (e) => {
    const strip = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-slot]");
    if (!strip || !list.contains(strip)) return;
    const slot = Number(strip.dataset.slot);
    if (slot === getHoveredSlot()) return;
    const combatant = getHumanCombatants().find((c) => c.slotIndex === slot);
    if (!combatant || !isAlive(combatant)) return;
    onHoverChange(slot);
  });
  list.addEventListener("mouseout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && list.contains(to)) return;
    if (getHoveredSlot() === null) return;
    onHoverChange(null);
  });
}