import { PopupMenu, styleButton } from "./menu";
import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw";
import type { SettlementState } from "../state/gameState";
import {
  buildingLabel,
  buildingDescription,
  buildingPlacementCost,
  buildingSettlementEffects,
  buildingPlayerEffects,
  buildingUpkeep,
  buildingUpgradeCost,
  getBuildingEffect,
} from "@heroes/engine";

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

  const effect = getBuildingEffect(kind);
  for (const r of effect.recruits) {
    const costParts = [`${r.goldCost}g`];
    if (r.resourceCost) {
      for (const [res, v] of Object.entries(r.resourceCost)) {
        if (v > 0) costParts.push(`${v}${res[0]}`);
      }
    }
    lines.push(`Recruit: ${r.unitTypeId} (${costParts.join(" ")})`);
  }

  return lines;
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

export interface BuildingMenuOptions {
  onRecruitArcher?: () => void;
  onUpgradeTownHall?: () => void;
  onUpgradeBuilding?: (building: BuildingDef) => void;
}

const TOWN_HALL_UPGRADE_COSTS: Record<number, { gold: number; wood: number; stone: number; days: number }> = {
  1: { gold: 1500, wood: 15, stone: 10, days: 7 },
  2: { gold: 5000, wood: 40, stone: 25, days: 12 },
};

export class BuildingMenu {
  private menu: PopupMenu | null = null;
  private onRecruitArcher: (() => void) | undefined;
  private onUpgradeTownHall: (() => void) | undefined;
  private onUpgradeBuilding: ((building: BuildingDef) => void) | undefined;

  constructor(opts: BuildingMenuOptions = {}) {
    this.onRecruitArcher = opts.onRecruitArcher;
    this.onUpgradeTownHall = opts.onUpgradeTownHall;
    this.onUpgradeBuilding = opts.onUpgradeBuilding;
  }

  show(building: BuildingDef, screenX: number, screenY: number, settlement?: SettlementState): void {
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

    if (building.kind === "archeryRange") {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "flex-end";
      row.style.gap = "8px";

      const recruitBtn = document.createElement("button");
      recruitBtn.textContent = "Recruit Archer";
      styleButton(recruitBtn, true);
      recruitBtn.addEventListener("click", () => {
        this.onRecruitArcher?.();
        this.hide();
      });
      row.appendChild(recruitBtn);

      this.menu.appendContent(row);
    }
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
