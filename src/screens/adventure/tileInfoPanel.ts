import { FloatingPanel, createPanel } from "@screens/shared/panel";
import { toolbarHeight } from "@screens/shared/panelRail";
import type { TileInfo } from "./tileInfo";
import { foundSettlementRefusalToast, pickupRefusalToast } from "./clickIntent";

export interface TileInfoPanelOptions {
  parent: HTMLElement;
  onClose?: () => void;
  /**
   * Fired by the pickup button. Wired by the UI manager to GameActions (which
   * runs the same engine reducer the server will, then POSTs); absent means the
   * panel renders the button's refusal text but offers no action, so a
   * read-only embed cannot mutate the game.
   */
  onPickup?: (heroId: string, q: number, r: number) => void;
}

const PANEL_WIDTH = 230;
const PANEL_X = 8;
const PANEL_GAP = 8;
const PANEL_Z_INDEX = 40;

function panelY(): number {
  return toolbarHeight() + PANEL_GAP;
}

function makeLine(
  text: string,
  opts: { dim?: boolean; bold?: boolean; key?: string } = {},
): HTMLDivElement {
  const line = document.createElement("div");
  line.textContent = text;
  // Optional addressable hook for the browser suites (the data-trade-* /
  // data-hero-trade-open convention): a keyed line can be read without
  // matching the panel's prose.
  if (opts.key) line.dataset.tileLine = opts.key;
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

/**
 * The deposit line, plus how much is still on the floor. The city-view half is
 * untouched by a pickup (the type and the per-turn yield the settlement works
 * are the same before and after), so only the trailing quantity changes --
 * which is exactly what the reader asked for: picking up must not remove what
 * the tile contributes.
 */
function depositLine(deposit: NonNullable<TileInfo["deposit"]>): string {
  const label = deposit.resource.charAt(0).toUpperCase() + deposit.resource.slice(1);
  const heads = deposit.workedBy
    ? `${label} deposit — worked by ${deposit.workedBy.name} (+${deposit.yield} ${deposit.resource}/turn)`
    : `${label} deposit — unclaimed`;
  return `${heads} · ${remainingPhrase(deposit.remaining)}`;
}

function remainingPhrase(remaining: number): string {
  if (remaining <= 0) return "worked out";
  return `${remaining} left`;
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

/**
 * The panel's one action, as data (the tilePanelLines rule: the player-visible
 * surface is readable without a document). Null when the hex offers no pickup
 * -- no hero of the viewer's standing here, or nothing left on the tile.
 *
 * A hero with no room still gets a button, DISABLED and labelled with the
 * engine's own refusal: a dead control that says why beats a live one that
 * silently does nothing.
 */
export function tilePanelAction(
  info: TileInfo,
): { label: string; disabled: boolean; title: string; heroId: string } | null {
  const pickup = info.pickup;
  if (!pickup) return null;
  const label = pickup.resource.charAt(0).toUpperCase() + pickup.resource.slice(1);
  if (!pickup.ok) {
    const refusal = pickupRefusalToast(pickup.reason);
    return {
      label: `${label} pickup — ${pickup.remaining} left`,
      disabled: true,
      title: refusal.message,
      heroId: pickup.heroId,
    };
  }
  return {
    label: `Pick up ${pickup.amount} ${pickup.resource} (${pickup.remaining} left)`,
    disabled: false,
    title: `${pickup.heroName} takes ${pickup.amount}; ${pickup.remaining - pickup.amount} stays on the ground. Cargo room: ${pickup.room}.`,
    heroId: pickup.heroId,
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
  /** Optional DOM hook: the rendered line carries `data-tile-line="<key>"`. */
  key?: string;
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
  // keyed: the browser suites read the deposit line's remaining amount off
  // `[data-tile-line="deposit"]` rather than matching the sentence.
  if (info.deposit) lines.push({ text: depositLine(info.deposit), key: "deposit" });
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
  return tilePanelLines(info).map((line) =>
    makeLine(line.text, { dim: line.dim, bold: line.bold, key: line.key }),
  );
}

function makePickupButton(
  info: TileInfo,
  action: NonNullable<ReturnType<typeof tilePanelAction>>,
  onPickup: ((heroId: string, q: number, r: number) => void) | undefined,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = action.label;
  button.title = action.title;
  button.disabled = action.disabled;
  button.dataset.pickup = "1";
  button.dataset.pickupHero = action.heroId;
  button.dataset.pickupTile = `${info.q},${info.r}`;
  Object.assign(button.style, {
    marginTop: "2px",
    padding: "4px 6px",
    fontSize: "11px",
    fontWeight: "600",
    borderRadius: "4px",
    border: "1px solid rgba(255,255,255,0.25)",
    background: action.disabled ? "rgba(255,255,255,0.06)" : "rgba(120,200,120,0.22)",
    color: "inherit",
    cursor: action.disabled ? "default" : "pointer",
    opacity: action.disabled ? "0.7" : "1",
  });
  if (!action.disabled && onPickup) {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      onPickup(action.heroId, info.q, info.r);
    });
  }
  return button;
}

export class TileInfoPanel {
  private menu: FloatingPanel;
  private bodyEl: HTMLDivElement;
  private visible = false;
  private lastSignature: string | null = null;
  private onCloseCallback?: () => void;
  private onPickupCallback?: (heroId: string, q: number, r: number) => void;

  constructor(opts: TileInfoPanelOptions) {
    this.onCloseCallback = opts.onClose;
    this.onPickupCallback = opts.onPickup;
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
    this.bodyEl.dataset.tileBody = "true";
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
    const children = renderLines(info);
    const action = tilePanelAction(info);
    if (action) children.push(makePickupButton(info, action, this.onPickupCallback));
    this.bodyEl.replaceChildren(...children);
  }

  /** Wired by the UI manager once the game actions exist (the panel is built first). */
  setPickupHandler(handler: ((heroId: string, q: number, r: number) => void) | undefined): void {
    this.onPickupCallback = handler;
  }
}
