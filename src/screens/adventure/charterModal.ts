import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";

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
