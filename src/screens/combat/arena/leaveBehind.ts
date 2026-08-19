import type { BattleSide, ManualBattleState } from "@heroes/engine";
import type { UnitType } from "../../../state/units";
import { PopupMenu, styleButton } from "@screens/shared/menu";

type LeaveBehindKey = string;

function leaveBehindKey(slotIndex: number, unitTypeId: string): LeaveBehindKey {
  return `${slotIndex}:${unitTypeId}`;
}

function applyLeaveBehind(
  state: ManualBattleState,
  side: BattleSide,
  leftBehind: Map<LeaveBehindKey, number>,
): void {
  const combatants = side === "attacker" ? state.attacker : state.defender;
  for (const c of combatants) {
    if (c.retreated) continue;
    let mutated = false;
    for (const e of c.entries) {
      const key = leaveBehindKey(c.slotIndex, e.unitTypeId);
      const remove = leftBehind.get(key);
      if (!remove) continue;
      e.count = Math.max(0, e.count - remove);
      mutated = true;
    }
    if (mutated) c.entries = c.entries.filter((e) => e.count > 0);
  }
}

function openLeaveBehindDialog(opts: {
  state: ManualBattleState;
  side: BattleSide;
  unitTypes: Record<string, UnitType>;
  shortfall: number;
  unitValue: number;
  onConfirm: (leftBehind: Map<LeaveBehindKey, number>) => void;
}): void {
  const { state, side, unitTypes, shortfall, unitValue, onConfirm } = opts;
  const combatants = side === "attacker" ? state.attacker : state.defender;
  const requiredUnits = Math.ceil(shortfall / unitValue);

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "120",
  });
  document.body.appendChild(wrapper);

  const menu = new PopupMenu({
    parent: wrapper,
    title: "Leave Behind",
    width: 420,
    draggable: false,
    closeable: true,
    zIndex: 121,
    onClose: () => wrapper.remove(),
  });
  menu.setPosition(Math.max(24, (window.innerWidth - 420) / 2), Math.max(24, (window.innerHeight - 360) / 2));

  const selected = new Map<LeaveBehindKey, number>();

  const intro = document.createElement("div");
  Object.assign(intro.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    opacity: "0.9",
    marginBottom: "8px",
  });
  intro.textContent =
    `You can't cover the surrender cost. Pick units to leave behind — each ` +
    `unit is worth ${unitValue}G. You need at least ${requiredUnits} more ` +
    `unit${requiredUnits === 1 ? "" : "s"} (${shortfall}G).`;
  menu.appendContent(intro);

  const summary = document.createElement("div");
  Object.assign(summary.style, {
    fontSize: "12px",
    padding: "6px 8px",
    marginBottom: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
  });
  menu.appendContent(summary);

  const list = document.createElement("div");
  Object.assign(list.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "240px",
    overflowY: "auto",
    marginBottom: "10px",
  });
  menu.appendContent(list);

  for (const c of combatants) {
    if (c.retreated) continue;
    if (c.entries.every((e) => e.count <= 0)) continue;
    for (const e of c.entries) {
      if (e.count <= 0) continue;
      const name = unitTypes[e.unitTypeId]?.name ?? e.unitTypeId;
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "4px 8px",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "4px",
        fontSize: "12px",
      });
      const label = document.createElement("div");
      label.textContent = `Platoon ${c.slotIndex + 1} — ${name} ×${e.count}`;
      row.appendChild(label);

      const controls = document.createElement("div");
      Object.assign(controls.style, { display: "flex", gap: "4px", alignItems: "center" });

      const minus = document.createElement("button");
      minus.textContent = "−";
      styleButton(minus);
      minus.style.minWidth = "24px";
      const plus = document.createElement("button");
      plus.textContent = "+";
      styleButton(plus);
      plus.style.minWidth = "24px";

      const pickLabel = document.createElement("span");
      pickLabel.style.minWidth = "40px";
      pickLabel.style.textAlign = "center";

      const key = leaveBehindKey(c.slotIndex, e.unitTypeId);

      const update = (): void => {
        const picked = selected.get(key) ?? 0;
        pickLabel.textContent = `${picked}/${e.count}`;
        refresh();
      };

      minus.addEventListener("click", () => {
        const cur = selected.get(key) ?? 0;
        if (cur <= 0) return;
        const next = cur - 1;
        if (next === 0) selected.delete(key);
        else selected.set(key, next);
        update();
      });
      plus.addEventListener("click", () => {
        const cur = selected.get(key) ?? 0;
        if (cur >= e.count) return;
        selected.set(key, cur + 1);
        update();
      });

      controls.append(minus, pickLabel, plus);
      row.appendChild(controls);
      list.appendChild(row);
      update();
    }
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm Surrender";
  styleButton(confirmBtn, false);
  confirmBtn.style.background = "rgba(120,40,40,0.7)";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  });
  row.append(cancelBtn, confirmBtn);
  menu.appendContent(row);

  function refresh(): void {
    let units = 0;
    for (const v of selected.values()) units += v;
    const goldCovered = units * unitValue;
    const enough = units >= requiredUnits;
    summary.textContent =
      `Leaving behind: ${units} unit${units === 1 ? "" : "s"} ` +
      `(${goldCovered}G / need ${shortfall}G)` +
      (enough ? " ✓" : "");
    confirmBtn.disabled = !enough;
    confirmBtn.style.opacity = enough ? "1" : "0.4";
    confirmBtn.style.cursor = enough ? "pointer" : "not-allowed";
  }

  cancelBtn.addEventListener("click", () => menu.close());
  confirmBtn.addEventListener("click", () => {
    if (confirmBtn.disabled) return;
    menu.close();
    onConfirm(selected);
  });

  refresh();
}

export { applyLeaveBehind, leaveBehindKey, openLeaveBehindDialog };