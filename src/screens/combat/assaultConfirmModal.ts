import type { Platoon } from "@heroes/contracts";
import { openCenteredModal, styleButton } from "@screens/shared/menu";

export type AssaultConfirmChoice = "assault" | "autoResolve" | "cancel";

export function pluralizeUnitName(name: string, count: number): string {
  if (count === 1) return name;
  if (/man$/i.test(name)) return `${name.slice(0, -3)}men`;
  if (/[a-z]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export function formatStacksLabel(
  stacks: readonly Platoon[],
  unitNames: Record<string, string>,
): string {
  const counts = new Map<string, number>();
  for (const platoon of stacks) {
    for (const entry of platoon.entries) {
      if (entry.count <= 0) continue;
      counts.set(entry.unitTypeId, (counts.get(entry.unitTypeId) ?? 0) + entry.count);
    }
  }
  if (counts.size === 0) return "no troops";
  return Array.from(counts)
    .map(([unitTypeId, count]) => `${count} ${pluralizeUnitName(unitNames[unitTypeId] ?? unitTypeId, count)}`)
    .join(", ");
}

export interface AssaultConfirmModalOptions {
  settlementName: string;
  attackerSummary: string;
  garrisonSummary: string;
  onAssault: () => void;
  onAutoResolve: () => void;
  onCancel: () => void;
}

export function openAssaultConfirmModal(options: AssaultConfirmModalOptions): void {
  const modal = openCenteredModal(document.body, `Assault on ${options.settlementName}`, 340, false, false);

  const summary = document.createElement("div");
  Object.assign(summary.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    margin: "4px 0 12px",
  });
  const attackerLine = document.createElement("div");
  attackerLine.textContent = `You: ${options.attackerSummary}`;
  summary.appendChild(attackerLine);
  const garrisonLine = document.createElement("div");
  garrisonLine.textContent = `Garrison: ${options.garrisonSummary}`;
  summary.appendChild(garrisonLine);
  modal.appendContent(summary);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "12px",
  });

  let closed = false;
  const finish = (choice: AssaultConfirmChoice) => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey);
    modal.close();
    if (choice === "assault") options.onAssault();
    else if (choice === "autoResolve") options.onAutoResolve();
    else options.onCancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    finish("cancel");
  };
  window.addEventListener("keydown", onKey);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => finish("cancel"));
  row.appendChild(cancelBtn);

  const autoBtn = document.createElement("button");
  autoBtn.textContent = "Auto-resolve";
  autoBtn.title = "Resolve with the engine auto-resolver";
  styleButton(autoBtn);
  autoBtn.addEventListener("click", () => finish("autoResolve"));
  row.appendChild(autoBtn);

  const assaultBtn = document.createElement("button");
  assaultBtn.textContent = "Assault";
  styleButton(assaultBtn, true);
  assaultBtn.addEventListener("click", () => finish("assault"));
  row.appendChild(assaultBtn);

  modal.appendContent(row);
}
