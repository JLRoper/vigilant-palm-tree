import { CHARTER_GOLD_COST, CHARTER_WAREHOUSE_COST } from "@heroes/engine";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";
import type { CharterRequirements } from "./charterRequirements";

const CHARTER_NAME_PREFIXES = [
  "Black", "Iron", "Silver", "Storm", "Frost",
  "Dragon", "Wolf", "Raven", "Stone", "Dawn",
  "Gold", "Ember", "Thorn", "Grim", "High",
];

const CHARTER_NAME_SUFFIXES = [
  "hold", "keep", "watch", "spire", "fall",
  "reach", "gate", "crest", "hollow", "rest",
  "guard", "pass", "mark",
];

function generateCharterName(): string {
  const p = CHARTER_NAME_PREFIXES[Math.floor(Math.random() * CHARTER_NAME_PREFIXES.length)];
  const s = CHARTER_NAME_SUFFIXES[Math.floor(Math.random() * CHARTER_NAME_SUFFIXES.length)];
  return `${p} ${s}`;
}

export interface CharterModalHandlers {
  onConfirm: (finalName: string) => void;
  onCancel?: () => void;
}

export function openCharterModal(targetQ: number, targetR: number, handlers: CharterModalHandlers): void {
  let currentName = generateCharterName();
  const modal = openCenteredModal(document.body, "Charter Settlement", 320);

  const info = document.createElement("div");
  info.style.fontSize = "14px";
  info.style.opacity = "0.9";
  info.style.textAlign = "center";
  info.style.margin = "4px 0 12px";
  info.textContent = `Found settlement at (${targetQ}, ${targetR})`;
  modal.appendContent(info);

  const cost = document.createElement("div");
  cost.style.fontSize = "11px";
  cost.style.opacity = "0.7";
  cost.style.textAlign = "center";
  cost.style.marginBottom = "10px";
  cost.textContent = "Cost: 2500g + 20 wood + 15 stone";
  modal.appendContent(cost);

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Settlement name";
  nameLabel.style.fontSize = "11px";
  nameLabel.style.opacity = "0.7";
  modal.appendContent(nameLabel);

  const nameRow = document.createElement("div");
  nameRow.style.display = "flex";
  nameRow.style.gap = "6px";
  nameRow.style.alignItems = "center";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = currentName;
  styleInput(nameInput);
  nameInput.style.flex = "1";
  nameRow.appendChild(nameInput);

  const rerollBtn = document.createElement("button");
  rerollBtn.textContent = "↻";
  rerollBtn.title = "Re-roll name";
  styleButton(rerollBtn);
  rerollBtn.style.width = "32px";
  rerollBtn.style.height = "100%";
  rerollBtn.style.textAlign = "center";
  rerollBtn.style.padding = "6px 0";
  rerollBtn.addEventListener("click", () => {
    currentName = generateCharterName();
    nameInput.value = currentName;
  });
  nameRow.appendChild(rerollBtn);

  modal.appendContent(nameRow);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "8px";
  row.style.marginTop = "12px";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => {
    modal.close();
    handlers.onCancel?.();
  });
  row.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  styleButton(confirmBtn, true);
  confirmBtn.addEventListener("click", () => {
    const finalName = nameInput.value.trim() || currentName;
    modal.close();
    handlers.onConfirm(finalName);
  });
  row.appendChild(confirmBtn);

  modal.appendContent(row);
  nameInput.focus();
  nameInput.select();
}

export interface CharterRequirementsModalHandlers {
  onConfirm: () => void;
  onCancel?: () => void;
}

export function openCharterRequirementsModal(
  requirements: CharterRequirements,
  handlers: CharterRequirementsModalHandlers,
): void {
  const modal = openCenteredModal(document.body, "Charter a New Settlement", 340);

  const intro = document.createElement("div");
  intro.style.fontSize = "11px";
  intro.style.opacity = "0.7";
  intro.style.textAlign = "center";
  intro.style.margin = "4px 0 10px";
  intro.textContent = `Cost: ${CHARTER_GOLD_COST}g + ${CHARTER_WAREHOUSE_COST.wood} wood + ${CHARTER_WAREHOUSE_COST.stone} stone`;
  modal.appendContent(intro);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "6px";
  for (const row of requirements.rows) {
    const line = document.createElement("div");
    Object.assign(line.style, {
      display: "flex",
      alignItems: "baseline",
      gap: "8px",
      fontSize: "12px",
    });
    const mark = document.createElement("span");
    mark.textContent = row.ok ? "✓" : "✗";
    mark.style.color = row.ok ? "#7ddc7d" : "#f88";
    mark.style.width = "14px";
    mark.style.flexShrink = "0";
    line.appendChild(mark);
    const label = document.createElement("span");
    label.textContent = row.label;
    line.appendChild(label);
    const detail = document.createElement("span");
    detail.textContent = row.detail;
    Object.assign(detail.style, {
      marginLeft: "auto",
      opacity: "0.75",
      fontSize: "11px",
      textAlign: "right",
    });
    line.appendChild(detail);
    list.appendChild(line);
  }
  modal.appendContent(list);

  for (const hint of requirements.hints) {
    const hintEl = document.createElement("div");
    hintEl.style.fontSize = "11px";
    hintEl.style.color = "#e9cf7d";
    hintEl.style.marginTop = "8px";
    hintEl.style.lineHeight = "1.4";
    hintEl.textContent = hint;
    modal.appendContent(hintEl);
  }

  const reason = document.createElement("div");
  Object.assign(reason.style, {
    fontSize: "11px",
    opacity: "0.8",
    marginTop: "8px",
  });
  reason.textContent = requirements.canStart ? "" : `Cannot charter yet: ${requirements.missing.join(", ")}`;
  modal.appendContent(reason);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "8px";
  row.style.marginTop = "12px";

  let closed = false;
  const finish = (cancel: boolean) => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey);
    modal.close();
    if (cancel) handlers.onCancel?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    finish(true);
  };
  window.addEventListener("keydown", onKey);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => finish(true));
  row.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  styleButton(confirmBtn, true);
  confirmBtn.disabled = !requirements.canStart;
  confirmBtn.style.opacity = requirements.canStart ? "1" : "0.4";
  confirmBtn.style.cursor = requirements.canStart ? "pointer" : "not-allowed";
  confirmBtn.title = requirements.canStart
    ? "Pick a hex for the new settlement"
    : requirements.missing.join(", ");
  confirmBtn.addEventListener("click", () => {
    if (confirmBtn.disabled) return;
    finish(false);
    handlers.onConfirm();
  });
  row.appendChild(confirmBtn);

  modal.appendContent(row);
}
