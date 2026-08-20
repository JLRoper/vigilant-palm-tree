import { PopupMenu } from "@screens/shared/menu";
import { toolbarHeight } from "@screens/shared/panelRail";
import type { TileInfo } from "./tileInfo";

export interface TileInfoPanelOptions {
  parent: HTMLElement;
  onClose?: () => void;
}

const PANEL_WIDTH = 230;
const PANEL_X = 8;
const PANEL_GAP = 8;
const PANEL_Z_INDEX = 40;

function panelY(): number {
  return toolbarHeight() + PANEL_GAP;
}

function makeLine(text: string, opts: { dim?: boolean; bold?: boolean } = {}): HTMLDivElement {
  const line = document.createElement("div");
  line.textContent = text;
  Object.assign(line.style, {
    opacity: opts.dim ? "0.6" : "0.92",
    fontWeight: opts.bold ? "600" : "400",
  });
  return line;
}

function terrainLine(info: TileInfo): string {
  const { label, cost, passable } = info.terrain;
  return passable ? `${label} · move cost ${cost}` : `${label} · impassable`;
}

function depositLine(deposit: NonNullable<TileInfo["deposit"]>): string {
  const label = deposit.resource.charAt(0).toUpperCase() + deposit.resource.slice(1);
  if (deposit.workedBy) {
    return `${label} deposit — worked by ${deposit.workedBy.name} (+${deposit.yield} ${deposit.resource}/turn)`;
  }
  return `${label} deposit — unclaimed`;
}

function settlementLine(settlement: NonNullable<TileInfo["settlement"]>): string {
  return `${settlement.name} — ${settlement.ownerName}, level ${settlement.level}, pop ${settlement.population}`;
}

function heroLine(hero: TileInfo["heroes"][number]): string {
  const move = hero.movementRemaining !== null ? `, ${Math.round(hero.movementRemaining)} move` : "";
  return `${hero.name} (${hero.ownerName}) — ${hero.troops} troops${move}`;
}

function charterLine(charter: NonNullable<TileInfo["charter"]>): string {
  const phaseLabel = charter.phase === "traveling" ? "traveling" : "constructing";
  return `${charter.name} — ${phaseLabel} charter (${charter.daysRemaining}d remaining)`;
}

function territoryLine(territory: NonNullable<TileInfo["territory"]>): string {
  return `Territory of ${territory.settlementName} (${territory.ownerName})`;
}

function signatureFor(info: TileInfo): string {
  return JSON.stringify(info);
}

function renderLines(info: TileInfo): HTMLElement[] {
  const lines: HTMLElement[] = [makeLine(terrainLine(info))];
  if (info.fogged) lines.push(makeLine("Unexplored", { dim: true }));
  if (info.deposit) lines.push(makeLine(depositLine(info.deposit)));
  if (info.settlement) lines.push(makeLine(settlementLine(info.settlement), { bold: info.settlement.owned }));
  for (const hero of info.heroes) lines.push(makeLine(heroLine(hero), { bold: hero.owned }));
  if (info.charter) lines.push(makeLine(charterLine(info.charter)));
  if (info.territory) lines.push(makeLine(territoryLine(info.territory), { dim: true }));
  return lines;
}

export class TileInfoPanel {
  private menu: PopupMenu;
  private bodyEl: HTMLDivElement;
  private visible = false;
  private lastSignature: string | null = null;
  private onCloseCallback?: () => void;

  constructor(opts: TileInfoPanelOptions) {
    this.onCloseCallback = opts.onClose;
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Tile",
      initialPosition: { x: PANEL_X, y: panelY() },
      width: PANEL_WIDTH,
      closeable: true,
      draggable: false,
      zIndex: PANEL_Z_INDEX,
      onClose: () => {
        this.visible = false;
        this.lastSignature = null;
        this.onCloseCallback?.();
      },
    });
    this.bodyEl = document.createElement("div");
    Object.assign(this.bodyEl.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      fontSize: "12px",
      lineHeight: "1.4",
    });
    this.menu.body.appendChild(this.bodyEl);
    this.menu.root.style.display = "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.lastSignature = null;
    this.menu.root.style.display = "none";
  }

  update(info: TileInfo): void {
    if (!this.visible) {
      if (!this.menu.root.parentNode) {
        document.body.appendChild(this.menu.root);
      }
      this.menu.root.style.display = "flex";
      this.menu.setPosition(PANEL_X, panelY());
      this.visible = true;
    }
    const signature = signatureFor(info);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.menu.setTitle(`Tile ${info.q}, ${info.r}`);
    this.bodyEl.replaceChildren(...renderLines(info));
  }
}
