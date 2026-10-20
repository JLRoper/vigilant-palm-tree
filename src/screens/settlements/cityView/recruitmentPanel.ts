import { FloatingPanel, styleButton, createPanel } from "@screens/shared/panel";
import { AccordionSection } from "@screens/shared/panelWidgets";
import { loadPanelGeometry, type PanelGeometryKey } from "@screens/shared/panelLayout";
import { toolbarHeight } from "@screens/shared/panelRail";
import type { BuildingKind } from "@heroes/contracts";
import type { GameState, HeroState } from "../../../state/gameState";
import { catalogFailed, catalogReady, getCachedUnit, loadUnitCatalog } from "../../../data/unitCatalog";
import { getUnitImageUrl } from "../../../data/unitImages";
import { RESOURCE_PILE_BUBBLY_SPRITES } from "../../../render/assetDescriptors";
import { GarrisonView, type GarrisonTransferRequest } from "../garrisonView";
import {
  allocateRecruitCounts,
  allocateWorkerSteps,
  recruitmentAffordable,
  recruitmentCanAddWorker,
  recruitmentCanRemoveWorker,
  recruitmentCanStaffAny,
  recruitmentCanUnstaffAny,
  recruitmentGroupFor,
  recruitmentIdleWorkers,
  recruitmentMaxCount,
  recruitmentStaffing,
  recruitmentTreasury,
  recruitmentWorkerBase,
  recruitmentWorkerTarget,
  type RecruitmentGroup,
  type RecruitmentSnapshotModel,
  type RecruitmentSource,
  type RecruitmentStaffable,
  type RecruitmentUnitRow,
} from "../recruitmentPanelModel";
import type { CityView } from "./cityView";

export interface RecruitmentRequest {
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  district: { q: number; r: number } | null;
  unitTypeId: string;
  count: number;
}

/** A row click: open this building's own menu (the iso-grid click's menu). */
export interface RecruitmentBuildingOpenRequest {
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  district: { q: number; r: number } | null;
}

export interface RecruitmentPanelOptions {
  parent: HTMLElement;
  cityView: CityView;
  onRecruit: (req: RecruitmentRequest) => boolean;
  /** Live game state, for the shared garrison view. */
  getGameState?: () => GameState | undefined;
  getHeroesAtSettlement?: (settlementId: string) => HeroState[];
  /** Transfer commits, wired to the same command the settlement panel uses. */
  onTransfer?: (req: GarrisonTransferRequest) => boolean;
  onReorderGarrison?: (settlementId: string, fromIdx: number, toIdx: number) => boolean;
  onReorderHero?: (heroId: string, fromIdx: number, toIdx: number) => boolean;
  /** A building row was clicked: open that building's own menu. */
  onOpenBuilding?: (req: RecruitmentBuildingOpenRequest) => boolean;
}

const PANEL_GEOMETRY_KEY: PanelGeometryKey = "recruitmentPanel";
const PANEL_WIDTH = 320;
const ICON_RESOURCE = 16;
const ICON_UNIT = 28;

/** One decimal at most, trailing zero trimmed: 3.5, 2, 1.6. */
function formatRate(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildCostChip(source: string, alt: string, amount: number, iconSize: number): HTMLSpanElement {
  const chip = document.createElement("span");
  Object.assign(chip.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    fontVariantNumeric: "tabular-nums",
  });
  const img = document.createElement("img");
  img.src = source;
  img.alt = alt;
  Object.assign(img.style, {
    width: `${iconSize}px`,
    height: `${iconSize}px`,
    objectFit: "contain",
    imageRendering: "pixelated",
    flexShrink: "0",
  });
  const value = document.createElement("span");
  value.textContent = String(amount);
  chip.appendChild(img);
  chip.appendChild(value);
  return chip;
}

interface StepperOptions {
  tip: string;
  count: string;
  countTitle: string;
  removeTitle: string;
  addTitle: string;
  canRemove: boolean;
  canAdd: boolean;
  onRemove: () => void;
  onAdd: () => void;
}

/**
 * One place to see every unit this settlement can train and to actually train
 * it: the unit row (its image) is the PARENT, and clicking it accordions down
 * the individual recruit buildings that train that unit. The parent buys and
 * staffs every one of those buildings at once; only a building's own line opens
 * that building's menu. Rows are still grouped by BUILDING KIND (one FARMHOUSE
 * block however many farmhouses exist) and the settlement's garrison is the
 * settlement panel's own GarrisonView mounted here.
 */
export class RecruitmentPanel {
  private menu: FloatingPanel | null = null;
  private readonly parent: HTMLElement;
  private readonly cityView: CityView;
  private readonly onRecruit: (req: RecruitmentRequest) => boolean;
  private readonly onOpenBuilding?: (req: RecruitmentBuildingOpenRequest) => boolean;
  private readonly getGameState?: () => GameState | undefined;
  private readonly garrisonView: GarrisonView;
  private readonly garrisonAccordion: AccordionSection;
  /** Expanded unit rows, keyed `<buildingKind>:<unitTypeId>`; collapsed is the default. */
  private readonly expandedRows = new Set<string>();

  constructor(opts: RecruitmentPanelOptions) {
    this.parent = opts.parent;
    this.cityView = opts.cityView;
    this.onRecruit = opts.onRecruit;
    this.onOpenBuilding = opts.onOpenBuilding;
    this.getGameState = opts.getGameState;

    this.garrisonView = new GarrisonView({
      getHeroesAtSettlement: opts.getHeroesAtSettlement,
      onTransfer: opts.onTransfer,
      onReorderGarrison: opts.onReorderGarrison,
      onReorderHero: opts.onReorderHero,
    });
    this.garrisonAccordion = new AccordionSection({ label: "Garrison", startExpanded: true });
    this.garrisonAccordion.body.appendChild(this.garrisonView.root);

    opts.cityView.setRecruitmentListener(() => this.update());
    // Staffing changes made anywhere (this panel's steppers, the workforce
    // panel, a grid drag) move the refill rate, so re-render on those too.
    opts.cityView.setWorkforceListener(() => this.update());
  }

  isOpen(): boolean {
    return this.menu !== null;
  }

  open(): void {
    if (this.menu) return;
    const stored = loadPanelGeometry(PANEL_GEOMETRY_KEY);
    const pos = stored ?? { x: 48, y: 200 };
    this.expandedRows.clear();
    this.menu = createPanel({
      parent: this.parent,
      title: "Recruitment",
      key: PANEL_GEOMETRY_KEY,
      width: PANEL_WIDTH,
      defaultPosition: pos,
      minTop: toolbarHeight,
      zIndex: 76,
      closeable: true,
      draggable: true,
      onClose: () => {
        this.cityView.clearWorkforcePreview();
        this.menu = null;
      },
    });
    if (!catalogReady() && !catalogFailed()) {
      void loadUnitCatalog().then(() => this.update());
    }
    this.update();
    this.reposition(pos);
  }

  /** First open lands clear of the city design box, the settlement panel and
   * the city grid; a stored position that already clears them is untouched. */
  private reposition(desired: { x: number; y: number }): void {
    if (!this.menu) return;
    const rect = this.menu.root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const resolved = this.cityView.resolveFloatingPlacement({
      x: desired.x,
      y: desired.y,
      w: rect.width,
      h: rect.height,
    });
    if (resolved.x !== desired.x || resolved.y !== desired.y) {
      this.menu.setPosition(resolved.x, resolved.y);
    }
  }

  close(): void {
    this.cityView.clearWorkforcePreview();
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
  }

  /** Per-state refresh driven by UIManager's dirty-keyed HUD pass: the garrison
   * section is the settlement panel's shared view, so a transfer made over
   * there (or a desertion, or a capture) shows up here on the same tick. */
  refreshGarrison(state: GameState | undefined): void {
    if (!this.menu) return;
    this.garrisonView.update(state, this.cityView.getSettlementState());
    this.syncGarrisonBadge();
  }

  private update(): void {
    if (!this.menu) return;
    this.render();
  }

  private render(): void {
    if (!this.menu) return;
    const settlement = this.cityView.getSettlementState();
    const model = this.cityView.recruitmentSnapshot();
    this.menu.setTitle(model.ready > 0 ? `Recruitment · ${model.ready} ready` : "Recruitment");
    this.menu.clearContent();
    this.menu.appendContent(this.treasuryStrip(settlement));

    if (model.groups.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No recruit buildings";
      empty.title = "Build a barracks, archery range, mage guild or another recruit building first.";
      Object.assign(empty.style, { fontSize: "11px", opacity: "0.55", padding: "2px 0" });
      this.menu.appendContent(empty);
    }

    for (const group of model.groups) {
      this.menu.appendContent(this.groupBlock(group, model));
    }

    const state = this.getGameState?.();
    this.garrisonView.update(state, settlement);
    this.menu.appendContent(this.garrisonAccordion.element);
    this.syncGarrisonBadge();
  }

  private syncGarrisonBadge(): void {
    const total = this.garrisonView.totalUnits();
    this.garrisonAccordion.rightEl.textContent = total > 0 ? `${total} units` : "";
    this.garrisonAccordion.element.style.display = this.garrisonView.isOwned() ? "" : "none";
  }

  private treasuryStrip(settlement: ReturnType<CityView["getSettlementState"]>): HTMLDivElement {
    const treasury = recruitmentTreasury(settlement);
    const strip = document.createElement("div");
    Object.assign(strip.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      flexWrap: "wrap",
      fontSize: "11px",
      opacity: "0.9",
      paddingBottom: "2px",
    });
    const entries: Array<["gold" | "wood" | "stone" | "iron" | "arcane", number, string]> = [
      ["gold", treasury.gold, "Treasury gold"],
      ["wood", treasury.warehouse.wood ?? 0, "Wood in the warehouse"],
      ["stone", treasury.warehouse.stone ?? 0, "Stone in the warehouse"],
      ["iron", treasury.warehouse.iron ?? 0, "Iron in the warehouse"],
      ["arcane", treasury.warehouse.arcane ?? 0, "Arcane in the warehouse"],
    ];
    for (const [resource, amount, tip] of entries) {
      const chip = buildCostChip(RESOURCE_PILE_BUBBLY_SPRITES[resource], resource, amount, ICON_RESOURCE);
      chip.title = tip;
      strip.appendChild(chip);
    }
    return strip;
  }

  private groupBlock(group: RecruitmentGroup, model: RecruitmentSnapshotModel): HTMLDivElement {
    const block = document.createElement("div");
    Object.assign(block.style, {
      display: "flex",
      flexDirection: "column",
      paddingTop: "4px",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginBottom: "2px",
      cursor: "default",
    });

    const label = document.createElement("span");
    label.textContent = group.label;
    label.title = this.groupTooltip(group);
    Object.assign(label.style, {
      fontSize: "10px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "#7fd0ff",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      flex: "1",
      minWidth: "0",
    });
    header.appendChild(label);

    const settlement = this.cityView.getSettlementState();
    const canBuy = group.units.some((u) => recruitmentMaxCount(settlement, u) >= 1);
    const buyAll = document.createElement("button");
    buyAll.textContent = "Buy all";
    styleButton(buyAll);
    Object.assign(buyAll.style, { padding: "0px 6px", fontSize: "10px", lineHeight: "1.6", flexShrink: "0" });
    buyAll.disabled = !canBuy;
    buyAll.style.opacity = canBuy ? "1" : "0.35";
    buyAll.style.cursor = canBuy ? "pointer" : "not-allowed";
    buyAll.title = canBuy
      ? `Recruit everything ${group.label} offers that the treasury and draft pools allow — the most-stocked building first, then round robin between them`
      : `Nothing ready or affordable from ${group.label}`;
    buyAll.addEventListener("click", () => this.buyAll(group.kind));
    header.appendChild(buyAll);
    block.appendChild(header);

    for (const unit of group.units) {
      block.appendChild(this.unitBlock(group, unit, model));
    }
    return block;
  }

  private groupTooltip(group: RecruitmentGroup): string {
    const lines = [`${group.label} — ${group.buildings.length} building${group.buildings.length === 1 ? "" : "s"}`];
    for (const b of group.buildings) {
      const where = b.district ? `district (${b.district.q}, ${b.district.r}) cell (${b.gx}, ${b.gy})` : `main city (${b.gx}, ${b.gy})`;
      const staff = b.workers === undefined ? "auto-staffed" : `${b.workers}/${b.maxWorkers} workers`;
      lines.push(`· ${where} · L${b.level} · ${staff}`);
    }
    return lines.join("\n");
  }

  private rowKey(group: RecruitmentGroup, unit: RecruitmentUnitRow): string {
    return `${group.kind}:${unit.unitTypeId}`;
  }

  private toggleRow(key: string): void {
    if (this.expandedRows.has(key)) this.expandedRows.delete(key);
    else this.expandedRows.add(key);
    this.update();
  }

  /**
   * One unit: its image row is the parent. The parent carries the aggregate
   * pool, the bulk worker stepper (every source at once) and the recruit `+`;
   * clicking it -- never on a button -- accordions the per-building rows.
   */
  private unitBlock(group: RecruitmentGroup, unit: RecruitmentUnitRow, model: RecruitmentSnapshotModel): HTMLDivElement {
    const settlement = this.cityView.getSettlementState();
    const catalogue = getCachedUnit(unit.unitTypeId);
    const name = catalogue?.name ?? unit.unitTypeId;
    const max = recruitmentMaxCount(settlement, unit);
    const canRecruitOne = recruitmentAffordable(settlement, unit, 1) && unit.ready >= 1;
    const key = this.rowKey(group, unit);
    const expanded = this.expandedRows.has(key);
    const buildingCount = `${unit.sources.length} ${group.label} building${unit.sources.length === 1 ? "" : "s"}`;

    const block = document.createElement("div");
    Object.assign(block.style, {
      display: "flex",
      flexDirection: "column",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      paddingTop: "4px",
    });

    const parent = document.createElement("div");
    Object.assign(parent.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      paddingBottom: "4px",
      cursor: "pointer",
      opacity: unit.ready < 1 ? "0.55" : "1",
    });
    parent.dataset.recruitParent = key;
    parent.dataset.expanded = expanded ? "true" : "false";
    parent.title = `${this.unitTooltip(unit, name, max)}\nClick to ${expanded ? "hide" : "show"} ${buildingCount} that train this unit`;

    const main = document.createElement("div");
    Object.assign(main.style, { display: "flex", alignItems: "center", gap: "8px" });

    const chevron = document.createElement("span");
    chevron.textContent = "\u25B6";
    Object.assign(chevron.style, {
      fontSize: "9px",
      opacity: "0.55",
      flexShrink: "0",
      transition: "transform 120ms ease-out",
      transform: expanded ? "rotate(90deg)" : "",
    });
    main.appendChild(chevron);

    const icon = document.createElement("img");
    icon.src = getUnitImageUrl(unit.unitTypeId);
    icon.alt = name;
    Object.assign(icon.style, {
      width: `${ICON_UNIT}px`,
      height: `${ICON_UNIT}px`,
      objectFit: "contain",
      imageRendering: "pixelated",
      flexShrink: "0",
    });
    main.appendChild(icon);

    const info = document.createElement("div");
    Object.assign(info.style, {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
      flex: "1",
      minWidth: "0",
    });

    const nameEl = document.createElement("span");
    nameEl.textContent = name;
    Object.assign(nameEl.style, {
      fontSize: "12px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    info.appendChild(nameEl);

    const costLine = document.createElement("span");
    Object.assign(costLine.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "10px",
      opacity: "0.8",
    });
    costLine.appendChild(buildCostChip(RESOURCE_PILE_BUBBLY_SPRITES.gold, "gold", unit.goldCost, ICON_RESOURCE));
    for (const cost of unit.resources) {
      costLine.appendChild(buildCostChip(RESOURCE_PILE_BUBBLY_SPRITES[cost.resource], cost.resource, cost.amount, ICON_RESOURCE));
    }
    info.appendChild(costLine);
    main.appendChild(info);

    const side = document.createElement("div");
    Object.assign(side.style, { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", flexShrink: "0" });

    const ready = document.createElement("span");
    ready.textContent = `${unit.ready}/${unit.capacity}`;
    ready.title = `Ready now / draft pool ceiling across ${unit.sources.length} building${unit.sources.length === 1 ? "" : "s"} (each refills ${formatRate(unit.draftMax === 0 ? 0 : unit.perWeek / 7 / Math.max(1, unit.sources.length))}/day while staffed)`;
    Object.assign(ready.style, {
      fontSize: "10px",
      opacity: "0.65",
      fontVariantNumeric: "tabular-nums",
    });
    side.appendChild(ready);

    const rate = document.createElement("span");
    rate.textContent = `+${formatRate(unit.perWeek)}/wk`;
    rate.title = `Draft refill: ${formatRate(unit.perWeek)}/week across every ${unit.buildingKind} building\nbase × staffing effort × unit tier per building, capped at ${unit.draftMax} each\nStaff the buildings from this row to refill faster`;
    Object.assign(rate.style, {
      fontSize: "9px",
      opacity: "0.5",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    side.appendChild(rate);

    const recruitBtn = document.createElement("button");
    recruitBtn.textContent = "+";
    recruitBtn.dataset.recruitBuy = unit.unitTypeId;
    styleButton(recruitBtn, true);
    Object.assign(recruitBtn.style, { padding: "0px 9px", fontSize: "13px", lineHeight: "1.5" });
    recruitBtn.disabled = !canRecruitOne;
    recruitBtn.style.opacity = canRecruitOne ? "1" : "0.35";
    recruitBtn.style.cursor = canRecruitOne ? "pointer" : "not-allowed";
    recruitBtn.title = canRecruitOne
      ? `Recruit 1 from the most-stocked building — Shift-click to recruit ${max} from every ${group.label} building at once`
      : max === 0
        ? "Nothing ready, or the treasury cannot pay for one"
        : "Not ready";
    recruitBtn.addEventListener("click", (e) => {
      const liveMax = recruitmentMaxCount(this.cityView.getSettlementState(), unit);
      const count = e.shiftKey ? liveMax : 1;
      if (count < 1) return;
      let ok = true;
      for (const step of allocateRecruitCounts(unit, count)) {
        const done = this.onRecruit({
          buildingKind: unit.buildingKind,
          gx: step.gx,
          gy: step.gy,
          district: step.district,
          unitTypeId: unit.unitTypeId,
          count: step.count,
        });
        if (!done) {
          ok = false;
          break;
        }
      }
      if (ok) this.cityView.notifyRecruitmentCommit();
      this.update();
    });
    side.appendChild(recruitBtn);
    main.appendChild(side);
    parent.appendChild(main);

    const staffRow = document.createElement("div");
    Object.assign(staffRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "6px",
    });
    for (const node of this.unitStaffing(group, unit, model, name)) staffRow.appendChild(node);
    parent.appendChild(staffRow);

    parent.addEventListener("click", (e) => {
      if ((e.target as HTMLElement | null)?.closest("button")) return;
      this.toggleRow(key);
    });
    block.appendChild(parent);

    const children = document.createElement("div");
    children.dataset.recruitChildren = key;
    Object.assign(children.style, {
      display: expanded ? "flex" : "none",
      flexDirection: "column",
      gap: "1px",
      marginLeft: "10px",
      paddingLeft: "8px",
      borderLeft: "1px solid rgba(255,255,255,0.08)",
    });
    if (expanded) {
      for (const source of unit.sources) children.appendChild(this.sourceLine(source, group, model));
    }
    block.appendChild(children);
    return block;
  }

  /** One building's own line, nested under the unit row: its location, its
   * worker stepper, and the only door onto that building's own menu. */
  private sourceLine(source: RecruitmentSource, group: RecruitmentGroup, model: RecruitmentSnapshotModel): HTMLDivElement {
    const line = document.createElement("div");
    Object.assign(line.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      paddingTop: "2px",
    });
    line.dataset.recruitChild = `${group.kind}:${source.gx},${source.gy}`;
    line.title = `${group.label} · ${source.district ? "district" : "main city"} (${source.gx}, ${source.gy}) · L${source.buildingLevel}`;

    const where = document.createElement("span");
    where.textContent = source.district
      ? `dist ${source.district.q},${source.district.r} · ${source.gx},${source.gy} · L${source.buildingLevel}`
      : `main · ${source.gx},${source.gy} · L${source.buildingLevel}`;
    Object.assign(where.style, {
      fontSize: "9px",
      opacity: "0.45",
      flex: "1",
      minWidth: "0",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    line.appendChild(where);

    for (const node of this.workerStepper(source, source.district ? "district building" : "main-city building", model)) {
      line.appendChild(node);
    }
    this.makeOpenBuildingTarget(
      line,
      { buildingKind: group.kind, gx: source.gx, gy: source.gy, district: source.district },
      `Open this ${group.label} (its own menu: workers, draft pool, upgrades)`,
    );
    return line;
  }

  /**
   * A row that opens one building's own menu -- the very menu an iso-grid click
   * on that cell opens, placed at the building, with the building ringed while
   * the menu is up. Clicks that land on a button (steppers, Buy all, +) keep
   * their own meaning, and hovering the row rings the building on the grid.
   */
  private makeOpenBuildingTarget(el: HTMLElement, target: RecruitmentBuildingOpenRequest, hint: string): void {
    el.style.cursor = "pointer";
    el.title = el.title ? `${el.title} — ${hint}` : hint;
    el.addEventListener("mouseenter", () =>
      this.cityView.previewWorkforceBuilding(target.gx, target.gy, target.district),
    );
    el.addEventListener("mouseleave", () => this.cityView.clearWorkforcePreview());
    el.addEventListener("click", (e) => {
      if (!this.onOpenBuilding) return;
      if ((e.target as HTMLElement | null)?.closest("button")) return;
      this.onOpenBuilding(target);
    });
  }

  private stepper(opts: StepperOptions): HTMLElement[] {
    const chip = document.createElement("span");
    Object.assign(chip.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "2px",
      fontSize: "10px",
      fontVariantNumeric: "tabular-nums",
      opacity: "0.8",
      whiteSpace: "nowrap",
      flexShrink: "0",
    });
    chip.title = opts.tip;

    const icon = document.createElement("img");
    icon.src = getUnitImageUrl("peasant");
    icon.alt = "worker";
    Object.assign(icon.style, {
      width: `${ICON_RESOURCE}px`,
      height: `${ICON_RESOURCE}px`,
      objectFit: "contain",
      imageRendering: "pixelated",
      flexShrink: "0",
      opacity: "0.9",
    });
    chip.appendChild(icon);

    const count = document.createElement("span");
    count.textContent = opts.count;
    count.title = opts.countTitle;
    chip.appendChild(count);

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.dataset.recruitStaff = "remove";
    styleButton(minus);
    Object.assign(minus.style, { padding: "0px 6px", fontSize: "12px", lineHeight: "1.4", flexShrink: "0" });
    minus.disabled = !opts.canRemove;
    minus.style.opacity = opts.canRemove ? "1" : "0.35";
    minus.style.cursor = opts.canRemove ? "pointer" : "not-allowed";
    minus.title = opts.removeTitle;
    minus.addEventListener("click", opts.onRemove);

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.dataset.recruitStaff = "add";
    styleButton(plus);
    Object.assign(plus.style, { padding: "0px 6px", fontSize: "12px", lineHeight: "1.4", flexShrink: "0" });
    plus.disabled = !opts.canAdd;
    plus.style.opacity = opts.canAdd ? "1" : "0.35";
    plus.style.cursor = opts.canAdd ? "pointer" : "not-allowed";
    plus.title = opts.addTitle;
    plus.addEventListener("click", opts.onAdd);

    return [chip, minus, plus];
  }

  /**
   * Worker count + stepper for one building: peasant sprite, current count (or
   * "Auto" while the settlement is still legacy-staffed) and −/+ that commit
   * one worker against this building's own district. Same rules as the
   * workforce panel -- the first click normalizes the settlement to explicit
   * crews and the engine auto-crews the rest.
   */
  private workerStepper(
    building: RecruitmentStaffable,
    what: string,
    model: RecruitmentSnapshotModel,
  ): HTMLElement[] {
    const base = recruitmentWorkerBase(building, model);
    const idle = recruitmentIdleWorkers(model);
    const explicit = building.workers !== undefined;
    const canRemove = recruitmentCanRemoveWorker(building, model);
    const canAdd = recruitmentCanAddWorker(building, model);
    return this.stepper({
      tip: `${what}: recruiters refill the draft pool${explicit ? "" : " (auto-staffed at full effort until you touch it)"}\nIdle workers: ${idle} of ${model.pool}`,
      count: explicit ? `${building.workers}/${building.maxWorkers}` : "Auto",
      countTitle: explicit
        ? `Of ${building.maxWorkers} worker slots on this building`
        : `Auto-staffed at full effort (max ${building.maxWorkers})`,
      removeTitle: canRemove ? "Take one worker off this building" : "No workers assigned here",
      addTitle: canAdd
        ? `Put one worker on this building (${idle} idle)`
        : base >= building.maxWorkers
          ? `All ${building.maxWorkers} worker slots filled`
          : "No idle workers in the pool",
      canRemove,
      canAdd,
      onRemove: () => this.commitWorkers(building, model, -1),
      onAdd: () => this.commitWorkers(building, model, 1),
    });
  }

  private commitWorkers(building: RecruitmentStaffable, model: RecruitmentSnapshotModel, delta: 1 | -1): void {
    const target = recruitmentWorkerTarget(building, model, delta);
    const ok = this.cityView.onAssignWorkers?.(
      building.gx,
      building.gy,
      target,
      building.district ?? undefined,
    ) ?? false;
    if (ok) this.cityView.notifyWorkforceCommit();
    this.update();
  }

  /**
   * The parent row's staffing readout and stepper: one click shifts one worker
   * across EVERY building that trains this unit (emptiest first for `+`,
   * fullest first for `−`), so the common case needs no expansion.
   */
  private unitStaffing(
    group: RecruitmentGroup,
    unit: RecruitmentUnitRow,
    model: RecruitmentSnapshotModel,
    name: string,
  ): HTMLElement[] {
    const summary = recruitmentStaffing(unit.sources, model);
    const canAdd = recruitmentCanStaffAny(unit.sources, model);
    const canRemove = recruitmentCanUnstaffAny(unit.sources, model);
    const count = `${unit.sources.length} ${group.label} building${unit.sources.length === 1 ? "" : "s"}`;
    return this.stepper({
      tip: `Recruiters for ${name} across ${count}: refill the draft pool${summary.auto ? " (auto-staffed at full effort until you touch it)" : ""}\nOne click staffs every listed building at once\nIdle workers: ${summary.idle} of ${model.pool}`,
      count: summary.auto ? "Auto" : `${summary.workers}/${summary.maxWorkers}`,
      countTitle: summary.auto
        ? `Auto-staffed at full effort (max ${summary.maxWorkers} across these buildings)`
        : `Workers across all ${count} (${summary.maxWorkers} slots)`,
      removeTitle: canRemove ? `Take one worker off every ${group.label} building` : "No workers assigned to these buildings",
      addTitle: canAdd
        ? `Put one worker on every ${group.label} building at once (${summary.idle} idle)`
        : "Every building is fully staffed, or there are no idle workers",
      canRemove,
      canAdd,
      onRemove: () => this.bulkStaff(group.kind, unit.unitTypeId, -1),
      onAdd: () => this.bulkStaff(group.kind, unit.unitTypeId, 1),
    });
  }

  private bulkStaff(kind: BuildingKind, unitTypeId: string, delta: 1 | -1): void {
    const live = this.cityView.recruitmentSnapshot();
    const sources = recruitmentGroupFor(live, kind)?.units.find((u) => u.unitTypeId === unitTypeId)?.sources ?? [];
    if (sources.length === 0) return;
    let committed = false;
    for (const step of allocateWorkerSteps(sources, live, delta)) {
      const ok = this.cityView.onAssignWorkers?.(
        step.gx,
        step.gy,
        step.workers,
        step.district ?? undefined,
      ) ?? false;
      if (ok) committed = true;
    }
    if (committed) this.cityView.notifyWorkforceCommit();
    this.update();
  }

  /**
   * Buy all of one kind: every unit the kind offers, as much as the pools and
   * the treasury allow, drawn most-stocked building first then round robin
   * (see allocateRecruitCounts). Each step re-reads the live settlement, so a
   * step that spends the last gold simply stops the rest.
   */
  private buyAll(kind: BuildingKind): void {
    const model = this.cityView.recruitmentSnapshot();
    const group = recruitmentGroupFor(model, kind);
    if (!group) return;
    let committed = 0;
    for (const row of group.units) {
      const max = recruitmentMaxCount(this.cityView.getSettlementState(), row);
      if (max < 1) continue;
      for (const step of allocateRecruitCounts(row, max)) {
        const ok = this.onRecruit({
          buildingKind: kind,
          gx: step.gx,
          gy: step.gy,
          district: step.district,
          unitTypeId: row.unitTypeId,
          count: step.count,
        });
        if (!ok) break;
        committed += step.count;
      }
    }
    if (committed > 0) this.cityView.notifyRecruitmentCommit();
    this.update();
  }

  private unitTooltip(unit: RecruitmentUnitRow, name: string, max: number): string {
    const parts = [`${name} · ${unit.ready}/${unit.capacity} ready · +${formatRate(unit.perWeek)}/week`];
    const stats = getCachedUnit(unit.unitTypeId);
    if (stats) {
      const bits = [`ATK ${stats.attack}`, `DEF ${stats.defence}`, `HP ${stats.health}`];
      if (stats.upkeepGold !== undefined || stats.upkeepFood !== undefined) {
        bits.push(`upkeep ${stats.upkeepGold ?? 0}g ${stats.upkeepFood ?? 0}f`);
      }
      if (stats.specialty) bits.push(stats.specialty);
      parts.push(bits.join(" · "));
    }
    const costParts = [`${unit.goldCost}g`];
    for (const cost of unit.resources) costParts.push(`${cost.amount} ${cost.resource}`);
    parts.push(`${costParts.join(" + ")} each${max > 0 ? ` · up to ${max}` : ""}`);
    if (unit.sources.length > 1) {
      const pools = unit.sources.map((s) => `${s.ready}`).join(" / ");
      parts.push(`Pools (most-stocked first): ${pools}`);
    }
    return parts.join("\n");
  }
}
