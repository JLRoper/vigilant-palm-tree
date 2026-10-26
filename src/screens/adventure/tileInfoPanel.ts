import { FloatingPanel, createPanel } from "@screens/shared/panel";
import { toolbarHeight } from "@screens/shared/panelRail";
import type { TileInfo } from "./tileInfo";
import { foundSettlementRefusalToast } from "./clickIntent";

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

function terrainLine(terrain: NonNullable<TileInfo["terrain"]>): string {
  const { label, cost, passable } = terrain;
  return passable ? `${label} · move cost ${cost}` : `${label} · impassable`;
}

function riverLine(river: NonNullable<TileInfo["river"]>): string {
  if (river.kind === "small") return "Small river — crossing takes a full day";
  if (river.bridge) return "Bridge over the wide river";
  return "Wide river — impassable without a bridge";
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

function districtLine(district: NonNullable<TileInfo["district"]>): string {
  return `${district.settlementName} district (${district.variant}, ${district.buildingCount} building${district.buildingCount === 1 ? "" : "s"})${district.blocked ? " — BLOCKED by enemy hero" : ""}`;
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

// The founding line reuses the refusal table's own sentence (clickIntent), so
// the panel, the toast and the server's refusal all say the same thing.
function foundingLine(founding: NonNullable<TileInfo["founding"]>): { text: string; dim: boolean } {
  if (founding.canFound) {
    return { text: `${founding.wagonName} — can found a settlement here`, dim: false };
  }
  return {
    text: `${founding.wagonName} — cannot found here: ${foundSettlementRefusalToast(founding.refusal ?? "").message}`,
    dim: true,
  };
}

function signatureFor(info: TileInfo): string {
  return JSON.stringify(info);
}

/** The panel's title bar: the inspected hex's coordinates, and nothing else. */
export function tilePanelTitle(info: TileInfo): string {
  return `Tile ${info.q}, ${info.r}`;
}

/** One line of the panel: the exact text plus how it is emphasised. */
export interface TilePanelLine {
  text: string;
  dim?: boolean;
  bold?: boolean;
}

/**
 * The panel's lines for a tile, as data rather than DOM. The strings are the
 * whole player-visible surface of the panel (an unrevealed hex is exactly
 * "Unexplored", a seen one leads with its terrain and move cost), so they are
 * readable -- and testable -- without a document.
 */
export function tilePanelLines(info: TileInfo): TilePanelLine[] {
  if (!info.terrain) return [{ text: "Unexplored", dim: true }];
  const lines: TilePanelLine[] = [{ text: terrainLine(info.terrain) }];
  if (info.river) lines.push({ text: riverLine(info.river) });
  if (info.fogged) lines.push({ text: "Unexplored", dim: true });
  if (info.deposit) lines.push({ text: depositLine(info.deposit) });
  if (info.settlement) lines.push({ text: settlementLine(info.settlement), bold: info.settlement.owned });
  if (info.district) lines.push({ text: districtLine(info.district) });
  for (const hero of info.heroes) lines.push({ text: heroLine(hero), bold: hero.owned });
  if (info.charter) lines.push({ text: charterLine(info.charter) });
  if (info.founding) {
    const line = foundingLine(info.founding);
    lines.push({ text: line.text, dim: line.dim, bold: info.founding.canFound });
  }
  if (info.territory) lines.push({ text: territoryLine(info.territory), dim: true });
  return lines;
}

function renderLines(info: TileInfo): HTMLElement[] {
  return tilePanelLines(info).map((line) => makeLine(line.text, { dim: line.dim, bold: line.bold }));
}

export class TileInfoPanel {
  private menu: FloatingPanel;
  private bodyEl: HTMLDivElement;
  private visible = false;
  private lastSignature: string | null = null;
  private onCloseCallback?: () => void;

  constructor(opts: TileInfoPanelOptions) {
    this.onCloseCallback = opts.onClose;
    this.menu = createPanel({
      parent: opts.parent,
      title: "Tile",
      key: "tileInfo",
      // Pinned beside the cursor: the position is never dragged or remembered,
      // only the size is.
      persistPosition: false,
      defaultPosition: { x: PANEL_X, y: panelY() },
      width: PANEL_WIDTH,
      closeable: true,
      draggable: false,
      zIndex: PANEL_Z_INDEX,
      hideOnDismiss: true,
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
    this.menu.setTitle(tilePanelTitle(info));
    this.bodyEl.replaceChildren(...renderLines(info));
  }
}
