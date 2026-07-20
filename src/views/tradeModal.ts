import type { SettlementState, WarehouseResource } from "../state/gameState";
import { openCenteredModal, styleButton, styleInput, menuTheme } from "./menu";

export type TradeConfirmHandler = (
  toId: string,
  resource: WarehouseResource,
  amount: number,
) => { ok: boolean; reason: string };

export interface TradeModalOptions {
  parent: HTMLElement;
  fromId: string;
  fromSettlement: SettlementState;
  destinations: SettlementState[];
  onConfirm: TradeConfirmHandler;
}

const TRADE_RESOURCES: WarehouseResource[] = ["wood", "stone", "iron", "arcane"];

function styleSelect(select: HTMLSelectElement): void {
  styleInput(select as unknown as HTMLInputElement);
}

export function openTradeModal(opts: TradeModalOptions): void {
  const modal = openCenteredModal(opts.parent, `Trade from ${opts.fromSettlement.name}`, 380);

  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "8px";

  const destLabel = document.createElement("label");
  destLabel.textContent = "Destination";
  destLabel.style.opacity = "0.7";
  content.appendChild(destLabel);

  const destSelect = document.createElement("select");
  styleSelect(destSelect);
  for (const d of opts.destinations) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    destSelect.appendChild(opt);
  }
  content.appendChild(destSelect);

  const resLabel = document.createElement("label");
  resLabel.textContent = "Resource";
  resLabel.style.opacity = "0.7";
  content.appendChild(resLabel);

  const resSelect = document.createElement("select");
  styleSelect(resSelect);
  for (const r of TRADE_RESOURCES) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = `${r} (have ${opts.fromSettlement.warehouse[r] ?? 0})`;
    resSelect.appendChild(opt);
  }
  content.appendChild(resSelect);

  const amtLabel = document.createElement("label");
  amtLabel.textContent = "Amount";
  amtLabel.style.opacity = "0.7";
  content.appendChild(amtLabel);

  const amtInput = document.createElement("input");
  amtInput.type = "number";
  amtInput.min = "1";
  amtInput.step = "1";
  styleInput(amtInput);
  content.appendChild(amtInput);

  const costLine = document.createElement("div");
  costLine.style.fontSize = "11px";
  costLine.style.opacity = "0.75";
  costLine.style.fontVariantNumeric = "tabular-nums";
  content.appendChild(costLine);

  const errorLine = document.createElement("div");
  Object.assign(errorLine.style, { ...menuTheme.error, minHeight: "14px", marginTop: "4px" });
  content.appendChild(errorLine);

  const recomputeDefaults = (): void => {
    const resource = resSelect.value as WarehouseResource;
    const have = opts.fromSettlement.warehouse[resource] ?? 0;
    const goldAvail = opts.fromSettlement.gold;
    const max = Math.max(0, Math.min(have, goldAvail));
    if (!amtInput.value || Number(amtInput.value) > max) {
      amtInput.value = String(max);
    }
    amtInput.max = String(max);
    const amt = Math.max(0, Number(amtInput.value) || 0);
    costLine.textContent = `Cost: ${amt}g`;
  };
  resSelect.addEventListener("change", recomputeDefaults);
  amtInput.addEventListener("input", () => {
    const amt = Math.max(0, Number(amtInput.value) || 0);
    costLine.textContent = `Cost: ${amt}g`;
  });

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "flex-end";
  row.style.gap = "8px";
  row.style.marginTop = "10px";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  styleButton(cancel);
  cancel.addEventListener("click", () => modal.close());
  row.appendChild(cancel);

  const confirm = document.createElement("button");
  confirm.textContent = "Trade";
  styleButton(confirm, true);
  confirm.addEventListener("click", () => {
    const toId = destSelect.value;
    const resource = resSelect.value as WarehouseResource;
    const amount = Math.floor(Number(amtInput.value) || 0);
    if (amount <= 0) {
      errorLine.textContent = "Amount must be positive.";
      return;
    }
    confirm.disabled = true;
    cancel.disabled = true;
    const result = opts.onConfirm(toId, resource, amount);
    if (!result.ok) {
      confirm.disabled = false;
      cancel.disabled = false;
      errorLine.textContent = `Failed: ${result.reason}`;
      return;
    }
    modal.close();
  });
  row.appendChild(confirm);

  content.appendChild(row);
  modal.setContent(content);
  recomputeDefaults();
}
