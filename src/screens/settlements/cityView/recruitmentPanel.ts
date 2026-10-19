import { PopupMenu, styleButton } from "@screens/shared/menu";
import { AccordionSection } from "@screens/shared/panelWidgets";
import { loadPanelGeometry, savePanelGeometry, type PanelGeometryKey } from "@screens/shared/panelLayout";
import { toolbarHeight } from "@screens/shared/panelRail";
import type { BuildingKind } from "@heroes/contracts";
import type { GameState, HeroState } from "../../../state/gameState";
import { catalogFailed, catalogReady, getCachedUnit, loadUnitCatalog } from "../../../data/unitCatalog";
import { getUnitImageUrl } from "../../../data/unitImages";
import { RESOURCE_PILE_BUBBLY_SPRITES } from "../../../render/assetDescriptors";
import { GarrisonView, type GarrisonTransferRequest } from "../garrisonView";
import {
  allocateRecruitCounts,
  recruitmentAffordable,
  recruitmentCanAddWorker,
  recruitmentCanRemoveWorker,
  recruitmentGroupFor,
  recruitmentIdleWorkers,
  recruitmentMaxCount,
  recruitmentTreasury,
  recruitmentWorkerBase,
  recruitmentWorkerTarget,
  type RecruitmentBuildingRow,
  type RecruitmentGroup,
  type RecruitmentSnapshotModel,
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

/**
 * One place to see every unit this settlement can train and to actually train
 * it: rows are grouped by BUILDING KIND (one FARMHOUSE block however many
 * farmhouses exist), each kind carries a buy-all, each building carries its own
 * worker stepper, and the settlement's garrison is the settlement panel's own
 * GarrisonView mounted here -- one representation, two surfaces. Minimal by
 * design: icons, counts and buttons; everything verbal lives in a tooltip.
 */
export class RecruitmentPanel {
  private menu: PopupMenu | null = null;
  private readonly parent: HTMLElement;
  private readonly cityView: CityView;
  private readonly onRecruit: (req: RecruitmentRequest) => boolean;
  private readonly onOpenBuilding?: (req: RecruitmentBuildingOpenRequest) => boolean;
  private readonly getGameState?: () => GameState | undefined;
  private readonly garrisonView: GarrisonView;
  private readonly garrisonAccordion: AccordionSection;

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
    this.menu = new PopupMenu({
      parent: this.parent,
      title: "Recruitment",
      width: PANEL_WIDTH,
      initialPosition: pos,
      minTop: toolbarHeight,
      zIndex: 76,
      closeable: true,
      draggable: true,
      clickToFront: true,
      // Same shared resize grip any other panel can take with one flag.
      resizeable: true,
      resizeKey: PANEL_GEOMETRY_KEY,
      onClose: () => {
        this.cityView.clearWorkforcePreview();
        this.menu = null;
      },
      onMove: (p) => savePanelGeometry(PANEL_GEOMETRY_KEY, p),
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
    const settlement = this.cityView.getSettlementState();
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

    // A single building of this kind keeps its stepper on the title line; with
    // several, each gets its own line below (labelled by location, so the kind
    // name is never repeated).
    if (group.buildings.length === 1) {
      for (const node of this.workerStepper(group.buildings[0], group.label, model)) header.appendChild(node);
    }
    // One building of this kind: the header IS that building's row, so it opens
    // its menu. Several: each gets its own line below (labelled by location, so
    // the kind name is never repeated) and the header stays a pure heading.
    if (group.buildings.length === 1) {
      this.makeBuildingTarget(header, group.buildings[0], group.kind);
    }
    block.appendChild(header);

    for (const unit of group.units) {
      block.appendChild(this.unitRow(unit));
    }

    if (group.buildings.length > 1) {
      for (const building of group.buildings) {
        block.appendChild(this.buildingLine(building, model, group.kind));
      }
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

  /** One building's own line: where it is, then its worker stepper. */
  private buildingLine(building: RecruitmentBuildingRow, model: RecruitmentSnapshotModel, kind: BuildingKind): HTMLDivElement {
    const line = document.createElement("div");
    Object.assign(line.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      paddingTop: "2px",
    });

    const where = document.createElement("span");
    where.textContent = building.district
      ? `dist ${building.district.q},${building.district.r} · ${building.gx},${building.gy}`
      : `main · ${building.gx},${building.gy}`;
    where.title = building.district
      ? `${building.district ? "District" : "Main city"} building at cell (${building.gx}, ${building.gy})`
      : `Main-city building at cell (${building.gx}, ${building.gy})`;
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

    for (const node of this.workerStepper(building, building.district ? "district building" : "main-city building", model)) {
      line.appendChild(node);
    }
    this.makeBuildingTarget(line, building, kind);
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

  /** The per-building line (and the kind's heading when it has one building). */
  private makeBuildingTarget(el: HTMLElement, building: RecruitmentBuildingRow, kind: BuildingKind): void {
    this.makeOpenBuildingTarget(
      el,
      { buildingKind: kind, gx: building.gx, gy: building.gy, district: building.district },
      `Open this ${kind} (its own menu: workers, draft pool, upgrades)`,
    );
  }

  /**
   * Worker count + stepper for one building: peasant sprite, current count (or
   * "Auto" while the settlement is still legacy-staffed) and −/+ that commit
   * one worker against this building's own district. Same rules as the
   * workforce panel -- the first click normalizes the settlement to explicit
   * crews and the engine auto-crews the rest.
   */
  private workerStepper(
    building: RecruitmentBuildingRow,
    what: string,
    model: RecruitmentSnapshotModel,
  ): HTMLElement[] {
    const base = recruitmentWorkerBase(building, model);
    const idle = recruitmentIdleWorkers(model);
    const explicit = building.workers !== undefined;

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
    chip.title = `${what}: recruiters refill the draft pool${explicit ? "" : " (auto-staffed at full effort until you touch it)"}\nIdle workers: ${idle} of ${model.pool}`;

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
    count.textContent = explicit ? `${building.workers}/${building.maxWorkers}` : "Auto";
    chip.appendChild(count);

    const minus = document.createElement("button");
    minus.textContent = "−";
    styleButton(minus);
    Object.assign(minus.style, { padding: "0px 6px", fontSize: "12px", lineHeight: "1.4", flexShrink: "0" });
    const canRemove = recruitmentCanRemoveWorker(building, model);
    minus.disabled = !canRemove;
    minus.style.opacity = canRemove ? "1" : "0.35";
    minus.style.cursor = canRemove ? "pointer" : "not-allowed";
    minus.title = canRemove ? "Take one worker off this building" : "No workers assigned here";

    const plus = document.createElement("button");
    plus.textContent = "+";
    styleButton(plus);
    Object.assign(plus.style, { padding: "0px 6px", fontSize: "12px", lineHeight: "1.4", flexShrink: "0" });
    const canAdd = recruitmentCanAddWorker(building, model);
    plus.disabled = !canAdd;
    plus.style.opacity = canAdd ? "1" : "0.35";
    plus.style.cursor = canAdd ? "pointer" : "not-allowed";
    plus.title = canAdd
      ? `Put one worker on this building (${idle} idle)`
      : base >= building.maxWorkers
        ? `All ${building.maxWorkers} worker slots filled`
        : "No idle workers in the pool";

    const commit = (delta: 1 | -1): void => {
      const target = recruitmentWorkerTarget(building, model, delta);
      const ok = this.cityView.onAssignWorkers?.(
        building.gx,
        building.gy,
        target,
        building.district ?? undefined,
      ) ?? false;
      if (ok) this.cityView.notifyWorkforceCommit();
      this.update();
    };
    minus.addEventListener("click", () => commit(-1));
    plus.addEventListener("click", () => commit(1));

    return [chip, minus, plus];
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

  private unitRow(unit: RecruitmentUnitRow): HTMLDivElement {
    const settlement = this.cityView.getSettlementState();
    const catalogue = getCachedUnit(unit.unitTypeId);
    const name = catalogue?.name ?? unit.unitTypeId;
    const max = recruitmentMaxCount(settlement, unit);
    const canRecruitOne = recruitmentAffordable(settlement, unit, 1) && unit.ready >= 1;

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "4px 0",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      opacity: unit.ready < 1 ? "0.55" : "1",
    });

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
    row.appendChild(icon);

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
    row.appendChild(info);

    const side = document.createElement("div");
    Object.assign(side.style, { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" });

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
    rate.title = `Draft refill: ${formatRate(unit.perWeek)}/week across every ${unit.buildingKind} building\nbase × staffing effort × unit tier per building, capped at ${unit.draftMax} each\nAdd workers on the building lines to refill faster`;
    Object.assign(rate.style, {
      fontSize: "9px",
      opacity: "0.5",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
    });
    side.appendChild(rate);

    const recruitBtn = document.createElement("button");
    recruitBtn.textContent = "+";
    styleButton(recruitBtn, true);
    Object.assign(recruitBtn.style, { padding: "0px 9px", fontSize: "13px", lineHeight: "1.5" });
    recruitBtn.disabled = !canRecruitOne;
    recruitBtn.style.opacity = canRecruitOne ? "1" : "0.35";
    recruitBtn.style.cursor = canRecruitOne ? "pointer" : "not-allowed";
    recruitBtn.title = canRecruitOne
      ? `Recruit 1 from the most-stocked building — Shift-click to recruit ${max}`
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
    row.appendChild(side);

    row.title = this.unitTooltip(unit, name, max);
    // The unit row is the other half of "that building's row": clicking the unit
    // art (or anywhere on the row but the buttons) opens the menu of the
    // building this row recruits from -- `sources[0]`, the fullest one, which is
    // exactly the building `+` draws on.
    const source = unit.sources[0];
    if (source) {
      const where = source.district
        ? `district (${source.district.q}, ${source.district.r})`
        : "main city";
      this.makeOpenBuildingTarget(
        row,
        {
          buildingKind: unit.buildingKind,
          gx: source.gx,
          gy: source.gy,
          district: source.district,
        },
        `Open the ${unit.buildingKind} that supplies this unit — ${where} (${source.gx}, ${source.gy})`,
      );
    }
    return row;
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
