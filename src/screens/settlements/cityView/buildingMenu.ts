import { PopupMenu, styleButton } from "@screens/shared/menu";
import type { BuildingDef, BuildingKind } from "../../../render/cityBuildingDraw";
import type { SettlementState } from "../../../state/gameState";
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
  type RecruitEntry,
} from "@heroes/engine";
import type { Warehouse } from "@heroes/contracts";

function formatEffectLine(kind: BuildingKind, level: number): string[] {
  const lines: string[] = [];
  const se = buildingSettlementEffects(kind, level);
  const pe = buildingPlayerEffects(kind, level);
  const upkeep = buildingUpkeep(kind, level);

  if (se.goldPerTurn) lines.push(`+${se.goldPerTurn} gold/turn`);
  if (se.foodPerTurn) lines.push(`+${se.foodPerTurn} food/turn`);
  if (se.populationBonus) lines.push(`+${se.populationBonus} population`);
  if (se.defenseBonus) lines.push(`+${se.defenseBonus} defense`);
  if (se.unitCostReductionPct) lines.push(`-${se.unitCostReductionPct}% unit cost`);
  if (se.resourceYieldBonus) {
    for (const [r, v] of Object.entries(se.resourceYieldBonus)) {
      if (v > 0) lines.push(`+${v} ${r}/turn`);
    }
  }
  if (pe.visionRangeBonus) lines.push(`+${pe.visionRangeBonus} vision range`);
  if (pe.controlRangeBonus) lines.push(`+${pe.controlRangeBonus} control range`);
  if (pe.heroSpeedBonus) lines.push(`+${pe.heroSpeedBonus} hero speed`);
  if (pe.heroAttackBonus) lines.push(`+${pe.heroAttackBonus} hero attack`);

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
}

const TOWN_HALL_UPGRADE_COSTS: Record<number, { gold: number; wood: number; stone: number; days: number }> = {
  1: { gold: 1500, wood: 15, stone: 10, days: 7 },
  2: { gold: 5000, wood: 40, stone: 25, days: 12 },
};

interface ShowArgs {
  building: BuildingDef;
  screenX: number;
  screenY: number;
  settlement?: SettlementState;
  producerCell?: ProducerCellInfo | null;
  constructionDaysRemaining?: number;
}

export class BuildingMenu {
  private menu: PopupMenu | null = null;
  private onRecruitUnits: ((building: BuildingDef, unitTypeId: string, count: number) => void) | undefined;
  private onUpgradeTownHall: (() => void) | undefined;
  private onUpgradeBuilding: ((building: BuildingDef) => void) | undefined;
  private lastShow: ShowArgs | null = null;

  constructor(opts: BuildingMenuOptions = {}) {
    this.onRecruitUnits = opts.onRecruitUnits;
    this.onUpgradeTownHall = opts.onUpgradeTownHall;
    this.onUpgradeBuilding = opts.onUpgradeBuilding;
  }

  show(
    building: BuildingDef,
    screenX: number,
    screenY: number,
    settlement?: SettlementState,
    producerCell?: ProducerCellInfo | null,
    constructionDaysRemaining?: number,
  ): void {
    this.lastShow = { building, screenX, screenY, settlement, producerCell, constructionDaysRemaining };
    this.showMenu(building, screenX, screenY, settlement, producerCell, constructionDaysRemaining);
  }

  private showMenu(
    building: BuildingDef,
    screenX: number,
    screenY: number,
    settlement?: SettlementState,
    producerCell?: ProducerCellInfo | null,
    constructionDaysRemaining?: number,
  ): void {
    this.hide();

    const x = Math.max(10, Math.min(screenX, window.innerWidth - 240));
    const y = Math.max(10, Math.min(screenY, window.innerHeight - 180));

    this.menu = new PopupMenu({
      parent: document.body,
      title: buildingLabel(building.kind) + (building.level > 1 ? ` (Lv ${building.level})` : ""),
      initialPosition: { x, y },
      width: 240,
      zIndex: 75,
      onClose: () => { this.menu = null; },
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

    const effects = formatEffectLine(building.kind, building.level);
    if (effects.length > 0) {
      const effDiv = document.createElement("div");
      effDiv.style.marginBottom = "4px";
      for (const line of effects) {
        const el = document.createElement("div");
        el.textContent = line;
        Object.assign(el.style, {
          fontSize: "11px",
          color: "#8f8",
          lineHeight: "1.5",
        });
        effDiv.appendChild(el);
      }
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

    if (constructionDaysRemaining !== undefined) {
      const conEl = document.createElement("div");
      conEl.textContent = `Under construction — ${constructionDaysRemaining} day${constructionDaysRemaining === 1 ? "" : "s"} remaining`;
      Object.assign(conEl.style, {
        fontSize: "11px",
        color: "#f0c860",
        lineHeight: "1.5",
        marginBottom: "4px",
      });
      this.menu.appendContent(conEl);
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

    if (building.kind === "townHall" && building.level < 3 && this.onUpgradeTownHall) {
      const cost = TOWN_HALL_UPGRADE_COSTS[building.level];
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

        const canAfford = settlement && settlement.gold >= cost.gold
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
        upgradeBtn.addEventListener("click", () => {
          if (canAfford) {
            this.onUpgradeTownHall?.();
            this.hide();
          }
        });
        row.appendChild(upgradeBtn);

        this.menu.appendContent(row);
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

        const canAfford = settlement && settlement.gold >= cost.gold
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

    if (constructionDaysRemaining === undefined) {
      const effect = getBuildingEffect(building.kind);
      const entries = effect.recruits.filter((r) => (r.minLevel ?? 1) <= building.level);
      if (!catalogReady() && !catalogFailed()) {
        void loadUnitCatalog().then(() => {
          if (this.menu && this.lastShow && this.lastShow.building === building) {
            this.show(this.lastShow.building, this.lastShow.screenX, this.lastShow.screenY, this.lastShow.settlement, this.lastShow.producerCell, this.lastShow.constructionDaysRemaining);
          }
        });
      }
      for (const entry of entries) {
        this.menu.appendContent(this.buildRecruitRow(building, entry, settlement));
      }
    }
  }

  private buildRecruitRow(building: BuildingDef, entry: RecruitEntry, settlement?: SettlementState): HTMLDivElement {
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
    countInput.max = "99";
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
      return Math.min(99, parsed);
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
      recruitBtn.disabled = !afford;
      recruitBtn.style.opacity = afford ? "1" : "0.4";
      recruitBtn.style.cursor = afford ? "pointer" : "not-allowed";
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
}
