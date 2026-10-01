// Click-to-front stacking for the floating info panels (hero/settlement info,
// rosters, tile info, build palette, building menus). The band sits above the
// participating panels' static z values (40-75) and below the fixed overlays
// that must always win: the settlement cargo modal (90), the city design box
// and battle arena (100), the confirm/leave-behind dialogs (120), the home
// overlay (200), centered modals (300), toast (10000).

export interface StackablePanel {
  setPanelZ(z: number): void;
}

export const PANEL_Z_RAISE_BASE = 76;
const PANEL_Z_RAISE_CAP = 88;

const clickOrder: StackablePanel[] = [];
let nextZ = PANEL_Z_RAISE_BASE;

export function raisePanel(panel: StackablePanel): void {
  const i = clickOrder.indexOf(panel);
  if (i >= 0) clickOrder.splice(i, 1);
  clickOrder.push(panel);
  if (nextZ > PANEL_Z_RAISE_CAP) renormalize();
  panel.setPanelZ(nextZ++);
}

export function removePanel(panel: StackablePanel): void {
  const i = clickOrder.indexOf(panel);
  if (i >= 0) clickOrder.splice(i, 1);
}

function renormalize(): void {
  nextZ = PANEL_Z_RAISE_BASE;
  for (const panel of clickOrder) panel.setPanelZ(nextZ++);
}

export function panelStackSizeForTest(): number {
  return clickOrder.length;
}

export function resetPanelStackForTest(): void {
  clickOrder.length = 0;
  nextZ = PANEL_Z_RAISE_BASE;
}
