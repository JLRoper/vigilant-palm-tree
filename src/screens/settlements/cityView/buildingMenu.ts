import { FloatingPanel, styleButton } from "@screens/shared/panel";
import type { BuildingDef, BuildingKind } from "@heroes/contracts";
import type { SettlementState } from "../../../state/gameState";
import { siteStatus } from "./siteStatus";
import { catalogFailed, catalogReady, getCachedUnit, loadUnitCatalog } from "../../../data/unitCatalog";
import { getUnitImageUrl } from "../../../data/unitImages";
import {
  buildingLabel,
  buildingDescription,
  buildingPlacementCost,
  buildingSettlementEffects,
  buildingPlayerEffects,
  buildingUpkeep,
  buildingUpgradeCost,
  getBuildingEffect,
  buildingDraftMax,
  canAssignWorkers,
  districtKey,
  effortFraction,
  workforcePool,
  assignedWorkersExplicit,
  buildingLegacyStaffing,
  staffingBase,
  staffingCeiling,
  steppedWorkers,
  TOWN_HALL_COSTS,
  type RecruitEntry,
} from "@heroes/engine";
import type { Warehouse } from "@heroes/contracts";
import { footprintLine } from "./footprint";
import { townHallUpgradeScope, townHallUpgradeScopeLine } from "./upgradeScope";
import { upgradeRefusalTitle } from "../upgradeRefusal";

function formatEffectLine(kind: BuildingKind, level: number, effort = 1): string[] {
  const lines: string[] = [];
  const se = buildingSettlementEffects(kind, level);
  const pe = buildingPlayerEffects(kind, level);
  const upkeep = buildingUpkeep(kind, level);
  const scaled = (value: number): string => {
    const n = Math.round(value * effort * 100) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };
  const staffNote = effort < 0.999 ? ` (${Math.round(effort * 100)}% staffed)` : "";

  if (se.goldPerTurn) lines.push(`+${scaled(se.goldPerTurn)} gold/turn${staffNote}`);
  if (se.foodPerTurn) lines.push(`+${scaled(se.foodPerTurn)} food/turn${staffNote}`);
  if (se.populationBonus) lines.push(`+${se.populationBonus} population`);
  if (se.defenseBonus) lines.push(`+${se.defenseBonus} defense`);
  if (se.unitCostReductionPct) lines.push(`-${se.unitCostReductionPct}% unit cost`);
  if (se.resourceYieldBonus) {
    for (const [r, v] of Object.entries(se.resourceYieldBonus)) {
      if (v > 0) lines.push(`+${v} ${r}/turn`);
    }
  }
  if (pe.controlRangeBonus) lines.push(`+${pe.controlRangeBonus} control range`);

  if (upkeep.wood > 0 || upkeep.stone > 0) {
    const parts: string[] = [];
    if (upkeep.wood > 0) parts.push(`${upkeep.wood}w`);
    if (upkeep.stone > 0) parts.push(`${upkeep.stone}s`);
    lines.push(`Upkeep: ${parts.join(" ")}/turn`);
  }

  return lines;
}

function formatRecruitCost(entry: RecruitEntry, count: number): string {
  const parts = [`${entry.goldCost * count}g`];
  if (entry.resourceCost) {
    for (const [res, v] of Object.entries(entry.resourceCost)) {
      if (v > 0) parts.push(`${v * count}${res[0]}`);
    }
  }
  return parts.join(" ");
}

function formatPlacementCost(kind: BuildingKind): string {
  const cost = buildingPlacementCost(kind);
  const parts: string[] = [];
  for (const [r, v] of Object.entries(cost)) {
    if (v > 0) {
      const suffix = r === "gold" ? "g" : r[0];
      parts.push(`${v}${suffix}`);
    }
  }
  return parts.length > 0 ? `Cost: ${parts.join(" ")}` : "";
}

export interface ProducerCellInfo {
  multiplier: number;
  resource: string;
  basePerTurn: number;
  amount: number;
}

export interface BuildingMenuOptions {
  onRecruitUnits?: (building: BuildingDef, unitTypeId: string, count: number) => void;
  onUpgradeTownHall?: () => void;
  onUpgradeBuilding?: (building: BuildingDef) => void;
  /** Faction gate for the recruit list: false hides the row. Absent = no gate (today's behavior). */
  isUnitRecruitable?: (unitTypeId: string) => boolean;
  /** Fired whenever the open menu goes away (×, Esc, or a replacement menu).
   *  Named `onMenuClosed` because `onClose` is the CityView-level callback. */
  onMenuClosed?: () => void;
}

/**
 * Workforce context passed by the city view (wave 2a): pool/assigned are the
 * settlement's explicit workforce totals, district names which list the
 * building came from (null = main settlement, the stepper passes it back on
 * every commit so assignments are district-true), onAssignWorkers assigns
 * a single building's explicit count, and getSettlement re-reads the LIVE
 * settlement so the stepper can re-resolve the building after each commit
 * (the engine replaces state objects immutably, so a captured snapshot goes
 * stale). Absent keeps the pre-workforce menu unchanged.
 */
export interface BuildingMenuWorkforce {
  pool: number;
  assigned: number;
  district: { q: number; r: number } | null;
  onChange: () => void;
  onAssignWorkers: (gx: number, gy: number, workers: number, district?: { q: number; r: number }) => boolean;
  getSettlement: () => SettlementState | undefined;
}

// The town hall's own price list is the ENGINE's (`TOWN_HALL_COSTS`,
// packages/engine/src/settlement/upgradeTownHall.ts) rather than a copy: the
// menu used to keep a second table that merely happened to match, so the price
// a player reads and the price the reducer charges could drift apart without
// anything failing.
const TOWN_HALL_UPGRADE_COSTS = TOWN_HALL_COSTS;

interface ShowArgs {
  building: BuildingDef;
  screenX: number;
  screenY: number;
  settlement?: SettlementState;
  producerCell?: ProducerCellInfo | null;
  constructionDaysRemaining?: number;
  workforce?: BuildingMenuWorkforce;
}

export class BuildingMenu {
  private menu: FloatingPanel | null = null;
  private onRecruitUnits: ((building: BuildingDef, unitTypeId: string, count: number) => void) | undefined;
  private onUpgradeTownHall: (() => void) | undefined;
  private onUpgradeBuilding: ((building: BuildingDef) => void) | undefined;
  private isUnitRecruitable: ((unitTypeId: string) => boolean) | undefined;
  private onMenuClosed: (() => void) | undefined;
  private lastShow: ShowArgs | null = null;

  constructor(opts: BuildingMenuOptions = {}) {
    this.onRecruitUnits = opts.onRecruitUnits;
    this.onUpgradeTownHall = opts.onUpgradeTownHall;
    this.onUpgradeBuilding = opts.onUpgradeBuilding;
    this.isUnitRecruitable = opts.isUnitRecruitable;
    this.onMenuClosed = opts.onMenuClosed;
  }

  show(
    building: BuildingDef,
    screenX: number,
    screenY: number,
    settlement?: SettlementState,
    producerCell?: ProducerCellInfo | null,
    constructionDaysRemaining?: number,
    workforce?: BuildingMenuWorkforce,
  ): void {
    this.lastShow = { building, screenX, screenY, settlement, producerCell, constructionDaysRemaining, workforce };
    this.showMenu(building, screenX, screenY, settlement, producerCell, constructionDaysRemaining, workforce);
  }

  private showMenu(
    building: BuildingDef,
    screenX: number,
    screenY: number,
    settlement?: SettlementState,
    producerCell?: ProducerCellInfo | null,
    constructionDaysRemaining?: number,
    workforce?: BuildingMenuWorkforce,
  ): void {
    this.hide();

    const x = Math.max(10, Math.min(screenX, window.innerWidth - 240));
    const y = Math.max(10, Math.min(screenY, window.innerHeight - 180));

    this.menu = new FloatingPanel({
      parent: document.body,
      title: buildingLabel(building.kind) + (building.level > 1 ? ` (Lv ${building.level})` : ""),
      initialPosition: { x, y },
      width: 240,
      zIndex: 75,
      clickToFront: true,
      resizeable: true,
      resizeKey: "buildingMenu",
      stackable: true,
      onClose: () => {
        this.menu = null;
        this.onMenuClosed?.();
      },
    });

    const desc = document.createElement("div");
    desc.textContent = buildingDescription(building.kind);
    Object.assign(desc.style, {
      fontSize: "12px",
      opacity: "0.8",
      lineHeight: "1.4",
      marginBottom: "2px",
    });
    this.menu.appendContent(desc);

    // Live re-resolution for the workforce stepper + recruit readouts: the
    // engine replaces the settlement object on every assignment, so the row
    // must re-read state through the context's accessor after each commit.
    const resolveLive = workforce
      ? (): BuildingDef | undefined => {
          const live = workforce.getSettlement();
          if (!live) return undefined;
          const list = workforce.district
            ? live.districts?.[districtKey(workforce.district.q, workforce.district.r)]?.buildings
            : live.buildings;
          return list?.find((b) => b.gx === building.gx && b.gy === building.gy && b.kind === building.kind);
        }
      : undefined;
    // What this menu is ABOUT, read live, plus the one question the site line
    // asks of it: is this still a SITE, and how many days has it left. Both are
    // resolved through the same live accessor rather than off the snapshot the
    // menu was opened with (2026-11-03). `refreshIfOpen` re-shows an open menu
    // from `lastShow` whenever the state moves, so a captured day count was
    // composed once and then re-rendered verbatim for as long as the menu stayed
    // open: a site progressing underneath it kept reading its open-day number,
    // and one that COMPLETED under the menu kept its "Under construction" line
    // (and kept hiding the recruit rows). The caller's own snapshot is used only
    // when there is no live settlement to read at all.
    const liveTarget = (): BuildingDef => resolveLive?.() ?? building;
    const siteDays = (): number | undefined =>
      resolveLive ? liveTarget().construction?.daysRemaining : constructionDaysRemaining;
    const recruitRefreshers: Array<() => void> = [];

    const effects = formatEffectLine(building.kind, building.level);
    if (effects.length > 0) {
      const effDiv = document.createElement("div");
      effDiv.style.marginBottom = "4px";
      const currentEffort = (): number => effortFraction(resolveLive?.() ?? building);
      const renderEffects = (): void => {
        effDiv.replaceChildren();
        for (const line of formatEffectLine(building.kind, building.level, currentEffort())) {
          const el = document.createElement("div");
          el.textContent = line;
          Object.assign(el.style, {
            fontSize: "11px",
            color: "#8f8",
            lineHeight: "1.5",
          });
          effDiv.appendChild(el);
        }
      };
      renderEffects();
      recruitRefreshers.push(renderEffects);
      this.menu.appendContent(effDiv);
    }

    const producerLine = producerCell
      ? `Cell ×${producerCell.multiplier.toFixed(2)} → +${producerCell.amount.toFixed(2)} ${producerCell.resource}/turn`
      : null;
    if (producerLine) {
      const prodEl = document.createElement("div");
      prodEl.textContent = producerLine;
      Object.assign(prodEl.style, {
        fontSize: "11px",
        color: "#7fd0ff",
        lineHeight: "1.5",
        marginBottom: "4px",
      });
      this.menu.appendContent(prodEl);
    }

    if (workforce && staffingCeiling(building) >= 1) {
      this.menu.appendContent(this.buildWorkforceRow(building, workforce, resolveLive, recruitRefreshers));
    }

    const daysNow = siteDays();
    if (daysNow !== undefined) {
      this.menu.appendContent(this.buildSiteStatusLine(liveTarget(), daysNow));
    }

    const costStr = formatPlacementCost(building.kind);
    if (costStr) {
      const costDiv = document.createElement("div");
      costDiv.textContent = costStr;
      Object.assign(costDiv.style, {
        fontSize: "10px",
        opacity: "0.6",
        marginBottom: "4px",
      });
      this.menu.appendContent(costDiv);
    }

    const footprintStr = footprintLine(building.kind, building.level);
    if (footprintStr) {
      const fpDiv = document.createElement("div");
      fpDiv.textContent = footprintStr;
      Object.assign(fpDiv.style, {
        fontSize: "10px",
        opacity: "0.6",
        marginBottom: "4px",
      });
      this.menu.appendContent(fpDiv);
    }

    if (building.kind === "townHall" && building.level < 3 && this.onUpgradeTownHall) {
      const cost = TOWN_HALL_UPGRADE_COSTS[building.level];
      if (cost) {
        // E3: the offer used to price only its own one-off cost and its 7 days,
        // so the click that levels the WHOLE city (every building, districts
        // included) and doubles its per-day upkeep read like a cheap upgrade.
        // The engine's own rule, stated before the purchase.
        const scopeLine = settlement
          ? townHallUpgradeScopeLine(townHallUpgradeScope(settlement, building.level + 1), building.level + 1)
          : "";
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.marginTop = "4px";
        row.style.marginBottom = "4px";

        const info = document.createElement("span");
        info.textContent = `L${building.level + 1}: ${cost.gold}g ${cost.wood}w ${cost.stone}s / ${cost.days}d`;
        info.style.fontSize = "10px";
        info.style.opacity = "0.75";
        row.appendChild(info);

        const canAfford = settlement !== undefined
          && settlement.gold >= cost.gold
          && (settlement.warehouse.wood ?? 0) >= cost.wood
          && (settlement.warehouse.stone ?? 0) >= cost.stone
          && !settlement.upgrade;

        const upgradeBtn = document.createElement("button");
        upgradeBtn.textContent = "Upgrade";
        styleButton(upgradeBtn, true);
        upgradeBtn.style.padding = "2px 8px";
        upgradeBtn.style.fontSize = "11px";
        if (!canAfford) {
          upgradeBtn.style.opacity = "0.4";
          upgradeBtn.style.cursor = "not-allowed";
        }
        upgradeBtn.disabled = !canAfford;
        // A dead control carries its reason in its own `title` -- the channel
        // the build palette's dead rows already use (buildEntryStatus.ts), since
        // this menu has no notice row of its own and the palette's belongs to
        // another panel. F-2/F-6: the reason names the cap when the cap, not the
        // income, is what stands in the way (see upgradeRefusal.ts).
        upgradeBtn.title = !settlement
          ? "Open this settlement to see what the upgrade needs"
          : canAfford
            ? `Raise the town hall to L${building.level + 1} (${cost.gold}g ${cost.wood}w ${cost.stone}s, ${cost.days} days). ${scopeLine}`
            : [upgradeRefusalTitle({ settlement, cost, inProgress: !!settlement.upgrade }), scopeLine].filter(Boolean).join("\n");
        upgradeBtn.addEventListener("click", () => {
          if (canAfford) {
            this.onUpgradeTownHall?.();
            this.hide();
          }
        });
        row.appendChild(upgradeBtn);

        this.menu.appendContent(row);

        if (scopeLine) {
          const scopeEl = document.createElement("div");
          scopeEl.textContent = scopeLine;
          Object.assign(scopeEl.style, {
            fontSize: "10px",
            opacity: "0.75",
            lineHeight: "1.4",
            marginBottom: "4px",
          });
          this.menu.appendContent(scopeEl);
        }
      }
    }

    if (building.kind !== "townHall" && building.level < 3 && this.onUpgradeBuilding) {
      const cost = buildingUpgradeCost(building.kind, building.level);
      if (cost) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.marginTop = "4px";
        row.style.marginBottom = "4px";

        const info = document.createElement("span");
        info.textContent = `L${building.level + 1}: ${cost.gold}g ${cost.wood}w ${cost.stone}s / ${cost.days}d`;
        info.style.fontSize = "10px";
        info.style.opacity = "0.75";
        row.appendChild(info);

        const canAfford = settlement !== undefined
          && settlement.gold >= cost.gold
          && (settlement.warehouse.wood ?? 0) >= cost.wood
          && (settlement.warehouse.stone ?? 0) >= cost.stone
          && !settlement.upgrade
          && !building.construction;

        const upgradeBtn = document.createElement("button");
        upgradeBtn.textContent = "Upgrade";
        styleButton(upgradeBtn, true);
        upgradeBtn.style.padding = "2px 8px";
        upgradeBtn.style.fontSize = "11px";
        if (!canAfford) {
          upgradeBtn.style.opacity = "0.4";
          upgradeBtn.style.cursor = "not-allowed";
        }
        upgradeBtn.disabled = !canAfford;
        // Same channel and vocabulary as the town hall row above.
        upgradeBtn.title = !settlement
          ? "Open this settlement to see what the upgrade needs"
          : canAfford
            ? `Raise this building to L${building.level + 1} (${cost.gold}g ${cost.wood}w ${cost.stone}s, ${cost.days} days)`
            : upgradeRefusalTitle({
                settlement,
                cost,
                inProgress: !!settlement.upgrade,
                extra: building.construction ? ["Still under construction"] : [],
              });
        upgradeBtn.addEventListener("click", () => {
          if (canAfford) {
            this.onUpgradeBuilding?.(building);
            this.hide();
          }
        });
        row.appendChild(upgradeBtn);

        this.menu.appendContent(row);
      }
    }

    if (siteDays() === undefined) {
      const effect = getBuildingEffect(building.kind);
      const entries = effect.recruits.filter(
        (r) =>
          (r.minLevel ?? 1) <= building.level &&
          (this.isUnitRecruitable ? this.isUnitRecruitable(r.unitTypeId) : true),
      );
      if (!catalogReady() && !catalogFailed()) {
        void loadUnitCatalog().then(() => {
          if (this.menu && this.lastShow && this.lastShow.building === building) {
            this.show(this.lastShow.building, this.lastShow.screenX, this.lastShow.screenY, this.lastShow.settlement, this.lastShow.producerCell, this.lastShow.constructionDaysRemaining, this.lastShow.workforce);
          }
        });
      }
      for (const entry of entries) {
        this.menu.appendContent(this.buildRecruitRow(building, entry, settlement, resolveLive, recruitRefreshers));
      }
    }
  }

  /**
   * The site's own line (design §6.1). Same element, same colour, same raw day
   * number as before -- fractions included -- with the CREW and the RATE added:
   * `Under construction — 1.33× (2 of 4 builders) · 4 days remaining`, or
   * `Under construction — stalled: no builders · 4 days remaining` when nobody
   * is on the site, which under the build-crew rule means it is not advancing at
   * all. The sentence itself is `siteStatus` (asserted directly, no DOM), and the
   * `data-*` hooks carry the same crew and rate so a browser pass can read them
   * without parsing the words.
   *
   * `building` is the LIVE site and `daysRemaining` its LIVE timer, both resolved
   * by the caller on every render (2026-11-03): this element used to be composed
   * once from the snapshot the menu was opened with, so a menu left open read a
   * frozen crew and a frozen day count until it was closed and reopened.
   */
  private buildSiteStatusLine(building: BuildingDef, daysRemaining: number): HTMLDivElement {
    const status = siteStatus(building, daysRemaining);
    const conEl = document.createElement("div");
    conEl.textContent = status.text;
    conEl.dataset.testid = "site-status";
    conEl.dataset.builders = String(status.builders);
    conEl.dataset.rate = status.rate;
    Object.assign(conEl.style, {
      fontSize: "11px",
      color: "#f0c860",
      lineHeight: "1.5",
      marginBottom: "4px",
    });
    return conEl;
  }

  private buildWorkforceRow(
    building: BuildingDef,
    workforce: BuildingMenuWorkforce,
    resolveLive: (() => BuildingDef | undefined) | undefined,
    recruitRefreshers: Array<() => void>,
  ): HTMLDivElement {
    // The CREW CEILING, not the kind's operational cap: a building under
    // construction takes up to `CONSTRUCTION_MAX_BUILDERS` whatever its kind
    // (2026-11-03), so the stepper, its `n / max` and its `+` gate would all
    // disagree with the reducer if this read `buildingMaxWorkers`.
    const max = staffingCeiling(building);
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: "4px",
      marginBottom: "4px",
    });

    const label = document.createElement("span");
    label.textContent = "Workers";
    Object.assign(label.style, {
      fontSize: "11px",
      opacity: "0.85",
    });
    row.appendChild(label);

    const controls = document.createElement("div");
    Object.assign(controls.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    const minus = document.createElement("button");
    minus.textContent = "−";
    styleButton(minus);
    Object.assign(minus.style, {
      padding: "0px 7px",
      fontSize: "12px",
    });

    const value = document.createElement("span");
    Object.assign(value.style, {
      fontSize: "11px",
      fontVariantNumeric: "tabular-nums",
      minWidth: "56px",
      textAlign: "center",
    });

    const plus = document.createElement("button");
    plus.textContent = "+";
    styleButton(plus);
    Object.assign(plus.style, {
      padding: "0px 7px",
      fontSize: "12px",
    });

    // THE BUILDING's own legaciness, not the settlement's (2026-11-03). A city
    // holding ONE auto-crewed building reads legacy as a whole, and a
    // settlement-wide base of 0 made `+` write 1 forever on every other
    // building -- which is what left the 4-builder site this feature introduces
    // unreachable from this control (measured: three `+` clicks on a real
    // level-2 town sent three identical `{"kind":"AssignWorkers","workers":1}`
    // commands and the row stayed `1 / 4`). The building is still resolved live
    // on every read: a commit normalizes the whole city, so the menu-open
    // snapshot goes stale.
    const baseNow = (live: BuildingDef): number =>
      staffingBase(live.workers, max, buildingLegacyStaffing(live));

    const refresh = (): void => {
      const live = resolveLive?.();
      if (!live) return;
      const base = baseNow(live);
      value.textContent = live.workers === undefined ? "Auto (max)" : `${live.workers} / ${max}`;
      const liveSettlement = workforce.getSettlement();
      const pool = liveSettlement ? workforcePool(liveSettlement) : workforce.pool;
      const assigned = liveSettlement ? assignedWorkersExplicit(liveSettlement) : workforce.assigned;
      const plusDisabled = !canAssignWorkers(base, max, 1, pool, assigned);
      plus.disabled = plusDisabled;
      plus.style.opacity = plusDisabled ? "0.4" : "1";
      plus.style.cursor = plusDisabled ? "not-allowed" : "pointer";
      const minusDisabled = base <= 0;
      minus.disabled = minusDisabled;
      minus.style.opacity = minusDisabled ? "0.4" : "1";
      minus.style.cursor = minusDisabled ? "not-allowed" : "pointer";
      for (const fn of recruitRefreshers) fn();
    };

    minus.addEventListener("click", () => {
      const live = resolveLive?.();
      if (!live) return;
      workforce.onAssignWorkers(building.gx, building.gy, steppedWorkers(live, max, -1), workforce.district ?? undefined);
      workforce.onChange();
      refresh();
    });
    plus.addEventListener("click", () => {
      const live = resolveLive?.();
      if (!live) return;
      workforce.onAssignWorkers(building.gx, building.gy, steppedWorkers(live, max, 1), workforce.district ?? undefined);
      workforce.onChange();
      refresh();
    });

    controls.appendChild(minus);
    controls.appendChild(value);
    controls.appendChild(plus);
    row.appendChild(controls);
    refresh();
    return row;
  }

  private buildRecruitRow(
    building: BuildingDef,
    entry: RecruitEntry,
    settlement?: SettlementState,
    resolveLive?: (() => BuildingDef | undefined),
    recruitRefreshers?: Array<() => void>,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      marginTop: "4px",
      paddingTop: "6px",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    });

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
    });

    const icon = document.createElement("img");
    icon.src = getUnitImageUrl(entry.unitTypeId);
    Object.assign(icon.style, {
      width: "24px",
      height: "24px",
      imageRendering: "pixelated",
      objectFit: "contain",
      flexShrink: "0",
    });
    icon.alt = entry.unitTypeId;
    row.appendChild(icon);

    const name = document.createElement("span");
    name.textContent = getCachedUnit(entry.unitTypeId)?.name ?? entry.unitTypeId;
    name.style.flex = "1";
    name.style.fontSize = "11px";
    row.appendChild(name);

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    const draftMax = buildingDraftMax(building.kind);
    const availOf = (b: BuildingDef): number => Math.floor(b.draft?.[entry.unitTypeId] ?? draftMax);
    const avail = availOf(building);
    countInput.max = String(Math.max(1, avail));
    countInput.value = "1";
    Object.assign(countInput.style, {
      width: "46px",
      padding: "2px 4px",
      fontSize: "11px",
      background: "#0e0e0e",
      color: "#eee",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "3px",
      fontFamily: "inherit",
      boxSizing: "border-box",
    });
    row.appendChild(countInput);

    const ready = document.createElement("span");
    ready.textContent = `ready ${avail}/${draftMax}`;
    Object.assign(ready.style, {
      fontSize: "10px",
      opacity: "0.75",
      fontVariantNumeric: "tabular-nums",
      flexShrink: "0",
    });
    row.appendChild(ready);

    if (resolveLive && recruitRefreshers) {
      recruitRefreshers.push(() => {
        const live = resolveLive();
        if (!live) return;
        ready.textContent = `ready ${availOf(live)}/${draftMax}`;
      });
    }

    const totalRow = document.createElement("div");
    Object.assign(totalRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: "4px",
    });

    const total = document.createElement("span");
    total.style.fontSize = "10px";
    total.style.opacity = "0.75";
    total.style.fontVariantNumeric = "tabular-nums";
    totalRow.appendChild(total);

    const recruitBtn = document.createElement("button");
    recruitBtn.textContent = "Recruit";
    styleButton(recruitBtn, true);
    recruitBtn.style.padding = "2px 8px";
    recruitBtn.style.fontSize = "11px";
    totalRow.appendChild(recruitBtn);

    const clampCount = (): number => {
      const parsed = parseInt(countInput.value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) return 1;
      return Math.min(Math.max(1, avail), parsed);
    };
    const canAfford = (n: number): boolean => {
      if (!settlement) return false;
      if (settlement.gold < entry.goldCost * n) return false;
      if (entry.resourceCost) {
        for (const [res, v] of Object.entries(entry.resourceCost)) {
          if (v > 0 && (settlement.warehouse[res as keyof Warehouse] ?? 0) < v * n) return false;
        }
      }
      return true;
    };
    const refresh = (): void => {
      const n = clampCount();
      total.textContent = formatRecruitCost(entry, n);
      const afford = canAfford(n);
      const poolEmpty = avail < 1;
      recruitBtn.disabled = !afford || poolEmpty;
      recruitBtn.style.opacity = afford && !poolEmpty ? "1" : "0.4";
      recruitBtn.style.cursor = afford && !poolEmpty ? "pointer" : "not-allowed";
      recruitBtn.title = poolEmpty
        ? "None ready — recharges (base × staffing × unit tier) per day"
        : "";
    };

    countInput.addEventListener("input", refresh);
    countInput.addEventListener("blur", () => {
      countInput.value = String(clampCount());
      refresh();
    });
    recruitBtn.addEventListener("click", () => {
      const n = clampCount();
      this.onRecruitUnits?.(building, entry.unitTypeId, n);
      this.hide();
    });
    refresh();

    wrap.appendChild(row);
    wrap.appendChild(totalRow);
    return wrap;
  }

  hide(): void {
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
  }

  isOpen(): boolean {
    return this.menu !== null;
  }

  /** Re-renders an open menu from its last show args (no-op when closed). */
  refreshIfOpen(): void {
    if (this.menu && this.lastShow) {
      this.show(
        this.lastShow.building,
        this.lastShow.screenX,
        this.lastShow.screenY,
        this.lastShow.settlement,
        this.lastShow.producerCell,
        this.lastShow.constructionDaysRemaining,
        this.lastShow.workforce,
      );
    }
  }
}
